#!/usr/bin/env bash
# Assert that every evidence citation in DECISIONS.md / AGENT.md still resolves.
#
# Usage:
#   bash check-citations.sh [/path/to/repo]
#
# WHY THIS EXISTS
# ---------------
# The framework's hard limit ("do not assume a decision is implemented without
# citing evidence") used to force every ADR to carry a `file:line` reference.
# Line numbers are not anchors: any edit that changes a file's line count
# silently invalidates every citation below the insertion point — in a DIFFERENT
# file, with nothing in the Verify block able to notice. Typecheck, lint, tests
# and the secret scan all pass, because none of them read a number in a .md.
# This recurred in three consecutive sessions, including one citation that had
# been stale for days before anyone spotted it.
#
# The structural fix is to cite a stable SYMBOL (`SCORING_VERSION in
# src/foo.service.ts`), which cannot drift when unrelated lines move. This
# script enforces that, and keeps checking the legacy `file:line` form so
# citations written before the change don't rot unnoticed.
#
# WHAT IT CHECKS
#   symbol form   `**Evidence:** SYMBOL in path/to/file.ts`
#                 → file exists AND SYMBOL appears in it (the strong check:
#                   this proves the citation points at what it claims)
#   line form     `**Evidence:** path/to/file.ts:123` (also `:120-130`)
#                 → file exists, line is in range, and is neither blank nor a
#                   pure comment (a weak, best-effort check: it can only prove
#                   a line is PLAUSIBLE, never that it is correct — which is
#                   exactly why the symbol form is preferred)
#
# Deliberately NOT failures: `not-implemented`, `proposed`, `[Coding agent to
# fill]`, `n/a`, `—`, and prose with no path in it. An ADR that honestly says
# "not yet implemented" is correct, not broken.
#
# Exit codes:
#   0  every citation resolves (or there are none to check)
#   3  at least one citation is stale  ← the one that matters
#   1  bad usage / missing repo
set -euo pipefail

REPO="${1:-$PWD}"
cd "$REPO" 2>/dev/null || { echo "✗ No such directory: $REPO" >&2; exit 1; }

FAIL=0
CHECKED=0

# Files that carry evidence citations. Missing files are fine — not every
# project has both, and a project with no DECISIONS.md yet is not broken.
TARGETS=()
for f in DECISIONS.md AGENT.md; do
  [ -f "$f" ] && TARGETS+=("$f")
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "→ No DECISIONS.md or AGENT.md in $REPO — nothing to check."
  exit 0
fi

# Placeholders that legitimately carry no resolvable evidence yet.
is_placeholder() {
  printf '%s' "$1" | grep -qiE 'not.?implemented|proposed|to fill|to be filled|\bTBD\b|\bn/?a\b|^[[:space:]]*[—–-][[:space:]]*$'
}

for SRC in "${TARGETS[@]}"; do
  # Pull the payload of every `**Evidence:**` line, with its line number in the
  # source doc so a failure report says where to go fix it.
  while IFS=$'\t' read -r SRCLINE PAYLOAD; do
    [ -n "$PAYLOAD" ] || continue
    is_placeholder "$PAYLOAD" && continue

    # --- symbol form: `SYMBOL in path/to/file.ext` -----------------------
    # Preferred. Immune to line drift by construction.
    if printf '%s' "$PAYLOAD" | grep -qE '[[:alnum:]_$.]+[[:space:]]+in[[:space:]]+[^[:space:],;]+\.[a-zA-Z0-9]+'; then
      # Grab the whole `SYMBOL in FILE` clause first, then split it. Matching
      # the clause as a unit avoids a greedy `.*` swallowing the leading
      # characters of the symbol (which would silently shorten it to a
      # substring that greps successfully — a false PASS, the worst outcome
      # for a checker whose whole job is catching stale references).
      CLAUSE="$(printf '%s' "$PAYLOAD" \
        | grep -oE '[[:alnum:]_$.]+[[:space:]]+in[[:space:]]+[^[:space:],;)]+\.[a-zA-Z0-9]+' | head -1)"
      SYMBOL="$(printf '%s' "$CLAUSE" | awk '{print $1}')"
      FILE="$(printf '%s' "$CLAUSE" | awk '{print $3}')"
      FILE="${FILE%%:*}"
      CHECKED=$((CHECKED + 1))

      if [ ! -f "$FILE" ]; then
        echo "✗ $SRC:$SRCLINE — cited file does not exist: $FILE" >&2
        FAIL=$((FAIL + 1))
        continue
      fi
      if ! grep -qF -- "$SYMBOL" "$FILE"; then
        echo "✗ $SRC:$SRCLINE — symbol '$SYMBOL' not found in $FILE" >&2
        echo "    The decision cites evidence that is no longer there." >&2
        echo "    Either the code was renamed/removed, or the ADR is stale." >&2
        FAIL=$((FAIL + 1))
      fi
      continue
    fi

    # --- legacy line form: `path/to/file.ext:123` or `:120-130` ----------
    # Best-effort. Proves plausibility, not correctness.
    #
    # A single Evidence line can carry several citations (the observed drift
    # case had five in one ADR), so loop over all of them.
    while read -r CITE; do
      [ -n "$CITE" ] || continue
      FILE="${CITE%%:*}"
      RANGE="${CITE#*:}"
      START="${RANGE%%-*}"
      END="${RANGE##*-}"
      CHECKED=$((CHECKED + 1))

      if [ ! -f "$FILE" ]; then
        echo "✗ $SRC:$SRCLINE — cited file does not exist: $FILE" >&2
        FAIL=$((FAIL + 1))
        continue
      fi

      TOTAL="$(wc -l < "$FILE" | tr -d ' ')"
      if [ "$START" -gt "$TOTAL" ] || [ "$END" -gt "$TOTAL" ]; then
        echo "✗ $SRC:$SRCLINE — $FILE:$RANGE is past end of file ($TOTAL lines)" >&2
        FAIL=$((FAIL + 1))
        continue
      fi

      # A citation landing on a blank line or a pure comment is the exact
      # signature of drift: the code it pointed at moved, and what is left at
      # that number is filler.
      CONTENT="$(sed -n "${START}p" "$FILE")"
      if [ -z "${CONTENT// /}" ]; then
        echo "✗ $SRC:$SRCLINE — $FILE:$START is a BLANK line (citation has drifted)" >&2
        FAIL=$((FAIL + 1))
      elif printf '%s' "$CONTENT" | grep -qE '^[[:space:]]*(//|#|\*|/\*)'; then
        echo "✗ $SRC:$SRCLINE — $FILE:$START is a COMMENT, not code (citation has drifted)" >&2
        echo "    line reads: $(printf '%s' "$CONTENT" | sed 's/^[[:space:]]*//')" >&2
        FAIL=$((FAIL + 1))
      fi
    done <<< "$(printf '%s' "$PAYLOAD" | grep -oE '[A-Za-z0-9_./-]+\.[a-zA-Z0-9]+:[0-9]+(-[0-9]+)?' || true)"

  done <<< "$(grep -nE '\*\*Evidence:\*\*' "$SRC" \
              | sed -E 's/^([0-9]+):.*\*\*Evidence:\*\*[[:space:]]*/\1\t/' || true)"
done

echo
if [ "$FAIL" -gt 0 ]; then
  echo "✗ $FAIL stale citation(s) out of $CHECKED checked." >&2
  echo >&2
  echo "  Fix by re-resolving the reference. Prefer the symbol form —" >&2
  echo "  '**Evidence:** SYMBOL_NAME in path/to/file.ts' — which does not" >&2
  echo "  drift when unrelated edits shift line numbers." >&2
  exit 3
fi

if [ "$CHECKED" -eq 0 ]; then
  echo "✓ No resolvable citations found (all placeholders or none present)."
else
  echo "✓ All $CHECKED citation(s) resolve."
fi
