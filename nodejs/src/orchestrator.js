import { EventEmitter } from 'events';
import logger from './logger.js';

export class Orchestrator extends EventEmitter {
  constructor({ config, tracker, workspace, agentRunner }) {
    super();
    this._config = config;
    this._tracker = tracker;
    this._workspace = workspace;
    this._agentRunner = agentRunner;

    this._running = new Map();       // issueId -> running entry
    this._claimed = new Set();       // issueId
    this._retryAttempts = new Map(); // issueId -> retry entry
    this._completed = new Set();     // issueId

    this._aiTotals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    };

    this._pollTimer = null;
    this._pollInProgress = false;
  }

  updateConfig(config) {
    this._config = config;
  }

  start() {
    const errors = this._config.validate();
    if (errors.length > 0) {
      throw new Error(`Config validation failed: ${errors.join('; ')}`);
    }

    logger.info('Orchestrator starting...');
    this._startupCleanup().then(() => {
      this._scheduleTick(0);
    });
  }

  stop() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    for (const [issueId, entry] of this._running) {
      if (entry.abortController) entry.abortController.abort();
    }
    for (const [, entry] of this._retryAttempts) {
      if (entry.timerHandle) clearTimeout(entry.timerHandle);
    }
    logger.info('Orchestrator stopped');
  }

  requestRefresh() {
    if (this._pollInProgress) {
      logger.info('Poll already in progress, will coalesce');
      return { queued: true, coalesced: true };
    }
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._scheduleTick(0);
    return { queued: true, coalesced: false };
  }

  snapshot() {
    const running = [];
    for (const [issueId, entry] of this._running) {
      running.push({
        issueId,
        issueIdentifier: entry.identifier,
        state: entry.issue?.state || 'unknown',
        sessionId: entry.sessionId,
        turnCount: entry.turnCount,
        lastEvent: entry.lastEvent,
        lastMessage: entry.lastMessage,
        startedAt: entry.startedAt,
        lastEventAt: entry.lastEventAt,
        tokens: {
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          totalTokens: entry.totalTokens,
        },
        retryAttempt: entry.retryAttempt,
      });
    }

    const retrying = [];
    for (const [issueId, entry] of this._retryAttempts) {
      retrying.push({
        issueId,
        issueIdentifier: entry.identifier,
        attempt: entry.attempt,
        dueAt: entry.dueAt ? new Date(entry.dueAt).toISOString() : null,
        error: entry.error,
      });
    }

    const now = Date.now();
    let activeSeconds = 0;
    for (const [, entry] of this._running) {
      activeSeconds += (now - new Date(entry.startedAt).getTime()) / 1000;
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: { running: this._running.size, retrying: this._retryAttempts.size },
      running,
      retrying,
      aiTotals: {
        inputTokens: this._aiTotals.inputTokens,
        outputTokens: this._aiTotals.outputTokens,
        totalTokens: this._aiTotals.totalTokens,
        secondsRunning: Math.round((this._aiTotals.secondsRunning + activeSeconds) * 10) / 10,
      },
      mode: this._config.mode,
      polling: !this._pollInProgress,
    };
  }

  // --- Internal ---

  async _startupCleanup() {
    try {
      const terminalIssues = await this._tracker.fetchIssuesByStates(this._config.terminalStates);
      for (const issue of terminalIssues) {
        this._workspace.remove(issue.identifier);
      }
      logger.info(`Startup cleanup: removed ${terminalIssues.length} terminal workspaces`);
    } catch (err) {
      logger.warn(`Startup cleanup failed: ${err.message}`);
    }
  }

  _scheduleTick(delayMs) {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this._tick(), delayMs);
  }

  async _tick() {
    this._pollInProgress = true;
    this.emit('tick_start');

    try {
      await this._reconcileRunningIssues();
    } catch (err) {
      logger.error(`Reconciliation error: ${err.message}`);
    }

    const validationErrors = this._config.validate();
    if (validationErrors.length > 0) {
      logger.error(`Config validation failed, skipping dispatch: ${validationErrors.join('; ')}`);
      this._pollInProgress = false;
      this.emit('update');
      this._scheduleTick(this._config.pollIntervalMs);
      return;
    }

    try {
      const candidates = await this._tracker.fetchCandidateIssues();
      const sorted = this._sortForDispatch(candidates);

      for (const issue of sorted) {
        if (this._availableSlots() <= 0) break;
        if (this._shouldDispatch(issue)) {
          this._dispatch(issue, null);
        }
      }
    } catch (err) {
      logger.error(`Candidate fetch error: ${err.message}`);
    }

    this._pollInProgress = false;
    this.emit('update');
    this._scheduleTick(this._config.pollIntervalMs);
  }

  async _reconcileRunningIssues() {
    this._reconcileStalledRuns();

    const runningIds = [...this._running.keys()];
    if (runningIds.length === 0) return;

    let refreshed;
    try {
      refreshed = await this._tracker.fetchIssueStatesByIds(runningIds);
    } catch (err) {
      logger.warn(`State refresh failed, keeping workers: ${err.message}`);
      return;
    }

    const activeNorm = new Set(this._config.activeStates.map(s => s.toLowerCase().trim()));
    const terminalNorm = new Set(this._config.terminalStates.map(s => s.toLowerCase().trim()));

    for (const issueState of refreshed) {
      const stateNorm = (issueState.state || '').toLowerCase().trim();
      const entry = this._running.get(issueState.id);
      if (!entry) continue;

      if (terminalNorm.has(stateNorm)) {
        this._terminateRunning(issueState.id, true);
      } else if (activeNorm.has(stateNorm)) {
        if (entry.issue) entry.issue.state = issueState.state;
      } else {
        this._terminateRunning(issueState.id, false);
      }
    }
  }

  _reconcileStalledRuns() {
    const stallTimeoutMs = this._config.aiStallTimeoutMs;
    if (stallTimeoutMs <= 0) return;

    const now = Date.now();
    for (const [issueId, entry] of this._running) {
      const lastActivity = entry.lastEventAt
        ? new Date(entry.lastEventAt).getTime()
        : new Date(entry.startedAt).getTime();
      const elapsed = now - lastActivity;

      if (elapsed > stallTimeoutMs) {
        logger.warn(`Issue ${entry.identifier} stalled (${Math.round(elapsed/1000)}s), terminating`);
        this._terminateRunning(issueId, false);
        this._scheduleRetry(issueId, (entry.retryAttempt || 0) + 1, {
          identifier: entry.identifier,
          error: `stalled for ${Math.round(elapsed/1000)}s`,
        });
      }
    }
  }

  _terminateRunning(issueId, cleanupWorkspace) {
    const entry = this._running.get(issueId);
    if (!entry) return;

    if (entry.abortController) entry.abortController.abort();

    const elapsed = (Date.now() - new Date(entry.startedAt).getTime()) / 1000;
    this._aiTotals.secondsRunning += elapsed;

    this._running.delete(issueId);

    if (cleanupWorkspace && entry.identifier) {
      this._workspace.remove(entry.identifier);
    }

    this._claimed.delete(issueId);
    logger.info(`Terminated ${entry.identifier} (cleanup=${cleanupWorkspace})`);
  }

  _sortForDispatch(issues) {
    return [...issues].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;

      const ca = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
      if (ca !== cb) return ca - cb;

      return (a.identifier || '').localeCompare(b.identifier || '');
    });
  }

  _shouldDispatch(issue) {
    if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;

    const stateNorm = issue.state.toLowerCase().trim();
    const activeNorm = new Set(this._config.activeStates.map(s => s.toLowerCase().trim()));
    const terminalNorm = new Set(this._config.terminalStates.map(s => s.toLowerCase().trim()));

    if (!activeNorm.has(stateNorm) || terminalNorm.has(stateNorm)) return false;
    if (this._running.has(issue.id)) return false;
    if (this._claimed.has(issue.id)) return false;

    if (stateNorm === 'to do' || stateNorm === 'todo') {
      const hasNonTerminalBlocker = (issue.blockedBy || []).some(b => {
        const bs = (b.state || '').toLowerCase().trim();
        return !terminalNorm.has(bs);
      });
      if (hasNonTerminalBlocker) return false;
    }

    const perStateLimit = this._getPerStateLimit(stateNorm);
    const stateCount = this._countRunningByState(stateNorm);
    if (stateCount >= perStateLimit) return false;

    return true;
  }

  _availableSlots() {
    return Math.max(this._config.maxConcurrentAgents - this._running.size, 0);
  }

  _getPerStateLimit(stateNorm) {
    const byState = this._config.maxConcurrentAgentsByState;
    for (const [key, val] of Object.entries(byState)) {
      if (key.toLowerCase().trim() === stateNorm && val > 0) return val;
    }
    return this._config.maxConcurrentAgents;
  }

  _countRunningByState(stateNorm) {
    let count = 0;
    for (const [, entry] of this._running) {
      if ((entry.issue?.state || '').toLowerCase().trim() === stateNorm) count++;
    }
    return count;
  }

  _dispatch(issue, attempt) {
    const ac = new AbortController();

    const entry = {
      identifier: issue.identifier,
      issue,
      abortController: ac,
      sessionId: null,
      turnCount: 0,
      lastEvent: null,
      lastMessage: null,
      startedAt: new Date().toISOString(),
      lastEventAt: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      retryAttempt: attempt || 0,
    };

    this._running.set(issue.id, entry);
    this._claimed.add(issue.id);

    if (this._retryAttempts.has(issue.id)) {
      const retryEntry = this._retryAttempts.get(issue.id);
      if (retryEntry.timerHandle) clearTimeout(retryEntry.timerHandle);
      this._retryAttempts.delete(issue.id);
    }

    logger.info(`Dispatching ${issue.identifier} (attempt=${attempt || 'initial'})`,
      { issue_id: issue.id, issue_identifier: issue.identifier });

    this._runWorker(issue, entry, attempt);
    this.emit('update');
  }

  async _runWorker(issue, entry, attempt) {
    try {
      const result = await this._agentRunner.run(issue, (update) => {
        this._handleWorkerUpdate(issue.id, update);
      }, { attempt });

      this._onWorkerExit(issue.id, 'normal', null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      logger.error(`Worker error for ${issue.identifier}: ${err.message}`,
        { issue_id: issue.id, issue_identifier: issue.identifier });
      this._onWorkerExit(issue.id, 'error', err.message);
    }
  }

  _handleWorkerUpdate(issueId, update) {
    const entry = this._running.get(issueId);
    if (!entry) return;

    entry.lastEvent = update.event;
    entry.lastEventAt = update.timestamp;

    if (update.event === 'turn_started') {
      entry.turnCount = update.turnNumber || (entry.turnCount + 1);
    }

    if (update.event === 'turn_completed' && update.usage) {
      entry.inputTokens += update.usage.prompt_tokens || 0;
      entry.outputTokens += update.usage.completion_tokens || 0;
      entry.totalTokens += update.usage.total_tokens || 0;
      this._aiTotals.inputTokens += update.usage.prompt_tokens || 0;
      this._aiTotals.outputTokens += update.usage.completion_tokens || 0;
      this._aiTotals.totalTokens += update.usage.total_tokens || 0;
    }

    if (update.contentPreview) {
      entry.lastMessage = update.contentPreview;
    } else if (update.prompt) {
      entry.lastMessage = update.prompt;
    }

    this.emit('update');
  }

  _onWorkerExit(issueId, reason, error) {
    const entry = this._running.get(issueId);
    if (!entry) return;

    const elapsed = (Date.now() - new Date(entry.startedAt).getTime()) / 1000;
    this._aiTotals.secondsRunning += elapsed;

    this._running.delete(issueId);

    if (reason === 'normal') {
      this._completed.add(issueId);
      this._scheduleRetry(issueId, 1, {
        identifier: entry.identifier,
        error: null,
      }, 1000);
    } else {
      const nextAttempt = (entry.retryAttempt || 0) + 1;
      this._scheduleRetry(issueId, nextAttempt, {
        identifier: entry.identifier,
        error: error || 'worker_error',
      });
    }

    this.emit('update');
  }

  _scheduleRetry(issueId, attempt, { identifier, error }, fixedDelayMs = null) {
    if (this._retryAttempts.has(issueId)) {
      const old = this._retryAttempts.get(issueId);
      if (old.timerHandle) clearTimeout(old.timerHandle);
    }

    let delayMs;
    if (fixedDelayMs != null) {
      delayMs = fixedDelayMs;
    } else {
      delayMs = Math.min(10000 * Math.pow(2, attempt - 1), this._config.maxRetryBackoffMs);
    }

    const dueAt = Date.now() + delayMs;
    const timerHandle = setTimeout(() => this._onRetryTimer(issueId), delayMs);

    this._retryAttempts.set(issueId, {
      attempt,
      identifier,
      error,
      dueAt,
      timerHandle,
    });

    logger.info(`Retry scheduled for ${identifier}: attempt=${attempt} delay=${delayMs}ms`,
      { issue_id: issueId, issue_identifier: identifier });
  }

  async _onRetryTimer(issueId) {
    const retryEntry = this._retryAttempts.get(issueId);
    if (!retryEntry) return;
    this._retryAttempts.delete(issueId);

    try {
      const candidates = await this._tracker.fetchCandidateIssues();
      const issue = candidates.find(c => c.id === issueId);

      if (!issue) {
        this._claimed.delete(issueId);
        logger.info(`Retry: ${retryEntry.identifier} no longer a candidate, releasing`);
        this.emit('update');
        return;
      }

      if (this._availableSlots() <= 0) {
        this._scheduleRetry(issueId, retryEntry.attempt + 1, {
          identifier: issue.identifier,
          error: 'no available orchestrator slots',
        });
        return;
      }

      this._dispatch(issue, retryEntry.attempt);
    } catch (err) {
      this._scheduleRetry(issueId, retryEntry.attempt + 1, {
        identifier: retryEntry.identifier,
        error: `retry poll failed: ${err.message}`,
      });
    }
  }
}
