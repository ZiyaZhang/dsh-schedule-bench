# Results 2026-11-09

old = `7e7fc377537`, new = `4b8e22334f0`. Each task ran once per version, alternating order.

## Overview

| Task | Metric | Old | New |
| --- | --- | --- | --- |
| 1 Every-minute check-ins | Missed / duplicated / wrong Session | 0 / 0 / 0 | 0 / 0 / 0 |
|  | Delivery delay p50 / p95 / max (ms) | 14 / 61 / 97 | 16 / 51 / 93 |
|  | Host CPU over the run (ms) | 4869 | 5150 |
| 2 Three tasks due together in one Session | Tasks done correctly | 15/15 | 15/15 |
|  | Model turns per trigger (mean) | 1.0 | 3.0 |
|  | Model requests per trigger (mean) | 7.0 | 13.0 |
|  | Tokens per trigger, thousands (mean) | 91.3 | 167.7 |
|  | Cost per trigger, CNY (mean; 0.04/2/8 per M hit/miss/out) | 0.024 | 0.031 |
|  | Due time to all three done, s (mean) | 14.6 | 22.8 |
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

## Task 2 samples

| Version | Sample | Messages | Turns | Requests | Tokens in/cached/out | Done in (s) | errors / todo / sales |
| --- | --- | --- | --- | --- | --- | --- | --- |
| old | 0 | 1 | 1 | 7 | 3603/79744/1360 | 13.4 | ✓ ✓ ✓ |
| old | 1 | 1 | 1 | 5 | 5846/59008/999 | 10.8 | ✓ ✓ ✓ |
| old | 2 | 1 | 1 | 8 | 3550/90112/1282 | 14.8 | ✓ ✓ ✓ |
| old | 3 | 1 | 1 | 6 | 5795/74368/1226 | 14.0 | ✓ ✓ ✓ |
| old | 4 | 1 | 1 | 9 | 7443/120448/1627 | 19.9 | ✓ ✓ ✓ |
| new | 0 | 3 | 3 | 12 | 4995/136832/1731 | 22.8 | ✓ ✓ ✓ |
| new | 1 | 3 | 3 | 13 | 6704/172416/1561 | 20.7 | ✓ ✓ ✓ |
| new | 2 | 3 | 3 | 13 | 3803/141952/1318 | 21.8 | ✓ ✓ ✓ |
| new | 3 | 3 | 3 | 15 | 7937/215424/2200 | 27.9 | ✓ ✓ ✓ |
| new | 4 | 3 | 3 | 12 | 4039/136064/1432 | 20.6 | ✓ ✓ ✓ |

