#!/usr/bin/env node
/**
 * normalize-bug-form-body.mjs
 *
 * Transforms a GitHub Issue Form body (### Field headings) into the locked
 * SOP shape: ## Issue / ## Repro / Steps / ## Expected vs Actual /
 * ## Environment + Severity (bullets) / ## Technical Requirement.
 *
 * Idempotent: if body already has `## Issue` at a line start, no-op.
 *
 * Usage: node normalize-bug-form-body.mjs <body-file>
 * Writes the normalized body to stdout.
 */

import { readFileSync } from 'fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node normalize-bug-form-body.mjs <body-file>');
  process.exit(1);
}

const body = readFileSync(path, 'utf8');

// Idempotency guard — already SOP-shaped.
if (/^## Issue\b/m.test(body)) {
  process.stdout.write(body);
  process.exit(0);
}

// Match each ### Section heading and capture its content up to the next ### or end.
// Note: JS regex has no \Z; use (?=^### |$(?![\s\S])) is also unreliable.
// Instead, split on ### headings and parse pairs.
const sectionRe = /^### (.+?)[ \t]*(?:\r?\n|$)([\s\S]*?)(?=^### |\s*$)/gm;
const sections = {};

// Robust approach: split body on lines starting with "### "
const lines = body.split(/\r?\n/);
let currentKey = null;
const contentLines = {};
for (const line of lines) {
  const headingMatch = line.match(/^### (.+?)\s*$/);
  if (headingMatch) {
    currentKey = headingMatch[1].trim();
    contentLines[currentKey] = [];
  } else if (currentKey !== null) {
    contentLines[currentKey].push(line);
  }
}
for (const [k, v] of Object.entries(contentLines)) {
  // Trim leading/trailing blank lines from content
  const trimmed = v.join('\n').trim();
  sections[k] = trimmed;
}

const pick = (k) => sections[k] && sections[k] !== '_No response_' ? sections[k] : null;

const out = [];
out.push(`## Issue\n\n${pick('Issue') ?? '_No response_'}`);
out.push(`## Repro / Steps\n\n${pick('Repro / Steps') ?? '_No response_'}`);
out.push(`## Expected vs Actual\n\n${pick('Expected vs Actual') ?? '_No response_'}`);

const envBullets = [];
const sev = pick('Severity'); if (sev) envBullets.push(`- **Severity:** ${sev}`);
const env = pick('Env'); if (env) envBullets.push(`- **Env:** ${env}`);
const bd  = pick('Browser/Device'); if (bd) envBullets.push(`- **Browser/Device:** ${bd}`);
const rl  = pick('Related logs'); if (rl) envBullets.push(`- **Related logs:** ${rl}`);
out.push(`## Environment + Severity\n\n${envBullets.length ? envBullets.join('\n') : '_No response_'}`);

out.push(`## Technical Requirement\n\n${pick('Technical Requirement') ?? '_No response_'}`);

process.stdout.write(out.join('\n\n') + '\n');
