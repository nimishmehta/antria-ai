#!/bin/bash
# Stage the capability skills the office roles depend on into desktop/skills-bundle/,
# so electron-builder can copy them into the .app (they land at
# process.resourcesPath/skills and get seeded into ~/.claude/skills on first run).
# Symlinked skills are dereferenced (-L). Heavy/dev cruft is excluded.
# Guard each skill: warn+skip anything missing, NEVER fail the build.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HOME/.claude/skills"
DEST="$HERE/skills-bundle"

SKILL_MANIFEST="
  xlsx pptx docx
  sow-kit brand-guidelines mcp-builder skill-creator
  email-drafts meeting-kit investor-update hiring-kit weekly-review
  nimish-honest-take graphify
  diagram excalidraw-diagram
  design-taste-frontend minimalist-ui redesign-existing-projects
  caveman caveman-commit caveman-compress caveman-help caveman-review caveman-stats
"

rm -rf "$DEST"
mkdir -p "$DEST"

BUNDLED=""
MISSING=""
for skill in $SKILL_MANIFEST; do
  if [ -e "$SRC/$skill" ]; then
    rsync -aL \
      --exclude '.git' \
      --exclude 'node_modules' \
      --exclude '.venv' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      --exclude '*.log' \
      --exclude '.DS_Store' \
      "$SRC/$skill/" "$DEST/$skill/"
    BUNDLED="$BUNDLED $skill"
  else
    MISSING="$MISSING $skill"
  fi
done

# Scrub personal/old branding from staged skills (source lives outside this repo).
find "$DEST" -type f \( -name '*.md' -o -name '*.js' -o -name '*.py' -o -name '*.txt' \) \
  -exec perl -pi -e 's/Nimish Office/Founders Office/g' {} + 2>/dev/null

echo "Staged capability skills:$BUNDLED"
[ -n "$MISSING" ] && echo "WARNING: skipped (not found in $SRC):$MISSING"
echo "Bundle size: $(du -sh "$DEST" | cut -f1 | tr -d ' ')"
exit 0
