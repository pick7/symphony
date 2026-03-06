---
name: debug
description:
  Investigate stuck runs and execution failures by tracing Symphony-nodejs logs
  with issue/session identifiers; use when runs stall, retry repeatedly, or
  fail unexpectedly.
---

# Debug

## Goals

- Find why a run is stuck, retrying, or failing.
- Correlate issue identity to a session quickly.
- Read the right logs in the right order to isolate root cause.

## Log Sources

- Primary runtime log: structured Winston JSON logs output to stdout/stderr.
- Check any log files configured in the Winston transport settings.

## Correlation Keys

- `issue_identifier`: human ticket key (example: `PROJ-123`)
- `issue_id`: Jira issue ID (stable internal ID)
- `session_id`: agent session identifier

Use these fields as your join keys during debugging.

## Quick Triage (Stuck Run)

1. Confirm scheduler/worker symptoms for the ticket.
2. Find recent lines for the ticket (`issue_identifier` first).
3. Extract `session_id` from matching lines.
4. Trace that `session_id` across start, stream, completion/failure, and stall
   handling logs.
5. Decide class of failure: timeout/stall, agent startup failure, turn
   failure, or orchestrator retry loop.

## Commands

```bash
# 1) Narrow by ticket key (fastest entry point)
rg -n "PROJ-123" log/*.log

# 2) Pull session IDs seen for that ticket
rg -o "session_id=[^ ;]+" log/*.log | sort -u

# 3) Trace one session end-to-end
rg -n "<session_id>" log/*.log

# 4) Focus on stuck/retry signals
rg -n "stall|retry|timeout|failed|error" log/*.log
```

## Investigation Flow

1. Locate the ticket slice:
    - Search by `issue_identifier`.
    - If noise is high, add `issue_id`.
2. Establish timeline:
    - Identify first session start event.
    - Follow with session completed, failed, or worker exit lines.
3. Classify the problem:
    - Stall loop: stall detection and backoff restart.
    - Agent startup: session initialization failure.
    - Turn execution failure: turn failed, timeout, or error.
    - Worker crash: agent task exited with error reason.
4. Validate scope:
    - Check whether failures are isolated to one issue/session or repeating
      across multiple tickets.
5. Capture evidence:
    - Save key log lines with timestamps, `issue_identifier`, `issue_id`, and
      `session_id`.
    - Record probable root cause and the exact failing stage.

## Notes

- Prefer `rg` over `grep` for speed on large logs.
- Check rotated logs before concluding data is missing.
