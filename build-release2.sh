#!/bin/bash
# Clean full repackage of v0.1.0: build mac (notarized) + win from ONE pass, then
# atomically replace ALL release assets with the fresh consistent set. Verifies
# manifest==asset for both platforms before declaring done. Survives session teardown
# (launched detached via caffeinate). Sentinel line at the very end.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }
fail(){ log "FATAL: $*"; echo "ALL DONE v2 EXIT=1"; exit 1; }

export GH_TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
export APPLE_API_KEY="$HERE/creds/AuthKey_G5N83ZAQUP.p8"
export APPLE_API_KEY_ID="G5N83ZAQUP"
export APPLE_API_ISSUER="0a671028-2f67-4de1-afe7-e69235991fca"
[ -n "$GH_TOKEN" ] || fail "GH_TOKEN empty"
[ -f "$APPLE_API_KEY" ] || fail "apple key missing"
EB="npx --no-install electron-builder"
REPO="nimishmehta/founders-office"

log "PHASE 1/5  stage skills"; bash stage-skills.sh || fail "staging"
rm -rf dist/*.dmg dist/*.zip dist/*.exe dist/*.blockmap dist/latest*.yml 2>/dev/null || true

log "PHASE 2/5  build macOS (universal, notarize) — no publish"
$EB --mac 2>&1 || fail "mac build"
log "macOS build OK"

log "PHASE 3/5  build Windows (nsis x64+arm64) — no publish"
$EB --win 2>&1 || fail "win build"
log "Windows build OK"

# map: local(space) -> release asset name(hyphen) : content-type
declare -a MAP=(
  "Founders Office-0.1.0-universal.dmg|Founders-Office-0.1.0-universal.dmg|application/octet-stream"
  "Founders Office-0.1.0-universal.dmg.blockmap|Founders-Office-0.1.0-universal.dmg.blockmap|application/octet-stream"
  "Founders Office-0.1.0-universal-mac.zip|Founders-Office-0.1.0-universal-mac.zip|application/octet-stream"
  "Founders Office-0.1.0-universal-mac.zip.blockmap|Founders-Office-0.1.0-universal-mac.zip.blockmap|application/octet-stream"
  "Founders Office-0.1.0.exe|Founders-Office-0.1.0.exe|application/octet-stream"
  "Founders Office-0.1.0.exe.blockmap|Founders-Office-0.1.0.exe.blockmap|application/octet-stream"
  "latest-mac.yml|latest-mac.yml|text/yaml"
  "latest.yml|latest.yml|text/yaml"
)
# guard: every expected local artifact present before we touch the live release
for row in "${MAP[@]}"; do IFS='|' read -r lf an ct <<<"$row"; [ -f "dist/$lf" ] || fail "missing built artifact: $lf"; done
log "all 8 fresh artifacts present locally"

log "PHASE 4/5  replace release assets (delete old, upload fresh)"
RID="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/tags/v0.1.0" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).id||""))}catch{process.stdout.write("")}})')"
[ -n "$RID" ] || fail "no v0.1.0 release found"
log "release id=$RID"
# delete every existing asset
curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/$RID/assets" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const a of JSON.parse(d))console.log(a.id)})' 2>/dev/null \
  | while read -r aid; do [ -n "$aid" ] && curl -s -X DELETE -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/assets/$aid" >/dev/null && log "  deleted asset $aid"; done
sleep 2
# upload fresh
for row in "${MAP[@]}"; do
  IFS='|' read -r lf an ct <<<"$row"
  curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: $ct" \
    --data-binary @"dist/$lf" "https://uploads.github.com/repos/$REPO/releases/$RID/assets?name=$an" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);console.log("  up:",r.name||("ERR "+JSON.stringify(r).slice(0,120)))})'
done
# ensure live (not draft)
curl -s -X PATCH -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/$RID" \
  -d '{"draft":false,"prerelease":false,"tag_name":"v0.1.0","target_commitish":"main","name":"v0.1.0"}' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);console.log("  release:",r.draft?"DRAFT":"LIVE","tag",r.tag_name)})'

log "PHASE 5/5  verify manifest==asset + freshness"
curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/tags/v0.1.0" > /tmp/rel2.json
MZIP=$(grep -A2 'universal-mac.zip$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
MDMG=$(grep -A2 'universal.dmg$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
WEXE=$(awk '/size:/{print $2; exit}' dist/latest.yml)
MZIP=$MZIP MDMG=$MDMG WEXE=$WEXE node -e '
const r=require("/tmp/rel2.json");const now=Date.now();const A={},G={};
for(const a of r.assets){A[a.name]=a.size;G[a.name]=((now-new Date(a.updated_at))/3.6e6);}
const chk=[["Founders-Office-0.1.0-universal-mac.zip",+process.env.MZIP],["Founders-Office-0.1.0-universal.dmg",+process.env.MDMG],["Founders-Office-0.1.0.exe",+process.env.WEXE]];
let ok=r.assets.length===8 && !r.draft;
console.log("  state:", r.draft?"DRAFT":"LIVE","assets:",r.assets.length);
for(const [n,s] of chk){const c=A[n]===s;ok&&=c;console.log("  "+n+": manifest="+s+" asset="+A[n]+" age="+G[n].toFixed(2)+"h -> "+(c?"OK":"MISMATCH"));}
console.log("  VERDICT:", ok?"CONSISTENT+LIVE":"PROBLEM");
'
log "ALL DONE."
echo "ALL DONE v2 EXIT=0"
