import { Liquid } from 'liquidjs';

const engine = new Liquid({ strictFilters: true });

export function buildPrompt(template, issue, attempt = null) {
  const issueObj = serializeForTemplate(issue);
  const context = { issue: issueObj, attempt: attempt };

  try {
    return engine.parseAndRenderSync(template, context);
  } catch (err) {
    throw new Error(`template_render_error: ${err.message}`);
  }
}

function serializeForTemplate(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeForTemplate);
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeForTemplate(value);
    }
    return result;
  }
  return obj;
}

export function buildContinuationPrompt(issue) {
  return [
    `Continue working on ${issue.identifier}: ${issue.title}`,
    '',
    'Resume from the current workspace state instead of restarting from scratch.',
    'Do not repeat already-completed investigation or validation unless needed for new code changes.',
    'Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.',
  ].join('\n');
}
