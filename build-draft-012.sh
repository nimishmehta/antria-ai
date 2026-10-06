#!/bin/bash
# Package v0.1.2 (mac notarized + win) and push to GitHub as a DRAFT (owner-visible, NOT live).
# Sets the caveman release notes as the body. Verifies draft + manifest==asset. Sentinel at end.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
log(){ echo ">>> [$(date +%H:%M:%S)] $*"; }
fail(){ log "FATAL: $*"; echo "ALL DONE v12 EXIT=1"; exit 1; }

export GH_TOKEN="$(tr -d '[:space:]' < creds/gh-token)"
export APPLE_API_KEY="$HERE/creds/AuthKey_G5N83ZAQUP.p8"
export APPLE_API_KEY_ID="G5N83ZAQUP"
export APPLE_API_ISSUER="0a671028-2f67-4de1-afe7-e69235991fca"
[ -n "$GH_TOKEN" ] || fail "GH_TOKEN empty"
[ -f "$APPLE_API_KEY" ] || fail "apple key missing"
EB="npx --no-install electron-builder"
REPO="nimishmehta/founders-office"
VER="$(node -e 'console.log(require("./package.json").version)')"
[ "$VER" = "0.1.2" ] || fail "package.json version is $VER, expected 0.1.2"
log "packaging v$VER as DRAFT"

# clean stale local artifacts
rm -rf dist/*.dmg dist/*.zip dist/*.exe dist/*.blockmap dist/latest*.yml 2>/dev/null || true
# guard: clear any leftover v0.1.2 draft assets so publish can't 422 on a re-run
RID_OLD="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/tags/v$VER" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).id||""))}catch{process.stdout.write("")}})')"
if [ -n "$RID_OLD" ]; then
  log "existing v$VER release found (id=$RID_OLD) — clearing its assets first"
  curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/$RID_OLD/assets" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const a of JSON.parse(d))console.log(a.id)})' 2>/dev/null \
    | while read -r aid; do [ -n "$aid" ] && curl -s -X DELETE -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/assets/$aid" >/dev/null; done
fi

log "PHASE 1/4  stage skills"; bash stage-skills.sh || fail "staging"

log "PHASE 2/4  build macOS (universal, notarize) + publish to DRAFT"
mac_ok=0
for attempt in 1 2 3 4 5 6; do
  log "  mac attempt $attempt/6"
  if $EB --mac --publish always 2>&1; then mac_ok=1; break; fi
  log "  attempt $attempt failed (often Apple timestamp service briefly down) — retry in 30s"; sleep 30
done
[ "$mac_ok" = 1 ] || fail "mac build (all 6 attempts)"
log "macOS build+publish OK"

log "PHASE 3/4  build Windows (nsis x64+arm64) + publish to DRAFT"
$EB --win --publish always 2>&1 || fail "win build"
log "Windows build+publish OK"

log "PHASE 4/4  set caveman notes, KEEP as draft, verify"
RID="$(curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/tags/v$VER" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).id||""))}catch{process.stdout.write("")}})')"
[ -n "$RID" ] || fail "no v$VER release found after publish"
# set body (caveman notes), name, and EXPLICITLY keep draft:true (never go live)
node -e '
const fs=require("fs"),https=require("https");
const body=fs.readFileSync("RELEASE-NOTES-0.1.2.md","utf8");
const payload=JSON.stringify({draft:true,prerelease:false,name:"v0.1.2",tag_name:"v0.1.2",body});
const req=https.request("https://api.github.com/repos/'"$REPO"'/releases/'"$RID"'",{method:"PATCH",headers:{Authorization:"Bearer "+process.env.GH_TOKEN,"User-Agent":"office","Content-Type":"application/json"}},res=>{let d="";res.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);console.log("  release:",r.draft?"DRAFT (correct)":"LIVE (WRONG!)","| notes set:",(r.body||"").length+" chars");});});
req.write(payload);req.end();
'
# verify consistency
curl -s -H "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/releases/tags/v$VER" > /tmp/rel12.json
MZIP=$(grep -A2 'universal-mac.zip$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
MDMG=$(grep -A2 'universal.dmg$' dist/latest-mac.yml | awk '/size:/{print $2; exit}')
WEXE=$(awk '/size:/{print $2; exit}' dist/latest.yml)
MZIP=$MZIP MDMG=$MDMG WEXE=$WEXE node -e '
const r=require("/tmp/rel12.json");const A={};for(const a of r.assets)A[a.name]=a.size;
const chk=[["Founders-Office-0.1.2-universal-mac.zip",+process.env.MZIP],["Founders-Office-0.1.2-universal.dmg",+process.env.MDMG],["Founders-Office-0.1.2.exe",+process.env.WEXE]];
let ok=r.assets.length>=8 && r.draft===true;
console.log("  state:", r.draft?"DRAFT":"LIVE","| assets:",r.assets.length);
for(const [n,s] of chk){const c=A[n]===s;ok&&=c;console.log("  "+n+": manifest="+s+" asset="+(A[n]||"MISSING")+" -> "+(c?"OK":"MISMATCH"));}
console.log("  VERDICT:", ok?"DRAFT+CONSISTENT":"PROBLEM");
'
log "ALL DONE."
echo "ALL DONE v12 EXIT=0"
