import { watch } from 'chokidar';
import { statSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { loadWorkflow } from './workflow.js';
import { Config } from './config.js';
import logger from './logger.js';
import { EventEmitter } from 'events';

export class WorkflowStore extends EventEmitter {
  constructor(filePath) {
    super();
    this._filePath = filePath;
    this._stamp = null;
    this._workflow = null;
    this._config = null;
    this._watcher = null;
  }

  get config() {
    return this._config;
  }

  get workflow() {
    return this._workflow;
  }

  load() {
    try {
      const workflow = loadWorkflow(this._filePath);
      const stamp = this._computeStamp();
      this._workflow = workflow;
      this._stamp = stamp;
      this._config = new Config(workflow);
      logger.info(`Workflow loaded from ${this._filePath}`);
      return this._config;
    } catch (err) {
      if (this._config) {
        logger.error(`Workflow reload failed, keeping last good config: ${err.message}`);
        return this._config;
      }
      throw err;
    }
  }

  startWatching() {
    this._watcher = watch(this._filePath, { persistent: true, ignoreInitial: true });
    this._watcher.on('change', () => {
      const newStamp = this._computeStamp();
      if (this._stamp && this._stamp === newStamp) return;
      logger.info('WORKFLOW.md changed, reloading...');
      this.load();
      this.emit('reload', this._config);
    });
    logger.info(`Watching ${this._filePath} for changes`);
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  _computeStamp() {
    try {
      const stat = statSync(this._filePath);
      const content = readFileSync(this._filePath, 'utf-8');
      const hash = createHash('md5').update(content).digest('hex');
      return `${stat.mtimeMs}-${stat.size}-${hash}`;
    } catch {
      return null;
    }
  }
}
