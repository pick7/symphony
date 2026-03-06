import axios from 'axios';
import logger from '../logger.js';

export class GitLabClient {
  constructor(config) {
    this._config = config;
    this._client = axios.create({
      baseURL: `${config.gitlabBaseUrl}/api/v4`,
      timeout: 30000,
      headers: {
        'PRIVATE-TOKEN': config.gitlabToken,
        'Content-Type': 'application/json',
      },
    });
    this._projectId = config.gitlabProjectId;
  }

  async createBranch(branchName, ref = 'main') {
    try {
      const { data } = await this._client.post(
        `/projects/${encodeURIComponent(this._projectId)}/repository/branches`,
        { branch: branchName, ref }
      );
      logger.info(`GitLab branch created: ${branchName}`);
      return data;
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.message?.includes('already exists')) {
        logger.info(`GitLab branch already exists: ${branchName}`);
        return null;
      }
      throw new Error(`gitlab_create_branch: ${err.message}`);
    }
  }

  async createMergeRequest(sourceBranch, title, description = '') {
    try {
      const { data } = await this._client.post(
        `/projects/${encodeURIComponent(this._projectId)}/merge_requests`,
        {
          source_branch: sourceBranch,
          target_branch: 'main',
          title,
          description,
          remove_source_branch: true,
        }
      );
      logger.info(`GitLab MR created: !${data.iid} ${title}`);
      return data;
    } catch (err) {
      if (err.response?.status === 409) {
        logger.info(`GitLab MR already exists for ${sourceBranch}`);
        return this._findExistingMR(sourceBranch);
      }
      throw new Error(`gitlab_create_mr: ${err.message}`);
    }
  }

  async addMRNote(mrIid, body) {
    try {
      const { data } = await this._client.post(
        `/projects/${encodeURIComponent(this._projectId)}/merge_requests/${mrIid}/notes`,
        { body }
      );
      return data;
    } catch (err) {
      logger.error(`Failed to add MR note: ${err.message}`);
      throw err;
    }
  }

  async getMRByBranch(sourceBranch) {
    return this._findExistingMR(sourceBranch);
  }

  async listMRNotes(mrIid) {
    try {
      const { data } = await this._client.get(
        `/projects/${encodeURIComponent(this._projectId)}/merge_requests/${mrIid}/notes`,
        { params: { sort: 'asc', per_page: 100 } }
      );
      return data;
    } catch (err) {
      logger.error(`Failed to list MR notes: ${err.message}`);
      return [];
    }
  }

  async getProject() {
    const { data } = await this._client.get(
      `/projects/${encodeURIComponent(this._projectId)}`
    );
    return data;
  }

  async _findExistingMR(sourceBranch) {
    try {
      const { data } = await this._client.get(
        `/projects/${encodeURIComponent(this._projectId)}/merge_requests`,
        { params: { source_branch: sourceBranch, state: 'opened' } }
      );
      return data[0] || null;
    } catch {
      return null;
    }
  }
}
