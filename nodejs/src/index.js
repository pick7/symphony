#!/usr/bin/env node

import { resolve } from 'path';
import { existsSync } from 'fs';
import { WorkflowStore } from './workflow-store.js';
import { createTracker } from './tracker/index.js';
import { GitLabClient } from './gitlab/client.js';
import { AIClient } from './ai-client.js';
import { WorkspaceManager } from './workspace.js';
import { AgentRunner } from './agent-runner.js';
import { Orchestrator } from './orchestrator.js';
import { createServer, startServer } from './web/server.js';
import logger from './logger.js';

async function main() {
  const args = process.argv.slice(2);
  let portOverride = null;

  const filteredArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      portOverride = parseInt(args[i + 1], 10);
      i++;
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const workflowPath = resolve(filteredArgs[0] || './WORKFLOW.md');
  if (!existsSync(workflowPath)) {
    logger.error(`Workflow file not found: ${workflowPath}`);
    process.exit(1);
  }

  // Load workflow
  const store = new WorkflowStore(workflowPath);
  let config;
  try {
    config = store.load();
  } catch (err) {
    logger.error(`Failed to load workflow: ${err.message}`);
    process.exit(1);
  }

  // Validate
  const errors = config.validate();
  if (errors.length > 0) {
    logger.error(`Config validation errors:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }

  // Create components
  const tracker = createTracker(config);
  const workspace = new WorkspaceManager(config);

  let gitlab = null;
  if (config.gitlabBaseUrl && config.gitlabToken) {
    gitlab = new GitLabClient(config);
    logger.info(`GitLab integration enabled: ${config.gitlabBaseUrl}`);
  }

  let aiClient = null;
  if (config.mode === 'auto' && config.aiBaseUrl) {
    aiClient = new AIClient(config);
    logger.info(`AI client enabled: ${config.aiBaseUrl} model=${config.aiModel}`);
  }

  const agentRunner = new AgentRunner({ config, tracker, workspace, aiClient, gitlab });
  const orchestrator = new Orchestrator({ config, tracker, workspace, agentRunner });

  // Watch workflow for changes
  store.on('reload', (newConfig) => {
    logger.info('Workflow reloaded, updating orchestrator config');
    orchestrator.updateConfig(newConfig);
  });
  store.startWatching();

  // Start HTTP server
  const port = portOverride || config.serverPort || parseInt(process.env.PORT, 10) || 3000;
  const app = createServer(orchestrator, config);
  try {
    await startServer(app, port);
  } catch (err) {
    logger.error(`Failed to start HTTP server: ${err.message}`);
    process.exit(1);
  }

  // Start orchestrator
  orchestrator.start();

  logger.info(`Symphony started in ${config.mode} mode`);
  logger.info(`Tracker: ${config.trackerKind} | Project: ${config.jiraProjectKey || 'n/a'}`);
  logger.info(`Active states: ${config.activeStates.join(', ')}`);
  logger.info(`Terminal states: ${config.terminalStates.join(', ')}`);
  logger.info(`Max concurrent: ${config.maxConcurrentAgents} | Max turns: ${config.maxTurns}`);
  logger.info(`Poll interval: ${config.pollIntervalMs}ms`);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    orchestrator.stop();
    store.stopWatching();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
