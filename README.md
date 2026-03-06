# Symphony-nodejs

Symphony-nodejs turns project work into isolated, autonomous implementation runs, allowing teams to manage
work instead of supervising coding agents.

> [!WARNING]
> Symphony-nodejs is a low-key engineering preview for testing in trusted environments.

## Running Symphony-nodejs

### Requirements

Symphony-nodejs works best in codebases that have adopted
[harness engineering](https://openai.com/index/harness-engineering/). Symphony-nodejs is the next step --
moving from managing coding agents to managing work that needs to get done.

### Option 1. Make your own

Tell your favorite coding agent to build Symphony in a programming language of your choice:

> Implement Symphony according to the following spec:
> https://github.com/openai/symphony/blob/main/SPEC.md

### Option 2. Use the Node.js implementation

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

Check out [nodejs/README.md](nodejs/README.md) for detailed instructions.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
