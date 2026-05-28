#!/usr/bin/env node
/**
 * lint-gh-comment.mjs
 *
 * Validates a GitHub comment / issue body / PR body against the SOP rules:
 *   1. First non-empty line must be an attribution header.
 *   2. No banned jargon in user-facing prose (everything before the first
 *      ## Resolution or ## Technical Requirement heading).
 *   3. For `comment` and `pr` types: a comment with a ## Resolution (or
 *      ## Technical Requirement) heading must have at least one recognized stage
 *      heading (## Investigation finding, ## Resolution, or ## Issue) at or before
 *      the tech boundary. ## Resolution counts as BOTH stage and tech, so a
 *      ## Resolution-only comment passes. Applies to comment + pr types only;
 *      issue type uses Rule 4 structure.
 *      DEPRECATED headings ## Diagnosis, ## Fix, ## Implementation are no
 *      longer recognized — they FAIL Rule 3 / voice.
 *   4. (Issue bodies only — `--type=issue`) The H2 headings in document order
 *      must be EXACTLY: Issue → Repro / Steps → Expected vs Actual →
 *      Environment + Severity → Technical Requirement. Any missing, extra,
 *      mis-ordered, or renamed H2 → FAIL with a message naming the offending
 *      heading and showing the required order.
 *      Also: `## Environment + Severity` must contain a line matching
 *      `**Severity:**` — else FAIL ("declare Severity inside ## Environment + Severity").
 *   5. (When `--title` is provided) Title must match /^\[.+\]\s+\S/ — starts
 *      with a non-empty [bracket] tag then a space and text.
 *      Required format: `[<Page or Feature>] <plain-English pain>`.
 *
 * Locked combined comment shape (comment/pr type — see AGENTS.md):
 *   Claude Code - YY-MM-DD
 *
 *   ## Investigation finding
 *   1. [<Where>] – <plain-English root cause>
 *
 *   ## Resolution
 *   1. [<Where>] – <plain-English action>
 *      Logic: <compact technical detail — jargon allowed here>
 *
 * Usage:
 *   node scripts/lint-gh-comment.mjs [--type=<comment|issue|pr>] [--title=<string>] <path>
 *   npm run lint:comment -- [--type=<comment|issue|pr>] [--title=<string>] <path>
 *
 *   --type    Defaults to `comment` when omitted (backward-compatible).
 *             Use `issue` to activate Rules 4–5.
 *   --title   When provided, validates the title format (Rule 5).
 *             Can be passed as --title=<string> or --title <string>.
 *
 * Exit codes:
 *   0  — PASS
 *   1  — FAIL (violations listed)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── helpers ──────────────────────────────────────────────────────────────────

const ATTRIBUTION_RE = /^(Claude Code|CW) - \d{2}-\d{2}-\d{2}\b/;

/**
 * Banned terms in user-facing prose.
 * Each entry is [displayName, RegExp].
 * Matches are word-boundary where sensible; quoted strings are literal phrase checks.
 */
const BANNED_TERMS = [
  // Framework / library names
  ['React',               /\bReact\b/i],
  ['Next.js',             /\bNext\.js\b/i],
  ['RSC',                 /\bRSC\b/],
  ['SSR',                 /\bSSR\b/],
  ['useState',            /\buseState\b/],
  ['useEffect',           /\buseEffect\b/],
  ['hydration',           /\bhydration\b/i],
  ['middleware',          /\bmiddleware\b/i],
  ['CDN',                 /\bCDN\b/],
  ['"controlled component"', /controlled component/i],
  ['"state staleness"',   /state staleness/i],
  ['"race condition"',    /race condition/i],

  // CSS / layout jargon
  ['overflow',            /\boverflow\b/i],
  ['align-items',         /\balign-items\b/i],
  ['flex',                /\bflex\b/i],
  ['min-height',          /\bmin-height\b/i],
  ['max-height',          /\bmax-height\b/i],
  ['h-full',              /\bh-full\b/],
  ['min-h-full',          /\bmin-h-full\b/],
  ['overflow-y',          /\boverflow-y\b/i],
  ['grid-template',       /\bgrid-template\b/i],
  ['position:',           /\bposition\s*:/i],
  ['display:',            /\bdisplay\s*:/i],
  ['z-index',             /\bz-index\b/i],

  // File paths — e.g. src/app/page.tsx, utils.ts, styles.css
  ['file path (.ts/.tsx/.js/.jsx/.css/.mjs/.py)',
                          /\b[\w./-]+\.(tsx?|jsx?|css|mjs|py)\b/],
  ['src/ path',           /\bsrc\//],

  // Commit hashes (7–40 hex chars)
  ['commit hash',         /\b[0-9a-f]{7,40}\b/i],
];

// ── parse args ────────────────────────────────────────────────────────────────

let type = 'comment';
let title = null;
let filePath = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--type=')) {
    type = arg.slice('--type='.length);
  } else if (arg === '--type') {
    type = args[++i];
  } else if (arg.startsWith('--title=')) {
    title = arg.slice('--title='.length);
  } else if (arg === '--title') {
    title = args[++i];
  } else if (!arg.startsWith('--')) {
    filePath = arg;
  }
}

const VALID_TYPES = ['comment', 'issue', 'pr'];
if (!VALID_TYPES.includes(type)) {
  console.error(`Error: --type must be one of: comment, issue, pr. Got: "${type}"`);
  console.error('Usage: node scripts/lint-gh-comment.mjs [--type=comment|issue|pr] [--title=<string>] <file>');
  process.exit(1);
}

if (!filePath) {
  console.error('Usage: node scripts/lint-gh-comment.mjs [--type=comment|issue|pr] [--title=<string>] <file>');
  process.exit(1);
}

const body = readFileSync(resolve(filePath), 'utf8');
const lines = body.split('\n');

const failures = [];

// ── Rule 1: Attribution ───────────────────────────────────────────────────────
const firstNonEmpty = lines.find(l => l.trim() !== '');
if (!firstNonEmpty || !ATTRIBUTION_RE.test(firstNonEmpty.trim())) {
  failures.push(
    `[Attribution] First non-empty line must match "Claude Code - YY-MM-DD" or "CW - YY-MM-DD".\n` +
    `  Got: ${firstNonEmpty ? JSON.stringify(firstNonEmpty.trim()) : '(nothing)'}`
  );
}

// ── Shared: locate the technical zone boundary ───────────────────────────────
// ## Resolution and ## Technical Requirement both open the technical zone.
// ## Diagnosis, ## Fix, ## Implementation are DEPRECATED — not recognized here.
const TECH_HEADING_RE = /^##\s*(Resolution|Technical Requirement)\s*$/i;
const techHeadingIdx = lines.findIndex(l => TECH_HEADING_RE.test(l));

// ── Rule 3: Locked skeleton — stage heading required at or before tech heading ──
// Recognized stage headings: ## Investigation finding, ## Resolution, ## Issue.
// ## Resolution is BOTH a stage and a tech heading, so a Resolution-only comment
// passes: the stage heading appears at index === techHeadingIdx.
// Applies to `comment` and `pr` types only. Issue type uses Rule 4 structure.
const STAGE_HEADING_RE = /^##\s*(Investigation finding|Resolution|Issue)\s*$/i;

if (type !== 'issue' && techHeadingIdx !== -1) {
  const atOrBeforeTech = lines.slice(0, techHeadingIdx + 1);
  const hasStageHeading = atOrBeforeTech.some(l => STAGE_HEADING_RE.test(l));
  if (!hasStageHeading) {
    failures.push(
      `[Structure] A comment with a ## Resolution section must use the locked skeleton — ` +
      `include a stage heading (## Investigation finding, ## Resolution, or ## Issue) at or above ## Resolution. ` +
      `Note: ## Diagnosis, ## Fix, and ## Implementation are deprecated and no longer recognized. ` +
      `See AGENTS.md.`
    );
  }
}

// ── Rule 2: No banned jargon in prose ─────────────────────────────────────────

// If no technical heading exists, the WHOLE body is prose (jargon anywhere fails).
const proseLines = techHeadingIdx === -1 ? lines : lines.slice(0, techHeadingIdx);

const jargonFailures = [];
proseLines.forEach((line, idx) => {
  for (const [name, re] of BANNED_TERMS) {
    if (re.test(line)) {
      jargonFailures.push(`  Line ${idx + 1}: banned term "${name}" → ${line.trim()}`);
    }
  }
});

if (jargonFailures.length > 0) {
  const zoneNote = techHeadingIdx === -1
    ? '(no ## Resolution / ## Technical Requirement heading found — entire body treated as prose)'
    : `(prose zone = lines 1–${techHeadingIdx}; technical zone starts at line ${techHeadingIdx + 1})`;
  failures.push(
    `[Jargon] Banned terms found in user-facing prose ${zoneNote}:\n` +
    jargonFailures.join('\n')
  );
}

// ── Rule 4: Issue body structure (issue type only) ───────────────────────────

if (type === 'issue') {
  const REQUIRED_H2 = [
    'Issue',
    'Repro / Steps',
    'Expected vs Actual',
    'Environment + Severity',
    'Technical Requirement',
  ];

  // Collect all H2 headings in document order
  const H2_RE = /^##\s+(.+?)\s*$/;
  const foundH2 = lines
    .map((l, i) => ({ idx: i, match: H2_RE.exec(l) }))
    .filter(e => e.match !== null)
    .map(e => ({ lineNum: e.idx + 1, heading: e.match[1] }));

  const foundNames = foundH2.map(e => e.heading);

  // Check exact match (count, names, order)
  let structureOk = foundNames.length === REQUIRED_H2.length &&
    REQUIRED_H2.every((req, i) => foundNames[i] === req);

  if (!structureOk) {
    let offendingMsg = '';
    if (foundNames.length < REQUIRED_H2.length) {
      const missing = REQUIRED_H2.filter(r => !foundNames.includes(r));
      offendingMsg = `Missing required H2 heading(s): ${missing.map(m => `"## ${m}"`).join(', ')}.`;
    } else if (foundNames.length > REQUIRED_H2.length) {
      const extra = foundNames.filter(f => !REQUIRED_H2.includes(f));
      offendingMsg = `Extra H2 heading(s) not allowed: ${extra.map(e => `"## ${e}"`).join(', ')}.`;
    } else {
      // Same count but wrong order or names — find first mismatch
      for (let i = 0; i < REQUIRED_H2.length; i++) {
        if (foundNames[i] !== REQUIRED_H2[i]) {
          offendingMsg = `H2 heading #${i + 1} is "## ${foundNames[i]}" but must be "## ${REQUIRED_H2[i]}".`;
          break;
        }
      }
    }
    failures.push(
      `[Issue Structure] Issue body H2 headings must be EXACTLY in this order:\n` +
      `  ${REQUIRED_H2.map(h => `## ${h}`).join(' → ')}\n` +
      `  ${offendingMsg}\n` +
      `  Found: ${foundNames.length === 0 ? '(none)' : foundNames.map(h => `## ${h}`).join(', ')}`
    );
  }

  // Check ## Environment + Severity contains **Severity:**
  const envSevIdx = lines.findIndex(l => /^##\s+Environment \+ Severity\s*$/.test(l));
  if (envSevIdx !== -1) {
    const nextH2Idx = lines.findIndex((l, i) => i > envSevIdx && /^##\s/.test(l));
    const sectionLines = nextH2Idx === -1
      ? lines.slice(envSevIdx + 1)
      : lines.slice(envSevIdx + 1, nextH2Idx);
    const hasSeverity = sectionLines.some(l => /\*\*Severity:\*\*/.test(l));
    if (!hasSeverity) {
      failures.push(
        `[Issue Structure] The "## Environment + Severity" section must declare Severity — ` +
        `add a line with "**Severity:**" (e.g. "- **Severity:** low / med / high").`
      );
    }
  }
}

// ── Rule 5: Title format (when --title provided) ──────────────────────────────

if (title !== null) {
  const TITLE_RE = /^\[.+\]\s+\S/;
  if (!TITLE_RE.test(title)) {
    failures.push(
      `[Title] Title must start with a non-empty [bracket] tag followed by a space and text.\n` +
      `  Required format: [<Page or Feature>] <plain-English pain>\n` +
      `  Got: ${JSON.stringify(title)}`
    );
  }
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('FAIL — comment violates the GitHub-ticket SOP:\n');
  failures.forEach(f => console.error(f + '\n'));
  process.exit(1);
} else {
  console.log('PASS — comment follows the GitHub-ticket SOP');
  process.exit(0);
}
