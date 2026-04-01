#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Test script for aspectcode watch-mode assessments.
#
# Run this from a SECOND terminal while aspectcode is watching
# a target repo (e.g. fightclub). It creates temporary files
# designed to trigger each type of assessment, then cleans up.
#
# Usage:
#   bash packages/cli/test/test-assessments.sh /c/code/fightclub
#
# What to look for in the aspectcode terminal:
#   1. Yellow ⚠ warning cards with [y]/[n]/[s] options
#   2. The "changes" counter incrementing
#   3. After pressing [n] to dismiss: "Learned: ..." message
#   4. After pressing [y] to confirm: suggestion printed
#   5. Preferences saved in .aspectcode/preferences.json
# ──────────────────────────────────────────────────────────────

set -e

REPO="${1:?Usage: $0 <path-to-watched-repo>}"

# Normalize backslashes
REPO="${REPO//\\//}"

# Try the path as-is, then with common mount-point conversions.
# Git Bash uses /c/, WSL uses /mnt/c/, and raw Windows paths use C:/.
resolve_repo() {
  for candidate in \
    "$REPO" \
    "/mnt/${REPO:0:1}${REPO:2}" \
    "/${REPO:0:1}${REPO:2}" \
    ; do
    # lowercase the drive letter
    local lower="$(echo "$candidate" | sed 's|^/\(.\)|\L/\1|; s|^/mnt/\(.\)|/mnt/\L\1|')"
    if [ -d "$lower" ]; then REPO="$lower"; return 0; fi
    if [ -d "$candidate" ]; then REPO="$candidate"; return 0; fi
  done
  return 1
}

if ! resolve_repo; then
  echo "ERROR: Cannot find directory: $1"
  echo "  (Tried Git Bash /c/..., WSL /mnt/c/..., and raw Windows paths)"
  exit 1
fi

CLEANUP_FILES=()
cleanup() {
  echo ""
  echo "── Cleaning up ──────────────────────────────────"
  for f in "${CLEANUP_FILES[@]}"; do
    if [ -f "$f" ]; then
      rm -f "$f"
      echo "  removed $f"
    fi
  done
  echo "  Done. Check the aspectcode terminal for unlink events."
}
trap cleanup EXIT

pause() {
  echo ""
  echo "  → Look at the aspectcode terminal now."
  echo "    Press Enter to continue (or Ctrl-C to abort)..."
  read -r
}

echo "══════════════════════════════════════════════════"
echo "  aspectcode assessment test script"
echo "  Target repo: $REPO"
echo "══════════════════════════════════════════════════"

# ── Test 1: Plain change (counter should increment, no warning) ──

echo ""
echo "── Test 1: Plain file change (expect counter +1, no warning) ──"
echo ""
echo "  Appending a comment to an existing .ts or .py file..."

# Find an existing source file to modify
TARGET=""
for f in "$REPO"/web/src/lib/utils.ts "$REPO"/web/src/lib/api.ts "$REPO"/api/main.py; do
  if [ -f "$f" ]; then
    TARGET="$f"
    break
  fi
done

if [ -z "$TARGET" ]; then
  echo "  SKIP: No known source file found to modify"
else
  echo "// test-assessment-marker" >> "$TARGET"
  echo "  Appended to: $TARGET"
  pause

  # Remove the marker line (portable: works on Linux, macOS, Git Bash, WSL)
  grep -v 'test-assessment-marker' "$TARGET" > "${TARGET}.tmp" && mv "${TARGET}.tmp" "$TARGET"
  echo "  Cleaned marker from $TARGET"
fi

# ── Test 2: Naming convention violation ──────────────────────

echo ""
echo "── Test 2: Naming convention mismatch (expect ⚠ warning) ──"
echo ""
echo "  Creating a snake_case file in PascalCase component directory..."

NAMING_FILE="$REPO/web/src/components/bad_naming_test.tsx"
cat > "$NAMING_FILE" << 'TSEOF'
export default function BadNamingTest() {
  return <div>test</div>;
}
TSEOF
CLEANUP_FILES+=("$NAMING_FILE")
echo "  Created: $NAMING_FILE"
echo "  (Components dir uses PascalCase, this file is snake_case)"
pause

# ── Test 3: Directory convention violation ───────────────────

echo ""
echo "── Test 3: Directory convention (expect ⚠ warning) ──"
echo ""
echo "  Creating a test file outside the normal test directory..."

# Create a test file in an unusual location
TESTFILE="$REPO/web/src/lib/utils.test.ts"
cat > "$TESTFILE" << 'TSEOF'
import { describe, it } from 'node:test';
describe('utils', () => {
  it('works', () => {});
});
TSEOF
CLEANUP_FILES+=("$TESTFILE")
echo "  Created: $TESTFILE"
echo "  (Test file in lib/ instead of a test directory)"
pause

# ── Test 4: Hub file modification (expect ⚠ warning) ────────

echo ""
echo "── Test 4: Hub file modification (expect ⚠ hub-safety warning) ──"
echo ""
echo "  Modifying a high-import file (types.ts or api.ts)..."

HUB_TARGET=""
for f in "$REPO"/web/src/lib/types.ts "$REPO"/web/src/lib/api.ts; do
  if [ -f "$f" ]; then
    HUB_TARGET="$f"
    break
  fi
done

if [ -z "$HUB_TARGET" ]; then
  echo "  SKIP: No known hub file found"
else
  echo "// test-hub-marker" >> "$HUB_TARGET"
  echo "  Appended to: $HUB_TARGET"
  echo "  (This file is imported by many components — should trigger hub-safety)"
  pause

  sed -i '/test-hub-marker/d' "$HUB_TARGET"
  echo "  Cleaned marker from $HUB_TARGET"
fi

# ── Test 5: Keyboard interaction ─────────────────────────────

echo ""
echo "── Test 5: Keyboard interaction ──────────────────────────"
echo ""
echo "  If you saw any ⚠ warnings in the aspectcode terminal:"
echo ""
echo "    [y] confirm  — acknowledges the warning, prints suggestion,"
echo "                    saves a 'deny' preference (future = violation)"
echo "    [n] dismiss  — learns this is OK here,"
echo "                    saves an 'allow' preference (suppresses future)"
echo "    [s] skip     — ignores without learning"
echo ""
echo "  Try pressing [n] on a warning, then re-trigger the same"
echo "  scenario — the warning should NOT appear again."
echo ""
echo "  Preferences are saved in: $REPO/.aspectcode/preferences.json"

pause

# ── Summary ──────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════"
echo "  Test complete!"
echo ""
echo "  What to verify:"
echo "    ✓ Changes counter went up for each file event"
echo "    ✓ ⚠ warnings appeared for naming/directory/hub violations"
echo "    ✓ [y]/[n]/[s] keys worked on warnings"
echo "    ✓ After [n], 'Learned: ...' message appeared"
echo "    ✓ .aspectcode/preferences.json was created/updated"
echo "══════════════════════════════════════════════════"
