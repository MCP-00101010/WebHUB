#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node validate-widget-manifest.cjs <manifest.json>');
  process.exitCode = 2;
  return;
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
} catch (error) {
  console.error(`Could not read manifest: ${error.message}`);
  process.exitCode = 2;
  return;
}

const errors = [];
const capabilityNames = new Set([
  'network', 'extensionRelay', 'nativeHost', 'secureCredentials',
  'filesystemPaths', 'geolocation', 'notifications', 'timers', 'localCache'
]);
if (!/^[a-z][a-zA-Z0-9-]{1,63}$/.test(String(manifest.id || ''))) errors.push('id must be 2-64 URL-safe characters and start with a lowercase letter');
for (const key of ['name', 'category', 'description']) if (!String(manifest[key] || '').trim()) errors.push(`${key} is required`);
if (!Array.isArray(manifest.allowedIn) || !manifest.allowedIn.length || manifest.allowedIn.some(value => !['column', 'navpane'].includes(value))) errors.push('allowedIn must contain column and/or navpane');
for (const key of ['defaultConfig', 'defaultData', 'settingsSchema', 'responsive']) {
  if (!manifest[key] || typeof manifest[key] !== 'object' || Array.isArray(manifest[key])) errors.push(`${key} must be an object`);
}
for (const name of Object.keys(manifest.capabilities || {})) if (!capabilityNames.has(name)) errors.push(`unknown capability: ${name}`);
if (!Array.isArray(manifest.lifecycle) || !manifest.lifecycle.includes('render')) errors.push('lifecycle must include render');

if (errors.length) {
  console.error(`Invalid widget manifest:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Valid widget manifest: ${manifest.id}`);
}
