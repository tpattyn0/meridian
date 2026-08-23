#!/usr/bin/env bash
# Assert that the project's `## Verify` block is real: it exists, it names one
# command, that command actually passes, and CI invokes the SAME command.
#
# Usage:
#   bash check-verify-block.sh [/path/to/repo]
#
# This replaces "the human eyeballs AGENT.md and confirms it looks right".
# A Verify block is either runnable or it isn't — that is a decidable question,
# so decide it here rather than asking. Failing loud at bootstrap beats failing
# confusingly in CI on the first PR.
#
# Exit codes:
#   0  Verify block present, passing, and matched by CI
#   2  no ## Verify block (or it is still the template placeholder)
#   3  Verify block present but the command FAILED
#   4  Verify block passes but .github/workflows/verify.yml runs something else
#   1  anything else
set -euo pipefail

REPO="${1:-$PWD}"
cd "$REPO"

[ -f AGENT.md ] || { echo "✗ No AGENT.md in $REPO" >&2; exit 2; }

# Extract the fenced command(s) under `## Verify`, ignoring comments/blanks.
BLOCK="$(awk '/^## Verify/{f=1;next} /^## /{f=0} f' AGENT.md \
  | awk '/^```/{c=!c;next} c' \
  | grep -vE '^\s*(#|$)' || true)"

if [ -z "$BLOCK" ]; then
  echo "✗ AGENT.md has no runnable '## Verify' block." >&2
  echo "  It must contain a fenced code block with ONE command that runs" >&2
  echo "  typecheck + lint + tests + secret scan." >&2
  exit 2
fi

# Placeholder detection MUST happen before execution — the shipped template's
# block is a prose "e.g." list inside the fence, and running it produces a bash
# syntax error that looks like a broken project rather than an unfilled one.
if printf '%s' "$BLOCK" | grep -qiE '<[a-z-]+>|\[e\.?g\.?|\(e\.?g\.?|TODO|FIXME|your-command|placeholder'; then
  echo "✗ The '## Verify' block is still the template placeholder — fill it in." >&2
  echo "  It must name ONE real command that runs typecheck + lint + tests +" >&2
  echo "  secret scan. Found:" >&2
  printf '    %s\n' "$BLOCK" >&2
  exit 2
fi

# A filled-in block is one command. A numbered prose list is not.
if [ "$(printf '%s\n' "$BLOCK" | wc -l | tr -d ' ')" -gt 1 ] \
   && printf '%s' "$BLOCK" | grep -qE '^[0-9]+\.'; then
  echo "✗ The '## Verify' block looks like a prose list, not a command." >&2
  printf '    %s\n' "$BLOCK" >&2
  exit 2
fi

echo "→ Verify block:"
printf '    %s\n' "$BLOCK"

# --- does it actually pass? ----------------------------------------------
echo "→ Running it…"
if ! bash -c "$BLOCK"; then
  echo "✗ The Verify block FAILED. Fix it now — this is the same command CI runs," >&2
  echo "  so a broken block here means a red first PR." >&2
  exit 3
fi
echo "✓ Verify block passes"

# --- does CI run the same thing? -----------------------------------------
WF=".github/workflows/verify.yml"
if [ ! -f "$WF" ]; then
  echo "✗ No $WF — the Verify block is not wired into CI." >&2
  exit 4
fi

# Compare the first token (the actual runner: npm/make/pytest/…) plus the
# script name, rather than demanding a byte-identical line — CI legitimately
# wraps it (e.g. `npm run verify:code` vs a `run:` with extra flags).
NEEDLE="$(printf '%s' "$BLOCK" | head -1 | awk '{print $1, $2, $3}' | sed 's/ *$//')"
if grep -qF "$NEEDLE" "$WF"; then
  echo "✓ CI ($WF) invokes the same command: $NEEDLE"
else
  echo "✗ $WF does NOT appear to run the Verify block." >&2
  echo "  AGENT.md says: $NEEDLE" >&2
  echo "  Nothing matching that is in the workflow's code-gate job." >&2
  exit 4
fi

echo "✓ Verify block is real, passing, and wired into CI."
