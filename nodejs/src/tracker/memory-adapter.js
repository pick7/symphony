import logger from '../logger.js';

export class MemoryAdapter {
  constructor(issues = []) {
    this._issues = issues;
    this._comments = [];
    this._stateUpdates = [];
  }

  get comments() { return this._comments; }
  get stateUpdates() { return this._stateUpdates; }

  setIssues(issues) {
    this._issues = issues;
  }

  async fetchCandidateIssues() {
    return this._issues.filter(i =>
      i.state && !['Done', 'Closed', 'Cancelled'].includes(i.state)
    );
  }

  async fetchIssuesByStates(stateNames) {
    const normalized = new Set(stateNames.map(s => s.toLowerCase().trim()));
    return this._issues.filter(i =>
      normalized.has((i.state || '').toLowerCase().trim())
    );
  }

  async fetchIssueStatesByIds(issueIds) {
    const idSet = new Set(issueIds);
    return this._issues
      .filter(i => idSet.has(i.id))
      .map(i => ({ id: i.id, identifier: i.identifier, state: i.state }));
  }

  async createComment(issueId, body) {
    this._comments.push({ issueId, body, createdAt: new Date() });
    logger.debug(`Memory: comment on ${issueId}`);
  }

  async updateIssueState(issueId, targetState) {
    const issue = this._issues.find(i => i.id === issueId);
    if (issue) issue.state = targetState;
    this._stateUpdates.push({ issueId, targetState, updatedAt: new Date() });
    logger.debug(`Memory: ${issueId} -> ${targetState}`);
  }
}
