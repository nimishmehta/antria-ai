#!/bin/bash
# One-shot: stage skills, build+publish mac & win for v0.1.0, flip the GitHub release live.
# Logs every phase. Never silently continues past a build failure.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }

# --- credentials (from creds/, per creds/README.md) ---
export GH_TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
export APPLE_API_KEY="$HERE/creds/AuthKey_G5N83ZAQUP.p8"
export APPLE_API_KEY_ID="G5N83ZAQUP"
export APPLE_API_ISSUER="0a671028-2f67-4de1-afe7-e69235991fca"
[ -n "$GH_TOKEN" ] || { log "FATAL: GH_TOKEN empty"; exit 1; }
[ -f "$APPLE_API_KEY" ] || { log "FATAL: Apple key missing"; exit 1; }

EB="npx --no-install electron-builder"
VER="$(node -e 'console.log(require("./package.json").version)')"
log "Version to publish: v$VER"

# --- current release state (API; gh CLI not installed) ---
log "Checking existing GitHub releases…"
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/nimishmehta/founders-office/releases" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);if(!Array.isArray(r)){console.log("  (api msg)",JSON.stringify(r).slice(0,200));return;}for(const x of r)console.log("  -",x.tag_name,x.draft?"[draft]":"[published]",(x.assets||[]).length+" assets");}catch(e){console.log("  parse err",e.message)}})'

# --- 1. stage skills (syncs ~/.claude/skills → skills-bundle, incl. email-drafts fix) ---
log "PHASE 1/4  staging skills…"
bash stage-skills.sh || { log "FATAL: staging failed"; exit 1; }

# --- 2. mac build + publish (config drives arch = universal; notarized) ---
log "PHASE 2/4  building macOS (universal dmg+zip, notarize)…"
$EB --mac --publish always 2>&1 || { log "FATAL: mac build failed"; exit 1; }
log "macOS build+publish OK"

# --- 3. win build + publish (config drives arch = x64+arm64 nsis) ---
log "PHASE 3/4  building Windows (nsis x64+arm64)…"
$EB --win --publish always 2>&1 || { log "FATAL: win build failed"; exit 1; }
log "Windows build+publish OK"

# --- 4. flip the v$VER release draft → published ---
log "PHASE 4/4  publishing the release (draft → live)…"
REL_ID="$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/nimishmehta/founders-office/releases" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v'"$VER"'"||x.tag_name==="'"$VER"'");process.stdout.write(m?String(m.id):"")})')"
if [ -n "$REL_ID" ]; then
  curl -s -X PATCH -H "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/repos/nimishmehta/founders-office/releases/$REL_ID" \
    -d '{"draft":false,"prerelease":false}' \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);console.log("  release now:",r.draft?"draft":"LIVE","-",r.html_url||"")})'
else
  log "WARN: could not find a v$VER release to flip — check manually"
fi

# --- final asset inventory ---
log "Final assets on the v$VER release:"
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/nimishmehta/founders-office/releases" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v'"$VER"'"||x.tag_name==="'"$VER"'");if(!m){console.log("  (none)");return}for(const a of (m.assets||[]))console.log("  -",a.name,(a.size/1e6).toFixed(1)+"MB")})'
log "ALL DONE."
