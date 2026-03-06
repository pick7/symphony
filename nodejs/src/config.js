import { getNestedValue, resolveEnvValue, expandPath } from './workflow.js';

export class Config {
  constructor(workflow) {
    this._config = workflow.config || {};
    this._promptTemplate = workflow.promptTemplate || '';
  }

  get promptTemplate() {
    return this._promptTemplate;
  }

  // --- Tracker ---
  get trackerKind() {
    return getNestedValue(this._config, 'tracker.kind', 'jira');
  }
  get jiraBaseUrl() {
    return resolveEnvValue(getNestedValue(this._config, 'tracker.base_url'))
      || process.env.JIRA_BASE_URL;
  }
  get jiraEmail() {
    return resolveEnvValue(getNestedValue(this._config, 'tracker.email'))
      || process.env.JIRA_EMAIL;
  }
  get jiraApiToken() {
    return resolveEnvValue(getNestedValue(this._config, 'tracker.api_key'))
      || process.env.JIRA_API_TOKEN;
  }
  get jiraProjectKey() {
    return resolveEnvValue(getNestedValue(this._config, 'tracker.project_key'))
      || process.env.JIRA_PROJECT_KEY;
  }
  get activeStates() {
    const val = getNestedValue(this._config, 'tracker.active_states', ['To Do', 'In Progress']);
    return Array.isArray(val) ? val : String(val).split(',').map(s => s.trim());
  }
  get terminalStates() {
    const val = getNestedValue(this._config, 'tracker.terminal_states', ['Done', 'Closed', 'Cancelled']);
    return Array.isArray(val) ? val : String(val).split(',').map(s => s.trim());
  }
  get jiraAssignee() {
    return resolveEnvValue(getNestedValue(this._config, 'tracker.assignee'));
  }

  // --- GitLab ---
  get gitlabBaseUrl() {
    return resolveEnvValue(getNestedValue(this._config, 'gitlab.base_url'))
      || process.env.GITLAB_BASE_URL;
  }
  get gitlabToken() {
    return resolveEnvValue(getNestedValue(this._config, 'gitlab.token'))
      || process.env.GITLAB_TOKEN;
  }
  get gitlabProjectId() {
    return resolveEnvValue(getNestedValue(this._config, 'gitlab.project_id'))
      || process.env.GITLAB_PROJECT_ID;
  }

  // --- Polling ---
  get pollIntervalMs() {
    return parseInt(getNestedValue(this._config, 'polling.interval_ms', 30000), 10);
  }

  // --- Workspace ---
  get workspaceRoot() {
    const val = getNestedValue(this._config, 'workspace.root');
    if (val) return expandPath(val);
    return expandPath(process.env.WORKSPACE_ROOT || '/tmp/symphony_workspaces');
  }

  // --- Hooks ---
  get hooks() {
    return {
      afterCreate: getNestedValue(this._config, 'hooks.after_create'),
      beforeRun: getNestedValue(this._config, 'hooks.before_run'),
      afterRun: getNestedValue(this._config, 'hooks.after_run'),
      beforeRemove: getNestedValue(this._config, 'hooks.before_remove'),
      timeoutMs: parseInt(getNestedValue(this._config, 'hooks.timeout_ms', 60000), 10),
    };
  }

  // --- Agent ---
  get maxConcurrentAgents() {
    return parseInt(getNestedValue(this._config, 'agent.max_concurrent_agents', 10), 10);
  }
  get maxTurns() {
    return parseInt(getNestedValue(this._config, 'agent.max_turns', 20), 10);
  }
  get maxRetryBackoffMs() {
    return parseInt(getNestedValue(this._config, 'agent.max_retry_backoff_ms', 300000), 10);
  }
  get maxConcurrentAgentsByState() {
    return getNestedValue(this._config, 'agent.max_concurrent_agents_by_state', {});
  }

  // --- AI (OpenAI-compatible) ---
  get aiBaseUrl() {
    return resolveEnvValue(getNestedValue(this._config, 'ai.base_url'))
      || process.env.AI_BASE_URL
      || 'http://localhost:8080/v1';
  }
  get aiApiKey() {
    return resolveEnvValue(getNestedValue(this._config, 'ai.api_key'))
      || process.env.AI_API_KEY
      || '';
  }
  get aiModel() {
    return resolveEnvValue(getNestedValue(this._config, 'ai.model'))
      || process.env.AI_MODEL
      || 'gpt-4';
  }
  get aiSystemPrompt() {
    return getNestedValue(this._config, 'ai.system_prompt',
      'You are an expert software engineer working on coding tasks. Follow instructions precisely.');
  }
  get aiMaxTokens() {
    return parseInt(getNestedValue(this._config, 'ai.max_tokens', 4096), 10);
  }
  get aiTemperature() {
    return parseFloat(getNestedValue(this._config, 'ai.temperature', 0.2));
  }
  get aiTurnTimeoutMs() {
    return parseInt(getNestedValue(this._config, 'ai.turn_timeout_ms', 600000), 10);
  }
  get aiStallTimeoutMs() {
    return parseInt(getNestedValue(this._config, 'ai.stall_timeout_ms', 300000), 10);
  }

  // --- Mode ---
  get mode() {
    return getNestedValue(this._config, 'mode', 'prompt-only');
  }

  // --- Server ---
  get serverPort() {
    return parseInt(getNestedValue(this._config, 'server.port', 0), 10)
      || parseInt(process.env.PORT, 10) || 0;
  }

  validate() {
    const errors = [];

    if (!this.trackerKind) errors.push('tracker.kind is required');
    if (this.trackerKind === 'jira') {
      if (!this.jiraBaseUrl) errors.push('tracker.base_url or JIRA_BASE_URL is required');
      if (!this.jiraApiToken) errors.push('tracker.api_key or JIRA_API_TOKEN is required');
      if (!this.jiraProjectKey) errors.push('tracker.project_key or JIRA_PROJECT_KEY is required');
    }

    if (this.mode === 'auto') {
      if (!this.aiBaseUrl) errors.push('ai.base_url or AI_BASE_URL is required for auto mode');
    }

    return errors;
  }
}
