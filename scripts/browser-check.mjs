// Real Chromium regression checks, with no additional npm dependencies.
// Run: node scripts/browser-check.mjs (or set CHROME_PATH).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const chromePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
assert(chromePath, 'Set CHROME_PATH to an installed Chromium browser.');
const profile = await mkdtemp(join(tmpdir(), 'rfdetr-browser-check-'));
const origin = 'http://127.0.0.1:5189';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5189', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, socket;
let nextId = 0;
const requests = new Map();
const browserErrors = [];
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    requests.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const body = () => evaluate('document.body.innerText');
const waitText = text => until(async () => (await body()).includes(text), `Missing text: ${text}`);
async function clickText(text) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
}
async function clickSelector(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) throw new Error('Control unavailable'); node.click(); })()`);
}
async function key(key, modifiers = 0) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  await delay(80);
}
async function mouse(x, y, type, extra = {}) {
  await cdp('Input.dispatchMouseEvent', { type, x, y, ...extra });
}
async function point(x, y) {
  return evaluate(`(() => { const r = document.querySelector('[aria-label="Annotation editor canvas"] img').getBoundingClientRect(); return { x: r.left + r.width * ${x}, y: r.top + r.height * ${y} }; })()`);
}
async function clickImage(x, y) {
  const p = await point(x, y);
  await mouse(p.x, p.y, 'mouseMoved');
  await mouse(p.x, p.y, 'mousePressed', { button: 'left', clickCount: 1 });
  await mouse(p.x, p.y, 'mouseReleased', { button: 'left', clickCount: 1 });
  await delay(100);
}
async function drag(x1, y1, x2, y2) {
  const a = await point(x1, y1), b = await point(x2, y2);
  await mouse(a.x, a.y, 'mouseMoved');
  await mouse(a.x, a.y, 'mousePressed', { button: 'left', clickCount: 1 });
  await delay(60);
  await mouse(b.x, b.y, 'mouseMoved', { button: 'left', buttons: 1 });
  await mouse(b.x, b.y, 'mouseReleased', { button: 'left', clickCount: 1 });
  await delay(100);
}
async function savedRecord(expression) {
  return evaluate(`(async () => { const { loadSession } = await import('/src/lib/db.ts'); const record = await loadSession(); return ${expression}; })()`);
}

try {
  await until(async () => {
    if (server.exitCode !== null) throw new Error(serverLog);
    return fetch(origin).then(r => r.ok).catch(() => false);
  }, 'Vite did not start');
  browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'pipe' });
  let browserLog = '';
  browser.stderr.on('data', chunk => { browserLog += chunk; });
  await until(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(browserLog), 'Browser did not start');
  const debugUrl = new URL(browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
  const pages = await fetch(`http://${debugUrl.host}/json/list`).then(r => r.json());
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = requests.get(message.id);
      requests.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  await waitText('Upload your zip files');

  // Generate actual decodable PNGs; upload ZIPs via the application's File input.
  const pngs = await evaluate(`(() => {
    const png = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.fillStyle = '#cbd5e1'; ctx.fillRect(0,0,w,h); return c.toDataURL().split(',')[1]; };
    return { good: png(2560,1440), bad: png(1024,572) };
  })()`);
  const backup = new JSZip(), labels = new JSZip();
  const goodNames = ['valid train', 'valid validation'];
  const badNames = ['image (5)', 'under_score', 'Gemini_Generated_Image_6j52866j52866j52', 'bad4', 'bad5', 'bad6', 'bad7', 'bad8', 'bad9'];
  for (const name of [...goodNames, ...badNames]) {
    backup.file(`data/${name}.png`, Buffer.from(goodNames.includes(name) ? pngs.good : pngs.bad, 'base64'));
    labels.file(`obj_train_data/${name}.txt`, '0 0.28125 0.5 0.1125 0.2');
  }
  labels.file('obj.names', 'chair\n');
  const uploads = await Promise.all([backup, labels].map(zip => zip.generateAsync({ type: 'base64' })));
  await evaluate(`(() => {
    const dt = new DataTransfer();
    ${JSON.stringify(uploads)}.forEach((base64, i) => dt.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], i === 0 ? 'seats_backup.zip' : 'seats.zip')));
    const input = document.querySelector('input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await clickText('Validate Files');
  await waitText('Delete All 9 Resolution Error Files');
  assert((await body()).includes('Images: 11 | Annotations: 11'));
  await clickText('Delete All 9 Resolution Error Files');
  assert.equal(await evaluate('document.querySelector("dialog").open'), true);
  await clickText('Cancel');
  await waitText('Delete All 9 Resolution Error Files');

  // Inject a persistence failure and verify neither counts nor files disappear.
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put; db.sessions.put = async () => { throw new Error('Test storage failure'); }; })()`);
  await clickSelector('[aria-label="Delete image (5).png"]');
  await waitText('Deletion failed. No files were deleted. Test storage failure');
  assert((await body()).includes('Images: 11 | Annotations: 11'));
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; })()`);
  await clickSelector('[aria-label="Delete image (5).png"]');
  await waitText('Delete All 8 Resolution Error Files');
  assert((await body()).includes('Images: 10 | Annotations: 10'));
  await clickText('Delete All 8 Resolution Error Files');
  await clickText('Delete All');
  await waitText('Validation complete');
  assert.equal(await savedRecord('record.session.totalImages'), 2);
  console.log('PASS upload, confirmation/cancel, atomic failure, individual/bulk cleanup and counts');

  await clickText('Choose Train/Valid Split');
  await key('ArrowLeft');
  await clickText('Mark Split Here');
  await clickText('Confirm Split');
  await waitText('View Tiles');
  await clickText('View Tiles');
  await until(() => evaluate(`Boolean(document.querySelector('[aria-label="Annotation editor canvas"] img')?.naturalWidth)`), 'Editor image did not decode');
  await waitText('1 annotation');
  await evaluate('document.querySelector("#editor-image-number").focus()');
  await clickImage(0.5, 0.5);
  assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Annotation editor canvas');
  await waitText('1 box selected');
  await key('d', 2);
  await waitText('0 annotations');
  await key('z', 2);
  await waitText('1 annotation');
  console.log('PASS Ctrl+D after input focus and Undo');

  await clickImage(0.5, 0.5);
  const selectedLeft = () => evaluate(`parseFloat([...document.querySelectorAll('[aria-label="Annotation editor canvas"] .absolute')].find(n => n.style.zIndex === "20").style.left)`);
  const leftBefore = await selectedLeft();
  await key('ArrowRight');
  const leftAfter = await selectedLeft();
  assert(Math.abs(leftAfter - leftBefore - 100 / 1440) < 1e-4, `ArrowRight must move one image pixel: ${leftBefore} -> ${leftAfter}`);
  await key('z', 2);
  await clickImage(0.5, 0.5);
  await key('c', 2);
  const pastePoint = await point(0.8, 0.7);
  await mouse(pastePoint.x, pastePoint.y, 'mouseMoved');
  await key('v', 2);
  await waitText('2 annotations');
  await key('z', 2);
  await waitText('1 annotation');
  console.log('PASS one-pixel movement, copy/paste at mouse and Undo');

  await key('x', 2);
  await drag(0.2, 0.5, 0.8, 0.5);
  await waitText('1 box selected');
  await key('d', 2);
  await waitText('0 annotations');
  await key('z', 2);
  await key('d');
  await drag(0.15, 0.15, 0.3, 0.3);
  await waitText('Assign a class');
  await key('z', 2); // Modal must protect the pending drawing.
  assert((await body()).includes('Assign a class'));
  await clickText('chaircls 0');
  await waitText('2 annotations');
  await key('z', 2);
  await waitText('1 annotation');
  await key('d'); // Return to selection/pan.
  console.log('PASS line selection, Draw shortcut, class assignment and modal protection');

  await clickImage(0.5, 0.5);
  await key('d', 2);
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put; db.sessions.put = async () => { throw new Error('Test annotation save failure'); }; })()`);
  await key('s', 2);
  await waitText('Test annotation save failure');
  assert((await body()).includes('Unsaved'));
  assert.notEqual(await savedRecord('await record.tiled.trainLabels[0].blob.text()'), '');
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; })()`);
  await key('s', 2);
  await waitText('Saved');
  assert.equal(await savedRecord('await record.tiled.trainLabels[0].blob.text()'), '');
  await cdp('Page.reload');
  await waitText('Resume');
  await clickText('Resume Session');
  await waitText('0 annotations');
  console.log('PASS failed Save preserves edits, retry, reload and Resume');

  await clickText('Finalize');
  await waitText('Finalization Summary');
  await evaluate(`(async () => {
    const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put;
    db.sessions.put = async function(...args) {
      await new Promise(resolve => { window.releaseFinalSave = resolve; });
      return window.originalPut.apply(this, args);
    };
  })()`);
  await clickText('Build zip');
  await until(() => evaluate('typeof window.releaseFinalSave === "function"'), 'ZIP save did not start');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Back to editor').disabled`), true);
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; window.releaseFinalSave(); })()`);
  await waitText('Download RFDETR_seats.zip');
  const zipBase64 = await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(record.finalZip); })`);
  const finalZip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'));
  const paths = Object.values(finalZip.files).filter(f => !f.dir).map(f => f.name);
  assert.equal(paths.length, 9);
  assert(paths.every(p => p.endsWith('obj.names') || p.includes('seats_valid train_') || p.includes('seats_valid validation_')));
  assert.equal(await finalZip.file('RFDETR_seats/train/labels/seats_valid train_1.txt').async('string'), '');
  console.log('PASS export locks navigation during save and preserves deleted-source exclusion');

  // Editing after export must invalidate the cached archive in memory/storage.
  await clickText('Back to editor');
  await waitText('0 annotations');
  await key('d');
  await drag(0.2, 0.2, 0.4, 0.4);
  await waitText('Assign a class');
  await clickText('chaircls 0');
  await key('s', 2);
  await waitText('Saved');
  assert.equal(await savedRecord('record.finalZip'), null);
  await clickText('Finalize');
  await waitText('Finalization Summary');
  await clickText('Build zip');
  await waitText('Download RFDETR_seats.zip');
  await clickText('Delete intermediate data');
  await until(async () => await savedRecord('record.finalization.oldFoldersDeleted'), 'Intermediate cleanup did not persist');
  assert.deepEqual(await savedRecord('record.session.pairs'), []);
  assert.equal(await savedRecord('record.split'), null);
  assert.equal(await savedRecord('record.tiled.trainImages.length + record.tiled.validImages.length'), 4);
  assert.equal(await savedRecord('record.finalZip instanceof Blob'), true);
  await cdp('Page.reload');
  await waitText('Download RFDETR_seats.zip');
  console.log('PASS editing invalidates cached ZIP; rebuild, intermediate cleanup and finalized reload preserve output');

  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  console.log('PASS final ZIP contains saved edits and no deleted sources; no browser runtime exceptions');
  await mkdir('.browser-check.local', { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('.browser-check.local/result.png', Buffer.from(screenshot.data, 'base64'));

  // Legacy/resumed sessions may contain the same tile name in both splits.
  // The editor must load the annotation belonging to that split, not the last
  // same-named annotation inserted into a global map.
  await evaluate(`(async () => {
    const { loadSession, saveSession } = await import('/src/lib/db.ts');
    const record = await loadSession();
    const label = '0 0.5 0.5 0.2 0.2';
    const tiled = {
      ...record.tiled,
      trainImages: [{ ...record.tiled.trainImages[0], name: 'shared.jpg' }],
      validImages: [{ ...record.tiled.validImages[0], name: 'shared.jpg' }],
      trainLabels: [{ name: 'shared.txt', blob: new Blob([label]) }],
      validLabels: [{ name: 'shared.txt', blob: new Blob([label + '\\n' + label]) }],
    };
    await saveSession({ id: 'current', stage: 'tile-viewer', updatedAt: Date.now() }, record.session, null, tiled);
  })()`);
  await cdp('Page.reload');
  await waitText('Resume Session');
  await clickText('Resume Session');
  await waitText('1 annotation');
  await key('ArrowRight');
  await waitText('2 annotations');
  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  console.log('PASS same-named train/valid tiles load their own annotations');
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) {
    console.error('PAGE:', await body().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await cdp('Browser.close').catch(() => {});
    socket.close();
  }
  browser?.kill();
  server.kill();
}
