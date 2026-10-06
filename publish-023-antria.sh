#!/bin/bash
# Publish Antria v0.2.3 LIVE to nimishmehta/antria-ai (Mac-only; no Windows asset this release).
# Draft -> upload all mac assets -> flip draft:false, prerelease:false, make_latest:true -> verify.
# Mirrors publish-021-antria.sh but discovers the real asset filenames from dist/0.2.3.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }
fail(){ log "FATAL: $*"; echo "PUBLISH DONE EXIT=1"; exit 1; }

TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
[ -n "$TOKEN" ] || fail "token empty"
REPO="nimishmehta/antria-ai"
API="https://api.github.com/repos/$REPO"
UPL="https://uploads.github.com/repos/$REPO"
VER="0.2.3"; TAG="v$VER"
D="dist/$VER"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

[ -d "$D" ] || fail "no $D directory"

# Discover the real mac asset filenames (universal dmg + zip + their blockmaps + the update feed).
DMG="$(ls "$D"/*.dmg 2>/dev/null | head -1)"
ZIP="$(ls "$D"/*-mac.zip 2>/dev/null | head -1)"
[ -n "$DMG" ] || fail "no .dmg in $D"
[ -n "$ZIP" ] || fail "no *-mac.zip in $D"
paths=(
  "$DMG|$(basename "$DMG")"
  "$DMG.blockmap|$(basename "$DMG").blockmap"
  "$ZIP|$(basename "$ZIP")"
  "$ZIP.blockmap|$(basename "$ZIP").blockmap"
  "$D/latest-mac.yml|latest-mac.yml"
)
for p in "${paths[@]}"; do lp="${p%%|*}"; [ -f "$lp" ] || fail "missing artifact: $lp"; done
log "assets to upload:"; for p in "${paths[@]}"; do echo "    - ${p##*|}"; done

log "resolve existing $TAG release (if any)"
RID="$(curl -s "${AUTH[@]}" "$API/releases?per_page=100" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v0.2.3");process.stdout.write(m?String(m.id):"")}catch(e){process.stdout.write("")}})')"
node -e 'const fs=require("fs");const body=fs.readFileSync("RELEASE-NOTES-0.2.3.md","utf8");fs.writeFileSync("/tmp/rel023-payload.json",JSON.stringify({draft:true,prerelease:false,name:"Antria 0.2.3",tag_name:"v0.2.3",target_commitish:"main",body}))'
if [ -n "$RID" ]; then
  log "existing release id=$RID — clearing its assets for clean re-upload"
  curl -s "${AUTH[@]}" "$API/releases/$RID/assets" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{for(const a of JSON.parse(d))console.log(a.id)}catch(e){}})' \
    | while read -r aid; do [ -n "$aid" ] && curl -s -X DELETE "${AUTH[@]}" "$API/releases/assets/$aid" >/dev/null; done
  curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" --data-binary @/tmp/rel023-payload.json "$API/releases/$RID" >/dev/null
else
  log "creating draft release $TAG"
  RID="$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" --data-binary @/tmp/rel023-payload.json "$API/releases" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);process.stdout.write(r.id?String(r.id):"")}catch(e){process.stdout.write("")}})')"
fi
[ -n "$RID" ] || fail "could not create/resolve release"
log "release id=$RID"

for p in "${paths[@]}"; do
  lp="${p%%|*}"; nm="${p##*|}"
  ct="application/octet-stream"; case "$nm" in *.yml) ct="text/yaml";; esac
  sz=$(stat -f%z "$lp")
  log "upload $nm ($(echo "scale=1;$sz/1000000"|bc)MB)"
  code=$(curl -s -o /tmp/upl.json -w '%{http_code}' -X POST "${AUTH[@]}" -H "Content-Type: $ct" --data-binary @"$lp" "$UPL/releases/$RID/assets?name=$nm")
  if [ "$code" != "201" ]; then
    log "  upload HTTP $code for $nm — retrying once"
    aid=$(curl -s "${AUTH[@]}" "$API/releases/$RID/assets" | node -e 'let d="";process.stdin.on("data",c=>c&&(d+=c)).on("end",()=>{try{const a=JSON.parse(d).find(x=>x.name==="'"$nm"'");process.stdout.write(a?String(a.id):"")}catch(e){}})')
    [ -n "$aid" ] && curl -s -X DELETE "${AUTH[@]}" "$API/releases/assets/$aid" >/dev/null
    code=$(curl -s -o /tmp/upl.json -w '%{http_code}' -X POST "${AUTH[@]}" -H "Content-Type: $ct" --data-binary @"$lp" "$UPL/releases/$RID/assets?name=$nm")
    [ "$code" = "201" ] || fail "upload failed twice for $nm (HTTP $code): $(cat /tmp/upl.json)"
  fi
done

log "flipping release to PUBLISHED (draft=false, latest)"
curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"draft":false,"prerelease":false,"make_latest":"true"}' "$API/releases/$RID" >/dev/null

log "verify"
curl -s "${AUTH[@]}" "$API/releases/$RID" > /tmp/rel023-final.json
node -e '
const r=require("/tmp/rel023-final.json");
const have=new Set((r.assets||[]).map(a=>a.name));
console.log("  tag:",r.tag_name,"| draft:",r.draft,"| prerelease:",r.prerelease);
console.log("  url:",r.html_url);
let ok = r.draft===false && r.prerelease===false;
let needDmg=false,needZip=false,needYml=have.has("latest-mac.yml");
for(const n of have){ if(/\.dmg$/.test(n)) needDmg=true; if(/-mac\.zip$/.test(n)) needZip=true; }
ok = ok && needDmg && needZip && needYml;
for(const a of (r.assets||[])) console.log("  OK  "+a.name+"  ("+a.size+" bytes, dl="+a.download_count+")");
console.log("  assets total:",(r.assets||[]).length);
console.log("  VERDICT:", ok?"PUBLISHED+ALL-ASSETS":"PROBLEM");
'
log "ALL DONE."
echo "PUBLISH DONE EXIT=0"
