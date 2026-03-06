import { JiraAdapter } from './jira-adapter.js';
import { MemoryAdapter } from './memory-adapter.js';

export function createTracker(config) {
  switch (config.trackerKind) {
    case 'jira':
      return new JiraAdapter(config);
    case 'memory':
      return new MemoryAdapter();
    default:
      throw new Error(`unsupported_tracker_kind: ${config.trackerKind}`);
  }
}
