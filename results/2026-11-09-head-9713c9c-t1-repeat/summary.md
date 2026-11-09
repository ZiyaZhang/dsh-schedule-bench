# Results 2026-11-09-head-9713c9c-t1-repeat

old = `7e7fc377537`, new = `9713c9cd5bd`. Each task ran once per version, alternating order.

## Overview

| Task | Metric | Old | New |
| --- | --- | --- | --- |
| 1 Every-minute check-ins | Missed / duplicated / wrong Session | 0 / 0 / 0 | 0 / 0 / 0 |
|  | Delivery delay p50 / p95 / max (ms) | 17 / 60 / 98 | 18 / 58 / 106 |
|  | Host CPU over the run (ms) | 5481 | 5235 |

## Task 1 detail

| Kind | Old n / p50 / p95 / max (ms) | New n / p50 / p95 / max (ms) |
| --- | --- | --- |
| at | 60 / 17 / 20 / 28 | 60 / 17 / 19 / 32 |
| every | 30 / 18 / 20 / 21 | 30 / 18 / 29 / 34 |
| cron | 12 / 49 / 98 / 98 | 12 / 57 / 106 / 106 |
| Event-loop stall max (ms) | 98 | 89 |
| RSS max (MB) | 364 | 379 |

