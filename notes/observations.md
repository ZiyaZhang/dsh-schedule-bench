# Observations

Behavior seen while building and running the bench that is outside the planned metrics.

## Reminders left in the inbox after consecutive failed turns (2026-11-09)

Seen in a task 2 smoke run on the new version whose model provider was misconfigured, so every turn ended with `NO_ADAPTER`. Three recurring tasks for one Session came due in the same minute and were delivered as three follow-up messages. Two turns ran and failed; the third message stayed in the Session inbox for the remaining ten minutes of the run, and the Session reported idle with one queued message.

Cause, from `packages/core/agent-loop/src/agent.ts` at `4b8e22334f0`: `kick()` runs `while (await this.turn())`. A turn that succeeds returns `true` while the inbox has pending input, so queued follow-ups run back to back. A turn that fails throws instead; `kick()` then re-wakes the driver only when a wake was requested during that running phase. Two messages queued during the first turn set one wake request: after the first failure the driver wakes once and claims one message (a turn claims at most one follow-up), and after the second failure no wake request is left, so the third message waits for the next wake, such as a later user message or reminder.

With the old version the three tasks arrive as one batch message, so the same failure loses all three in one failed turn and leaves nothing queued. With the new version the remaining reminders run later, at the next wake, with their original text. The behavior comes from the agent loop, not from the schedule packages; delivery one message per task makes it reachable from scheduled tasks.
