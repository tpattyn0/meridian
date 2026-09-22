#!/usr/bin/env bash
# Tests for write-guard.js. Run: bash templates/.claude/hooks/write-guard.test.sh
#
# Each case feeds a PreToolUse payload on stdin and asserts the exit code:
#   0 = allowed, 2 = blocked.
# Assertions on the block payload read the TYPED fields (oldLines, newLines),
# never the prose, so message wording can change without breaking tests.
set -uo pipefail

GUARD="$(cd "$(dirname "$0")" && pwd)/write-guard.js"
PASS=0
FAIL=0

# Isolated project root per run; cleaned up on exit.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/.claude" "$TMP/plans"

# Build a payload and run the guard. Args: tool_name, file_path, content
run_guard() {
  local tool="$1" file="$2" content="$3"
  node -e '
    const [tool, file, content] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      tool_name: tool,
      tool_input: { file_path: file, content },
      cwd: process.env.TMPROOT,
    }));
  ' "$tool" "$file" "$content" | CLAUDE_PROJECT_DIR="$TMP" TMPROOT="$TMP" node "$GUARD" >"$TMP/.out" 2>/dev/null
}

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ok   %s\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  FAIL %s (expected exit %s, got %s)\n' "$label" "$expected" "$actual" >&2
    FAIL=$((FAIL + 1))
  fi
}

# A 100-line curated file to shrink against.
seq 1 100 | sed 's/^/line /' > "$TMP/DECISIONS.md"
BIG="$(cat "$TMP/DECISIONS.md")"
SMALL="$(seq 1 10 | sed 's/^/line /')"   # 10 lines = 10% — well under the 40% ratio
OK_SHRINK="$(seq 1 80 | sed 's/^/line /')" # 80 lines = 80% — within tolerance

echo "write-guard.js"

# --- The core behaviour ---
run_guard Write "$TMP/DECISIONS.md" "$SMALL"; check "blocks a 100 -> 10 line collapse of DECISIONS.md" 2 $?
run_guard Write "$TMP/DECISIONS.md" "$OK_SHRINK"; check "allows a 100 -> 80 line edit (within tolerance)" 0 $?
run_guard Write "$TMP/DECISIONS.md" "$BIG"; check "allows a same-size rewrite" 0 $?

# --- Scope: only Write, only curated, only existing ---
run_guard Edit "$TMP/DECISIONS.md" "$SMALL"; check "ignores Edit (bounded span by construction)" 0 $?
run_guard MultiEdit "$TMP/DECISIONS.md" "$SMALL"; check "ignores MultiEdit" 0 $?

# Documents a KNOWN LIMIT rather than desired behaviour: Bash redirection is not
# guarded, so a shell write to a curated file passes untouched. Pinned as a test
# so the gap stays visible and any future fix flips this case deliberately.
printf '{"tool_name":"Bash","tool_input":{"command":"echo x > DECISIONS.md"},"cwd":"%s"}' "$TMP" \
  | CLAUDE_PROJECT_DIR="$TMP" node "$GUARD" >/dev/null 2>&1
check "KNOWN LIMIT: does not see Bash redirection" 0 $?

seq 1 100 | sed 's/^/line /' > "$TMP/NOTES.md"
run_guard Write "$TMP/NOTES.md" "$SMALL"; check "ignores a non-curated file" 0 $?

run_guard Write "$TMP/MISSING.md" "$SMALL"; check "ignores a file that does not exist yet" 0 $?

# --- The floor ---
seq 1 30 | sed 's/^/line /' > "$TMP/PRODUCT.md"
run_guard Write "$TMP/PRODUCT.md" "line 1"; check "ignores a sub-floor file (30 lines < 40)" 0 $?

# --- Other curated paths ---
seq 1 100 | sed 's/^/line /' > "$TMP/plans/2026-08-05-thing.md"
run_guard Write "$TMP/plans/2026-08-05-thing.md" "$SMALL"; check "blocks a collapse inside plans/" 2 $?

seq 1 100 | sed 's/^/line /' > "$TMP/ARCHITECTURE.md"
run_guard Write "$TMP/ARCHITECTURE.md" "$SMALL"; check "blocks a collapse of ARCHITECTURE.md" 2 $?

# STATUS.md is deliberately NOT curated — it is cleared as a matter of course.
seq 1 100 | sed 's/^/line /' > "$TMP/STATUS.md"
run_guard Write "$TMP/STATUS.md" "$SMALL"; check "does not guard STATUS.md (cleared by design)" 0 $?

# --- Case-insensitive matching ---
seq 1 100 | sed 's/^/line /' > "$TMP/decisions.md" 2>/dev/null || true
run_guard Write "$TMP/decisions.md" "$SMALL"; check "matches case-insensitively" 2 $?

# --- Escape hatch: env var ---
printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"},"cwd":"%s"}' \
  "$TMP/DECISIONS.md" "$TMP" \
  | WORKFLOW_ALLOW_DOC_SHRINK=1 CLAUDE_PROJECT_DIR="$TMP" node "$GUARD" >/dev/null 2>&1
check "env override bypasses the block" 0 $?

printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"},"cwd":"%s"}' \
  "$TMP/DECISIONS.md" "$TMP" \
  | WORKFLOW_ALLOW_DOC_SHRINK=0 CLAUDE_PROJECT_DIR="$TMP" node "$GUARD" >/dev/null 2>&1
check "env override set to 0 does NOT bypass" 2 $?

# --- Escape hatch: single-use path-bound sentinel ---
echo "DECISIONS.md" > "$TMP/.claude/.allow-doc-shrink"
run_guard Write "$TMP/DECISIONS.md" "$SMALL"; check "armed sentinel allows the named file" 0 $?
# Assert the file is gone, not just that the next write blocks: a guard whose
# sentinel never matched at all would also "block on the second call", so the
# exit code alone cannot distinguish consumption from a dead hatch.
[ ! -f "$TMP/.claude/.allow-doc-shrink" ]; check "  ...and the token is consumed from disk" 0 $?
run_guard Write "$TMP/DECISIONS.md" "$SMALL"; check "sentinel is single-use (next write blocks)" 2 $?

echo "ARCHITECTURE.md" > "$TMP/.claude/.allow-doc-shrink"
run_guard Write "$TMP/DECISIONS.md" "$SMALL"; check "sentinel armed for another file does not apply" 2 $?
[ -f "$TMP/.claude/.allow-doc-shrink" ]; check "  ...and is left intact for its own target" 0 $?
rm -f "$TMP/.claude/.allow-doc-shrink"

# Stale sentinel (older than the 15-minute TTL) is a leftover, not authorisation.
echo "DECISIONS.md" > "$TMP/.claude/.allow-doc-shrink"
touch -t 200001010000 "$TMP/.claude/.allow-doc-shrink"
run_guard Write "$TMP/DECISIONS.md" "$SMALL"; check "stale sentinel does not authorise" 2 $?
[ ! -f "$TMP/.claude/.allow-doc-shrink" ]; check "  ...and is housekept away" 0 $?

# --- Malformed input must never wedge a session ---
echo 'not json' | node "$GUARD" >/dev/null 2>&1; check "malformed JSON fails open" 0 $?
echo 'null' | node "$GUARD" >/dev/null 2>&1; check "null payload fails open" 0 $?
echo '{}' | node "$GUARD" >/dev/null 2>&1; check "empty payload fails open" 0 $?
printf '{"tool_name":"Write","tool_input":{"file_path":[],"content":"x"}}' \
  | node "$GUARD" >/dev/null 2>&1; check "non-string file_path fails open" 0 $?
printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$TMP/DECISIONS.md" \
  | node "$GUARD" >/dev/null 2>&1; check "missing content fails open" 0 $?

# --- Typed fields in the block payload ---
run_guard Write "$TMP/DECISIONS.md" "$SMALL"
node -e '
  const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const ok = o.decision === "block" && o.oldLines === 100 && o.newLines === 10
    && typeof o.overrideEnvVar === "string";
  process.exit(ok ? 0 : 1);
' "$TMP/.out"
check "block payload carries typed oldLines/newLines/override fields" 0 $?

# The denial must not hand a blocked agent the sentinel recipe.
if grep -q "allow-doc-shrink" "$TMP/.out" && ! grep -q '"overrideSentinel"' "$TMP/.out"; then
  check "denial prose does not leak the sentinel path" 0 1
else
  node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.exit(o.reason.includes("allow-doc-shrink") ? 1 : 0);
  ' "$TMP/.out"
  check "denial prose does not leak the sentinel path" 0 $?
fi

echo
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
