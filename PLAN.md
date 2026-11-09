# Plan

Fixed before the measured runs. Changes after the first measured run are listed under "Changes" with the reason.

## Question

Does moving scheduled-task wake-up from the schedule runtime into a clock source provider (time as one trigger source) make scheduled tasks slower, less reliable, or more expensive?

## Versions

| Label | Commit | What it is |
| --- | --- | --- |
| old | `7e7fc377537` | master as last merged into the change |
| new | `4b8e22334f0` | head of the change |

The two commits differ only by the change. Both are built with `pnpm install --frozen-lockfile && pnpm run build:artifacts` under Node 24.

## What the change touches

| Area | Old | New |
| --- | --- | --- |
| Wake-up | one runtime timer; each wake scans every task | the clock source keeps a min-heap and emits one event per due task; the runtime queues events and delivers them one by one |
| Recurring tasks for one Session due together | one `[SCHEDULE REMINDER BATCH]` message, so one model turn | one message per task; each follow-up message is its own turn |
| Recurring task alone | batch format with a one-item list | single-reminder format |
| Failed delivery | retried at the next runtime pass (a task edit, another task finishing) | retried by the runtime after 60 seconds |
| Reconciliation on task edits and turn ends | due scan over all tasks | every active task is rebound and the single timer re-armed |

## Tasks

Each task runs once per version. Order: t1 old, t1 new, t2 new, t2 old, t3 old, t3 new, t4 new, t4 old. One run at a time on one machine.

1. **Every-minute check-ins** (fake model). 60 one-shot tasks due three seconds apart over six Sessions; ten 60-second recurring tasks created six seconds apart, one per Session; three every-minute cron tasks, one per Session. About five minutes of firing.
2. **Three tasks due together in one Session** (real model, DeepSeek-V4.1-Flash). Three cron tasks in one Session due in the same minute: count `ERROR` lines in a log, copy unchecked todos, sum a sales column; each writes one file under `report/`. Five samples per version, each in a fresh Session with a fresh copy of the files in `tasks/t2-morning/workspace`.
3. **100 tasks due in one second** (fake model). 100 one-shot tasks due in the same second over ten Sessions, first with no other tasks, then with 900 more tasks waiting a year ahead.
4. **Missed while stopped, and a failed open** (fake model). (a) A 60-second recurring task that missed five occurrences and a one-shot task that missed its time are written to the task store, as a stopped Host leaves them, and the runtime is woken. (b) The target Session fails to open once (injected through `schedule/resolve-agent`); observed for 100 seconds.

The fake model answers every request at once with a short text, so tasks 1, 3 and 4 measure scheduling alone.

## Metrics

| Metric | Definition | Tasks |
| --- | --- | --- |
| Correctness | every expected occurrence delivered once, to its own Session; recurring catch-up delivers the latest missed occurrence only | 1, 3, 4 |
| On time | delivery delay = `deliveredAt − scheduledAt` (inbox write acknowledged); p50, p95, max | 1, 3 |
| Duration | due time to the end of the last turn handling the trigger | 2 |
| Task success | output files match the answer key (checked by script) | 2 |
| Cost | model turns, requests, tokens (input, cached, output), CNY per trigger | 2 |
| Host resources | process CPU time, longest event-loop stall, peak RSS over the measurement window | 1, 3 |

## Regression rules

- Correctness: any missed, duplicated or wrong-Session delivery in the new version, or a catch-up that differs from the rule, is a regression.
- On time and Host resources: a regression when the new value exceeds the old one by more than 20% and by more than 20 ms (p95 delivery delay in task 1; last delivery after due time, CPU and longest stall in task 3; CPU in task 1).
- Task success: a regression when the new version gets fewer files right than the old one.
- Cost and duration in task 2 are reported as old and new values with their ratio; the change makes several tasks due together take several turns by design, so these are trade-offs, not pass or fail.
- If a metric crosses a threshold, that task is run once more for both versions and both runs are reported.

## Not covered

- Recovery after the Host process is killed mid-delivery; the change's own unit tests cover the recovery paths.
- Laptop sleep and wake; both versions use the same `setTimeout`-based wait.
- One run per version: small differences in delay are within run-to-run noise.

## Changes

- 2026-11-09: tasks 1, 3 and 4 ran in the planned order (t1 old, t1 new, t3 old, t3 new, t4 new, t4 old). Task 2 runs afterwards because the model endpoint was unreachable from the run machine at the planned time; its own order (new, then old) is unchanged.
