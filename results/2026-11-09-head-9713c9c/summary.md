# Results 2026-11-09-head-9713c9c

old = `7e7fc377537`, new = `9713c9cd5bd`. Each task ran once per version, alternating order.

## Overview

| Task | Metric | Old | New |
| --- | --- | --- | --- |
| 1 Every-minute check-ins | Missed / duplicated / wrong Session | 0 / 0 / 0 | 0 / 0 / 0 |
|  | Delivery delay p50 / p95 / max (ms) | 18 / 49 / 104 | 18 / 97 / 135 |
|  | Host CPU over the run (ms) | 5257 | 5158 |
| 2 Three tasks due together in one Session | Tasks done correctly | 15/15 | 15/15 |
|  | Model turns per trigger (mean) | 1.0 | 3.0 |
|  | Model requests per trigger (mean) | 7.4 | 12.0 |
|  | Tokens per trigger, thousands (mean) | 98.7 | 134.3 |
|  | Cost per trigger, CNY (mean; 0.04/2/8 per M hit/miss/out) | 0.027 | 0.022 |
|  | Due time to all three done, s (mean) | 16.5 | 18.0 |
| 3 100 tasks due in one second (100 active) | Missed / duplicated | 0 / 0 | 0 / 0 |
|  | Last delivery after due time (ms) | 2759 | 2801 |
|  | Longest event-loop stall during the burst (ms) | 21 | 26 |
|  | Host CPU during the burst (ms) | 1592 | 1563 |
| 3 Same, 1000 active | Missed / duplicated | 0 / 0 | 0 / 0 |
|  | Last delivery after due time (ms) | 2791 | 2892 |
|  | Longest event-loop stall during the burst (ms) | 19 | 16 |
|  | Host CPU during the burst (ms) | 1646 | 1749 |
|  | Creating the 900 waiting tasks (s) | 9.0 | 9.4 |
| 4 Missed while stopped | Recurring task: deliveries (latest occurrence only?) | 1 (yes) | 1 (yes) |
|  | One-shot task: deliveries | 1 | 1 |
| 4 Session fails to open once | Delivered within 100 s | no | yes, after 60 s |

## Task 1 detail

| Kind | Old n / p50 / p95 / max (ms) | New n / p50 / p95 / max (ms) |
| --- | --- | --- |
| at | 60 / 18 / 25 / 35 | 60 / 18 / 49 / 128 |
| every | 30 / 15 / 21 / 24 | 30 / 17 / 24 / 26 |
| cron | 12 / 49 / 104 / 104 | 12 / 60 / 135 / 135 |
| Event-loop stall max (ms) | 85 | 279 |
| RSS max (MB) | 381 | 379 |

## Task 2 samples

| Version | Sample | Messages | Turns | Requests | Tokens in/cached/out | Done in (s) | errors / todo / sales |
| --- | --- | --- | --- | --- | --- | --- | --- |
| old | 0 | 1 | 1 | 6 | 5902/74496/1633 | 16.3 | ✓ ✓ ✓ |
| old | 1 | 1 | 1 | 8 | 6266/108160/1587 | 18.0 | ✓ ✓ ✓ |
| old | 2 | 1 | 1 | 8 | 3662/94080/1900 | 17.4 | ✓ ✓ ✓ |
| old | 3 | 1 | 1 | 10 | 4013/119552/2072 | 20.0 | ✓ ✓ ✓ |
| old | 4 | 1 | 1 | 5 | 5871/62976/1222 | 11.1 | ✓ ✓ ✓ |
| new | 0 | 3 | 3 | 13 | 3854/142464/1226 | 19.8 | ✓ ✓ ✓ |
| new | 1 | 3 | 3 | 12 | 3609/128384/934 | 16.7 | ✓ ✓ ✓ |
| new | 2 | 3 | 3 | 12 | 3931/130304/1314 | 18.0 | ✓ ✓ ✓ |
| new | 3 | 3 | 3 | 11 | 3160/120832/1267 | 18.7 | ✓ ✓ ✓ |
| new | 4 | 3 | 3 | 12 | 3150/125952/1203 | 17.0 | ✓ ✓ ✓ |

