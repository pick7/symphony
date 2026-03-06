import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(orchestrator, config) {
  const app = express();
  app.use(express.json());

  // Dashboard
  app.get('/', (_req, res) => {
    const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
    res.type('html').send(html);
  });

  // JSON API
  app.get('/api/v1/state', (_req, res) => {
    try {
      const snap = orchestrator.snapshot();
      res.json(snap);
    } catch (err) {
      res.status(500).json({ error: { code: 'snapshot_error', message: err.message } });
    }
  });

  app.get('/api/v1/:issueIdentifier', (req, res) => {
    const { issueIdentifier } = req.params;
    const snap = orchestrator.snapshot();
    const running = snap.running.find(r => r.issueIdentifier === issueIdentifier);
    const retrying = snap.retrying.find(r => r.issueIdentifier === issueIdentifier);

    if (!running && !retrying) {
      return res.status(404).json({
        error: { code: 'issue_not_found', message: `Issue ${issueIdentifier} not found in runtime state` },
      });
    }

    res.json({
      issueIdentifier,
      issueId: running?.issueId || retrying?.issueId,
      status: running ? 'running' : 'retrying',
      running: running || null,
      retry: retrying || null,
    });
  });

  app.post('/api/v1/refresh', (_req, res) => {
    const result = orchestrator.requestRefresh();
    res.status(202).json({
      ...result,
      requestedAt: new Date().toISOString(),
      operations: ['poll', 'reconcile'],
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found' } });
  });

  return app;
}

export function startServer(app, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      logger.info(`Dashboard: http://${addr.address}:${addr.port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
