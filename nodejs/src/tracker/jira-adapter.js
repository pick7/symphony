import axios from 'axios';
import logger from '../logger.js';

export class JiraAdapter {
  constructor(config) {
    this._config = config;
    this._client = axios.create({
      baseURL: config.jiraBaseUrl,
      timeout: 30000,
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  }

  async fetchCandidateIssues() {
    const { jiraProjectKey, activeStates, jiraAssignee } = this._config;
    const statesJql = activeStates.map(s => `"${s}"`).join(', ');
    let jql = `project = "${jiraProjectKey}" AND status IN (${statesJql})`;
    if (jiraAssignee === 'me') {
      jql += ' AND assignee = currentUser()';
    } else if (jiraAssignee) {
      jql += ` AND assignee = "${jiraAssignee}"`;
    }
    jql += ' ORDER BY priority ASC, created ASC';

    return this._fetchIssuesByJql(jql);
  }

  async fetchIssuesByStates(stateNames) {
    if (!stateNames || stateNames.length === 0) return [];
    const { jiraProjectKey } = this._config;
    const statesJql = stateNames.map(s => `"${s}"`).join(', ');
    const jql = `project = "${jiraProjectKey}" AND status IN (${statesJql})`;
    return this._fetchIssuesByJql(jql);
  }

  async fetchIssueStatesByIds(issueIds) {
    if (!issueIds || issueIds.length === 0) return [];
    const idsJql = issueIds.map(id => `"${id}"`).join(', ');
    const jql = `key IN (${idsJql})`;
    return this._fetchIssuesByJql(jql);
  }

  async createComment(issueId, body) {
    try {
      await this._client.post(`/rest/api/3/issue/${issueId}/comment`, {
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
        },
      });
      logger.info(`Comment created on ${issueId}`);
    } catch (err) {
      logger.error(`Failed to create comment on ${issueId}: ${err.message}`);
      throw err;
    }
  }

  async updateIssueState(issueId, targetStateName) {
    try {
      const { data } = await this._client.get(`/rest/api/3/issue/${issueId}/transitions`);
      const transition = data.transitions.find(
        t => t.name.toLowerCase().trim() === targetStateName.toLowerCase().trim()
      );
      if (!transition) {
        throw new Error(`Transition to "${targetStateName}" not found for ${issueId}`);
      }
      await this._client.post(`/rest/api/3/issue/${issueId}/transitions`, {
        transition: { id: transition.id },
      });
      logger.info(`Issue ${issueId} transitioned to ${targetStateName}`);
    } catch (err) {
      logger.error(`Failed to update state for ${issueId}: ${err.message}`);
      throw err;
    }
  }

  async _fetchIssuesByJql(jql) {
    const issues = [];
    let startAt = 0;
    const maxResults = 50;

    while (true) {
      try {
        const { data } = await this._client.get('/rest/api/3/search', {
          params: {
            jql,
            startAt,
            maxResults,
            fields: 'summary,description,status,priority,assignee,labels,created,updated,issuelinks',
          },
        });

        for (const raw of data.issues) {
          issues.push(this._normalizeIssue(raw));
        }

        if (startAt + data.issues.length >= data.total) break;
        startAt += maxResults;
      } catch (err) {
        const status = err.response?.status;
        const body = err.response?.data;
        logger.error(`Jira API error: status=${status} ${err.message}`, { body });
        throw new Error(`jira_api_error: ${err.message}`);
      }
    }

    return issues;
  }

  _normalizeIssue(raw) {
    const fields = raw.fields;
    const blockedBy = (fields.issuelinks || [])
      .filter(link => link.type?.inward === 'is blocked by' && link.inwardIssue)
      .map(link => ({
        id: link.inwardIssue.key,
        identifier: link.inwardIssue.key,
        state: link.inwardIssue.fields?.status?.name || null,
      }));

    return {
      id: raw.key,
      identifier: raw.key,
      title: fields.summary || '',
      description: this._extractDescription(fields.description),
      priority: fields.priority?.id ? parseInt(fields.priority.id, 10) : null,
      state: fields.status?.name || '',
      branchName: null,
      url: `${this._config.jiraBaseUrl}/browse/${raw.key}`,
      assigneeId: fields.assignee?.accountId || null,
      labels: (fields.labels || []).map(l => l.toLowerCase()),
      blockedBy,
      createdAt: fields.created ? new Date(fields.created) : null,
      updatedAt: fields.updated ? new Date(fields.updated) : null,
      assignedToWorker: true,
    };
  }

  _extractDescription(desc) {
    if (!desc) return '';
    if (typeof desc === 'string') return desc;
    if (desc.type === 'doc' && desc.content) {
      return this._adfToText(desc);
    }
    return JSON.stringify(desc);
  }

  _adfToText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (Array.isArray(node.content)) {
      return node.content.map(n => this._adfToText(n)).join(
        node.type === 'paragraph' ? '\n' : ''
      );
    }
    return '';
  }
}
