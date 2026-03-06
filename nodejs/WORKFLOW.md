---
tracker:
  kind: jira
  base_url: $JIRA_BASE_URL
  email: $JIRA_EMAIL
  api_key: $JIRA_API_TOKEN
  project_key: $JIRA_PROJECT_KEY
  active_states:
    - To Do
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: ~/symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 $GITLAB_CLONE_URL .
agent:
  max_concurrent_agents: 5
  max_turns: 20
ai:
  base_url: $AI_BASE_URL
  api_key: $AI_API_KEY
  model: $AI_MODEL
  system_prompt: |
    You are an expert software engineer working on coding tasks.
    Follow instructions precisely. Write clean, maintainable code.
    Always explain your reasoning before making changes.
  max_tokens: 4096
  temperature: 0.2
gitlab:
  base_url: $GITLAB_BASE_URL
  token: $GITLAB_TOKEN
  project_id: $GITLAB_PROJECT_ID
mode: prompt-only
server:
  port: 3000
---

You are working on a Jira ticket `{{ issue.identifier }}`

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
{% endif %}

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
Labels: {{ issue.labels | join: ", " }}
URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

Instructions:

1. Work only in the provided repository copy. Do not touch any other path.
2. Analyze the issue requirements carefully before making any changes.
3. Write tests for new functionality.
4. Keep changes narrowly scoped to the issue requirements.
5. Create clean, atomic commits with descriptive messages.
6. Push to a feature branch and create a merge request when ready.

## Workflow

### Status map
- `To Do` -> queued; transition to `In Progress` before active work.
- `In Progress` -> implementation underway.
- `Code Review` -> MR attached and validated; waiting on human approval.
- `Done` -> terminal state; no further action required.

### Step 1: Understand the issue
1. Read the full issue description and any comments.
2. Identify acceptance criteria.
3. Plan the implementation.

### Step 2: Implementation
1. Create a feature branch from `main`.
2. Implement the required changes.
3. Write/update tests.
4. Run validation and ensure tests pass.

### Step 3: Submit
1. Commit changes with descriptive messages.
2. Push to GitLab.
3. Create a merge request.
4. Link the MR to the Jira issue.

### Guardrails
- Do not modify unrelated code.
- Keep commits atomic and well-described.
- If blocked by missing information, document what's needed and stop.
