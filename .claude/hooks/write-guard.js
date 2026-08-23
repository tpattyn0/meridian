#!/usr/bin/env node
// Claude Code PreToolUse hook: block a whole-file Write that catastrophically
// shrinks a curated project document.
//
// Why this exists as code and not as a sentence in CLAUDE.md
// ---------------------------------------------------------
// Every guardrail in our framework is currently prose an agent reads. Prose
// lowers the probability of a mistake; it cannot prevent one. The failure this
// guards against is specific and mechanical: an agent Reads a *window* of a
// long document (say lines 40-60 of DECISIONS.md), builds a Write payload from
// what it holds in context, and overwrites the whole file with it — silently
// destroying every section outside that window. Nothing in our Verify block
// catches it: typecheck, lint, tests and the secret scan all pass, because none
// of them read a .md. It is the same class of drift as the file:line citation
// problem (#10), and the same lesson: an invariant that only a model enforces
// is not enforced.
//
// The bound is worth stating plainly: this stops accidental, single-shot
// collapse. It is not a defence against an agent that has decided to get around
// it — the sentinel hatch below is a plain file any Bash call can create. What
// it buys is the conversion of "ignore a sentence" into "take one deliberate,
// path-bound, single-use, auditable action".
//
// Scope — deliberately narrow
// ---------------------------
//   - Write only. Edit and MultiEdit replace bounded spans and cannot collapse
//     a file by construction.
//   - The target must already exist. Creating a file fresh is always fine.
//   - The target must be a *curated* document (see CURATED_PATTERNS). Not all
//     markdown: free-prose docs get legitimately rewritten wholesale, and a
//     guard that fires on those trains override-fatigue until nobody reads it.
//
// Trigger: the pending payload carries fewer than SHRINK_RATIO of the on-disk
// line count, and the file is at least FLOOR_LINES long.
//
// Escape hatches (both named in the block message — an undocumented bypass gets
// bypassed with the blunt instrument instead, disabling every other guard too):
//   - WORKFLOW_ALLOW_DOC_SHRINK=1 — for a human running interactively, where
//     an env var can actually reach the hook's environment.
//   - .claude/.allow-doc-shrink — a single-use, path-bound, 15-minute sentinel
//     file, for legitimate programmatic rewrites. A PreToolUse hook inherits
//     the *runtime's* environment, so a per-command env prefix can never reach
//     it; the sentinel is a transport that code consults, not prose an agent
//     obeys.
//
// Known limits, stated where the code lives:
//   - THE BASH PATH IS NOT GUARDED. This hook sees the Write tool only, so
//     `echo x > DECISIONS.md`, `cp`, `sed -i`, or a redirect from any Bash call
//     rewrites a curated file untouched. This is not theoretical: in the live
//     test of this prototype, a real Claude session that hit this block
//     immediately proposed a Bash `cp` to route around it, describing it as
//     "bypassing the Write tool's shrink guard". Closing that path means
//     parsing arbitrary shell for write redirection — a much larger and
//     much less reliable job — so the honest framing is that this guard
//     raises the cost of an accidental clobber, and does not stop a
//     determined one. The pre-commit hook and PR review remain the backstop
//     for anything that reaches disk by another route.
//   - Stateless per write. Sequential shrinks (300 -> 130 -> 55) each clear the
//     ratio against *current* disk state, so cumulative erosion is invisible.
//   - Case-insensitive matching unconditionally, because macOS and Windows
//     default to case-insensitive filesystems where a differently-cased path is
//     the same real file. On Linux a genuinely distinct 'decisions.md' is
//     therefore also treated as curated. Narrow, accepted cost.
//
// Action: exit 2 with decision:'block' on a catastrophic shrink.
// No-op (exit 0): any other tool, new files, non-curated paths, sub-floor
// files, an override, or any internal error — a broken hook must never wedge
// a session.

'use strict';

const fs = require('fs');
const path = require('path');

// Block when the payload has fewer than this fraction of the on-disk lines.
const SHRINK_RATIO = 0.4;

// Files shorter than this are exempt — a 12-line stub legitimately gets
// rewritten to 3 lines, and a ratio check on small files is meaningless.
const FLOOR_LINES = 40;

// Curated documents, matched against the resolved path with separators
// normalised to '/'. A closed set, matching the file map in CLAUDE.md: these
// are the append-mostly documents where a whole-file Write is nearly always a
// mistake. STATUS.md is deliberately ABSENT — it is capped at 20 lines by rule,
// is cleared as a matter of course, and sits under the floor anyway.
const CURATED_PATTERNS = [
  /(?:^|\/)DECISIONS\.md$/i,
  /(?:^|\/)ARCHITECTURE\.md$/i,
  /(?:^|\/)PRODUCT\.md$/i,
  /(?:^|\/)TECH_DEBT\.md$/i,
  /(?:^|\/)AGENT\.md$/i,
  /(?:^|\/)GTM\.md$/i,
  /(?:^|\/)DESIGN\.md$/i,
  /(?:^|\/)plans\/[^/]+\.md$/i,
  /(?:^|\/)reviews\/[^/]+\.md$/i,
];

const SENTINEL_NAME = '.allow-doc-shrink';
const SENTINEL_REL = '.claude/' + SENTINEL_NAME;
const SENTINEL_TTL_MS = 15 * 60 * 1000;
const OVERRIDE_ENV = 'WORKFLOW_ALLOW_DOC_SHRINK';

// Count logical lines, ignoring one trailing newline so "a\nb\n" and "a\nb"
// both count as 2.
function countLines(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function isOverrideSet() {
  const v = process.env[OVERRIDE_ENV];
  return typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

// Single-use sentinel. Consulted ONLY at the block point, so a write that would
// have passed anyway never burns the token.
//
// projectDir is the session's project root; the sentinel lives at
// <projectDir>/.claude/.allow-doc-shrink and its first line names the one file
// it authorises, resolved relative to the project root.
function consumeSentinelFor(projectDir, filePath) {
  try {
    // Resolve the project root through symlinks before comparing. The target
    // path has already been realpath-resolved, so an unresolved root here can
    // never compare equal to it — the sentinel would be silently dead whenever
    // the project is reached via a link. That is the common case, not an edge
    // one: macOS /tmp and /var are both symlinks, as are most worktree and
    // network-mount layouts.
    try {
      projectDir = fs.realpathSync(projectDir);
    } catch { /* keep the lexical root */ }

    const sentinelPath = path.join(projectDir, '.claude', SENTINEL_NAME);

    let st;
    try {
      st = fs.statSync(sentinelPath);
    } catch {
      return false; // not armed
    }

    // A stale token is a leftover, not an authorisation — housekeep it.
    if (Date.now() - st.mtimeMs > SENTINEL_TTL_MS) {
      try { fs.unlinkSync(sentinelPath); } catch { /* best effort */ }
      return false;
    }

    const token = fs.readFileSync(sentinelPath, 'utf8').split('\n')[0].trim();
    if (!token) return false;

    // Path-bound: the token names exactly one file. Same case-insensitive
    // stance as the curated match itself.
    const named = path.resolve(projectDir, token).replace(/\\/g, '/').toLowerCase();
    if (named !== filePath.replace(/\\/g, '/').toLowerCase()) {
      return false; // armed for a different file — leave it for that write
    }

    // Consume BEFORE allowing: if the Write then fails, the safe direction is a
    // spent token, never a lingering one.
    fs.unlinkSync(sentinelPath);
    return true;
  } catch {
    // Any sentinel error means "not exempt". The hatch may never fail a guard
    // open — the normal blocking flow proceeds.
    return false;
  }
}

// The block emission must itself be exception-safe: an EPIPE from a write here
// must not land in the fail-open catch below, which is the one outcome the
// fail-closed branches exist to prevent. The decision stands regardless of
// whether the payload could be delivered.
function emitBlock(output) {
  try {
    // writeSync, not console.log: pipe writes are async on Windows and
    // process.exit() does not flush them — a truncated payload is a guard that
    // silently half-fired.
    fs.writeSync(1, JSON.stringify(output));
    fs.writeSync(2, output.reason);
  } catch {
    // Emission failed; the block still stands.
  }
  process.exit(2);
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);

    // JSON.parse('null') is null, and reading a property off a primitive throws
    // into the fail-open catch. Nothing to guard — pass it deliberately.
    if (data === null || typeof data !== 'object') process.exit(0);

    // Only whole-file Write is catastrophic by construction.
    if (data.tool_name !== 'Write') process.exit(0);

    if (isOverrideSet()) process.exit(0);

    // Typed reads: `[]` and `{}` are truthy and would pass a bare `!value`
    // check, then throw inside path.resolve() — crash-to-allow. A non-string
    // degrades to '' and exits here instead.
    const toolInput = data.tool_input;
    const rawFilePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : '';
    const content = toolInput?.content;
    if (!rawFilePath || typeof content !== 'string') process.exit(0);

    const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
    const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd;

    let filePath = path.resolve(cwd, rawFilePath);
    // Resolve symlinks BEFORE the curated match: a Write to a non-curated path
    // that symlinks into DECISIONS.md would otherwise not match, while
    // writeFileSync follows the link and clobbers the real target. ENOENT (new
    // file) keeps the lexical path; the read below then handles it.
    try {
      filePath = fs.realpathSync(filePath);
    } catch { /* keep the lexical path */ }

    const normalized = filePath.replace(/\\/g, '/');
    if (!CURATED_PATTERNS.some(re => re.test(normalized))) process.exit(0);

    // Only guard overwrites. ENOENT fails OPEN (no baseline to protect — this
    // is a new file). Any other read error (EACCES, EISDIR, ELOOP, a Windows
    // lock) fails CLOSED: a guard that waves a curated Write through on a
    // transient read error is not enforced by code at all.
    let onDisk;
    try {
      onDisk = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') process.exit(0);
      emitBlock({
        decision: 'block',
        readError: err && err.code ? String(err.code) : 'UNKNOWN',
        overrideEnvVar: OVERRIDE_ENV,
        overrideSentinel: SENTINEL_REL,
        reason:
          `Write guard: could not read '${filePath}' to compare against the pending Write ` +
          `(${err && err.code ? err.code : 'unknown read error'}). That file is a curated ` +
          `project document, so this guard fails closed rather than risk a blind overwrite. ` +
          `Retry once the file is readable, or if this overwrite is intentional, re-run with ` +
          `${OVERRIDE_ENV}=1 set in the environment.`,
      });
    }

    const oldLines = countLines(onDisk);
    const newLines = countLines(content);

    if (oldLines < FLOOR_LINES) process.exit(0);
    if (newLines >= oldLines * SHRINK_RATIO) process.exit(0);

    // The mechanical hatch, consulted only here so a passing write never burns it.
    if (consumeSentinelFor(projectDir, filePath)) process.exit(0);

    const pct = Math.round((newLines / oldLines) * 100);
    // Typed fields ride alongside the prose so tests never regex the message.
    emitBlock({
      decision: 'block',
      oldLines,
      newLines,
      overrideEnvVar: OVERRIDE_ENV,
      overrideSentinel: SENTINEL_REL,
      // The denial deliberately does NOT explain how to arm the sentinel. The
      // failure being guarded is an agent reasoning past an advisory; a block
      // message that prints the bypass recipe hands that same agent a
      // mechanical self-authorisation at the exact moment it is blocked. The
      // sentinel stays documented where humans read it (HUMAN_GUIDE.md), and in
      // the typed overrideSentinel field above. The env var is named because it
      // cannot reach a hook from a per-command prefix, so naming it does not
      // hand the blocked agent a same-tool bypass.
      reason:
        `Write guard: this Write would shrink '${path.basename(filePath)}' from ${oldLines} ` +
        `lines to ${newLines} (${pct}% of current). That file is a curated project document, ` +
        `and a whole-file Write this much smaller almost always means the payload was built ` +
        `from a partial read — it would destroy every section outside that window. ` +
        `To fix: use Edit for a scoped change, or Read the entire file and include every ` +
        `existing section in the Write. If this collapse is genuinely intended, re-run with ` +
        `${OVERRIDE_ENV}=1 set in the environment.`,
    });
  } catch {
    // Never block a valid tool call because of a hook error.
    process.exit(0);
  }
});
