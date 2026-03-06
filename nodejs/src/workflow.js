import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import logger from './logger.js';

export function loadWorkflow(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`missing_workflow_file: cannot read ${filePath}: ${err.message}`);
  }

  return parseWorkflow(raw);
}

export function parseWorkflow(raw) {
  const frontMatterRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(frontMatterRe);

  let config = {};
  let promptTemplate = raw.trim();

  if (match) {
    const yamlStr = match[1];
    promptTemplate = (match[2] || '').trim();

    try {
      config = yaml.load(yamlStr);
    } catch (err) {
      throw new Error(`workflow_parse_error: invalid YAML front matter: ${err.message}`);
    }

    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('workflow_front_matter_not_a_map: front matter must be a YAML mapping');
    }
  }

  return { config, promptTemplate };
}

export function getNestedValue(obj, path, defaultValue = undefined) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return defaultValue;
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}

export function resolveEnvValue(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('$')) {
    const envName = value.slice(1);
    const resolved = process.env[envName];
    return resolved || undefined;
  }
  return value;
}

export function expandPath(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    return home + value.slice(1);
  }
  if (value.startsWith('$')) {
    return resolveEnvValue(value);
  }
  return value;
}
