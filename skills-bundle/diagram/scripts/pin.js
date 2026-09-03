#!/usr/bin/env node
'use strict';
/* ---------------------------------------------------------------------------
 * pin.js — pin an already-authored .excalidraw file onto a channel's whiteboard
 * in the running Founders Office.
 *
 * This does NOT generate diagrams. Authoring is the job of the `excalidraw-diagram`
 * skill (hand-crafted JSON + a render-and-fix loop that guarantees the diagram
 * actually looks right — no clipped text, no overlaps). Once that skill has
 * produced and visually validated a .excalidraw file, this helper drops it onto
 * the office board so it shows on the desk + at the top of the channel.
 *
 * USAGE:
 *   node pin.js <file.excalidraw> [--sid <sessionId>] [--title "Board title"]
 *
 * - No --sid: auto-resolves THIS folder's channel from the running office.
 * - Office must be running (default http://localhost:4517, or $PORT).
 * ------------------------------------------------------------------------- */
const fs = require('fs');
const http = require('http');

const PORT = Number(process.env.PORT) || 4517;
const BASE = `http://localhost:${PORT}`;

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(BASE + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Origin: BASE },
    }, (res) => { let out = ''; res.on('data', (d) => (out += d)); res.on('end', () => resolve({ status: res.statusCode, body: out })); });
    req.on('error', reject); req.write(data); req.end();
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, (res) => { let out = ''; res.on('data', (d) => (out += d)); res.on('end', () => resolve({ status: res.statusCode, body: out })); }).on('error', reject);
  });
}

async function resolveSid() {
  try {
    const r = await get('/api/office');
    const office = JSON.parse(r.body);
    const cabins = office.cabins || office.cubicles || [];
    const cwd = process.cwd();
    const hit = cabins.find((c) => c.cwd && (cwd === c.cwd || cwd.startsWith(c.cwd)));
    return hit && hit.sessionId;
  } catch { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('Usage: node pin.js <file.excalidraw> [--sid <id>] [--title "..."]'); process.exit(2); }
  const sidFlag = args.indexOf('--sid');
  const titleFlag = args.indexOf('--title');
  let sid = sidFlag >= 0 ? args[sidFlag + 1] : null;
  const title = titleFlag >= 0 ? args[titleFlag + 1] : null;

  let scene;
  try { scene = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('Cannot read/parse ' + file + ': ' + e.message); process.exit(1); }
  if (scene.type !== 'excalidraw' || !Array.isArray(scene.elements) || !scene.elements.length) {
    console.error('Not a valid non-empty Excalidraw scene: ' + file); process.exit(1);
  }

  if (!sid) sid = await resolveSid();
  if (!sid) {
    console.error('Could not resolve this folder\'s channel (is the office running on ' + BASE + '?). Pass --sid <sessionId>. The file itself is fine — it opens on excalidraw.com.');
    process.exit(2);
  }
  const res = await post('/api/board/save', { sid, scene, title: title || scene.title || 'Board' });
  if (res.status >= 200 && res.status < 300) {
    console.log('Pinned to channel board (sid=' + sid + '). It now shows on the desk and at the top of the channel.');
  } else {
    console.error('Board save failed (' + res.status + '): ' + res.body); process.exit(1);
  }
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
