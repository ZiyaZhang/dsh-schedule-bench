// Generates the task-2 workspace (log, todo list, sales table) and its answer key.
// Deterministic: the same seed always produces the same files.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tasks', 't2-morning')
const ws = join(root, 'workspace')

let state = 20261109
function rand() {
  state = (state * 1103515245 + 12345) % 2147483648
  return state / 2147483648
}
function pick(list) { return list[Math.floor(rand() * list.length)] }

// logs/app.log: 120 lines; the level is the third column, and "ERROR" appears nowhere else.
const services = ['api', 'worker', 'scheduler', 'billing', 'auth']
const infoText = ['request served', 'cache warmed', 'job finished', 'connection reused', 'config reloaded']
const warnText = ['slow response', 'retrying upstream call', 'queue depth high']
const errorText = ['upstream timeout', 'payment declined by gateway', 'database deadlock', 'disk quota exceeded']
const logLines = []
let errorCount = 0
for (let i = 0; i < 120; i++) {
  const t = new Date(Date.UTC(2026, 10, 9, 8, 0, 0) + i * 17_000).toISOString().replace('.000Z', 'Z')
  const r = rand()
  let level
  let text
  if (r < 0.2) { level = 'ERROR'; text = pick(errorText); errorCount++ } else if (r < 0.35) { level = 'WARN'; text = pick(warnText) } else { level = 'INFO'; text = pick(infoText) }
  logLines.push(`${t} ${pick(services).padEnd(9)} ${level.padEnd(5)} ${text}`)
}

// notes/todo.md: 8 items, 3 checked.
const todo = [
  ['x', 'Renew the TLS certificate for the staging host'],
  [' ', 'Reply to the vendor about the invoice discrepancy'],
  [' ', 'Book the meeting room for Thursday review'],
  ['x', 'Archive last quarter dashboards'],
  [' ', 'Update the on-call rotation sheet'],
  [' ', 'Draft release notes for version 2.4'],
  ['x', 'Rotate the read-only database password'],
  [' ', 'Send the hiring panel feedback'],
]
const todoMd = ['# Todo', '', ...todo.map(([mark, text]) => `- [${mark}] ${text}`), ''].join('\n')
const unchecked = todo.filter(([mark]) => mark === ' ').map(([, text]) => text)

// data/sales.csv: 30 rows with two-decimal amounts.
const regions = ['north', 'south', 'east', 'west']
const salesRows = ['date,region,amount']
let cents = 0
for (let i = 0; i < 30; i++) {
  const amount = Math.round((200 + rand() * 4800) * 100)
  cents += amount
  const day = String(1 + (i % 28)).padStart(2, '0')
  salesRows.push(`2026-10-${day},${pick(regions)},${(amount / 100).toFixed(2)}`)
}

const files = {
  'logs/app.log': logLines.join('\n') + '\n',
  'notes/todo.md': todoMd,
  'data/sales.csv': salesRows.join('\n') + '\n',
}
for (const [rel, text] of Object.entries(files)) {
  const path = join(ws, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const prompts = {
  errors: '统计 logs/app.log 中包含 ERROR 的行数，只把这个数字写入 report/errors.txt。',
  todo: '把 notes/todo.md 里还没勾选的待办事项逐条抄到 report/todo.txt，每行一条，只写事项文字。',
  sales: '计算 data/sales.csv 中 amount 列的总和，保留两位小数，只把结果写入 report/sales.txt。',
}
const answers = {
  errors: { file: 'report/errors.txt', value: String(errorCount) },
  todo: { file: 'report/todo.txt', value: unchecked },
  sales: { file: 'report/sales.txt', value: (cents / 100).toFixed(2) },
}
writeFileSync(join(root, 'prompts.json'), JSON.stringify(prompts, null, 2) + '\n')
writeFileSync(join(root, 'answers.json'), JSON.stringify(answers, null, 2) + '\n')
console.log(JSON.stringify({ errorCount, unchecked: unchecked.length, salesTotal: answers.sales.value }))
