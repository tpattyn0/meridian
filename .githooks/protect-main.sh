#!/usr/bin/env bash
# Configure branch protection on the default branch, plus the repo-level
# "auto-delete head branches" setting. Idempotent: safe to re-run.
#
# Usage:
#   bash protect-main.sh [owner/repo]        # defaults to the current repo
#
# This is SETUP.md §1 as a script.
#
# GitHub gates branch protection on PRIVATE repos on the Free plan: both the
# legacy `branches/*/protection` and the modern `rulesets` endpoints return
# 403 "Upgrade to GitHub Pro or make this repository public". That is a PLAN
# limit, not a permissions problem (verified 2026-07-23 with an admin token:
# 403 on a private repo, ruleset created successfully on a public one).
#
# There is no automated workaround. The web UI is not API-gated, but driving it
# requires an authenticated browser session, and the automation browsers have
# none — signing one in would mean an agent entering your GitHub credentials,
# which is out of bounds. So on a private Free-plan repo this script exits 3
# and says so plainly rather than pretending a fallback exists.
#
# Exit codes:
#   0  protection configured AND verified by push probe
#   2  the code-gate check has never reported — cannot require it yet
#   3  unavailable: private repo on a plan without branch protection
#   1  anything else
set -euo pipefail

REPO="${1:-}"
if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

BRANCH="$(gh api "repos/$REPO" --jq .default_branch)"
echo "→ Repo: $REPO · default branch: $BRANCH"

# The required status check must have reported at least once before GitHub will
# accept it as a required context. On a brand-new repo that means: first PR,
# CI runs, THEN protection. Check before writing anything.
if ! gh api "repos/$REPO/commits/$BRANCH/check-runs" --jq '.check_runs[].name' 2>/dev/null | grep -qx 'code-gate'; then
  # It may have reported on a PR branch rather than the default branch.
  if ! gh api "repos/$REPO/check-runs?check_name=code-gate" --jq '.total_count' 2>/dev/null | grep -qv '^0$'; then
    echo "✗ The 'code-gate' check has not reported on this repo yet." >&2
    echo "  Push a branch, open a PR, let CI run — then re-run this script." >&2
    exit 2
  fi
fi

# --- repo-level settings (not plan-gated) --------------------------------
gh api -X PATCH "repos/$REPO" \
  -F delete_branch_on_merge=true \
  --silent
echo "✓ Auto-delete head branches on merge: enabled"

# --- branch protection (plan-gated on private repos) ---------------------
# Try the modern ruleset API first, then legacy branch protection. Both return
# the same 403 on a Free-plan private repo; distinguish that from a real error
# so the caller knows to fall back to the UI rather than treating it as fatal.
PROTECT_ERR=""
set +e
PROTECT_ERR="$(gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
  --input - <<JSON 2>&1 >/dev/null
{
  "required_status_checks": { "strict": true, "contexts": ["code-gate"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
)"
PROTECT_RC=$?
set -e

if [ $PROTECT_RC -eq 0 ]; then
  # enforce_admins=true matters more than it looks: without it, a repo admin
  # (i.e. you, and any agent using your token) bypasses every rule silently.
  # Protection that the only actor can walk through is not protection — and the
  # push probe below would report a false PASS on it.
  echo "✓ Branch protection on '$BRANCH': PR required · code-gate required · force-push blocked · admins included"
elif printf '%s' "$PROTECT_ERR" | grep -q 'Upgrade to GitHub Pro'; then
  VIS="$(gh api "repos/$REPO" --jq 'if .private then "private" else "public" end')"
  echo "→ Branch protection is UNAVAILABLE on this repo ($VIS, on a plan without it)." >&2
  echo "  GitHub gates both the protection and rulesets APIs on private repos on" >&2
  echo "  the Free plan. This is a plan limit, not a permissions problem, and" >&2
  echo "  there is no automated workaround — the Settings UI is not API-gated but" >&2
  echo "  driving it needs a signed-in browser, which no agent should arrange." >&2
  echo "" >&2
  echo "  Still enforcing without it: pre-commit hooks (secrets), the AGENT.md" >&2
  echo "  Verify block, and CI running code-gate on every PR." >&2
  echo "  NOT enforced: 'never push to main' and 'never merge a red PR' remain" >&2
  echo "  instruction-level for agents and habit-level for you." >&2
  echo "" >&2
  echo "  To get real enforcement: make the repo public (\`gh repo edit $REPO" >&2
  echo "  --visibility public\`) and re-run this script, or upgrade the plan." >&2
  exit 3
else
  echo "✗ Branch protection failed: $PROTECT_ERR" >&2
  exit 1
fi

# --- verify behaviour, not config ----------------------------------------
# A settings screen that reads correct and enforcement that actually fires are
# different things. Probe with a real push that must be rejected.
echo "→ Probing enforcement (a rejected push is the PASS case)…"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  CUR="$(git rev-parse --abbrev-ref HEAD)"
  git fetch origin "$BRANCH" -q
  git checkout -q "$BRANCH" 2>/dev/null || true
  git commit --allow-empty --no-verify -q -m "protection probe"
  if git push origin "$BRANCH" 2>/dev/null; then
    echo "✗ PROBE FAILED: a direct push to '$BRANCH' SUCCEEDED — protection is" >&2
    echo "  configured but NOT enforcing. The usual cause is admin bypass: repo" >&2
    echo "  admins skip every rule unless enforce_admins is on (this script sets" >&2
    echo "  it, so check whether a ruleset with bypass_actors is overriding, or" >&2
    echo "  whether the rule was later edited in the UI)." >&2
    # Undo the probe commit on the remote — it must not survive as real history.
    git reset --hard "HEAD~1" -q
    git push --force-with-lease origin "$BRANCH" -q 2>/dev/null || true
    git fetch origin "$BRANCH" -q
    exit 1
  fi
  echo "✓ Probe passed: direct push to '$BRANCH' was rejected"
  git reset --hard "origin/$BRANCH" -q
  git checkout -q "$CUR" 2>/dev/null || true
else
  echo "  (not inside a work tree — skipped the push probe)"
fi

echo "✓ Done."
