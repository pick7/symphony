import { buildPrompt, buildContinuationPrompt } from './prompt-builder.js';
import logger from './logger.js';

export class AgentRunner {
  constructor({ config, tracker, workspace, aiClient, gitlab }) {
    this._config = config;
    this._tracker = tracker;
    this._workspace = workspace;
    this._aiClient = aiClient;
    this._gitlab = gitlab;
  }

  async run(issue, onUpdate, opts = {}) {
    const attempt = opts.attempt || null;
    const maxTurns = opts.maxTurns || this._config.maxTurns;
    const mode = this._config.mode;

    let ws;
    try {
      ws = this._workspace.createForIssue(issue.identifier);
    } catch (err) {
      throw new Error(`workspace_error: ${err.message}`);
    }

    try {
      this._workspace.runBeforeRunHook(ws.path);
    } catch (err) {
      throw new Error(`before_run_hook_error: ${err.message}`);
    }

    try {
      const result = await this._runTurns(issue, ws, attempt, maxTurns, mode, onUpdate);
      return result;
    } finally {
      this._workspace.runAfterRunHook(ws.path);
    }
  }

  async _runTurns(issue, ws, attempt, maxTurns, mode, onUpdate) {
    const conversationHistory = [];
    const results = [];
    let turnNumber = 1;

    while (turnNumber <= maxTurns) {
      let prompt;
      if (turnNumber === 1) {
        prompt = buildPrompt(this._config.promptTemplate, issue, attempt);
      } else {
        prompt = buildContinuationPrompt(issue);
      }

      onUpdate?.({
        event: 'turn_started',
        turnNumber,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        timestamp: new Date().toISOString(),
      });

      if (mode === 'prompt-only') {
        const turnResult = {
          turnNumber,
          prompt,
          systemPrompt: this._config.aiSystemPrompt,
          workspace: ws.path,
          issue: { id: issue.id, identifier: issue.identifier, title: issue.title, state: issue.state },
          generatedAt: new Date().toISOString(),
        };

        results.push(turnResult);

        onUpdate?.({
          event: 'prompt_generated',
          turnNumber,
          prompt: prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''),
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          timestamp: new Date().toISOString(),
        });

        break;
      }

      // auto mode: send to AI
      const aiResult = await this._aiClient.runTurn(
        this._config.aiSystemPrompt,
        prompt,
        conversationHistory
      );

      conversationHistory.push(
        { role: 'user', content: prompt },
        { role: 'assistant', content: aiResult.content }
      );

      onUpdate?.({
        event: 'turn_completed',
        turnNumber,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        usage: aiResult.usage,
        contentPreview: aiResult.content.slice(0, 200),
        timestamp: new Date().toISOString(),
      });

      results.push({
        turnNumber,
        content: aiResult.content,
        usage: aiResult.usage,
        finishReason: aiResult.finishReason,
      });

      // Check if issue is still active
      try {
        const refreshed = await this._tracker.fetchIssueStatesByIds([issue.id]);
        if (refreshed.length > 0) {
          const current = refreshed[0];
          const activeNorm = new Set(this._config.activeStates.map(s => s.toLowerCase().trim()));
          if (!activeNorm.has((current.state || '').toLowerCase().trim())) {
            logger.info(`Issue ${issue.identifier} is no longer active (${current.state}), stopping`);
            break;
          }
        }
      } catch (err) {
        logger.warn(`Failed to refresh issue state: ${err.message}`);
      }

      if (turnNumber >= maxTurns) {
        logger.info(`Max turns (${maxTurns}) reached for ${issue.identifier}`);
        break;
      }

      turnNumber++;
    }

    return {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      turns: results,
      mode,
      workspace: ws.path,
    };
  }
}
