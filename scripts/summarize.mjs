// Builds results/<run>/summary.md from the per-run JSON files.
// Usage: node scripts/summarize.mjs <run-id> [price-hit price-miss price-out]  (CNY per million tokens)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runId = process.argv[2]
if (!runId) throw new Error('run id required')
// Default: DeepSeek-V4.1-Flash (deepseek-flash) peak-hour prices from the DeepSeek API pricing page, read 2026-11-09.
const [hit, miss, out] = (process.argv.slice(3).length === 3 ? process.argv.slice(3) : ['0.04', '2', '8']).map(Number)
const dir = join(root, 'results', runId)
const load = (task, label) => {
  const path = join(dir, `${task}-${label}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}
const fmt = (v, digits = 0) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(digits))
const ms = v => fmt(v, 0)
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0)
const mean = list => (list.length === 0 ? NaN : list.reduce((s, x) => s + x, 0) / list.length)
const lines = []
const row = cells => lines.push(`| ${cells.join(' | ')} |`)
const header = (...cells) => { row(cells); row(cells.map(() => '---')) }

const t1 = { old: load('t1', 'old'), new: load('t1', 'new') }
const t2 = { old: load('t2', 'old'), new: load('t2', 'new') }
const t3 = { old: load('t3', 'old'), new: load('t3', 'new') }
const t4 = { old: load('t4', 'old'), new: load('t4', 'new') }
const commits = ['old', 'new'].map(l => [t1, t2, t3, t4].map(t => t[l]?.commit).find(Boolean)?.slice(0, 11) ?? '–')

lines.push(`# Results ${runId}`, '', `old = \`${commits[0]}\`, new = \`${commits[1]}\`. Each task ran once per version, alternating order.`, '')

lines.push('## Overview', '')
header('Task', 'Metric', 'Old', 'New')
if (t1.old && t1.new) {
  const p = r => r.problems
  row(['1 Every-minute check-ins', 'Missed / duplicated / wrong Session', `${p(t1.old).missed} / ${p(t1.old).duplicated} / ${p(t1.old).wrongSession}`, `${p(t1.new).missed} / ${p(t1.new).duplicated} / ${p(t1.new).wrongSession}`])
  row(['', 'Delivery delay p50 / p95 / max (ms)', `${ms(t1.old.latencyMs.all.p50)} / ${ms(t1.old.latencyMs.all.p95)} / ${ms(t1.old.latencyMs.all.max)}`, `${ms(t1.new.latencyMs.all.p50)} / ${ms(t1.new.latencyMs.all.p95)} / ${ms(t1.new.latencyMs.all.max)}`])
  row(['', 'Host CPU over the run (ms)', ms(t1.old.resources.cpuMs), ms(t1.new.resources.cpuMs)])
}
if (t2.old && t2.new) {
  const agg = r => {
    const s = r.samples
    const ok = sum(s, x => Object.values(x.correct).filter(Boolean).length)
    const tokens = s.map(x => x.tokens)
    const cost = mean(tokens.map(t => (t.cacheRead * hit + t.input * miss + t.output * out) / 1e6))
    return {
      ok: `${ok}/${s.length * 3}`,
      turns: fmt(mean(s.map(x => x.turns)), 1),
      requests: fmt(mean(s.map(x => x.requests)), 1),
      tokens: fmt(mean(tokens.map(t => t.input + t.cacheRead + t.output)) / 1000, 1),
      cost: fmt(cost, 3),
      makespan: fmt(mean(s.map(x => x.makespanMs ?? NaN)) / 1000, 1),
    }
  }
  const a = agg(t2.old)
  const b = agg(t2.new)
  row(['2 Three tasks due together in one Session', 'Tasks done correctly', a.ok, b.ok])
  row(['', 'Model turns per trigger (mean)', a.turns, b.turns])
  row(['', 'Model requests per trigger (mean)', a.requests, b.requests])
  row(['', 'Tokens per trigger, thousands (mean)', a.tokens, b.tokens])
  row(['', `Cost per trigger, CNY (mean; ${hit}/${miss}/${out} per M hit/miss/out)`, a.cost, b.cost])
  row(['', 'Due time to all three done, s (mean)', a.makespan, b.makespan])
}
if (t3.old && t3.new) {
  for (const i of [0, 1]) {
    const o = t3.old.phases[i]
    const n = t3.new.phases[i]
    const name = i === 0 ? `3 100 tasks due in one second (${o.totalActiveAtBurst} active)` : `3 Same, ${o.totalActiveAtBurst} active`
    row([name, 'Missed / duplicated', `${o.problems.missed} / ${o.problems.duplicated + o.problems.messageDuplicates}`, `${n.problems.missed} / ${n.problems.duplicated + n.problems.messageDuplicates}`])
    row(['', 'Last delivery after due time (ms)', ms(o.latencyMs.max), ms(n.latencyMs.max)])
    row(['', 'Longest event-loop stall during the burst (ms)', ms(o.burstWindow.loopDelayMaxMs), ms(n.burstWindow.loopDelayMaxMs)])
    row(['', 'Host CPU during the burst (ms)', ms(o.burstWindow.cpuMs), ms(n.burstWindow.cpuMs)])
    if (i === 1) row(['', `Creating the ${o.waitingTasks} waiting tasks (s)`, fmt(o.createWaitingMs / 1000, 1), fmt(n.createWaitingMs / 1000, 1)])
  }
}
if (t4.old && t4.new) {
  const c = r => r.catchup
  row(['4 Missed while stopped', 'Recurring task: deliveries (latest occurrence only?)', `${c(t4.old).recurringDeliveries} (${c(t4.old).recurringDeliveredLatest ? 'yes' : 'no'})`, `${c(t4.new).recurringDeliveries} (${c(t4.new).recurringDeliveredLatest ? 'yes' : 'no'})`])
  row(['', 'One-shot task: deliveries', c(t4.old).oneShotDeliveries, c(t4.new).oneShotDeliveries])
  const f = r => r.failure
  row(['4 Session fails to open once', 'Delivered within 100 s', f(t4.old).delivered ? `yes, after ${fmt(f(t4.old).deliveredAfterMs / 1000, 0)} s` : 'no', f(t4.new).delivered ? `yes, after ${fmt(f(t4.new).deliveredAfterMs / 1000, 0)} s` : 'no'])
}
lines.push('')

if (t1.old && t1.new) {
  lines.push('## Task 1 detail', '')
  header('Kind', 'Old n / p50 / p95 / max (ms)', 'New n / p50 / p95 / max (ms)')
  for (const kind of ['at', 'every', 'cron']) {
    const o = t1.old.latencyMs[kind]
    const n = t1.new.latencyMs[kind]
    row([kind, `${o.n} / ${ms(o.p50)} / ${ms(o.p95)} / ${ms(o.max)}`, `${n.n} / ${ms(n.p50)} / ${ms(n.p95)} / ${ms(n.max)}`])
  }
  row(['Event-loop stall max (ms)', ms(t1.old.resources.loopDelayMaxMs), ms(t1.new.resources.loopDelayMaxMs)])
  row(['RSS max (MB)', fmt(t1.old.resources.rssMaxMb, 0), fmt(t1.new.resources.rssMaxMb, 0)])
  lines.push('')
}
if (t2.old && t2.new) {
  lines.push('## Task 2 samples', '')
  header('Version', 'Sample', 'Messages', 'Turns', 'Requests', 'Tokens in/cached/out', 'Done in (s)', 'errors / todo / sales')
  for (const label of ['old', 'new']) {
    for (const s of t2[label].samples) {
      row([label, s.sample, s.messages, s.turns, s.requests, `${s.tokens.input}/${s.tokens.cacheRead}/${s.tokens.output}`, fmt((s.makespanMs ?? NaN) / 1000, 1),
        ['errors', 'todo', 'sales'].map(k => (s.correct[k] ? '✓' : '✗')).join(' ')])
    }
  }
  lines.push('')
}
writeFileSync(join(dir, 'summary.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
