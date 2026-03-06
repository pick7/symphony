# Symphony Node.js

Coding agent orchestrator adapted for **Jira + GitLab + company OpenAI-compatible AI**.

Based on the [Symphony specification](../SPEC.md), rewritten from Elixir to Node.js with the following adaptations:

| Original (Elixir) | This version (Node.js) |
|---|---|
| Linear | **Jira** REST API |
| GitHub | **GitLab** API |
| Codex app-server (JSON-RPC stdio) | **OpenAI-compatible HTTP API** (chat completions) |
| Elixir/OTP | **Node.js** (ES modules) |

## Two Modes

### `prompt-only` (default)

Generates prompts from Jira issues using the WORKFLOW.md template. You copy the prompt and feed it to your company's AI manually.

### `auto`

Sends prompts directly to your company's OpenAI-compatible AI endpoint, runs multi-turn conversations, and tracks token usage.

## Quick Start

```bash
cd nodejs
npm install

# Copy and fill in your credentials
cp .env.example .env

# Run (uses ./WORKFLOW.md by default)
node src/index.js

# Or specify a workflow file and port
node src/index.js ./WORKFLOW.md --port 3000
```

Open http://localhost:3000 for the dashboard.

## Configuration

All configuration lives in `WORKFLOW.md` (YAML front matter + Liquid prompt template).

### Environment Variables

| Variable | Description |
|---|---|
| `JIRA_BASE_URL` | Jira instance URL (e.g. `https://company.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `JIRA_PROJECT_KEY` | Jira project key (e.g. `PROJ`) |
| `GITLAB_BASE_URL` | GitLab instance URL |
| `GITLAB_TOKEN` | GitLab personal access token |
| `GITLAB_PROJECT_ID` | GitLab project ID |
| `AI_BASE_URL` | OpenAI-compatible API base URL |
| `AI_API_KEY` | API key for the AI endpoint |
| `AI_MODEL` | Model name (e.g. `gpt-4`) |
| `PORT` | Dashboard HTTP port (default: 3000) |

### WORKFLOW.md Front Matter

```yaml
---
tracker:
  kind: jira                    # "jira" or "memory"
  base_url: $JIRA_BASE_URL
  email: $JIRA_EMAIL
  api_key: $JIRA_API_TOKEN
  project_key: $JIRA_PROJECT_KEY
  active_states:                # Jira statuses to poll
    - To Do
    - In Progress
  terminal_states:              # Jira statuses that mean "done"
    - Done
    - Closed
    - Cancelled
  assignee: me                  # Optional: filter by assignee

polling:
  interval_ms: 30000            # Poll Jira every 30s

workspace:
  root: ~/symphony-workspaces   # Per-issue workspace directory

hooks:
  after_create: |               # Shell script after workspace created
    git clone --depth 1 $GITLAB_CLONE_URL .
  before_run: |                 # Before each agent run
    git fetch origin main
  after_run: |                  # After each agent run (errors ignored)
    echo "run complete"

agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000

ai:
  base_url: $AI_BASE_URL
  api_key: $AI_API_KEY
  model: $AI_MODEL
  system_prompt: "You are an expert software engineer..."
  max_tokens: 4096
  temperature: 0.2
  turn_timeout_ms: 600000
  stall_timeout_ms: 300000

gitlab:
  base_url: $GITLAB_BASE_URL
  token: $GITLAB_TOKEN
  project_id: $GITLAB_PROJECT_ID

mode: prompt-only               # "prompt-only" or "auto"

server:
  port: 3000
---
```

### Prompt Template

The Markdown body after the YAML front matter is a [Liquid](https://liquidjs.com/) template.

Available variables:
- `issue.identifier` - Jira issue key (e.g. `PROJ-123`)
- `issue.title` - Issue summary
- `issue.description` - Issue description (ADF converted to text)
- `issue.state` - Current status name
- `issue.labels` - Array of labels (lowercase)
- `issue.url` - Link to the Jira issue
- `issue.priority` - Priority number
- `issue.blockedBy` - Array of blocking issues
- `attempt` - Retry attempt number (null on first run)

## Architecture

```
┌──────────────┐     ┌───────────┐     ┌──────────────┐
│  WORKFLOW.md │────>│  Config   │────>│ Orchestrator │
│  (YAML+tmpl) │     │  Layer    │     │  (poll/dispatch/retry)
└──────────────┘     └───────────┘     └──────┬───────┘
                                              │
                    ┌─────────────────────────┼─────────────────────┐
                    │                         │                     │
              ┌─────▼─────┐           ┌───────▼──────┐     ┌───────▼──────┐
              │   Jira    │           │    Agent     │     │   Web        │
              │  Adapter  │           │    Runner    │     │  Dashboard   │
              │ (REST API)│           │              │     │ (Express)    │
              └───────────┘           └───────┬──────┘     └──────────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    │         │         │
                              ┌─────▼───┐ ┌───▼───┐ ┌───▼─────┐
                              │Workspace│ │Prompt │ │AI Client│
                              │Manager  │ │Builder│ │(OpenAI) │
                              └─────────┘ └───────┘ └─────────┘
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Web dashboard |
| GET | `/api/v1/state` | Full runtime state JSON |
| GET | `/api/v1/:issueId` | Single issue details |
| POST | `/api/v1/refresh` | Trigger immediate poll |

## File Structure

```
nodejs/
├── package.json
├── .env.example
├── WORKFLOW.md                  # Workflow config + prompt template
├── src/
│   ├── index.js                 # CLI entry point
│   ├── config.js                # Typed config from WORKFLOW.md
│   ├── workflow.js              # WORKFLOW.md parser
│   ├── workflow-store.js        # File watcher + hot reload
│   ├── prompt-builder.js        # Liquid template rendering
│   ├── orchestrator.js          # Poll/dispatch/retry/reconciliation
│   ├── agent-runner.js          # Per-issue turn runner
│   ├── ai-client.js             # OpenAI-compatible HTTP client
│   ├── workspace.js             # Per-issue workspace management
│   ├── logger.js                # Structured logging (winston)
│   ├── tracker/
│   │   ├── index.js             # Tracker adapter factory
│   │   ├── jira-adapter.js      # Jira REST API client
│   │   └── memory-adapter.js    # In-memory test adapter
│   ├── gitlab/
│   │   └── client.js            # GitLab REST API client
│   └── web/
│       ├── server.js            # Express server + API routes
│       └── dashboard.html       # Single-page dashboard UI
```
