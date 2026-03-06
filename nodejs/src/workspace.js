import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { execSync } from 'child_process';
import logger from './logger.js';

export class WorkspaceManager {
  constructor(config) {
    this._config = config;
  }

  createForIssue(issueIdentifier) {
    const key = sanitizeIdentifier(issueIdentifier);
    const root = resolve(this._config.workspaceRoot);
    const wsPath = join(root, key);

    this._validateWorkspacePath(wsPath, root);

    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
    }

    let createdNow = false;
    if (!existsSync(wsPath)) {
      mkdirSync(wsPath, { recursive: true });
      createdNow = true;
    }

    if (createdNow && this._config.hooks.afterCreate) {
      this._runHook('after_create', this._config.hooks.afterCreate, wsPath);
    }

    return { path: wsPath, key, createdNow };
  }

  remove(issueIdentifier) {
    const key = sanitizeIdentifier(issueIdentifier);
    const root = resolve(this._config.workspaceRoot);
    const wsPath = join(root, key);

    if (!existsSync(wsPath)) return;

    if (this._config.hooks.beforeRemove) {
      try {
        this._runHook('before_remove', this._config.hooks.beforeRemove, wsPath);
      } catch (err) {
        logger.warn(`before_remove hook failed for ${key}: ${err.message}`);
      }
    }

    try {
      rmSync(wsPath, { recursive: true, force: true });
      logger.info(`Workspace removed: ${key}`);
    } catch (err) {
      logger.warn(`Failed to remove workspace ${key}: ${err.message}`);
    }
  }

  runBeforeRunHook(wsPath) {
    if (this._config.hooks.beforeRun) {
      this._runHook('before_run', this._config.hooks.beforeRun, wsPath);
    }
  }

  runAfterRunHook(wsPath) {
    if (this._config.hooks.afterRun) {
      try {
        this._runHook('after_run', this._config.hooks.afterRun, wsPath);
      } catch (err) {
        logger.warn(`after_run hook failed: ${err.message}`);
      }
    }
  }

  pathForIssue(issueIdentifier) {
    const key = sanitizeIdentifier(issueIdentifier);
    return join(resolve(this._config.workspaceRoot), key);
  }

  _validateWorkspacePath(wsPath, root) {
    const absWs = resolve(wsPath);
    const absRoot = resolve(root);
    if (!absWs.startsWith(absRoot)) {
      throw new Error(`invalid_workspace_cwd: ${absWs} is outside workspace root ${absRoot}`);
    }
  }

  _runHook(name, script, cwd) {
    const timeoutMs = this._config.hooks.timeoutMs || 60000;
    logger.info(`Running hook ${name} in ${cwd}`);
    try {
      execSync(script, {
        cwd,
        shell: '/bin/bash',
        timeout: timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, WORKSPACE_PATH: cwd },
      });
      logger.info(`Hook ${name} completed`);
    } catch (err) {
      const msg = err.stderr?.toString().slice(0, 500) || err.message;
      throw new Error(`hook_${name}_failed: ${msg}`);
    }
  }
}

export function sanitizeIdentifier(identifier) {
  return identifier.replace(/[^A-Za-z0-9._-]/g, '_');
}
