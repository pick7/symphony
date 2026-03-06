# Symphony-nodejs

**Symphony-nodejs** is a coding agent orchestrator that turns project work into isolated, autonomous implementation runs, allowing teams to manage work instead of supervising coding agents.

> [!WARNING]
> Symphony-nodejs is a low-key engineering preview for testing in trusted environments.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
  - [Option 1: Build Your Own](#option-1-build-your-own)
  - [Option 2: Node.js Implementation](#option-2-nodejs-implementation)
- [Configuration Reference](#configuration-reference)
  - [WORKFLOW.md File Format](#workflowmd-file-format)
  - [Front Matter Fields](#front-matter-fields)
  - [Prompt Template](#prompt-template)
  - [Dynamic Hot Reload](#dynamic-hot-reload)
- [Workspace Management](#workspace-management)
- [Orchestration State Machine](#orchestration-state-machine)
- [Coding Agent Integration Protocol](#coding-agent-integration-protocol)
- [Issue Tracker Integration](#issue-tracker-integration)
- [Observability and Dashboard](#observability-and-dashboard)
  - [Web Dashboard](#web-dashboard)
  - [JSON REST API](#json-rest-api)
- [Failure Model and Recovery Strategy](#failure-model-and-recovery-strategy)
- [Security and Operational Safety](#security-and-operational-safety)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Specification Document](#specification-document)
- [FAQ](#faq)
- [License](#license)

---

## Overview

Symphony-nodejs is a long-running automation service that continuously reads work from an issue tracker (such as Jira), creates an isolated workspace for each issue, and runs a coding agent session for that issue inside the workspace.

The service solves four core operational problems:

1. **Daemon workflow** — Turns issue execution into a repeatable daemon workflow instead of manual scripts.
2. **Agent isolation** — Isolates agent execution in per-issue workspaces so agent commands run only inside per-issue workspace directories.
3. **Versioned policy** — Keeps the workflow policy in-repo (`WORKFLOW.md`) so teams version the agent prompt and runtime settings with their code.
4. **Runtime observability** — Provides enough observability to operate and debug multiple concurrent agent runs.

### Important Boundary

- Symphony-nodejs is a scheduler/runner and tracker reader.
- Ticket writes (state transitions, comments, PR links) are typically performed by the coding agent using tools available in the workflow/runtime environment.
- A successful run may end at a workflow-defined handoff state (for example `Human Review`), not necessarily `Done`.

---

## Core Features

| Feature | Description |
|---------|-------------|
| Poll-based scheduling | Polls the issue tracker at a configurable interval for candidate work |
| Per-issue workspaces | Each issue gets its own isolated workspace directory with lifecycle hooks |
| Bounded concurrency | Global and per-state concurrency limits to prevent resource overload |
| Exponential backoff retry | Automatic retry on failure with exponential backoff, configurable max delay |
| Active run reconciliation | Automatically stops runs when issues move to terminal or non-active states |
| Stall detection | Detects inactive agent sessions and triggers retry |
| Hot reload configuration | Automatically reloads config and prompt template on `WORKFLOW.md` changes without restart |
| Optional web dashboard | Express dashboard |
| JSON REST API | Runtime state query and operational debugging endpoints |
| Token usage tracking | Tracks input/output/total token consumption of coding agent sessions |
| Rate limit monitoring | Tracks the latest agent rate limit payload |
| Structured logging | Structured log output with issue/session context fields |
| Startup terminal cleanup | Automatically cleans up workspaces for issues already in terminal states on startup |

---

## System Architecture

Symphony-nodejs is designed with a layered architecture for portability and clarity:

```
┌─────────────────────────────────────────────────────────────────┐
│  Policy Layer                                                   │
│  WORKFLOW.md prompt body + team-specific rules                  │
├─────────────────────────────────────────────────────────────────┤
│  Configuration Layer                                            │
│  Parses front matter → typed runtime settings, defaults, envs   │
├─────────────────────────────────────────────────────────────────┤
│  Coordination Layer                                             │
│  Polling loop, issue eligibility, concurrency, retries, recon   │
├─────────────────────────────────────────────────────────────────┤
│  Execution Layer                                                │
│  Filesystem lifecycle, workspace preparation, agent protocol    │
├─────────────────────────────────────────────────────────────────┤
│  Integration Layer                                              │
│  Tracker adapter (Jira) API calls and normalization             │
├─────────────────────────────────────────────────────────────────┤
│  Observability Layer                                            │
│  Structured logs + optional status dashboard and JSON API       │
└─────────────────────────────────────────────────────────────────┘
```

### Main Components

1. **Workflow Loader** — Reads and parses `WORKFLOW.md`, returning config and prompt template.
2. **Config Layer** — Provides typed config getters with defaults and `$VAR` environment resolution.
3. **Issue Tracker Client** — Fetches candidate issues, refreshes states, cleans terminal issues.
4. **Orchestrator** — Owns the poll tick and in-memory runtime state; decides dispatch, retry, stop, or release.
5. **Workspace Manager** — Maps issue identifiers to workspace paths and manages directory lifecycle.
6. **Agent Runner** — Creates workspace, builds prompt, launches coding agent, streams updates back.
7. **Status Surface** — Optional human-readable runtime status (dashboard, terminal output, etc.).

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js >= 18 (ES modules) |
| Web framework | Express |
| HTTP client | Axios |
| Template engine | LiquidJS |
| YAML parsing | js-yaml |
| File watching | Chokidar |
| Logging | Winston |
| Issue tracker | Jira REST API or in-memory adapter |
| Coding agent | OpenAI-compatible HTTP API (chat completions) |
| VCS integration | GitLab REST API |

**Two operating modes:**

- **`prompt-only` (default)** — Generates prompts from Jira issues using the WORKFLOW.md template. You copy the prompt and feed it to your AI manually.
- **`auto`** — Sends prompts directly to your OpenAI-compatible AI endpoint, runs multi-turn conversations, and tracks token usage.

---

## Getting Started

### Option 1: Build Your Own

Tell your favorite coding agent to build Symphony in a programming language of your choice:

> Implement Symphony according to the following spec:
> https://github.com/openai/symphony/blob/main/SPEC.md

### Option 2: Node.js Implementation

#### Prerequisites

- Node.js >= 18
- Jira account and API token
- (Optional) GitLab account and Personal Access Token
- (Optional, for `auto` mode) OpenAI-compatible AI API endpoint

#### Installation and Running

```bash
cd nodejs
npm install

# Copy and fill in your credentials
cp .env.example .env
# Edit .env with your Jira, GitLab, AI credentials

# Run (uses ./WORKFLOW.md by default)
node src/index.js

# Or specify a workflow file and port
node src/index.js ./WORKFLOW.md --port 3000
```

Open http://localhost:3000 for the dashboard.

#### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `JIRA_BASE_URL` | Jira instance URL (e.g. `https://company.atlassian.net`) | Yes |
| `JIRA_EMAIL` | Jira account email | Yes |
| `JIRA_API_TOKEN` | Jira API token | Yes |
| `JIRA_PROJECT_KEY` | Jira project key (e.g. `PROJ`) | Yes |
| `GITLAB_BASE_URL` | GitLab instance URL | No |
| `GITLAB_TOKEN` | GitLab personal access token | No |
| `GITLAB_PROJECT_ID` | GitLab project ID | No |
| `AI_BASE_URL` | OpenAI-compatible API base URL | `auto` mode only |
| `AI_API_KEY` | API key for the AI endpoint | `auto` mode only |
| `AI_MODEL` | Model name (e.g. `gpt-4`) | `auto` mode only |
| `PORT` | Dashboard HTTP port (default: 3000) | No |

---

## Configuration Reference

### WORKFLOW.md File Format

`WORKFLOW.md` is Symphony-nodejs's core configuration file, using YAML front matter + Markdown body format:

```markdown
---
# YAML front matter (runtime settings)
tracker:
  kind: jira
workspace:
  root: ~/code/workspaces
agent:
  max_concurrent_agents: 10
---

<!-- Markdown body (prompt template) -->
You are working on Jira issue {{ issue.identifier }}

Title: {{ issue.title }}
Description: {{ issue.description }}
```

**Parsing rules:**
- If the file starts with `---`, lines until the next `---` are parsed as YAML front matter
- Remaining lines become the prompt body
- If no front matter is present, the entire file is treated as prompt body with empty config
- YAML front matter must decode to a map/object; non-map YAML is an error
- Prompt body is trimmed before use

### Front Matter Fields

#### `tracker` (Tracker Configuration)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kind` | string | — | Required. `jira` or `memory` |
| `active_states` | list/string | `Todo, In Progress` | Active state names |
| `terminal_states` | list/string | `Closed, Cancelled, Canceled, Duplicate, Done` | Terminal state names |

#### `polling` (Polling Configuration)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `interval_ms` | integer | `30000` | Poll interval in milliseconds, takes effect at runtime |

#### `workspace` (Workspace Configuration)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `root` | path | `<system-temp>/symphony_workspaces` | Workspace root directory. Supports `~` and `$VAR` expansion |

#### `hooks` (Lifecycle Hooks)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `after_create` | shell script | null | Runs once after a new workspace is created. Failure aborts creation |
| `before_run` | shell script | null | Runs before each agent attempt. Failure aborts the attempt |
| `after_run` | shell script | null | Runs after each agent attempt. Failure is logged but ignored |
| `before_remove` | shell script | null | Runs before workspace deletion. Failure is logged but ignored |
| `timeout_ms` | integer | `60000` | Timeout for all hooks (milliseconds) |

#### `agent` (Agent Configuration)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_concurrent_agents` | integer | `10` | Global maximum concurrent agents |
| `max_turns` | integer | `20` | Maximum consecutive turns per agent invocation |
| `max_retry_backoff_ms` | integer | `300000` (5 min) | Maximum retry backoff delay |
| `max_concurrent_agents_by_state` | map | `{}` | Per-state concurrency limits (state keys normalized to lowercase) |

#### `ai` (AI Configuration)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `base_url` | string | `$AI_BASE_URL` | OpenAI-compatible API base URL |
| `api_key` | string | `$AI_API_KEY` | API key |
| `model` | string | `$AI_MODEL` | Model name |
| `system_prompt` | string | — | System prompt |
| `max_tokens` | integer | `4096` | Maximum tokens |
| `temperature` | number | `0.2` | Temperature parameter |
| `turn_timeout_ms` | integer | `600000` | Turn timeout |
| `stall_timeout_ms` | integer | `300000` | Stall detection timeout |

#### `server` (HTTP Server Configuration — Extension)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | integer | — | HTTP port. CLI `--port` takes precedence |

### Prompt Template

The Markdown body of `WORKFLOW.md` is the per-issue prompt template, rendered using a Liquid-compatible template engine.

**Available variables:**

| Variable | Description |
|----------|-------------|
| `issue.id` | Stable tracker-internal ID |
| `issue.identifier` | Human-readable ticket key (e.g. `ABC-123`) |
| `issue.title` | Issue title |
| `issue.description` | Issue description |
| `issue.state` | Current tracker state name |
| `issue.priority` | Priority (integer, lower is higher priority) |
| `issue.url` | Issue URL |
| `issue.labels` | List of labels (normalized to lowercase) |
| `issue.blocked_by` | List of blocker references |
| `issue.created_at` | Creation timestamp |
| `issue.updated_at` | Last update timestamp |
| `attempt` | Retry attempt number (null on first run) |

**Template example:**

```markdown
You are working on Jira issue {{ issue.identifier }}

{% if attempt %}
This is retry attempt #{{ attempt }}. Resume from current workspace state.
{% endif %}

Title: {{ issue.title }}
Description: {{ issue.description }}
Current status: {{ issue.state }}
Labels: {{ issue.labels }}
```

### Dynamic Hot Reload

Symphony-nodejs watches `WORKFLOW.md` for changes and automatically reloads when modifications are detected:

- Config changes (polling interval, concurrency limits, active/terminal states, etc.) take effect immediately for subsequent scheduling
- Prompt template changes apply to future runs
- Invalid reloads do not crash the service; the last known good config is retained
- In-flight agent sessions are not automatically restarted

---

## Workspace Management

### Workspace Layout

```
<workspace.root>/
├── <sanitized-issue-identifier-1>/   # e.g. ABC-123/
│   ├── .git/
│   └── ... (repository code)
├── <sanitized-issue-identifier-2>/   # e.g. ABC-456/
│   ├── .git/
│   └── ... (repository code)
└── ...
```

### Workspace Key Sanitization

Workspace directory names are derived from the issue identifier:
- Only `[A-Za-z0-9._-]` characters are allowed
- All other characters are replaced with `_`

### Workspace Lifecycle

1. **Creation** — If the directory doesn't exist, create it and mark `created_now=true`
2. **after_create hook** — Runs only on first creation (e.g. `git clone`)
3. **Reuse** — Subsequent runs for the same issue reuse the existing workspace
4. **Cleanup** — When the issue moves to a terminal state, the workspace is deleted

### Safety Invariants

1. **Agent runs only inside workspace** — Before launching the coding agent, validate `cwd == workspace_path`
2. **Path stays under root** — Workspace path must have workspace root as a prefix directory
3. **Identifier is sanitized** — Workspace directory names contain only safe characters

---

## Orchestration State Machine

### Issue Orchestration States (Internal, Not Tracker States)

```
┌──────────┐  dispatch  ┌─────────┐   exit    ┌──────────────┐
│ Unclaimed│──────────>│ Claimed │──────────>│ RetryQueued  │
│          │           │         │<──────────│              │
└──────────┘           │         │ retry timer└──────────────┘
     ^                 │ Running │                    │
     │                 │         │                    │
     │                 └────┬────┘                    │
     │                      │                         │
     │  terminal/non-active │                         │
     └──────────────────────┴─────────────────────────┘
                        Released
```

### Poll-and-Dispatch Tick

Each tick executes in the following order:

1. **Reconcile** — Check current states of running issues (stall detection + tracker state refresh)
2. **Validate** — Run dispatch preflight validation
3. **Fetch** — Get candidate issues from tracker
4. **Sort** — Order by priority, creation time, identifier
5. **Dispatch** — Dispatch eligible issues while slots remain

### Candidate Selection Rules

An issue is dispatch-eligible only if all of the following are true:

- Has `id`, `identifier`, `title`, and `state`
- State is in `active_states` and not in `terminal_states`
- Not already in the `running` map
- Not already in the `claimed` set
- Global concurrency slots available
- Per-state concurrency slots available
- Blocker rule for `Todo` state passes (no non-terminal blockers)

### Dispatch Sort Order

1. `priority` ascending (1..4 preferred; null/unknown sorts last)
2. `created_at` oldest first
3. `identifier` lexicographic tie-breaker

### Retry and Backoff

| Scenario | Delay Calculation |
|----------|-------------------|
| Continuation retry after normal exit | Fixed `1000` ms |
| Failure-driven retry | `min(10000 * 2^(attempt-1), max_retry_backoff_ms)` |

### Run Attempt Lifecycle

A run attempt transitions through these phases:

1. `PreparingWorkspace`
2. `BuildingPrompt`
3. `LaunchingAgentProcess`
4. `InitializingSession`
5. `StreamingTurn`
6. `Finishing`
7. `Succeeded` / `Failed` / `TimedOut` / `Stalled` / `CanceledByReconciliation`

---

## Coding Agent Integration Protocol

### OpenAI-Compatible HTTP API

Symphony-nodejs communicates with AI endpoints via the standard OpenAI chat completions HTTP API, supporting multi-turn conversations.

---

## Issue Tracker Integration

### Required Operations

| Operation | Purpose |
|-----------|---------|
| `fetch_candidate_issues()` | Fetch issues in active states for dispatch |
| `fetch_issues_by_states(state_names)` | Startup terminal workspace cleanup |
| `fetch_issue_states_by_ids(issue_ids)` | Active run reconciliation (state refresh) |

### Jira Integration

- REST API
- Supports filtering by project key, assignee, and status
- ADF (Atlassian Document Format) descriptions auto-converted to text

### Issue Normalization

All tracker implementations normalize issues to a common model:
- `labels` → lowercase strings
- `blocked_by` → derived from inverse relations of type `blocks`
- `priority` → integer only (non-integers become null)
- `created_at` / `updated_at` → ISO-8601 timestamps

---

## Observability and Dashboard

### Web Dashboard

The dashboard is served at `/`, displaying:

- Active sessions and their status
- Retry delay queue
- Token consumption statistics
- Aggregate runtime totals
- Recent events
- Health/error indicators

The dashboard uses Express with a static HTML page.

### JSON REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/state` | Returns full runtime state JSON |
| GET | `/api/v1/<issue_identifier>` | Returns single issue details |
| POST | `/api/v1/refresh` | Triggers an immediate poll and reconciliation |

**`GET /api/v1/state` response example:**

```json
{
  "generated_at": "2026-03-06T10:15:30Z",
  "counts": { "running": 2, "retrying": 1 },
  "running": [
    {
      "issue_id": "abc123",
      "issue_identifier": "MT-649",
      "state": "In Progress",
      "session_id": "thread-1-turn-1",
      "turn_count": 7,
      "last_event": "turn_completed",
      "started_at": "2026-03-06T10:10:12Z",
      "tokens": { "input_tokens": 1200, "output_tokens": 800, "total_tokens": 2000 }
    }
  ],
  "retrying": [
    {
      "issue_id": "def456",
      "issue_identifier": "MT-650",
      "attempt": 3,
      "due_at": "2026-03-06T10:16:00Z",
      "error": "no available orchestrator slots"
    }
  ],
  "codex_totals": {
    "input_tokens": 5000,
    "output_tokens": 2400,
    "total_tokens": 7400,
    "seconds_running": 1834.2
  },
  "rate_limits": null
}
```

**`GET /api/v1/<issue_identifier>` response example:**

```json
{
  "issue_identifier": "MT-649",
  "issue_id": "abc123",
  "status": "running",
  "workspace": { "path": "/tmp/symphony_workspaces/MT-649" },
  "attempts": { "restart_count": 1, "current_retry_attempt": 2 },
  "running": {
    "session_id": "thread-1-turn-1",
    "turn_count": 7,
    "state": "In Progress",
    "started_at": "2026-03-06T10:10:12Z",
    "last_event": "notification",
    "last_message": "Working on tests",
    "tokens": { "input_tokens": 1200, "output_tokens": 800, "total_tokens": 2000 }
  },
  "retry": null,
  "recent_events": [
    { "at": "2026-03-06T10:14:59Z", "event": "notification", "message": "Working on tests" }
  ],
  "last_error": null
}
```

**`POST /api/v1/refresh` response example (202 Accepted):**

```json
{
  "queued": true,
  "coalesced": false,
  "requested_at": "2026-03-06T10:15:30Z",
  "operations": ["poll", "reconcile"]
}
```

---

## Failure Model and Recovery Strategy

### Failure Classes

| Class | Examples | Recovery Behavior |
|-------|----------|-------------------|
| Workflow/Config | Missing `WORKFLOW.md`, invalid YAML | Skip new dispatches, keep service alive |
| Workspace | Directory creation failure, hook timeout | Current attempt fails, orchestrator retries |
| Agent Session | Handshake failure, turn failed/timeout | Exponential backoff retry |
| Tracker | API transport errors, non-200 status | Skip this tick, try again next tick |
| Observability | Dashboard render errors, log sink failure | Does not crash the orchestrator |

### Restart Recovery

Symphony-nodejs uses intentionally in-memory state. After restart, recovery happens through:

1. Startup terminal workspace cleanup
2. Fresh polling of active issues
3. Re-dispatching eligible work

No retry timers or running sessions are restored from prior process memory.

### Operator Intervention Points

- **Edit `WORKFLOW.md`** — Modify prompt and most runtime settings (detected and re-applied automatically)
- **Change issue states in tracker** — Terminal → stops run and cleans workspace; Non-active → stops run without cleanup
- **Restart the service** — For process recovery or deployment (not the normal path for config changes)

---

## Security and Operational Safety

### Filesystem Safety

- Workspace path must remain under the configured workspace root
- Coding agent cwd must be the per-issue workspace path
- Workspace directory names use sanitized identifiers only

### Secret Handling

- `$VAR` indirection is supported in workflow config
- API tokens and secret env values are never logged
- Secret presence is validated without printing values

### Hook Script Safety

- Hooks are arbitrary shell scripts from `WORKFLOW.md`, treated as fully trusted configuration
- Hooks execute inside the workspace directory
- Hook output is truncated in logs
- Hook timeouts are required to prevent orchestrator hangs

### Hardening Recommendations

- Add external isolation layers (OS/container/VM sandboxing, network restrictions)
- Filter which issues, projects, or labels are eligible for dispatch
- Reduce available tools, credentials, filesystem paths, and network destinations to the minimum needed
- Run under a dedicated OS user
- Restrict workspace root permissions
- Mount workspace root on a dedicated volume if possible

---

## Testing

```bash
cd nodejs
npm install
npm start         # Start the service
npm run dev       # Development mode (file watch auto-restart)
```

---

## Project Structure

```
symphony-nodejs/
├── README.md                         # Project overview (original)
├── README.zh-CN.md                   # Chinese README
├── README.en.md                      # English detailed README
├── SPEC.md                           # Full language-agnostic specification
├── LICENSE                           # Apache License 2.0
│
├── .github/
│   ├── workflows/                    # CI workflows
│   ├── pull_request_template.md      # PR template
│   └── media/                        # Demo video, screenshots
│
├── .codex/                           # Codex skills and environment setup
│   ├── worktree_init.sh              # Worktree initialization script
│   └── skills/
│       ├── commit/SKILL.md           # Commit skill
│       ├── push/SKILL.md             # Push skill
│       ├── pull/SKILL.md             # Pull skill
│       ├── land/SKILL.md             # Land/merge skill
│       └── debug/SKILL.md            # Debug skill
│
└── nodejs/                           # Node.js implementation
    ├── src/
    │   ├── index.js                  # CLI entry point
    │   ├── config.js                 # Typed configuration
    │   ├── workflow.js               # WORKFLOW.md parser
    │   ├── workflow-store.js         # File watcher + hot reload
    │   ├── prompt-builder.js         # Liquid template rendering
    │   ├── orchestrator.js           # Poll/dispatch/retry/reconciliation
    │   ├── agent-runner.js           # Per-issue turn runner
    │   ├── ai-client.js              # OpenAI-compatible HTTP client
    │   ├── workspace.js              # Per-issue workspace management
    │   ├── logger.js                 # Structured logging (Winston)
    │   ├── tracker/
    │   │   ├── index.js              # Tracker adapter factory
    │   │   ├── jira-adapter.js       # Jira REST API client
    │   │   └── memory-adapter.js     # In-memory test adapter
    │   ├── gitlab/
    │   │   └── client.js             # GitLab REST API client
    │   └── web/
    │       ├── server.js             # Express server + API routes
    │       └── dashboard.html        # Single-page dashboard UI
    ├── package.json                  # Project dependencies
    ├── .env.example                  # Environment variable template
    ├── WORKFLOW.md                   # Example workflow
    └── README.md                     # Node.js implementation docs
```

---

## Specification Document

The full language-agnostic specification is in [`SPEC.md`](SPEC.md), covering:

- Core domain model definitions (Issue, Workspace, Run Attempt, Live Session, etc.)
- Orchestration state machine design
- Polling, scheduling, and reconciliation algorithms
- Workspace management and safety specification
- Coding-agent protocol
- Issue tracker integration contract
- Prompt construction and context assembly
- Logging and observability specification
- Failure model and recovery strategy
- Security and operational safety guidelines
- Reference algorithms (pseudocode)
- Test and validation matrix
- Implementation checklist (definition of done)

You can provide `SPEC.md` to any coding agent and have it implement a fully conforming Symphony in your language of choice.

---

## FAQ

### How do I set this up for my own codebase?

Check out [nodejs/README.md](nodejs/README.md) for detailed setup instructions. You can also ask your favorite coding agent:

> Set up Symphony-nodejs for my repository based on
> https://github.com/openai/symphony/blob/main/nodejs/README.md

### Can I use other coding agents?

Yes. The Node.js implementation demonstrates how to use a generic OpenAI-compatible HTTP API. You can also implement your own agent integration based on `SPEC.md`, as long as the agent supports the required communication protocol.

### Where should WORKFLOW.md be placed?

It is recommended to place `WORKFLOW.md` in the repository root and version-control it. This allows teams to manage agent prompts and runtime settings alongside their code. Symphony-nodejs looks for `WORKFLOW.md` in the current working directory by default, but a custom path can be specified via CLI argument.

### How do I harden Symphony-nodejs for production?

Refer to Section 15 of `SPEC.md` for security and operational safety guidance:
- Add container/VM isolation layers
- Restrict network access
- Filter which issues are eligible for dispatch
- Minimize available tools and credentials
- Run under a dedicated OS user with restricted permissions

### What happens when Symphony-nodejs restarts?

Symphony-nodejs uses in-memory state, so no retry timers or running sessions survive a restart. Recovery is tracker-driven: the service performs startup terminal workspace cleanup, polls for active issues, and re-dispatches eligible work automatically.

### How does the multi-turn agent loop work?

After each successful turn, the worker re-checks the tracker issue state. If the issue is still active, the worker starts another turn on the same live thread in the same workspace (up to `agent.max_turns`). The first turn uses the full rendered prompt; continuation turns send only continuation guidance. After the worker exits, the orchestrator schedules a short continuation retry to check if the issue still needs work.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
