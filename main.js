'use strict';

const { app, BrowserWindow, Menu, shell, powerSaveBlocker, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.OFFICE_PORT) || 4517;
const HOST = '127.0.0.1';
const URL = `http://${HOST}:${PORT}/`;

let serverProc = null;
let win = null;
let pendingUpdate = null; // { ready:true, version } once an update has downloaded
let weStartedServer = false;

// Resolve the bundled office server. In dev it lives next to this folder;
// packaged, electron-builder copies it into process.resourcesPath/fleet-office.
function serverDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'fleet-office');
  }
  return path.join(__dirname, '..', 'fleet-office');
}

// ---- PATH / claude resolution ----------------------------------------------
// When the .app is opened from Finder/Dock, macOS hands us a MINIMAL PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). The `claude` launcher (and often node/nvm)
// live in the user's SHELL PATH (~/.claude/local, /opt/homebrew/bin, npm global,
// nvm, ~/.local/bin). So spawn('claude') -> ENOENT -> the office can't start its
// team. We rebuild a rich PATH (login shell + common macOS locations) so the
// server we spawn — and every worker IT spawns, which inherit its env — can find
// `claude`. We also resolve claude's absolute path and pass it as CLAUDE_BIN so
// the server can spawn it directly as a belt-and-suspenders fallback.
// Computed once and cached — the login-shell probe is the slow part.
let _resolved = null;
function resolveShellPathAndClaude() {
  if (_resolved) return _resolved;
  return process.platform === 'win32'
    ? (_resolved = resolveWindows())
    : (_resolved = resolvePosix());
}

// ---- Windows resolution -----------------------------------------------------
// No login-shell trick on Windows: use `where claude` (cmd) and probe the
// user-level install locations the official installer writes to. `claude` on
// Windows is a .cmd/.exe/.ps1 shim, so probe those extensions too. PATH is
// joined with ";" (path.delimiter) here — never ":".
// A Windows claude target that child_process can spawn DIRECTLY. Node ≥20.12
// (Electron 31 → Node 20.18) throws EINVAL on `.cmd`/`.bat` shims, and `.ps1`
// needs PowerShell — so only a native `.exe` (or a bare, extension-less binary)
// is safe to hand straight to spawn(). We prefer these everywhere so the office —
// including the first `auth status` and the login button — actually runs.
function winDirectlySpawnable(p) {
  const ext = path.extname(p || '').toLowerCase();
  return ext === '.exe' || ext === '.com' || ext === '';
}
function resolveWindows() {
  const sep = path.delimiter; // ";" on win32
  const env = process.env;
  const home = env.USERPROFILE || os.homedir();
  let claudeBin = '';

  // 1. `where claude` — searches the current PATH for any matching executable.
  //    `where` can list several shims (claude.exe AND claude.cmd). Prefer a
  //    directly-spawnable native binary; only fall back to a shim if that's all
  //    there is (claude.js then routes the shim through a shell as a safety net).
  try {
    const r = spawnSync('cmd', ['/d', '/s', '/c', 'where claude'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    const out = (r && r.stdout) || '';
    const hits = out.split(/\r?\n/).map((l) => l.trim()).filter((t) => t && fs.existsSync(t));
    claudeBin = hits.find(winDirectlySpawnable) || hits[0] || '';
  } catch (_) {}

  // 2. Candidate install dirs the user-level installer writes to.
  const candidates = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    env.APPDATA ? path.join(env.APPDATA, 'npm') : '',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : '',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'claude') : '',
    env.ProgramFiles ? path.join(env.ProgramFiles, 'Claude') : '',
    env.ProgramFiles ? path.join(env.ProgramFiles, 'claude') : '',
  ].filter(Boolean);

  const seen = new Set();
  const parts = [];
  for (const p of [...(env.PATH || '').split(sep), ...candidates]) {
    const t = (p || '').trim();
    if (t && !seen.has(t)) { seen.add(t); parts.push(t); }
  }
  const PATH = parts.join(sep);

  // 3. Probe candidate dirs. Native `.exe` first so we spawn directly; a `.cmd`
  //    shim is only a last resort. Run this even when step 1 already found a shim,
  //    so a directly-spawnable binary in a known install dir wins over it.
  if (!claudeBin || !winDirectlySpawnable(claudeBin)) {
    const names = ['claude.exe', 'claude.com', 'claude', 'claude.cmd', 'claude.bat', 'claude.ps1'];
    outer:
    for (const name of names) {          // name-outer: a native .exe in ANY dir beats a .cmd elsewhere
      for (const dir of parts) {
        try {
          const cand = path.join(dir, name);
          if (fs.existsSync(cand)) { claudeBin = cand; break outer; }
        } catch (_) {}
      }
    }
  }

  return { PATH, claudeBin };
}

// ---- macOS / Linux resolution (unchanged behavior) --------------------------
function resolvePosix() {
  let shellPath = '';
  let claudeBin = '';
  // 1. Ask the user's real login shell for its PATH (and where claude is).
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const r = spawnSync(shell, ['-ilc', 'command -v claude; echo "PATH=$PATH"'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const out = (r && r.stdout) || '';
    for (const line of out.split('\n')) {
      if (line.startsWith('PATH=')) shellPath = line.slice(5).trim();
      else if (!claudeBin && line.trim() && line.includes('/')) claudeBin = line.trim();
    }
    // Validate: an interactive login shell can echo an rc banner line containing a
    // slash before the `command -v` output. Only trust it if it's a real file.
    if (claudeBin && !fs.existsSync(claudeBin)) claudeBin = '';
  } catch (_) {}

  // 2. Union: shell PATH + our own + common macOS locations.
  const home = os.homedir();
  const candidates = [
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  // nvm current, if resolvable (nvm/versions/node/<v>/bin).
  try {
    const nvmVers = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmVers)) {
      for (const v of fs.readdirSync(nvmVers)) candidates.push(path.join(nvmVers, v, 'bin'));
    }
  } catch (_) {}

  const seen = new Set();
  const parts = [];
  for (const p of [...shellPath.split(':'), ...(process.env.PATH || '').split(':'), ...candidates]) {
    const t = (p || '').trim();
    if (t && !seen.has(t)) { seen.add(t); parts.push(t); }
  }
  const PATH = parts.join(':');

  // 3. If the shell didn't tell us where claude is, scan the candidate dirs.
  if (!claudeBin) {
    for (const dir of parts) {
      try {
        const cand = path.join(dir, 'claude');
        if (fs.existsSync(cand)) { claudeBin = cand; break; }
      } catch (_) {}
    }
  }

  return { PATH, claudeBin };
}

// ---- Ensure Claude Code CLI is installed ------------------------------------
// First-run gate. If `claude` already resolves, this is a no-op (idempotent —
// the working Mac flow never triggers an install). If it's missing, run the
// OFFICIAL user-level installer (no admin/sudo), stream friendly progress to the
// loading window, then clear the memoized resolve cache and re-resolve.
//   win32:        powershell -c "irm https://claude.ai/install.ps1 | iex"
//   darwin/linux: bash -lc  "curl -fsSL https://claude.ai/install.sh | bash"
function ensureClaudeInstalled(onProgress) {
  return new Promise((resolve) => {
    // Already present AND directly spawnable? Nothing to do. On Windows a bare
    // `.cmd`/`.bat`/`.ps1` shim is NOT enough — Node 20.18 (Electron 31) can't spawn
    // it, so the office would boot but never see the signed-in account. In that case
    // fall through to the native installer, which drops a spawnable `claude.exe`.
    const pre = resolveShellPathAndClaude().claudeBin;
    if (pre && (process.platform !== 'win32' || winDirectlySpawnable(pre))) {
      resolve({ installed: true });
      return;
    }

    try { onProgress && onProgress('Setting up Claude Code… (one-time, ~1–2 min)'); } catch (_) {}

    const isWin = process.platform === 'win32';
    let cmd, args;
    if (isWin) {
      cmd = 'powershell';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        'irm https://claude.ai/install.ps1 | iex'];
    } else {
      cmd = 'bash';
      args = ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'];
    }

    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, env: { ...process.env } });
    } catch (e) {
      resolve({ installed: false, error: e.message });
      return;
    }

    let stderr = '';
    let done = false;
    const finish = (result) => { if (done) return; done = true; clearTimeout(watchdog); resolve(result); };

    // Watchdog: curl -fsSL / irm have no default connect timeout, so a stalled
    // network would hang the child forever and the boot() await would never
    // return. Kill it after 3 min and surface the retry screen.
    const watchdog = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish({ installed: false, error: 'Setup timed out — check your connection.' });
    }, 180000);

    try { child.stdout.on('data', (d) => process.stdout.write(`[claude-install] ${d}`)); } catch (_) {}
    try { child.stderr.on('data', (d) => { stderr += d; process.stderr.write(`[claude-install:err] ${d}`); }); } catch (_) {}

    child.on('error', (e) => finish({ installed: false, error: e.message }));
    child.on('exit', (code) => {
      // Re-resolve from scratch: the installer just wrote a new binary.
      _resolved = null;
      const { claudeBin } = resolveShellPathAndClaude();
      if (claudeBin) finish({ installed: true });
      else finish({ installed: false, error: `installer exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}` });
    });
  });
}

// ---- Codex (OpenAI) CLI resolution + install --------------------------------
// The office's SECOND engine. Pinned EXACT version per app release — codex ships
// near-daily and the engine adapter (fleet-office/lib/engine/codex.js) is written
// against this surface. Install is a plain npm GLOBAL (needs Node ≥22), identical
// command on mac/win/linux. codex.js spawns `process.env.CODEX_BIN || 'codex'`, so
// we resolve the absolute bin and pass CODEX_BIN (mirrors CLAUDE_BIN).
const CODEX_PIN = '0.153.4';

// App-managed, user-writable dir for the standalone Codex binary (no npm/Node, no sudo).
// Mirrors vercelInstallDir — survives app updates, shared with the office server + codex.js
// (lib/codex-install.js uses the IDENTICAL path, so a server-side on-demand install and this
// wrapper resolve the same binary).
function codexManagedDir() { return path.join(os.homedir(), '.claude', 'local', 'office-codex', 'bin'); }
function codexManagedBin() { return path.join(codexManagedDir(), process.platform === 'win32' ? 'codex.exe' : 'codex'); }

// Absolute `codex`: our app-managed standalone install WINS (works on a no-npm/no-Node Mac),
// else scan the enriched PATH (npm-global drops it there). '' if nowhere — the server then
// provisions on demand or reports needs-install honestly.
function resolveCodexBin() {
  try { const ours = codexManagedBin(); if (fs.existsSync(ours)) return ours; } catch (_) {}
  const { PATH } = resolveShellPathAndClaude();
  const names = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'];
  for (const dir of (PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) { try { const c = path.join(dir, n); if (fs.existsSync(c)) return c; } catch (_) {} }
  }
  return '';
}

// GitHub release asset for this platform/arch (standalone Codex binary). '' if unsupported.
function codexAssetName() {
  const p = process.platform, a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'codex-aarch64-apple-darwin.tar.gz' : 'codex-x86_64-apple-darwin.tar.gz';
  if (p === 'linux') return a === 'arm64' ? 'codex-aarch64-unknown-linux-gnu.tar.gz' : 'codex-x86_64-unknown-linux-gnu.tar.gz';
  if (p === 'win32') return a === 'arm64' ? 'codex-aarch64-pc-windows-msvc.exe' : 'codex-x86_64-pc-windows-msvc.exe';
  return '';
}

// Download the pinned STANDALONE Codex binary (no npm, no Node) into our managed dir,
// extract, mark executable, and clear the macOS Gatekeeper quarantine. Electron's main
// process has global fetch (follows redirects); tar ships on macOS/Linux and Win10+.
async function downloadCodexBinary(onProgress) {
  const asset = codexAssetName();
  if (!asset) return { ok: false, error: `Codex isn't available for ${process.platform}/${process.arch}.` };
  const dir = codexManagedDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { ok: false, error: e.message }; }
  const finalBin = codexManagedBin();
  const urlStr = `https://github.com/openai/codex/releases/download/rust-v${CODEX_PIN}/${asset}`;
  try {
    onProgress && onProgress('Downloading the ChatGPT image engine… (one-time, ~90 MB)');
    const res = await fetch(urlStr, { redirect: 'follow' });
    if (!res || !res.ok) return { ok: false, error: `download HTTP ${res && res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length < 1000000) return { ok: false, error: 'download incomplete' };
    if (process.platform === 'win32') {
      fs.writeFileSync(finalBin, buf);
    } else {
      const tgz = path.join(dir, 'codex-dl.tar.gz');
      fs.writeFileSync(tgz, buf);
      const r = spawnSync('tar', ['xzf', tgz, '-C', dir], { encoding: 'utf8', timeout: 120000 });
      if (!r || r.status !== 0) return { ok: false, error: 'extract failed: ' + ((r && r.stderr) || '').slice(-200) };
      const extracted = path.join(dir, asset.replace(/\.tar\.gz$/, ''));
      try { if (fs.existsSync(extracted)) fs.renameSync(extracted, finalBin); } catch (e) { return { ok: false, error: 'rename failed: ' + e.message }; }
      try { fs.unlinkSync(tgz); } catch (_) {}
    }
    try { fs.chmodSync(finalBin, 0o755); } catch (_) {}
    if (process.platform === 'darwin') { try { spawnSync('xattr', ['-dr', 'com.apple.quarantine', finalBin], { timeout: 8000 }); } catch (_) {} }
    return { ok: true, bin: finalBin };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Installed codex version as a [major,minor,patch] triple, or null if it can't be
// read. Windows: a `.cmd`/`.bat` shim can't be spawned directly (Node 20.18 EINVAL),
// so route it through the shell; `.ps1` through PowerShell — same rule as claude.js.
function detectCodexVersion(bin) {
  if (!bin) return null;
  const isWin = process.platform === 'win32';
  const ext = path.extname(bin).toLowerCase();
  try {
    let r;
    if (isWin && ext === '.ps1') {
      r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bin, '--version'],
        { encoding: 'utf8', timeout: 8000, windowsHide: true, env: childEnv({}) });
    } else {
      const useShell = isWin && (ext === '.cmd' || ext === '.bat');
      r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true, env: childEnv({}), shell: useShell });
    }
    const out = ((r && r.stdout) || '') + ((r && r.stderr) || '');
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  } catch (_) { return null; }
}
const CODEX_PIN_TRIPLE = CODEX_PIN.split('.').map(Number);
function semverLt(a, b) { for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); } return false; }
// codex present AND at least the pinned version the current model needs? An older
// install (or one we can't read a version from) counts as stale → force an upgrade.
// This is the fix for "the 'gpt-5.6-terra' model requires a newer version of Codex":
// the old check only asked "does codex exist?" and never upgraded a too-old CLI.
function codexUpToDate() {
  const bin = resolveCodexBin();
  if (!bin) return false;
  const v = detectCodexVersion(bin);
  if (!v) return false;
  return !semverLt(v, CODEX_PIN_TRIPLE);
}

// Find `node` on the enriched PATH and return its major version (0 if unknown).
function detectNodeMajor() {
  const { PATH } = resolveShellPathAndClaude();
  const isWin = process.platform === 'win32';
  const nodeName = isWin ? 'node.exe' : 'node';
  for (const p of (PATH || '').split(path.delimiter)) {
    if (!p) continue;
    try {
      const c = path.join(p, nodeName);
      if (fs.existsSync(c)) {
        const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 5000 });
        const m = (r && r.stdout || '').match(/v?(\d+)\./);
        if (m) return Number(m[1]);
      }
    } catch (_) {}
  }
  return 0;
}

// First-run gate for the Codex engine. Mirrors ensureClaudeInstalled: idempotent
// (no-op if `codex` already resolves), honest failures (no npm/Node, Node too old,
// network) surface the retry UI, never silent. Install = `npm install -g
// @openai/codex@<PIN>` — same command on every OS.
function ensureCodexInstalled(onProgress) {
  return new Promise((resolve) => {
    // Up to date? Nothing to do. A codex that merely EXISTS is not enough — if it's
    // older than the pinned version the model needs, fall through and upgrade it.
    if (codexUpToDate()) { resolve({ installed: true }); return; }

    // Need npm (Electron bundles Node but not npm) and Node ≥22 to install codex.
    const { PATH } = resolveShellPathAndClaude();
    const isWin = process.platform === 'win32';
    const npmName = isWin ? 'npm.cmd' : 'npm';
    let npmBin = '';
    for (const p of (PATH || '').split(path.delimiter)) {
      if (!p) continue;
      try { const c = path.join(p, npmName); if (fs.existsSync(c)) { npmBin = c; break; } } catch (_) {}
    }
    if (!npmBin) { resolve({ installed: false, error: 'Node/npm not found — install Node 22+ then reopen.' }); return; }
    const major = detectNodeMajor();
    if (major && major < 22) { resolve({ installed: false, error: `Node ${major} is too old — the OpenAI engine needs Node 22+.` }); return; }

    try { onProgress && onProgress('Setting up your engine… (one-time, ~1–2 min)'); } catch (_) {}

    let child;
    try {
      child = spawn(npmBin, ['install', '-g', `@openai/codex@${CODEX_PIN}`, '--no-audit', '--no-fund', '--loglevel', 'error'],
        { windowsHide: true, env: childEnv({}) });
    } catch (e) { resolve({ installed: false, error: e.message }); return; }

    let stderr = '';
    let done = false;
    const finish = (result) => { if (done) return; done = true; clearTimeout(watchdog); resolve(result); };
    const watchdog = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish({ installed: false, error: 'Setup timed out — check your connection.' });
    }, 180000);

    try { child.stdout.on('data', (d) => process.stdout.write(`[codex-install] ${d}`)); } catch (_) {}
    try { child.stderr.on('data', (d) => { stderr += d; process.stderr.write(`[codex-install:err] ${d}`); }); } catch (_) {}
    child.on('error', (e) => finish({ installed: false, error: e.message }));
    child.on('exit', (code) => {
      _resolved = null; // installer wrote a new global bin — re-resolve PATH
      if (resolveCodexBin()) finish({ installed: true });
      else finish({ installed: false, error: `installer exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}` });
    });
  });
}

// ---- Engine choice (drives which CLI the wrapper installs) -------------------
// The chosen engine is persisted by the office server in ~/.founders-office/config.json
// (`engine` key: "claude" | "codex"). We read it RAW here — the server owns writing it
// (chooser SCREEN-1 + the existing-user rollout that maps prior installs to claude).
//   • "codex"  → install/attach the OpenAI engine.
//   • "claude" → install/attach Claude Code (existing users; byte-identical to before).
//   • absent   → fresh install, no choice yet: default to Claude (the shipped default),
//                exactly as this wrapper always has. Codex is NEVER installed unless the
//                founder has explicitly chosen it — nothing OpenAI-specific ships or runs
//                until then. (config.json is per-user, never bundled — see extraResources.)
function readEngineChoice() {
  try {
    const cfg = path.join(os.homedir(), '.founders-office', 'config.json');
    const raw = fs.readFileSync(cfg, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.engine === 'codex' || parsed.engine === 'claude')) return parsed.engine;
  } catch (_) {}
  return null; // no valid choice yet
}

// Boot gate: ensure the CHOSEN engine's CLI is present. Returns the same
// { installed, error } shape as the per-engine installers so boot() is engine-agnostic.
// `label` is a founder-facing engine name for the OS-window retry screen copy.
function ensureEngineInstalled(onProgress) {
  const engine = readEngineChoice();
  if (engine === 'codex') {
    return ensureCodexInstalled(onProgress).then((r) => ({ ...r, engine: 'codex', label: 'the OpenAI engine' }));
  }
  // claude, or fresh/unchosen → Claude default (byte-identical to the original flow).
  return ensureClaudeInstalled(onProgress).then((r) => ({ ...r, engine: 'claude', label: 'Claude Code' }));
}

// ---- Vercel CLI (deploy) resolution -----------------------------------------
// Same "opened from Finder = minimal PATH" problem as claude, plus: on a fresh Mac
// the `vercel` npm CLI may not be installed at all. We install it into an
// APP-MANAGED, user-writable dir (no sudo, no global npm prefix) and resolve its
// absolute bin so the server can spawn it directly (mirrors CLAUDE_BIN). The dir is
// DETERMINISTIC and shared with server.js so a background install that finishes AFTER
// the server booted is still picked up on the next vercel call — no restart needed.
function vercelInstallDir() {
  // ~/.claude/local/office-vercel — user-writable, no elevation, survives app updates.
  return path.join(os.homedir(), '.claude', 'local', 'office-vercel');
}
function vercelBinPath() {
  // `npm install vercel --prefix <dir>` drops the launcher in <dir>/node_modules/.bin.
  const name = process.platform === 'win32' ? 'vercel.cmd' : 'vercel';
  return path.join(vercelInstallDir(), 'node_modules', '.bin', name);
}
// Absolute `vercel` if we can find one: our managed install first, else scan the
// enriched PATH. '' if nowhere (server then degrades to the "not installed" flow).
function resolveVercelBin() {
  try { const ours = vercelBinPath(); if (fs.existsSync(ours)) return ours; } catch (_) {}
  const { PATH } = resolveShellPathAndClaude();
  const names = process.platform === 'win32' ? ['vercel.cmd', 'vercel.exe', 'vercel'] : ['vercel'];
  for (const dir of (PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) { try { const c = path.join(dir, n); if (fs.existsSync(c)) return c; } catch (_) {} }
  }
  return '';
}

// Env for any child we spawn: enriched PATH + CLAUDE_BIN so `claude` is findable,
// plus VERCEL_BIN + the vercel bin dir on PATH so the deploy flow (and agent-driven
// `vercel` spawns that inherit this env) resolve our managed install.
function childEnv(extra) {
  const { PATH, claudeBin } = resolveShellPathAndClaude();
  let fullPath = PATH;
  const vercelBin = resolveVercelBin();
  if (vercelBin) {
    const vdir = path.dirname(vercelBin);
    if (!(PATH || '').split(path.delimiter).includes(vdir)) fullPath = vdir + path.delimiter + PATH;
  }
  const env = { ...process.env, PATH: fullPath };
  if (claudeBin) env.CLAUDE_BIN = claudeBin;
  if (vercelBin) env.VERCEL_BIN = vercelBin;
  // codex.js spawns process.env.CODEX_BIN || 'codex' — hand it the resolved absolute
  // bin so the OpenAI engine is findable from the Finder-launched (minimal-PATH) app.
  const codexBin = resolveCodexBin();
  if (codexBin) env.CODEX_BIN = codexBin;
  return { ...env, ...(extra || {}) };
}

// ---- First-run Vercel CLI provisioning --------------------------------------
// Ensure the `vercel` CLI exists so the deploy flow leaves ONLY login for the user.
// IDEMPOTENT: skip if vercel already resolves (PATH or our managed install) or the
// version marker matches. NON-BLOCKING: spawns npm in the background and returns
// immediately — never delays or breaks boot. NO SUDO: `npm install --prefix <userDir>`
// is a plain local install into a writable dir (no -g, no global prefix, no password).
// Everything is wrapped/best-effort; failure just leaves the current "not installed"
// messaging intact. Verifies `vercel --version` runs before writing the marker.
function seedVercelCli() {
  try {
    if (resolveVercelBin()) return; // already available anywhere → nothing to do
    const claudeDir = path.join(os.homedir(), '.claude');
    const marker = path.join(claudeDir, '.nimish-office-vercel.json');
    const version = app.getVersion();
    try { const m = JSON.parse(fs.readFileSync(marker, 'utf8')); if (m && m.version === version) return; } catch (_) {}

    const dir = vercelInstallDir();
    fs.mkdirSync(dir, { recursive: true });

    // Electron bundles Node but NOT npm — find the user's npm on the enriched PATH.
    const { PATH } = resolveShellPathAndClaude();
    const isWin = process.platform === 'win32';
    const npmName = isWin ? 'npm.cmd' : 'npm';
    let npmBin = '';
    for (const p of (PATH || '').split(path.delimiter)) {
      if (!p) continue;
      try { const c = path.join(p, npmName); if (fs.existsSync(c)) { npmBin = c; break; } } catch (_) {}
    }
    if (!npmBin) { console.warn('[seed-vercel] npm not found on PATH — skipping (deploy stays "not installed").'); return; }

    console.log('[seed-vercel] installing vercel CLI in the background…');
    const child = spawn(npmBin, ['install', 'vercel', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel', 'error'],
      { env: childEnv({}), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { child.stdout.on('data', (d) => process.stdout.write(`[seed-vercel] ${d}`)); } catch (_) {}
    try { child.stderr.on('data', (d) => process.stderr.write(`[seed-vercel:err] ${d}`)); } catch (_) {}
    child.on('error', (e) => console.warn(`[seed-vercel] install failed (app still runs): ${e && e.message}`));
    child.on('exit', (code) => {
      const bin = vercelBinPath();
      if (code === 0 && fs.existsSync(bin)) {
        // VERIFY the claim: the installed launcher must actually run.
        let ok = false;
        try { const r = spawnSync(bin, ['--version'], { timeout: 15000, encoding: 'utf8', env: childEnv({}) }); ok = r.status === 0; } catch (_) {}
        if (ok) {
          try { fs.writeFileSync(marker, JSON.stringify({ version, at: new Date().toISOString(), bin })); } catch (_) {}
          console.log('[seed-vercel] vercel CLI ready — only login left for the user.');
        } else {
          console.warn('[seed-vercel] installed but `vercel --version` did not run — leaving for retry next launch.');
        }
      } else {
        console.warn(`[seed-vercel] npm exited ${code} (app still runs; deploy stays "not installed").`);
      }
    });
  } catch (e) {
    console.warn(`[seed-vercel] failed (app still boots): ${e && e.message}`);
  }
}

// ---- First-run ENGINE RUNTIME provisioning ----------------------------------
// FOUNDER DECISION (2026-09-22): the ~1.1 GB gstack runtime (browse binary + bun
// + Chromium) is NOT bundled — it is fetched ONCE here on first launch so the DMG
// stays small. The needs-engine skills' markdown already shipped via seedSkills();
// this makes them actually EXECUTE. NON-BLOCKING + best-effort: runs in the
// background, never delays boot, never breaks the 38 ships-as-is skills. Idempotent
// (installEngineRuntime skips a matching install) and self-retrying (a failed
// attempt writes a "retry" status and simply runs again next launch). Progress and
// failure are surfaced via ~/.claude/.fleet-engine-status.json for the UI to poll.
function seedEngineRuntime() {
  try {
    const dir = serverDir();
    const modPath = path.join(dir, 'lib', 'install-skills.js');
    if (!fs.existsSync(modPath)) { console.warn('[seed-engine] install-skills.js not found — skipping.'); return; }
    const { installEngineRuntime, engineRuntimeStatus } = require(modPath);
    if (engineRuntimeStatus().installed) { console.log('[seed-engine] runtime already present.'); return; }

    // Run in a detached child so the multi-minute Chromium download never blocks the
    // UI thread. We invoke the installer via Electron's own Node (ELECTRON_RUN_AS_NODE)
    // with an inline bootstrap that hands git/bun an enriched PATH.
    console.log('[seed-engine] setting up advanced tools in the background…');
    const boot =
      "const m=require(process.argv[1]);" +
      "m.installEngineRuntime({onProgress:(msg,pct)=>console.log('[seed-engine] '+(pct||0)+'% '+msg)})" +
      ".then(r=>{console.log('[seed-engine] result '+JSON.stringify(r));process.exit(r&&r.ok?0:1);})" +
      ".catch(e=>{console.warn('[seed-engine] '+(e&&e.message));process.exit(1);});";
    const child = spawn(process.execPath, ['-e', boot, modPath], {
      cwd: dir,
      env: childEnv({ ELECTRON_RUN_AS_NODE: '1' }),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try { child.stdout.on('data', (d) => process.stdout.write(`[seed-engine] ${d}`)); } catch (_) {}
    try { child.stderr.on('data', (d) => process.stderr.write(`[seed-engine:err] ${d}`)); } catch (_) {}
    child.on('error', (e) => console.warn(`[seed-engine] failed (app still runs): ${e && e.message}`));
    child.on('exit', (code) => console.log(`[seed-engine] exited ${code} (retries next launch if it failed).`));
  } catch (e) {
    console.warn(`[seed-engine] failed (app still boots): ${e && e.message}`);
  }
}

// TCP probe: is something already listening on PORT?
function portListening() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port: PORT });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(700);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

// HTTP probe: does the office actually answer?
function httpReady() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      res.resume();
      resolve(res.statusCode > 0);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
  });
}

// ---- First-run skill seeding ------------------------------------------------
// The DMG is drag-to-Applications; it never runs install.sh, so on a fresh Mac
// NO skills would exist. We seed them here on first launch (and after a version
// bump). Idempotent: a version marker in ~/.claude means normal launches skip it.
//   1. Copy bundled capability skills (resourcesPath/skills) -> ~/.claude/skills
//      (copy if missing; if it exists, back it up once then update — like install.sh).
//   2. Run generate-skills.js so the staff-role skills exist, backing up any
//      pre-existing role dir first.
// Everything is best-effort and wrapped: seeding must NEVER stop the app booting.
function seedSkills() {
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    const skillsDir = path.join(claudeDir, 'skills');
    const marker = path.join(claudeDir, '.nimish-office-seed.json');
    const version = app.getVersion();

    // Already seeded for this version? Skip — keeps normal launches instant.
    try {
      const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (m && m.version === version) return;
    } catch (_) {}

    const dir = serverDir();
    const bundled = app.isPackaged
      ? path.join(process.resourcesPath, 'skills')
      : path.join(__dirname, 'skills-bundle');

    fs.mkdirSync(skillsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(claudeDir, `skills-backup-${ts}`);

    // 1. Capability skills.
    let added = 0, updated = 0;
    if (fs.existsSync(bundled)) {
      for (const name of fs.readdirSync(bundled)) {
        const from = path.join(bundled, name);
        try {
          if (!fs.statSync(from).isDirectory()) continue;
          const to = path.join(skillsDir, name);
          if (fs.existsSync(to)) {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.cpSync(to, path.join(backupDir, name), { recursive: true });
            fs.rmSync(to, { recursive: true, force: true });
            updated++;
          } else {
            added++;
          }
          fs.cpSync(from, to, { recursive: true });
        } catch (e) {
          console.warn(`[seed] skill ${name} skipped: ${e.message}`);
        }
      }
    } else {
      console.warn(`[seed] no bundled skills at ${bundled}`);
    }

    // 2. Staff-role skills — back up any existing role dir, then regenerate
    //    from the shipped founders.js so they always match this build.
    try {
      const foundersPath = path.join(dir, 'founders.js');
      const genPath = path.join(dir, 'generate-skills.js');
      if (fs.existsSync(foundersPath) && fs.existsSync(genPath)) {
        const roles = Object.keys(require(foundersPath).FOUNDER_ROLES || {});
        for (const role of roles) {
          const to = path.join(skillsDir, role);
          if (fs.existsSync(to)) {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.cpSync(to, path.join(backupDir, role), { recursive: true });
          }
        }
        const r = spawnSync(process.execPath, [genPath], {
          cwd: dir,
          env: childEnv({ ELECTRON_RUN_AS_NODE: '1' }),
          stdio: 'ignore',
        });
        if (r.status !== 0) console.warn('[seed] generate-skills exited nonzero');
      }
    } catch (e) {
      console.warn(`[seed] staff roles skipped: ${e.message}`);
    }

    fs.writeFileSync(marker, JSON.stringify({ version, at: ts }));
    console.log(`[seed] skills ready (added=${added} updated=${updated}).`);
  } catch (e) {
    console.warn(`[seed] failed (app still boots): ${e.message}`);
  }
}

// ── Results Gate: HTML render bridge ──────────────────────────────────────
// The server runs as ELECTRON_RUN_AS_NODE (plain Node — no BrowserWindow), so the
// Results Gate's HTML check can't open a window itself. This tiny loopback HTTP server,
// living in Electron MAIN, renders a local HTML file in a hidden offscreen window and
// returns its console errors + broken images. The server reaches it via GATE_RENDER_URL.
let renderBridge = null, renderBridgePort = 0;
function startRenderBridge() {
  if (renderBridge) return Promise.resolve(renderBridgePort);
  return new Promise((resolve) => {
    renderBridge = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        let filePath = '';
        try { filePath = String((JSON.parse(body || '{}') || {}).filePath || ''); } catch { /* */ }
        const out = { consoleErrors: [], brokenImages: [] };
        if (!filePath) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); return; }
        let w = null;
        const done = (payload) => { try { if (w) w.destroy(); } catch (_) {} res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
        try {
          w = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: true, sandbox: true, contextIsolation: true } });
          w.webContents.on('console-message', (_e, level, message) => { if (level >= 2) out.consoleErrors.push(String(message)); });
          w.webContents.on('render-process-gone', (_e, d) => out.consoleErrors.push('render-gone: ' + (d && d.reason)));
          const guard = setTimeout(() => done(out), 15000);
          await w.loadFile(filePath);
          try {
            const broken = await w.webContents.executeJavaScript(
              'Array.from(document.images).filter(function(i){return !i.complete||i.naturalWidth===0;}).map(function(i){return i.currentSrc||i.src;})'
            );
            if (Array.isArray(broken)) out.brokenImages = broken;
          } catch (_) { /* no images / eval blocked */ }
          clearTimeout(guard); done(out);
        } catch (e) { out.consoleErrors.push('load-failed: ' + (e && e.message || e)); done(out); }
      });
    });
    renderBridge.listen(0, '127.0.0.1', () => {
      renderBridgePort = renderBridge.address().port;
      console.log('[office] gate render bridge on 127.0.0.1:' + renderBridgePort);
      resolve(renderBridgePort);
    });
    renderBridge.on('error', () => resolve(0));
  });
}

function startServer() {
  const dir = serverDir();
  const serverPath = path.join(dir, 'server.js');
  // Run server.js with Electron's OWN bundled Node — no system Node needed.
  serverProc = spawn(process.execPath, [serverPath], {
    cwd: dir,
    env: childEnv({
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      GATE_RENDER_URL: renderBridgePort ? ('http://127.0.0.1:' + renderBridgePort + '/render') : '',
      // Authoritative app version (from desktop/package.json via electron-builder) so the
      // office header shows the REAL shipped version and never drifts from the installed app.
      ANTRIA_APP_VERSION: app.getVersion(),
      // Live "Team Work" box: turn the activity feature ON in the packaged app (the flag
      // defaults OFF in code so tests can assert flag-off behavior). Override with FO_ACTIVITY=0.
      FO_ACTIVITY: process.env.FO_ACTIVITY || '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  weStartedServer = true;
  serverProc.stdout.on('data', (d) => process.stdout.write(`[office] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[office:err] ${d}`));
  serverProc.on('exit', (code, sig) => {
    console.log(`[office] exited code=${code} sig=${sig}`);
    serverProc = null;
  });
}

async function waitForReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpReady()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function loadingHtml(msg) {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:#F0EEE6;color:#2B2A27}
  .box{text-align:center}
  .dot{width:14px;height:14px;border-radius:50%;background:#CC785C;
    display:inline-block;animation:p 1s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
  h1{font-size:17px;font-weight:600;margin:18px 0 4px}
  p{font-size:13px;color:#6B6A65;margin:0}
</style></head><body><div class="box">
  <div class="dot"></div>
  <h1>Starting the office…</h1>
  <p>${msg || 'Waking up your team.'}</p>
</div></body></html>`)
  );
}

function createWindow() {
  // Reuse an existing window (e.g. retry-boot after an install failure) instead
  // of orphaning it and stacking a new one on every "Try again".
  if (win && !win.isDestroyed()) {
    win.loadURL(loadingHtml());
    return;
  }
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Antria',
    backgroundColor: '#F0EEE6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setTitle('Antria');
  win.loadURL(loadingHtml());

  // Right-click menu with Cut/Copy/Paste, so clipboard works by mouse too
  // (not just keyboard). Paste/Select-All show whenever a text field is focused.
  win.webContents.on('context-menu', (_e, params) => {
    const canEdit = params.isEditable;
    const hasText = params.selectionText && params.selectionText.trim().length > 0;
    const items = [];
    if (canEdit) items.push({ role: 'cut', enabled: hasText });
    if (canEdit || hasText) items.push({ role: 'copy', enabled: hasText });
    if (canEdit) items.push({ role: 'paste' });
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Open target=_blank / external links in the system browser, not new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.on('closed', () => {
    win = null;
  });
}

function installRetryHtml(detail, engineLabel) {
  const label = engineLabel || 'Claude Code';
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:#F0EEE6;color:#2B2A27}
  .box{text-align:center;max-width:420px;padding:0 24px}
  h1{font-size:17px;font-weight:600;margin:0 0 8px}
  p{font-size:13px;color:#6B6A65;margin:0 0 16px;line-height:1.5}
  a.btn{display:inline-block;background:#CC785C;color:#fff;text-decoration:none;
    font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px;margin:0 6px}
  a.link{color:#6B6A65;font-size:12px}
</style></head><body><div class="box">
  <h1>Couldn't set up ${label}</h1>
  <p>Your team runs on ${label} and we couldn't install it automatically.${detail ? ' ' + detail : ''}</p>
  <p><a class="btn" href="#" onclick="try{window.nimishOffice.retryBoot()}catch(e){location.reload()};return false;">Try again</a></p>
  <p><a class="link" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Install it manually →</a></p>
</div></body></html>`)
  );
}

async function boot() {
  createWindow();

  const already = await portListening();
  if (!already) {
    // GATE: the team can only start once the CHOSEN engine's CLI is present. Which
    // engine is read from ~/.founders-office/config.json (claude|codex; absent →
    // Claude default). Existing users = Claude (unchanged). On a fresh machine (esp.
    // Windows) this installs it first, showing progress. Codex is only ever installed
    // when the founder has explicitly chosen the OpenAI engine.
    const res = await ensureEngineInstalled((msg) => {
      try { if (win) win.loadURL(loadingHtml(msg)); } catch (_) {}
    });
    if (!win) return;
    if (!res.installed) {
      console.warn(`[${res.engine || 'engine'}-install] not installed: ${res.error || 'unknown'}`);
      win.loadURL(installRetryHtml('You can retry, or install it manually — then reopen.', res.label || 'Claude Code'));
      return;
    }
    seedSkills();
    seedVercelCli();     // background, non-blocking — provisions the deploy CLI (login-only left)
    seedEngineRuntime(); // background, non-blocking — fetches gstack runtime (bun+Chromium) once
    try { await startRenderBridge(); } catch (_) { /* gate HTML check degrades to amber without it */ }
    startServer();
  } else {
    console.log('[office] port 4517 already in use — attaching to existing office.');
  }

  const ok = await waitForReady();
  if (!win) return;
  if (ok) {
    win.loadURL(URL);
  } else {
    win.loadURL(
      loadingHtml('The office did not start in time. Check the logs, then quit and reopen.')
    );
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: 'Antria',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    // Edit menu — REQUIRED for Cmd+C / Cmd+V / Cmd+X / Cmd+A to work in text
    // fields. Without these role items present, macOS does not deliver the
    // standard clipboard shortcuts to the app's inputs.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Auto-update (electron-updater, generic/static feed) --------------------
// Checks the feed set in package.json build.publish (provider "generic").
// electron-builder emits latest-mac.yml / latest.yml + the .zip/.dmg/.exe;
// upload those to that host and every installed app self-updates on next launch.
// checkForUpdatesAndNotify: downloads in the background, shows a native
// notification when ready, and installs the update on quit. Safe no-op in dev
// (app.isPackaged false) and if the feed/artifacts are unreachable.
function setupAutoUpdate() {
  if (!app.isPackaged) {
    console.log('[update] skipped (dev / not packaged).');
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // install the downloaded update on quit
  autoUpdater.on('checking-for-update', () => console.log('[update] checking…'));
  autoUpdater.on('update-available', (i) => console.log(`[update] available: ${i && i.version}`));
  autoUpdater.on('update-not-available', () => console.log('[update] none — up to date.'));
  autoUpdater.on('download-progress', (p) =>
    console.log(`[update] downloading ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (i) => {
    // A new version is downloaded and ready. Remember it (in case the UI mounts
    // later) and light up the "Relaunch to update" card in the sidebar.
    pendingUpdate = { ready: true, version: (i && i.version) || null };
    console.log(`[update] downloaded ${pendingUpdate.version} — ready to relaunch.`);
    try { if (win && win.webContents) win.webContents.send('update-ready', pendingUpdate); } catch (_) {}
  });
  autoUpdater.on('error', (e) => console.warn(`[update] error: ${e && e.message}`));
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.warn(`[update] check failed (app still runs): ${e && e.message}`);
  }
}

function killServer() {
  if (serverProc && weStartedServer) {
    const pid = serverProc.pid;
    // Only runs on a REAL quit (before-quit/quit/exit) — NOT on window-close, which on
    // macOS deliberately keeps the engine + tasks running in the background.
    //
    // ROOT CAUSE of "update downloads but won't install": the engine runs from our OWN
    // bundle (…/MacOS/Founders Office executing fleet-office/server.js via RUN_AS_NODE),
    // so the macOS updater (Squirrel/ShipIt) counts it as "the app still running" and
    // ABORTS with SQRLInstallerErrorDomain Code=-9. A plain SIGTERM let the engine linger
    // past the installer's check. So: ask it to stop GRACEFULLY first (it flushes task
    // state; long tasks are detached and survive regardless), wait briefly, and only
    // force-kill if it's still alive — then confirm the pid is gone so the app never
    // hands off to the installer while a bundle process is still running.
    const spin = new Int32Array(new SharedArrayBuffer(4));
    const gone = () => { if (!pid) return true; try { process.kill(pid, 0); return false; } catch (_) { return true; } };
    const waitFor = (ms) => { const end = Date.now() + ms; while (Date.now() < end && !gone()) { try { Atomics.wait(spin, 0, 0, 50); } catch (_) {} } };
    try { serverProc.kill('SIGTERM'); } catch (_) {}
    waitFor(1200);                                   // graceful window
    if (!gone()) { try { serverProc.kill('SIGKILL'); } catch (_) {} waitFor(1500); } // force if stubborn
    serverProc = null;
  }
}

// ---- Keep-awake while tasks are running -------------------------------------
// ROOT CAUSE: long-running tasks were dying because (a) closing the window on
// macOS killed the background engine, and (b) the Mac going to sleep suspended
// the app mid-task. This poller asks the server every 30s whether any tasks are
// active (GET /api/office -> counts.active) and, if so, holds a
// powerSaveBlocker('prevent-app-suspension') so macOS won't sleep the app while
// work is in flight. It releases the blocker as soon as nothing is active.
// Everything is wrapped in try/catch and tolerates the server being down —
// kept error-safe in the same spirit as setupAutoUpdate.
let powerBlockerId = null; // powerSaveBlocker id when active, else null

function setupKeepAwake() {
  try {
    setInterval(() => {
      try {
        const req = http.get(
          { host: HOST, port: PORT, path: '/api/office', timeout: 5000 },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              try {
                const active =
                  (JSON.parse(body).counts || {}).active || 0;
                const blocking =
                  powerBlockerId !== null &&
                  powerSaveBlocker.isStarted(powerBlockerId);
                if (active > 0 && !blocking) {
                  powerBlockerId = powerSaveBlocker.start(
                    'prevent-app-suspension'
                  );
                  console.log('[keepawake] tasks active — preventing sleep.');
                } else if (active === 0 && blocking) {
                  powerSaveBlocker.stop(powerBlockerId);
                  powerBlockerId = null;
                  console.log('[keepawake] idle — sleep allowed.');
                }
              } catch (_) {} // bad/empty JSON: leave state as-is
            });
          }
        );
        req.on('error', () => {}); // server down: ignore, retry next tick
        req.on('timeout', () => req.destroy());
      } catch (_) {}
    }, 30000);
  } catch (e) {
    console.warn(`[keepawake] setup failed (app still runs): ${e && e.message}`);
  }
}

// IPC for the sidebar "Relaunch to update" card (registered once, safe in dev too).
ipcMain.handle('get-update-state', () => pendingUpdate || { ready: false });
ipcMain.on('retry-boot', () => {
  try {
    if (win) win.loadURL(loadingHtml('Retrying setup…'));
    boot();
  } catch (e) {
    console.warn(`[claude-install] retry failed: ${e && e.message}`);
  }
});
ipcMain.on('quit-and-install', () => {
  try {
    // Force the install+relaunch now, regardless of the quit-time default.
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    console.warn(`[update] quitAndInstall failed: ${e && e.message}`);
  }
});
// One-click engine-switch restart. The office frontend (doOneClickRestart) calls the
// injected hook window.nimishOffice.relaunchApp() after /api/app/restart returns
// mode:'electron'; we own the process lifecycle, so relaunch the whole app. killServer
// runs on the ensuing quit (before-quit/quit), stopping the bundled engine cleanly, and
// the fresh boot() re-reads config.json → installs/attaches the newly-chosen engine.
ipcMain.on('relaunch-app', () => {
  try {
    app.relaunch();
    app.exit(0);
  } catch (e) {
    console.warn(`[relaunch] failed: ${e && e.message}`);
  }
});

app.whenReady().then(() => {
  buildMenu();
  boot();
  setupAutoUpdate();
  setupKeepAwake();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
});

app.on('window-all-closed', () => {
  // ROOT CAUSE: on macOS, closing the window (red-X / Cmd-W) used to killServer,
  // silently killing the background engine and any in-flight long task while the
  // app stayed in the Dock. Keep the engine + tasks running on darwin; the server
  // is only stopped on a REAL quit (before-quit/quit/exit below, e.g. Cmd-Q).
  if (process.platform !== 'darwin') {
    killServer();
    app.quit();
  }
});

app.on('before-quit', killServer);
app.on('quit', killServer);
process.on('exit', killServer);
