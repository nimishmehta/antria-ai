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
function resolveWindows() {
  const sep = path.delimiter; // ";" on win32
  const env = process.env;
  const home = env.USERPROFILE || os.homedir();
  let claudeBin = '';

  // 1. `where claude` — searches the current PATH for any matching executable.
  try {
    const r = spawnSync('cmd', ['/d', '/s', '/c', 'where claude'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    const out = (r && r.stdout) || '';
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t && fs.existsSync(t)) { claudeBin = t; break; }
    }
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

  // 3. If `where` came up empty, probe each candidate dir for a claude shim.
  if (!claudeBin) {
    const names = ['claude.cmd', 'claude.exe', 'claude.ps1', 'claude'];
    outer:
    for (const dir of parts) {
      for (const name of names) {
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
    // Already present? Nothing to do.
    if (resolveShellPathAndClaude().claudeBin) {
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

function startServer() {
  const dir = serverDir();
  const serverPath = path.join(dir, 'server.js');
  // Run server.js with Electron's OWN bundled Node — no system Node needed.
  serverProc = spawn(process.execPath, [serverPath], {
    cwd: dir,
    env: childEnv({
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
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
    title: 'Founders Office',
    backgroundColor: '#F0EEE6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setTitle('Founders Office');
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

function installRetryHtml(detail) {
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
  <h1>Couldn't set up Claude Code</h1>
  <p>Your team runs on Claude Code and we couldn't install it automatically.${detail ? ' ' + detail : ''}</p>
  <p><a class="btn" href="#" onclick="try{window.nimishOffice.retryBoot()}catch(e){location.reload()};return false;">Try again</a></p>
  <p><a class="link" href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Install it manually →</a></p>
</div></body></html>`)
  );
}

async function boot() {
  createWindow();

  const already = await portListening();
  if (!already) {
    // GATE: the team can only start once the Claude Code CLI is present. On a
    // fresh machine (esp. Windows) this installs it first, showing progress.
    const res = await ensureClaudeInstalled((msg) => {
      try { if (win) win.loadURL(loadingHtml(msg)); } catch (_) {}
    });
    if (!win) return;
    if (!res.installed) {
      console.warn(`[claude-install] not installed: ${res.error || 'unknown'}`);
      win.loadURL(installRetryHtml('You can retry, or install it manually — then reopen.'));
      return;
    }
    seedSkills();
    seedVercelCli();  // background, non-blocking — provisions the deploy CLI (login-only left)
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
          label: 'Founders Office',
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
