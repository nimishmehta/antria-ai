#!/bin/bash
# Package v0.2.0 (mac universal notarized + win nsis x64/arm64) and push to GitHub as a DRAFT.
# Owner-visible, NOT live. Fixes the phase-4 by-tag gotcha (looks up via LIST, keeps draft:true via curl).
# Fixes the dotted zip.blockmap name so delta/auto-update matches the manifest. Sentinel line at end.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }
fail(){ log "FATAL: $*"; echo "ALL DONE v020 EXIT=1"; exit 1; }

export GH_TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
export APPLE_API_KEY="$HERE/creds/AuthKey_G5N83ZAQUP.p8"
export APPLE_API_KEY_ID="G5N83ZAQUP"
export APPLE_API_ISSUER="0a671028-2f67-4de1-afe7-e69235991fca"
[ -n "$GH_TOKEN" ] || fail "GH_TOKEN empty"
[ -f "$APPLE_API_KEY" ] || fail "apple key missing"
EB="npx --no-install electron-builder"
REPO="nimishmehta/founders-office"
API="https://api.github.com/repos/$REPO"
UPL="https://uploads.github.com/repos/$REPO"
VER="$(node -e 'console.log(require("./package.json").version)')"
[ "$VER" = "0.2.0" ] || fail "package.json version is $VER, expected 0.2.0"
log "packaging v$VER as DRAFT"

# clean stale local artifacts (0.1.2 etc.)
rm -rf dist/*.dmg dist/*.zip dist/*.exe dist/*.blockmap dist/latest*.yml 2>/dev/null || true

# guard: clear any leftover v0.2.0 release assets so publish can't 422 on a re-run
RID_OLD="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v0.2.0"||(x.draft&&(x.assets||[]).some(a=>a.name.includes("0.2.0"))));process.stdout.write(m?String(m.id):"")}catch{process.stdout.write("")}})')"
if [ -n "$RID_OLD" ]; then
  log "existing v$VER release found (id=$RID_OLD) — clearing its assets first"
  curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases/$RID_OLD/assets" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const a of JSON.parse(d))console.log(a.id)})' 2>/dev/null \
    | while read -r aid; do [ -n "$aid" ] && curl -s -X DELETE -H "Authorization: Bearer $GH_TOKEN" "$API/releases/assets/$aid" >/dev/null; done
fi

log "PHASE 1/5  stage skills"; bash stage-skills.sh || fail "staging"

log "PHASE 2/5  build macOS (universal dmg+zip, sign+notarize) + upload to DRAFT"
mac_ok=0
for attempt in 1 2 3 4 5 6; do
  log "  mac attempt $attempt/6"
  if $EB --mac --publish always 2>&1; then mac_ok=1; break; fi
  log "  attempt $attempt failed (often Apple timestamp service briefly down) — retry in 30s"; sleep 30
done
[ "$mac_ok" = 1 ] || fail "mac build (all 6 attempts)"
log "macOS build+upload OK"

log "PHASE 3/5  build Windows (nsis x64+arm64) + upload to DRAFT"
$EB --win --publish always 2>&1 || fail "win build"
log "Windows build+upload OK"

log "PHASE 4/5  resolve release via LIST (not by-tag), fix dotted blockmap, set notes, KEEP draft"
RID="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);const m=r.find(x=>x.tag_name==="v0.2.0"||(x.draft&&(x.assets||[]).some(a=>a.name.includes("0.2.0"))));process.stdout.write(m?String(m.id):"")})')"
[ -n "$RID" ] || fail "no v$VER release found after publish (checked LIST)"
log "  release id=$RID"

# Fix the mis-named dotted zip.blockmap (GitHub turned the space into a dot on upload).
# Manifest references the hyphenated name; delete dotted, re-upload hyphenated from dist.
BAD="Founders.Office-$VER-universal-mac.zip.blockmap"
GOOD="Founders-Office-$VER-universal-mac.zip.blockmap"
LOCAL_BM="dist/Founders Office-$VER-universal-mac.zip.blockmap"
BAD_ID="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases/$RID/assets" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).find(x=>x.name==="'"$BAD"'");process.stdout.write(a?String(a.id):"")})')"
HAVE_GOOD="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases/$RID/assets" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).find(x=>x.name==="'"$GOOD"'");process.stdout.write(a?"1":"")})')"
if [ -n "$BAD_ID" ]; then
  log "  deleting dotted blockmap asset id=$BAD_ID ($BAD)"
  curl -s -X DELETE -H "Authorization: Bearer $GH_TOKEN" "$API/releases/assets/$BAD_ID" >/dev/null
fi
if [ -z "$HAVE_GOOD" ] && [ -f "$LOCAL_BM" ]; then
  log "  uploading hyphenated blockmap ($GOOD)"
  curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary @"$LOCAL_BM" "$UPL/releases/$RID/assets?name=$GOOD" >/dev/null
fi

# Set notes + name + tag, EXPLICITLY keep draft:true. Body via curl --data-binary from a JSON file (python SSL fails in this env).
node -e 'const fs=require("fs");const body=fs.readFileSync("RELEASE-NOTES-0.2.0.md","utf8");fs.writeFileSync("/tmp/rel020-payload.json",JSON.stringify({draft:true,prerelease:false,name:"v0.2.0",tag_name:"v0.2.0",target_commitish:"main",body}))'
curl -s -X PATCH -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/rel020-payload.json "$API/releases/$RID" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);console.log("  release:",r.draft?"DRAFT (correct)":"LIVE (WRONG!)","| notes:",(r.body||"").length+" chars","| url:",r.html_url)})'

log "PHASE 5/5  verify draft state + manifest==asset consistency"
curl -s -H "Authorization: Bearer $GH_TOKEN" "$API/releases/$RID" > /tmp/rel020.json
MZIP=$(grep -A2 'universal-mac.zip$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
MDMG=$(grep -A2 'universal.dmg$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
WEXE=$(awk '/size:/{print $2; exit}' dist/latest.yml)
MZIP=$MZIP MDMG=$MDMG WEXE=$WEXE VER=$VER node -e '
const r=require("/tmp/rel020.json");const A={};for(const a of r.assets)A[a.name]=a.size;
const V=process.env.VER;
const chk=[["Founders-Office-"+V+"-universal-mac.zip",+process.env.MZIP],["Founders-Office-"+V+"-universal.dmg",+process.env.MDMG],["Founders-Office-"+V+".exe",+process.env.WEXE]];
let ok=r.assets.length>=8 && r.draft===true;
console.log("  state:", r.draft?"DRAFT":"LIVE","| assets:",r.assets.length);
for(const [n,s] of chk){const c=A[n]===s;ok=ok&&c;console.log("  "+n+": manifest="+s+" asset="+(A[n]||"MISSING")+" -> "+(c?"OK":"MISMATCH"));}
const hasHyphBM=!!A["Founders-Office-"+V+"-universal-mac.zip.blockmap"];
const hasDotBM=!!A["Founders.Office-"+V+"-universal-mac.zip.blockmap"];
console.log("  zip.blockmap hyphenated present:",hasHyphBM," dotted present:",hasDotBM);
ok=ok&&hasHyphBM&&!hasDotBM;
console.log("  manifests present: latest-mac.yml="+(!!A["latest-mac.yml"])+" latest.yml="+(!!A["latest.yml"]));
ok=ok&&!!A["latest-mac.yml"]&&!!A["latest.yml"];
console.log("  ASSET LIST:");for(const a of r.assets)console.log("    - "+a.name+"  "+(a.size/1e6).toFixed(1)+"MB");
console.log("  VERDICT:", ok?"DRAFT+CONSISTENT":"PROBLEM");
'
log "ALL DONE."
echo "ALL DONE v020 EXIT=0"
