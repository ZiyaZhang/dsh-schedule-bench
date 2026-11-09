/**
 * Scheduled-task benchmark. One vitest file, copied into `apps/web/tests/` of a DSH checkout and run with
 * `vitest.web.config.ts`. It boots the shipped Web composition in-process through the repository's own e2e
 * scaffold and drives the Host task API, so both checkouts are measured through the same entry points.
 *
 * Environment:
 *   BENCH_TASK      t1 | t2 | t3 | t4
 *   BENCH_OUT       absolute path of the result JSON
 *   BENCH_LABEL     free-form label stored in the result (for example the checkout name)
 *   BENCH_COMMIT    commit of the checkout, stored in the result
 *   BENCH_FIXTURES  absolute path of tasks/t2-morning (t2 only)
 *   BENCH_SAMPLES   t2 sample count (default 5)
 *   t2 also needs DSH_SNAPSHOT=record and DEEPSEEK_API_KEY (DEEPSEEK_BASE_URL optional).
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, platform, release } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScheduleId, createAfterScheduleRecord, createEveryScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { ScheduleRecord, ScheduleTask } from '@deepseek-ai/dsh-schedule'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const TASK = process.env.BENCH_TASK ?? ''
const OUT = process.env.BENCH_OUT ?? ''
const FAKE_PROVIDER = 'bench-fake'
const FAKE_MODEL = 'reply'
const SECOND = 1_000
const MINUTE = 60 * SECOND

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const log = (message: string): void => { process.stderr.write(`[bench ${new Date().toISOString()}] ${message}\n`) }

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(stepMs)
  }
  return await check()
}

/** Model stand-in: answers every request at once with a short text, optionally after a fixed delay. */
class FakeAdapter extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: FAKE_MODEL, name: `${provider}/${FAKE_MODEL}` }] }
  requests = 0
  delayMs = 0
  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests++
    if (this.delayMs > 0) await sleep(this.delayMs)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Process-level resource sampling over one measurement window. */
class Probe {
  private readonly loop = monitorEventLoopDelay({ resolution: 5 })
  private cpu = process.cpuUsage()
  private started = 0
  private rssMax = 0
  private timer: ReturnType<typeof setInterval> | undefined
  start(): void {
    this.loop.reset()
    this.loop.enable()
    this.cpu = process.cpuUsage()
    this.started = performance.now()
    this.rssMax = process.memoryUsage().rss
    this.timer = setInterval(() => { this.rssMax = Math.max(this.rssMax, process.memoryUsage().rss) }, 250)
  }
  stop(): Record<string, number> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.loop.disable()
    const cpu = process.cpuUsage(this.cpu)
    this.rssMax = Math.max(this.rssMax, process.memoryUsage().rss)
    return {
      wallMs: round(performance.now() - this.started),
      cpuMs: round((cpu.user + cpu.system) / 1_000),
      loopDelayMaxMs: round(this.loop.max / 1e6),
      loopDelayP99Ms: round(this.loop.percentile(99) / 1e6),
      rssMaxMb: round(this.rssMax / 2 ** 20),
    }
  }
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function stats(values: readonly number[]): Record<string, number | null> {
  if (values.length === 0) return { n: 0, p50: null, p95: null, max: null, mean: null }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? NaN
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1] ?? NaN),
    mean: round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
  }
}

interface Occurrence { taskId: string; occurrenceAt: string; time: number; batchSize: number; sessionId: string }

/** Reminder occurrences that entered model-visible history, read from one Session's events. */
function occurrencesIn(handle: AgentHandle): Occurrence[] {
  const out: Occurrence[] = []
  for (const event of handle.agent.session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    const message = event.data
    if (message.source.kind !== 'schedule') continue
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    if (text.includes('[SCHEDULE CHANGE]')) continue
    const lines = text.split('\n')
    const value = (prefix: string): string | undefined => lines.find(line => line.startsWith(prefix))?.slice(prefix.length)
    if (lines[0] === '[SCHEDULE REMINDER BATCH]') {
      const list = JSON.parse(value('reminders_json: ') ?? '[]') as { schedule_id: string; occurrence_at: string }[]
      for (const item of list) {
        out.push({ taskId: item.schedule_id, occurrenceAt: item.occurrence_at, time: event.time, batchSize: list.length, sessionId: handle.agent.id })
      }
    } else if (lines[0] === '[SCHEDULE REMINDER]') {
      out.push({
        taskId: JSON.parse(value('schedule_id_json: ') ?? '""') as string,
        occurrenceAt: value('occurrence_at: ') ?? '',
        time: event.time,
        batchSize: 1,
        sessionId: handle.agent.id,
      })
    }
  }
  return out
}

function idle(handle: AgentHandle): boolean {
  const { agent } = handle
  return agent.status === 'idle' && agent.inbox.nextTurn.length === 0 && agent.inbox.nextStep.length === 0
}

describe('schedule bench', () => {
  let scaffold: WebScaffold
  const fake = new FakeAdapter()
  const sessions = new Map<string, AgentHandle>()
  let sessionSerial = 0

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([FAKE_PROVIDER], fake), 'bench fake adapter')
  }, 180_000)

  afterAll(async () => {
    await scaffold?.close()
  }, 120_000)

  async function session(label: string, options: { cwd?: string; provider?: string; model?: string } = {}): Promise<AgentHandle> {
    const id = `bench-${label}-${++sessionSerial}`
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(id),
      meta: { cwd: options.cwd ?? scaffold.workspaceCwd },
      agentOptions: { provider: options.provider ?? FAKE_PROVIDER, model: options.model ?? FAKE_MODEL },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    sessions.set(id, handle)
    return handle
  }

  async function create(handle: AgentHandle, title: string, prompt: string, timing: Record<string, unknown>): Promise<string> {
    const view = await scaffold.ctx.schedule.create(
      // The timing union is checked by the Host; the bench passes plain JSON values.
      { title, prompt, timing: timing as never, target: { kind: 'session', sessionId: handle.agent.id } },
      handle.agent.id,
    )
    return view.id
  }

  async function remove(id: string, actor: AgentHandle): Promise<void> {
    await scaffold.ctx.schedule.edit({ action: 'delete', id: ScheduleId(id) }, actor.agent.id)
  }

  async function deliveries(id: string): Promise<{ scheduledAt: string; deliveredAt: string; targetSessionId: string }[]> {
    const page = await scaffold.ctx.schedule.history({ id: ScheduleId(id), limit: 100 })
    return 'records' in page ? page.records.map(r => ({ scheduledAt: r.scheduledAt, deliveredAt: r.deliveredAt, targetSessionId: r.targetSessionId })) : []
  }

  async function report(body: Record<string, unknown>): Promise<void> {
    const result = {
      task: TASK,
      label: process.env.BENCH_LABEL ?? '',
      commit: process.env.BENCH_COMMIT ?? '',
      node: process.version,
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? '',
      finishedAt: new Date().toISOString(),
      ...body,
    }
    await mkdir(join(OUT, '..'), { recursive: true })
    await writeFile(OUT, JSON.stringify(result, null, 2) + '\n')
  }

  /**
   * t1 — on time, nothing missed or repeated. 60 one-shot tasks three seconds apart over six Sessions,
   * ten 60-second recurring tasks created six seconds apart (one per Session), and three every-minute
   * cron tasks; about five minutes of firing.
   */
  async function t1(): Promise<void> {
    const atSessions = await Promise.all(Array.from({ length: 6 }, (_, i) => session(`t1-at${i}`)))
    const everySessions = await Promise.all(Array.from({ length: 10 }, (_, i) => session(`t1-every${i}`)))
    const cronSessions = await Promise.all(Array.from({ length: 3 }, (_, i) => session(`t1-cron${i}`)))
    const probe = new Probe()
    probe.start()
    const startedAt = Date.now()
    const atStart = Math.ceil((startedAt + 15 * SECOND) / SECOND) * SECOND
    const atTasks: { id: string; at: number; session: AgentHandle }[] = []
    for (let i = 0; i < 60; i++) {
      const at = atStart + i * 3 * SECOND
      const handle = atSessions[i % 6]!
      atTasks.push({ id: await create(handle, `at ${i}`, `One-shot check ${i}.`, { kind: 'at', at: new Date(at).toISOString() }), at, session: handle })
    }
    const cronTasks: { id: string; session: AgentHandle; createdAt: number }[] = []
    for (const [i, handle] of cronSessions.entries()) {
      const createdAt = Date.now()
      const id = await create(handle, `cron ${i}`, `Minute check ${i}.`, { kind: 'cron', cron: { expression: '* * * * *', time_zone: 'UTC' } })
      cronTasks.push({ id, session: handle, createdAt })
    }
    const everyTasks: { id: string; session: AgentHandle; firstAt: number }[] = []
    for (const [i, handle] of everySessions.entries()) {
      const before = Date.now()
      const id = await create(handle, `every ${i}`, `Recurring check ${i}.`, { kind: 'every', every_seconds: 60 })
      const view = (await scaffold.ctx.schedule.catalog()).find(entry => entry.id === id)
      const firstAt = view === undefined ? before + MINUTE : Date.parse(view.scheduledAt ?? new Date(before + MINUTE).toISOString())
      everyTasks.push({ id, session: handle, firstAt })
      if (i < everySessions.length - 1) await sleep(6 * SECOND)
    }
    // Run until every recurring task has fired three times and the last one-shot task has fired.
    const lastEvery = Math.max(...everyTasks.map(t => t.firstAt))
    const until = Math.max(lastEvery + 2 * MINUTE, atStart + 59 * 3 * SECOND) + 5 * SECOND
    await sleep(Math.max(0, until - Date.now()))
    const cutoff = Date.now()
    // History is read before the recurring tasks are deleted; a deleted task has no history.
    const history = new Map<string, Awaited<ReturnType<typeof deliveries>>>()
    for (const task of [...atTasks, ...everyTasks, ...cronTasks]) history.set(task.id, await deliveries(task.id))
    for (const task of [...everyTasks, ...cronTasks]) await remove(task.id, task.session)
    await waitUntil(() => [...atSessions, ...everySessions, ...cronSessions].every(idle), 30 * SECOND)
    const resources = probe.stop()

    const latency: Record<string, number[]> = { at: [], every: [], cron: [] }
    const problems = { missed: 0, duplicated: 0, wrongSession: 0, unexpected: 0 }
    let expectedCount = 0
    const seen = new Map<string, number>()
    for (const handle of [...atSessions, ...everySessions, ...cronSessions]) {
      for (const o of occurrencesIn(handle)) seen.set(`${o.taskId}@${o.occurrenceAt}`, (seen.get(`${o.taskId}@${o.occurrenceAt}`) ?? 0) + 1)
    }
    for (const count of seen.values()) if (count > 1) problems.duplicated += count - 1
    // Occurrences due more than two seconds before the cutoff must be delivered; ones within two seconds may or may not be.
    const check = (kind: string, id: string, handle: AgentHandle, grid: number[]): void => {
      const records = history.get(id) ?? []
      for (const r of records) {
        latency[kind]!.push(Date.parse(r.deliveredAt) - Date.parse(r.scheduledAt))
        if (r.targetSessionId !== handle.agent.id) problems.wrongSession++
      }
      const delivered = new Set(records.map(r => Date.parse(r.scheduledAt)))
      const required = grid.filter(at => at <= cutoff - 2 * SECOND)
      expectedCount += required.length
      for (const at of required) if (!delivered.has(at)) problems.missed++
      for (const at of delivered) if (!grid.includes(at)) problems.unexpected++
    }
    for (const t of atTasks) check('at', t.id, t.session, [t.at])
    for (const t of everyTasks) {
      const grid: number[] = []
      for (let at = t.firstAt; at <= cutoff; at += MINUTE) grid.push(at)
      check('every', t.id, t.session, grid)
    }
    for (const t of cronTasks) {
      const grid: number[] = []
      for (let at = Math.ceil((t.createdAt + 1) / MINUTE) * MINUTE; at <= cutoff; at += MINUTE) grid.push(at)
      check('cron', t.id, t.session, grid)
    }
    const all = [...latency.at!, ...latency.every!, ...latency.cron!]
    await report({
      params: { atTasks: 60, atSpacingSeconds: 3, atSessions: 6, everyTasks: 10, everyStaggerSeconds: 6, cronTasks: 3 },
      expectedDeliveries: expectedCount,
      deliveries: all.length,
      problems,
      latencyMs: { all: stats(all), at: stats(latency.at!), every: stats(latency.every!), cron: stats(latency.cron!) },
      resources,
      modelRequests: fake.requests,
    })
  }

  /**
   * t2 — three recurring tasks in one Session due in the same minute, answered by the real model.
   * Each sample uses a fresh Session and a fresh copy of the workspace files.
   */
  async function t2(): Promise<void> {
    const fixtures = process.env.BENCH_FIXTURES ?? ''
    const prompts = JSON.parse(await readFile(join(fixtures, 'prompts.json'), 'utf8')) as Record<'errors' | 'todo' | 'sales', string>
    const answers = JSON.parse(await readFile(join(fixtures, 'answers.json'), 'utf8')) as {
      errors: { file: string; value: string }; todo: { file: string; value: string[] }; sales: { file: string; value: string }
    }
    const samples = Number(process.env.BENCH_SAMPLES ?? '5')
    const results: Record<string, unknown>[] = []
    for (let i = 0; i < samples; i++) {
      const dir = join(scaffold.workspaceCwd, `t2-sample-${i}`)
      await cp(join(fixtures, 'workspace'), dir, { recursive: true })
      const handle = await session(`t2-${i}`, { cwd: dir, provider: process.env.BENCH_PROVIDER ?? 'deepseek-official', model: process.env.BENCH_MODEL ?? 'deepseek-flash' })
      const due = Math.ceil((Date.now() + 20 * SECOND) / MINUTE) * MINUTE
      const at = new Date(due)
      const cron = { kind: 'cron', cron: { expression: `${at.getUTCMinutes()} ${at.getUTCHours()} * * *`, time_zone: 'UTC' } }
      const ids = {
        errors: await create(handle, 'Count errors', prompts.errors, cron),
        todo: await create(handle, 'Open todos', prompts.todo, cron),
        sales: await create(handle, 'Sales total', prompts.sales, cron),
      }
      log(`t2 sample ${i}: three tasks due at ${at.toISOString()}`)
      await sleep(Math.max(0, due - Date.now()))
      const finished = await waitUntil(async () => {
        const counts = await Promise.all(Object.values(ids).map(async id => (await deliveries(id)).length))
        return counts.every(count => count >= 1) && idle(handle)
      }, 10 * MINUTE, 500)
      // A settled Session stays settled for two more seconds before the sample closes.
      await sleep(2 * SECOND)
      const settled = finished && idle(handle)
      log(`t2 sample ${i}: settled=${String(settled)} inbox=${handle.agent.inbox.nextTurn.length}+${handle.agent.inbox.nextStep.length} status=${handle.agent.status}`)
      for (const id of Object.values(ids)) await remove(id, handle)

      const events = handle.agent.session.snapshotEvents().filter(event => event.time >= due - SECOND)
      const turns = events.filter(event => event.type === 'turn/start').length
      const turnEnds = events.filter(event => event.type === 'turn/end')
      const usage = { input: 0, cacheRead: 0, output: 0, requests: 0 }
      const toolCalls: string[] = []
      for (const event of events) {
        if (event.type !== 'assistant/message') continue
        usage.requests++
        usage.input += event.data.usage?.inputTokens ?? 0
        usage.cacheRead += event.data.usage?.cacheReadTokens ?? 0
        usage.output += event.data.usage?.outputTokens ?? 0
        for (const block of event.data.message.content) if (block.type === 'tool-call') toolCalls.push(`${block.name} ${block.arguments.slice(0, 160)}`)
      }
      const occurrences = occurrencesIn(handle)
      const read = async (file: string): Promise<string | undefined> => {
        try { return await readFile(join(dir, file), 'utf8') } catch { return undefined }
      }
      const errorsText = await read(answers.errors.file)
      const todoText = await read(answers.todo.file)
      const salesText = await read(answers.sales.file)
      const normalizeLine = (line: string): string => line.replace(/^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/u, '').trim()
      const todoLines = (todoText ?? '').split('\n').map(normalizeLine).filter(line => line.length > 0)
      const correct = {
        errors: errorsText !== undefined && errorsText.trim() === answers.errors.value,
        todo: todoText !== undefined && todoLines.length === answers.todo.value.length
          && answers.todo.value.every(item => todoLines.includes(item)),
        sales: salesText !== undefined && Math.abs(Number(salesText.replace(/[,\s]/gu, '')) - Number(answers.sales.value)) < 0.005,
      }
      const lastEnd = turnEnds.length === 0 ? undefined : Math.max(...turnEnds.map(event => event.time))
      results.push({
        sample: i,
        dueAt: at.toISOString(),
        settled,
        messages: new Set(occurrences.map(o => o.time)).size,
        batchSizes: occurrences.map(o => o.batchSize),
        occurrences: occurrences.length,
        turns,
        turnEndReasons: turnEnds.map(event => event.type === 'turn/end' ? event.data.reason : undefined),
        requests: usage.requests,
        tokens: { input: usage.input, cacheRead: usage.cacheRead, output: usage.output },
        makespanMs: lastEnd === undefined ? null : lastEnd - due,
        correct,
        outputs: { errors: errorsText ?? null, todo: todoText ?? null, sales: salesText ?? null },
        toolCalls,
      })
    }
    await report({ params: { samples, model: process.env.BENCH_MODEL ?? 'deepseek-flash', tasksPerSession: 3 }, samples: results })
  }

  /**
   * t3 — 100 one-shot tasks due in the same second over ten Sessions, first with no other tasks,
   * then with 900 more tasks waiting a year ahead.
   */
  async function t3(): Promise<void> {
    const burstSessions = await Promise.all(Array.from({ length: 10 }, (_, i) => session(`t3-burst${i}`)))
    const background = await session('t3-background')
    const phases: Record<string, unknown>[] = []
    for (const waiting of [0, 900]) {
      const createProbe = new Probe()
      createProbe.start()
      const yearAhead = Date.now() + 365 * 24 * 60 * MINUTE
      for (let i = 0; i < waiting; i++) {
        await create(background, `waiting ${i}`, `Later check ${i}.`, { kind: 'at', at: new Date(yearAhead + i * SECOND).toISOString() })
      }
      const waitingCreate = createProbe.stop()
      const due = Math.ceil((Date.now() + 20 * SECOND) / SECOND) * SECOND
      const burstCreateProbe = new Probe()
      burstCreateProbe.start()
      const burst: { id: string; session: AgentHandle }[] = []
      for (let i = 0; i < 100; i++) {
        const handle = burstSessions[i % 10]!
        burst.push({ id: await create(handle, `burst ${i}`, `Burst check ${i}.`, { kind: 'at', at: new Date(due).toISOString() }), session: handle })
      }
      const burstCreate = burstCreateProbe.stop()
      await sleep(Math.max(0, due - SECOND - Date.now()))
      const probe = new Probe()
      probe.start()
      await waitUntil(async () => {
        const counts = await Promise.all(burst.map(async t => (await deliveries(t.id)).length))
        return counts.every(count => count >= 1) && burstSessions.every(idle)
      }, 3 * MINUTE, 100)
      const resources = probe.stop()
      const latency: number[] = []
      const problems = { missed: 0, duplicated: 0, wrongSession: 0 }
      for (const t of burst) {
        const records = await deliveries(t.id)
        if (records.length === 0) problems.missed++
        if (records.length > 1) problems.duplicated += records.length - 1
        for (const r of records) {
          latency.push(Date.parse(r.deliveredAt) - due)
          if (r.targetSessionId !== t.session.agent.id) problems.wrongSession++
        }
      }
      const seen = new Map<string, number>()
      for (const handle of burstSessions) {
        for (const o of occurrencesIn(handle)) if (o.occurrenceAt === new Date(due).toISOString()) seen.set(o.taskId, (seen.get(o.taskId) ?? 0) + 1)
      }
      const messageDuplicates = [...seen.values()].reduce((s, c) => s + Math.max(0, c - 1), 0)
      phases.push({
        waitingTasks: waiting,
        totalActiveAtBurst: waiting + 100,
        createWaitingMs: waitingCreate.wallMs,
        createWaitingCpuMs: waitingCreate.cpuMs,
        createWaitingLoopMaxMs: waitingCreate.loopDelayMaxMs,
        createBurstMs: burstCreate.wallMs,
        problems: { ...problems, messageDuplicates },
        latencyMs: stats(latency),
        burstWindow: resources,
      })
    }
    await report({ params: { burstTasks: 100, burstSessions: 10, waitingPhases: [0, 900] }, phases, modelRequests: fake.requests })
  }

  /**
   * t4 — catch-up and failure. (a) A 60-second task that missed five occurrences and a one-shot task that
   * missed its time are written to the task store, as a stopped Host would leave them, and the Host is
   * woken: each should be delivered once, the recurring one for its latest occurrence only.
   * (b) The target Session cannot be opened the first time; the task should still be delivered.
   */
  async function t4(): Promise<void> {
    const domain = scaffold.ctx.storageDomain.get('schedule')
    if (domain === undefined) throw new Error('schedule storage domain is not open')
    const catchup = await session('t4-catchup')
    const now = Date.now()
    const every = createEveryScheduleRecord(ScheduleId('bench-t4-every'), 'Recurring catch-up check.', 60, now - 6 * MINUTE + 30 * SECOND, 'Missed recurring')
    const once = createAfterScheduleRecord(ScheduleId('bench-t4-once'), 'One-shot catch-up check.', 60, now - 3 * MINUTE, 'Missed one-shot')
    const stored = (record: ScheduleRecord): ScheduleTask => {
      const instant = new Date(now - 6 * MINUTE).toISOString()
      return {
        record, target: { kind: 'session', sessionId: catchup.agent.id }, involvedSessionIds: [catchup.agent.id], status: 'active',
        createdAt: instant, updatedAt: instant,
        deliveryHistory: { records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false },
      }
    }
    for (const record of [every, once]) await domain.table('tasks').put(record.id, stored(record))
    const woke = Date.now()
    // A task change makes the runtime read the store again, as Host start does.
    const wake = await create(catchup, 'Wake', 'Unused wake.', { kind: 'after', after_seconds: 86_400 })
    await remove(wake, catchup)
    await waitUntil(async () => (await deliveries(every.id)).length >= 1 && (await deliveries(once.id)).length >= 1 && idle(catchup), 30 * SECOND)
    await sleep(3 * SECOND)
    const everyRecords = await deliveries(every.id)
    const onceRecords = await deliveries(once.id)
    const latestDue = Date.parse(every.scheduledAt) + Math.floor((woke - Date.parse(every.scheduledAt)) / MINUTE) * MINUTE
    const everyAfter = (await scaffold.ctx.schedule.catalog()).find(entry => entry.id === every.id)
    const catchupResult = {
      missedOccurrences: Math.floor((woke - Date.parse(every.scheduledAt)) / MINUTE) + 1,
      recurringDeliveries: everyRecords.length,
      recurringDeliveredLatest: everyRecords.length === 1 && Date.parse(everyRecords[0]!.scheduledAt) === latestDue,
      recurringNextIsFuture: everyAfter?.scheduledAt === undefined ? null : Date.parse(everyAfter.scheduledAt) > woke,
      oneShotDeliveries: onceRecords.length,
      messages: occurrencesIn(catchup).length,
      catchupLatencyMs: [...everyRecords, ...onceRecords].map(r => Date.parse(r.deliveredAt) - woke),
    }
    await remove(every.id, catchup)

    const failing = await session('t4-failure')
    let attempts = 0
    let injected = 0
    const dispose = scaffold.ctx.on('schedule/resolve-agent', async (sessionId, next) => {
      if (sessionId !== failing.agent.id) return next()
      attempts++
      if (injected < 1) {
        injected++
        throw new Error('bench: injected Session activation failure')
      }
      return next()
    })
    const createdAt = Date.now()
    const failingId = await create(failing, 'Failure', 'Check after a failed open.', { kind: 'after', after_seconds: 5 })
    const dueAt = createdAt + 5 * SECOND
    const observeMs = 100 * SECOND
    await waitUntil(async () => (await deliveries(failingId)).length >= 1, observeMs, 500)
    const failureRecords = await deliveries(failingId)
    dispose()
    await report({
      params: { injectedFailures: 1, observeSeconds: observeMs / SECOND },
      catchup: catchupResult,
      failure: {
        delivered: failureRecords.length > 0,
        deliveredAfterMs: failureRecords.length > 0 ? Date.parse(failureRecords[0]!.deliveredAt) - dueAt : null,
        openAttempts: attempts,
        deliveries: failureRecords.length,
      },
      modelRequests: fake.requests,
    })
  }

  it(`runs ${TASK}`, async () => {
    if (OUT === '') throw new Error('BENCH_OUT is required')
    log(`start ${TASK} ${process.env.BENCH_LABEL ?? ''}`)
    if (TASK === 't1') await t1()
    else if (TASK === 't2') await t2()
    else if (TASK === 't3') await t3()
    else if (TASK === 't4') await t4()
    else throw new Error(`unknown BENCH_TASK ${JSON.stringify(TASK)}`)
  }, 60 * MINUTE)
})
