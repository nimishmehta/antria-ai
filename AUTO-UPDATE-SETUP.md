# Auto-Update Setup (Founders Office) — GitHub Releases

Auto-updates via **electron-updater** (the electron-builder standard; covers Mac +
Windows from one feed). Update host = **GitHub Releases**. electron-builder builds
the app AND uploads it to a GitHub Release; installed apps read that Release and
update themselves. Set up once, ~2 min per release.

---

## How it works (plain version)

- Every build is uploaded to a **GitHub Release** on one repo you own.
- Installed apps check that repo's Releases on launch, download any newer version
  in the background, and install it on quit.
- electron-updater reads the Release **assets** (the `.zip` / `.exe` + `.yml` feed
  files). It does NOT read your source code — only the published Release files.

---

## ONE-TIME SETUP (do once)

### 1. Pick the GitHub repo that hosts releases
- Create or choose one GitHub repo to host builds.
- Put its owner + repo name into `desktop/package.json` → `build.publish`,
  replacing the two placeholders:
  ```
  "publish": [
    { "provider": "github", "owner": "GITHUB-OWNER-PLACEHOLDER", "repo": "GITHUB-REPO-PLACEHOLDER" }
  ]
  ```
  `owner` = the GitHub account/org name. `repo` = the repository name.
- **Public vs private:** electron-updater reads the Release assets over the
  network, so the host must be reachable by installed apps.
  - **PUBLIC repo = recommended** for a downloadable app — simplest, no auth on
    the user's machine.
  - **Private repo works** but every installed app must carry a GitHub token baked
    into the build to fetch updates. More setup, a secret shipped to users. Avoid
    unless you have a reason. **Use PUBLIC for release hosting.**
  - (The repo hosting Releases can be separate from where your code lives — the
    Release repo just needs to be public.)

### 2. Create a GitHub token for uploading builds
- GitHub → Settings → Developer settings → **Personal access tokens (classic)**.
- Scope: **`repo`**. Generate, copy the token.
- This is your **`GH_TOKEN`**. It is used ONLY to auto-upload builds to Releases.
- Keep it secret. Don't commit it. Don't paste it in chat.

### 3. Turn ON Apple notarization (Mac — required)
`desktop/package.json` → `mac` currently has **`notarize: false`**. The app is
already signed with Developer ID **"Nimish Mehta (QFH65RZ2JG)"**, but signing
alone is not enough.

**Why it matters:** macOS auto-update swaps the app bundle in place. If the new
bundle isn't **notarized**, Gatekeeper blocks the swap and the update **fails
silently** — works in your testing, dies on users' machines.

**Enable it:** set `notarize` on (or remove `"notarize": false`) and supply Apple
credentials as environment variables at build time. Two ways:

- **Apple API key (recommended):**
  ```
  export APPLE_API_KEY=/path/to/AuthKey_XXXX.p8
  export APPLE_API_KEY_ID=XXXXXXXXXX
  export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ```
  (Get these from App Store Connect → Users and Access → Integrations → App Store
  Connect API.)
- **Or Apple ID + app-specific password:**
  ```
  export APPLE_ID="you@example.com"
  export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
  export APPLE_TEAM_ID=QFH65RZ2JG
  ```

Notarization adds a few minutes to each Mac build (Apple scans it). Without it,
Mac auto-update does not work in the wild.

> Windows: unsigned auto-update works but shows a SmartScreen warning; a code-
> signing cert removes it. Not required to ship.

---

## PER-RELEASE (~2 min per version) — two ways

Pick **A** (auto-publish, recommended) or **B** (manual). Both need the version
bumped first.

Bump the version in `desktop/package.json` (e.g. `0.3.1` → `0.3.2`).
electron-updater compares this number to decide "is there an update".

### Option A — AUTO-PUBLISH (recommended)
electron-builder builds AND uploads dmg + zip + `latest-mac.yml` (and, for
`dist:all`, the Windows exe + `latest.yml`) straight to a GitHub **draft** Release,
then you click Publish.

1. Set the token (once per terminal):
   ```
   export GH_TOKEN=your_personal_access_token
   ```
   (Mac: also `export` the Apple notarization vars from step 3.)
2. Build + upload:
   - Mac only:
     ```
     cd desktop && npm run dist -- -p always
     ```
   - Mac + Windows:
     ```
     cd desktop && npm run dist:all -- -p always
     ```
3. Go to GitHub → the release repo → **Releases**. A **draft** Release for the new
   version is waiting with all files attached. Click **Publish**.
4. Done. Installed apps pick it up on next launch.

### Option B — MANUAL
1. Build (no upload):
   ```
   cd desktop && npm run dist
   ```
   (Use `npm run dist:all` to also build the Windows exe.)
2. GitHub → release repo → Releases → **Draft a new release**. Create a tag
   matching the app version, prefixed with `v` (version `0.3.2` → tag `v0.3.2`).
3. Drag-drop from `desktop/dist/` onto the release:
   - **Mac:** `latest-mac.yml`, `Founders Office-<version>-arm64-mac.zip`,
     `Founders Office-<version>-arm64.dmg` (+ their `.blockmap` files)
   - **Windows:** `latest.yml`, `Founders Office Setup <version>.exe`
     (+ its `.blockmap`)
4. **Publish**.
5. Done.

> The `.yml` feed files are required — they name the exact asset to download. A
> missing or mismatched file = update fails silently. Keep the `.yml` + `.zip`/
> `.exe` + `.blockmap` together.

**Version tag must match the app version.** On auto-publish (Option A),
electron-builder creates the tag `v{version}` for you. On manual (Option B), you
type it (`v0.3.2`).

---

## Not done here (by design)

Nothing was published, deployed, signed, or built by this doc. No keys or tokens
touched. Local prep only — reversible.
