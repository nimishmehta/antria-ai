#!/bin/bash
# Publish the rebuilt Antria v0.2.0 (NEW name + icon) to nimishmehta/antria-ai, OVERWRITING v0.2.0.
# All artifacts are now Antria-named (incl. the mac zip). Clears old assets (Founders-Office zip etc),
# uploads new ones, flips draft=false, re-verifies via API.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }
fail(){ log "FATAL: $*"; echo "PUBLISH DONE EXIT=1"; exit 1; }

TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
[ -n "$TOKEN" ] || fail "token empty"
REPO="nimishmehta/antria-ai"
API="https://api.github.com/repos/$REPO"
UPL="https://uploads.github.com/repos/$REPO"
VER="0.2.0"; TAG="v$VER"
D="dist/$VER"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

# local path | asset name (manifest-matching). ZIP is now Antria-named.
paths=(
  "$D/Antria-universal.dmg|Antria-universal.dmg"
  "$D/Antria-universal.dmg.blockmap|Antria-universal.dmg.blockmap"
  "$D/Antria-0.2.0-universal-mac.zip|Antria-0.2.0-universal-mac.zip"
  "$D/Antria-0.2.0-universal-mac.zip.blockmap|Antria-0.2.0-universal-mac.zip.blockmap"
  "$D/Antria-Setup.exe|Antria-Setup.exe"
  "$D/Antria-Setup.exe.blockmap|Antria-Setup.exe.blockmap"
  "$D/latest.yml|latest.yml"
  "$D/latest-mac.yml|latest-mac.yml"
)
for p in "${paths[@]}"; do lp="${p%%|*}"; [ -f "$lp" ] || fail "missing artifact: $lp"; done

# 1) reuse-or-create release (start as DRAFT so partial upload is never visible)
log "resolve existing $TAG release (if any)"
RID="$(curl -s "${AUTH[@]}" "$API/releases" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v0.2.0");process.stdout.write(m?String(m.id):"")}catch{process.stdout.write("")}})')"
if [ -n "$RID" ]; then
  log "existing release id=$RID — clearing ALL its assets (incl old Founders-Office zip) for a clean re-upload"
  curl -s "${AUTH[@]}" "$API/releases/$RID/assets" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{for(const a of JSON.parse(d))console.log(a.id)}catch{}})' \
    | while read -r aid; do [ -n "$aid" ] && curl -s -X DELETE "${AUTH[@]}" "$API/releases/assets/$aid" >/dev/null; done
  node -e 'const fs=require("fs");const body=fs.readFileSync("RELEASE-NOTES-0.2.0.md","utf8");fs.writeFileSync("/tmp/rel-payload.json",JSON.stringify({draft:true,prerelease:false,name:"Antria 0.2.0",tag_name:"v0.2.0",body}))'
  curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" --data-binary @/tmp/rel-payload.json "$API/releases/$RID" >/dev/null
else
  log "creating draft release $TAG"
  node -e 'const fs=require("fs");const body=fs.readFileSync("RELEASE-NOTES-0.2.0.md","utf8");fs.writeFileSync("/tmp/rel-payload.json",JSON.stringify({draft:true,prerelease:false,name:"Antria 0.2.0",tag_name:"v0.2.0",target_commitish:"main",body}))'
  RID="$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" --data-binary @/tmp/rel-payload.json "$API/releases" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);process.stdout.write(r.id?String(r.id):"")})')"
fi
[ -n "$RID" ] || fail "could not create/resolve release"
log "release id=$RID"

# 2) upload every asset with its manifest-matching name
for p in "${paths[@]}"; do
  lp="${p%%|*}"; nm="${p##*|}"
  ct="application/octet-stream"; case "$nm" in *.yml) ct="text/yaml";; esac
  sz=$(stat -f%z "$lp")
  log "upload $nm ($(echo "scale=1;$sz/1000000"|bc)MB)"
  code=$(curl -s -o /tmp/upl.json -w '%{http_code}' -X POST "${AUTH[@]}" -H "Content-Type: $ct" \
    --data-binary @"$lp" "$UPL/releases/$RID/assets?name=$nm")
  if [ "$code" != "201" ]; then
    log "  upload HTTP $code for $nm — retrying once"
    aid=$(curl -s "${AUTH[@]}" "$API/releases/$RID/assets" | node -e 'let d="";process.stdin.on("data",c=>c&&(d+=c)).on("end",()=>{try{const a=JSON.parse(d).find(x=>x.name==="'"$nm"'");process.stdout.write(a?String(a.id):"")}catch{}})')
    [ -n "$aid" ] && curl -s -X DELETE "${AUTH[@]}" "$API/releases/assets/$aid" >/dev/null
    code=$(curl -s -o /tmp/upl.json -w '%{http_code}' -X POST "${AUTH[@]}" -H "Content-Type: $ct" --data-binary @"$lp" "$UPL/releases/$RID/assets?name=$nm")
    [ "$code" = "201" ] || fail "upload failed twice for $nm (HTTP $code): $(cat /tmp/upl.json)"
  fi
done

# 3) publish: flip draft=false, make_latest=true
log "flipping release to PUBLISHED (draft=false, latest)"
curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"draft":false,"prerelease":false,"make_latest":"true"}' "$API/releases/$RID" >/dev/null

# 4) re-fetch + verify
log "verify"
curl -s "${AUTH[@]}" "$API/releases/$RID" > /tmp/rel-final.json
node -e '
const r=require("/tmp/rel-final.json");
const want=["Antria-universal.dmg","Antria-universal.dmg.blockmap","Antria-0.2.0-universal-mac.zip","Antria-0.2.0-universal-mac.zip.blockmap","Antria-Setup.exe","Antria-Setup.exe.blockmap","latest.yml","latest-mac.yml"];
const have=new Set((r.assets||[]).map(a=>a.name));
console.log("  tag:",r.tag_name,"| draft:",r.draft,"| prerelease:",r.prerelease);
console.log("  url:",r.html_url);
let ok = r.draft===false && r.prerelease===false;
for(const w of want){const h=have.has(w);ok=ok&&h;console.log("  "+(h?"OK":"MISSING")+"  "+w);}
const stale=[...have].filter(n=>/Founders.?Office/i.test(n));
console.log("  stale Founders-Office assets:", stale.length? stale.join(", "):"NONE");
ok=ok && stale.length===0;
console.log("  assets total:",(r.assets||[]).length);
console.log("  VERDICT:", ok?"PUBLISHED+ALL-ANTRIA-ASSETS+NO-STALE":"PROBLEM");
'
log "ALL DONE."
echo "PUBLISH DONE EXIT=0"
