# Results 2026-11-09

old = `7e7fc377537`, new = `4b8e22334f0`. Each task ran once per version, alternating order.

## Overview

| Task | Metric | Old | New |
| --- | --- | --- | --- |
| 1 Every-minute check-ins | Missed / duplicated / wrong Session | 0 / 0 / 0 | 0 / 0 / 0 |
|  | Delivery delay p50 / p95 / max (ms) | 14 / 61 / 97 | 16 / 51 / 93 |
|  | Host CPU over the run (ms) | 4869 | 5150 |
| 3 100 tasks due in one second (100 active) | Missed / duplicated | 0 / 0 | 0 / 0 |
|  | Last delivery after due time (ms) | 2652 | 2697 |
|  | Longest event-loop stall during the burst (ms) | 24 | 20 |
|  | Host CPU during the burst (ms) | 1560 | 1614 |
| 3 Same, 1000 active | Missed / duplicated | 0 / 0 | 0 / 0 |
|  | Last delivery after due time (ms) | 2656 | 2868 |
|  | Longest event-loop stall during the burst (ms) | 19 | 14 |
|  | Host CPU during the burst (ms) | 1589 | 1732 |
|  | Creating the 900 waiting tasks (s) | 9.1 | 9.3 |
| 4 Missed while stopped | Recurring task: deliveries (latest occurrence only?) | 1 (yes) | 1 (yes) |
|  | One-shot task: deliveries | 1 | 1 |
| 4 Session fails to open once | Delivered within 100 s | no | yes, after 60 s |

## Task 1 detail

| Kind | Old n / p50 / p95 / max (ms) | New n / p50 / p95 / max (ms) |
| --- | --- | --- |
| at | 60 / 13 / 19 / 24 | 60 / 16 / 20 / 25 |
| every | 30 / 15 / 21 / 21 | 30 / 17 / 19 / 20 |
| cron | 12 / 57 / 97 / 97 | 12 / 49 / 93 / 93 |
| Event-loop stall max (ms) | 85 | 85 |
| RSS max (MB) | 367 | 352 |

