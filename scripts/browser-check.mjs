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
  await until(() => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    return Boolean(button && !button.disabled);
  })()`), 'Button did not become available: '+text);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error('Button unavailable: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
}
async function clickSelector(selector) {
  await until(() => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); return Boolean(node && !node.disabled); })()`), 'Control did not become available: '+selector);
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) throw new Error('Control unavailable'); node.click(); })()`);
}
async function key(key, modifiers = 0) {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
  // Chromium needs the native key code to execute Tab/Escape default actions.
  const windowsVirtualKeyCode = { Tab: 9, Escape: 27 }[key];
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, ...(windowsVirtualKeyCode ? { windowsVirtualKeyCode } : {}) });
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
  assert(!(await body()).includes('Delete Image'));
  assert(!(await body()).includes('Mark as Last Train Image'));
  assert(await evaluate(`Boolean(document.querySelector('[title="Delete selected (Del or Ctrl+D)"]'))`));
  console.log('PASS raw editor hides image management controls and retains bounding-box Delete');
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

  // Reopen an actual app export through the one-file uploader.
  async function uploadOne(base64) {
    await evaluate(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0))], 'arbitrary-name.zip'));
      const input = document.querySelector('input[type=file]'); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await clickText('Validate Files');
    await waitText('Annotation Editor');
    await until(() => evaluate(`Boolean(document.querySelector('[aria-label="Annotation editor canvas"] img')?.naturalWidth)`), 'Reopened image did not decode');
    await delay(150);
    assert(!(await body()).includes('Choose Train/Valid Split'));
    assert(!(await body()).includes('Tiling images'));
  }
  await evaluate(`(async () => { const { clearSession } = await import('/src/lib/db.ts'); await clearSession(); })()`);
  await cdp('Page.reload'); await waitText('Upload your zip files');
  await uploadOne(zipBase64);
  assert.equal(await savedRecord('record.session.datasetType'), 'processed-rfdetr');
  assert.equal(await savedRecord('record.split'), null);
  assert.equal(await savedRecord('record.tiled.trainImages.length + record.tiled.validImages.length'), 4);
  assert.equal(await savedRecord('record.tiled.trainImages[0].name'), 'seats_valid train_1.jpg');
  await waitText('0 annotations');
  console.log('PASS actual raw export reopens directly through upload, preserves names, assignments and saved annotations');

  // A 194-image real PNG fixture exported by the same generator.
  console.log('Preparing 194-image processed fixture');
  const largeZip = await evaluate(`(async () => {
    const { buildFinalZip } = await import('/src/lib/finalization.ts');
    const pixels = new Blob([Uint8Array.from(atob(${JSON.stringify(pngs.bad)}), c => c.charCodeAt(0))], { type: 'image/png' });
    const imageFiles = Array.from({length:194}, (_, i) => ({name:(i+1)+'.png', blob:pixels}));
    const labelBlob = new Blob(['0 0.5 0.5 0.2 0.2\\n1 0.8000000001234567 0.8 0.1234567890123456 0.1']);
    const labelFiles = imageFiles.map(file => ({name:file.name.replace('.png','.txt'), blob:labelBlob}));
    const zip = await buildFinalZip({trainImages:imageFiles.slice(0,150), trainLabels:labelFiles.slice(0,150),
      validImages:imageFiles.slice(150), validLabels:labelFiles.slice(150), tiledAt:Date.now()}, 'Man\\nChair', 'roundtrip');
    return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(zip); });
  })()`);
  await evaluate(`(async () => { const { clearSession } = await import('/src/lib/db.ts'); await clearSession(); })()`);
  await cdp('Page.reload'); await waitText('Upload your zip files');
  console.log('Uploading 194-image processed fixture');
  await uploadOne(largeZip);
  await waitText('Train: 150 | Valid: 44');
  const originalPixels = await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(record.tiled.trainImages[0].blob); })`);
  // Existing editor shortcuts must also work for processed datasets.
  await clickSelector('[aria-label="Hide Man boxes"]'); await clickSelector('[aria-label="Show Man boxes"]');
  await clickSelector('[aria-label="Hide Chair boxes"]'); await clickSelector('[aria-label="Show Chair boxes"]');
  await clickSelector('[aria-label="Toggle visibility of all boxes"]'); await clickSelector('[aria-label="Toggle visibility of all boxes"]');
  await clickSelector('[title="Zoom in"]'); await clickSelector('[title="Zoom out"]');
  await clickSelector('[title="Next"]'); await waitText('2 / 194'); await delay(150);
  await clickSelector('[title="Previous"]'); await waitText('1 / 194'); await delay(150);
  await clickImage(0.5,0.5); await drag(0.5,0.5,0.55,0.55); await waitText('Unsaved'); await key('z',2);
  await clickImage(0.5,0.5);
  const handle = await evaluate(`(() => { const n = document.querySelector('[style*="cursor: nwse-resize"]'); const r = n.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await mouse(handle.x,handle.y,'mousePressed',{button:'left',clickCount:1});
  await mouse(handle.x-10,handle.y-10,'mouseMoved',{button:'left',buttons:1});
  await mouse(handle.x-10,handle.y-10,'mouseReleased',{button:'left',clickCount:1});
  await waitText('Unsaved'); await key('z',2);
  await clickImage(0.5,0.5); await clickSelector('[title="Delete selected (Del or Ctrl+D)"]');
  await waitText('1 annotation'); await key('z',2); await waitText('2 annotations');

  await clickImage(0.5, 0.5); await key('ArrowRight'); await key('z', 2);
  await clickImage(0.5, 0.5); await key('c', 2); const processedPaste = await point(0.3, 0.3);
  await mouse(processedPaste.x, processedPaste.y, 'mouseMoved'); await key('v', 2);
  await waitText('3 annotations'); await key('z', 2); await waitText('2 annotations');
  await key('x', 2); await drag(0.2, 0.5, 0.7, 0.5); await key('d', 2);
  await waitText('1 annotation'); await key('z', 2); await waitText('2 annotations');
  await key('d'); await drag(0.1, 0.1, 0.2, 0.2); await waitText('Assign a class');
  await clickText('Mancls 0'); await waitText('3 annotations'); await key('d');
  // Dirty edits and split update commit together, including on storage failure.
  await clickText('Mark as Last Train Image'); await waitText('Your unsaved annotations will be saved');
  assert.equal(await evaluate(`document.querySelector('dialog[aria-label="Update Train/Valid split"]').open`), true);
  await key('Tab');
  assert.equal(await evaluate(`Boolean(document.activeElement.closest('dialog[aria-label="Update Train/Valid split"]'))`), true);
  await key('Escape');
  assert.equal(await evaluate(`Boolean(document.querySelector('dialog[aria-label="Update Train/Valid split"]'))`), false);
  assert((await body()).includes('Unsaved'));
  await clickText('Mark as Last Train Image');
  await key('d', 2); assert((await body()).includes('3 annotations'));
  await clickText('Cancel'); assert((await body()).includes('Unsaved'));
  await clickText('Mark as Last Train Image');
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put; db.sessions.put = async () => { throw new Error('Test split save failure'); }; })()`);
  await clickText('Update Split'); await waitText('Test split save failure');
  assert.equal(await savedRecord('record.tiled.trainImages.length'), 150);
  assert((await body()).includes('3 annotations'));
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; })()`);
  await clickText('Update Split'); await waitText('Train: 1 | Valid: 193');
  assert.equal(await savedRecord("(await record.tiled.trainLabels[0].blob.text()).split('\\n').length"), 3);
  assert.equal(await savedRecord("(await record.tiled.trainLabels[0].blob.text()).split('\\n')[1]"), '1 0.8000000001234567 0.8 0.1234567890123456 0.1');
  async function jump(number) {
    await evaluate(`(() => { const input = document.querySelector('#editor-image-number');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(number))});
      input.dispatchEvent(new Event('input', { bubbles:true })); input.closest('form').requestSubmit(); })()`);
    await waitText(number + ' / 194'); await delay(150);
  }
  await jump(160); await clickText('Mark as Last Train Image'); await clickText('Update Split');
  await waitText('Train: 160 | Valid: 34');
  await jump(120); await clickText('Mark as Last Train Image'); await clickText('Update Split');
  await waitText('Train: 120 | Valid: 74');
  assert((await body()).includes('Last Train Image: roundtrip_120.png'));
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('Train: 120 | Valid: 74'); await waitText('3 annotations');
  assert.equal(await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(record.tiled.trainImages[0].blob); })`), originalPixels);
  await clickText('Finalize'); await waitText('Finalization Summary');
  await until(() => evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Build zip' && !b.disabled)`), 'Summary did not finish loading');
  await clickText('Build zip');
  await waitText('Download RFDETR_roundtrip.zip');
  const reopenedExport = await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(record.finalZip); })`);
  const reopenedZip = await JSZip.loadAsync(Buffer.from(reopenedExport, 'base64'));
  for (const [partition, count] of [['train',120],['valid',74]]) {
    for (const folder of ['images','labels']) assert.equal(Object.values(reopenedZip.files).filter(file => !file.dir && file.name.startsWith('RFDETR_roundtrip/'+partition+'/'+folder+'/')).length, count);
  }
  assert.equal((await reopenedZip.file('RFDETR_roundtrip/train/labels/roundtrip_1.txt').async('string')).split('\n').length, 3);
  await clickText('Back to editor'); await waitText('Train: 120 | Valid: 74');
  await jump(140); await clickText('Mark as Last Train Image'); await clickText('Update Split');
  await waitText('Train: 140 | Valid: 54'); assert.equal(await savedRecord('record.finalZip'), null);
  // Re-upload exported output and ensure it does not gain another filename prefix.
  await evaluate(`(async () => { const { clearSession } = await import('/src/lib/db.ts'); await clearSession(); })()`);
  await cdp('Page.reload'); await waitText('Upload your zip files'); await uploadOne(reopenedExport);
  await waitText('Train: 120 | Valid: 74'); await waitText('3 annotations');
  assert.equal(await savedRecord('record.tiled.trainImages[0].name'), 'roundtrip_1.png');
  const panBefore = await evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img').parentElement.style.transform`);
  await drag(0.05,0.05,0.1,0.1);
  const panAfter = await evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img').parentElement.style.transform`);
  assert.notEqual(panAfter, panBefore);
  await key('f'); await until(() => evaluate('Boolean(document.fullscreenElement)'), 'Fullscreen did not open');
  await key('f'); await until(() => evaluate('!document.fullscreenElement'), 'Fullscreen did not close');

  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  console.log('PASS processed shortcuts, dirty split save/cancel/failure/retry, 160/34 and 120/74 assignments, resume, exact ZIP counts, unchanged pixels, cache invalidation and re-upload');

  // Deletion operates only on processed items; confirm both actions are present.
  assert((await body()).includes('Delete Image'));
  assert((await body()).includes('Mark as Last Train Image'));
  await clickText('Finalize'); await waitText('Finalization Summary');
  await until(() => evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Build zip' && !b.disabled)`), 'Deletion baseline summary did not finish');
  await clickText('Build zip'); await waitText('Download RFDETR_roundtrip.zip');
  assert.equal(await savedRecord('record.finalZip instanceof Blob'), true);
  await clickText('Back to editor'); await waitText('3 annotations');
  const deletedUrl = await evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img').src`);
  await evaluate(`(() => { window.revokedImageUrls = []; const original = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = url => { window.revokedImageUrls.push(url); original(url); }; })()`);
  await clickImage(0.5,0.5); await key('ArrowRight'); await waitText('Unsaved');
  await clickText('Delete Image'); await waitText('Deleting the image will also discard those changes');
  assert.equal(await evaluate(`document.querySelector('dialog[aria-label="Delete image and annotation"]').open`), true);
  await key('d',2); assert((await body()).includes('3 annotations'));
  await clickText('Cancel'); await waitText('Unsaved');
  assert.equal(await savedRecord('record.session.totalImages'), 194);
  assert.equal(await savedRecord('record.finalZip instanceof Blob'), true);
  await clickText('Delete Image');
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put; db.sessions.put = async () => { throw new Error('Test image delete failure'); }; })()`);
  await clickText('Delete'); await waitText('Test image delete failure');
  assert.equal(await savedRecord('record.session.totalImages'), 194);
  assert((await body()).includes('Unsaved'));
  assert.equal(await evaluate('window.revokedImageUrls.includes('+JSON.stringify(deletedUrl)+')'), false);
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; })()`);
  await clickText('Delete'); await waitText('Train: 119 | Valid: 74');
  await until(() => evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img')?.alt === 'roundtrip_2.png'`), 'First-image deletion must show next image');
  await waitText('2 annotations');
  assert.equal(await savedRecord('record.session.totalImages'), 193);
  assert.equal(await savedRecord('record.session.totalAnnotations'), 193);
  assert.equal(await savedRecord('record.finalZip'), null);
  assert.equal(await savedRecord("record.tiled.trainLabels.some(label => label.name === 'roundtrip_1.txt')"), false);
  assert.equal(await evaluate('window.revokedImageUrls.includes('+JSON.stringify(deletedUrl)+')'), true);
  assert.equal(await evaluate(`window.revokedImageUrls.includes(document.querySelector('[aria-label="Annotation editor canvas"] img').src)`), false);
  assert.equal(await evaluate(`document.querySelector('[title="Undo (Ctrl+Z)"]').disabled`), true);
  assert(!(await body()).includes('box selected'));
  console.log('PASS delete confirmation/cancel, unsaved-edit warning, storage failure/retry, cache invalidation, selection/Undo reset and object URL cleanup');

  const deletedNumbers = [1];
  async function deleteNamed(number, next, train, valid, lastTrain) {
    await clickSelector('[title="roundtrip_'+number+'.png"]');
    await until(() => evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img')?.alt === 'roundtrip_${number}.png'`), 'Target image did not open');
    await delay(150);
    await clickText('Delete Image'); await clickText('Delete');
    await waitText('Train: '+train+' | Valid: '+valid);
    await until(() => evaluate(`document.querySelector('[aria-label="Annotation editor canvas"] img')?.alt === 'roundtrip_${next}.png'`), 'Wrong image after deleting '+number);
    await waitText('2 annotations');
    assert((await body()).includes('Last Train Image: roundtrip_'+lastTrain+'.png'));
    assert.equal(await savedRecord('record.session.totalImages'), train+valid);
    assert.equal(await savedRecord('record.session.totalAnnotations'), train+valid);
    assert.equal(await savedRecord("[...record.tiled.trainImages,...record.tiled.validImages].some(file => file.name === 'roundtrip_"+number+".png')"), false);
    assert.equal(await savedRecord("[...record.tiled.trainLabels,...record.tiled.validLabels].some(file => file.name === 'roundtrip_"+number+".txt')"), false);
    deletedNumbers.push(number);
  }
  await deleteNamed(50,51,118,74,120); // Train before boundary.
  await deleteNamed(120,121,117,74,119); // Boundary removal keeps Valid unchanged.
  await deleteNamed(150,151,117,73,119); // Valid removal.
  await deleteNamed(194,193,117,72,119); // Last image opens previous.
  await deleteNamed(193,192,117,71,119);
  await deleteNamed(119,121,116,71,118);
  await deleteNamed(180,181,116,70,118);
  await deleteNamed(2,3,115,70,118);
  assert((await body()).includes('1 / 185'));
  // Split calculation uses remaining items, not the original numeric filename.
  await clickSelector('[title="roundtrip_140.png"]'); await waitText('135 / 185'); await delay(150);
  await clickText('Mark as Last Train Image'); await waitText('Train: 135 images | Valid: 50 images');
  await clickText('Update Split'); await waitText('Train: 135 | Valid: 50');
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('Train: 135 | Valid: 50'); await waitText('2 annotations');
  assert.equal(await savedRecord('record.session.totalImages'),185);
  await clickText('Finalize'); await waitText('Finalization Summary');
  await until(() => evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Build zip' && !b.disabled)`), 'Deletion summary did not finish');
  await clickText('Build zip'); await waitText('Download RFDETR_roundtrip.zip');
  const afterDeletionExport = await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(record.finalZip); })`);
  const afterDeletionZip = await JSZip.loadAsync(Buffer.from(afterDeletionExport, 'base64'));
  for (const [partition, count] of [['train',135],['valid',50]]) {
    for (const folder of ['images','labels']) assert.equal(Object.values(afterDeletionZip.files).filter(file => !file.dir && file.name.startsWith('RFDETR_roundtrip/'+partition+'/'+folder+'/')).length,count);
  }
  for (const number of deletedNumbers) for (const partition of ['train','valid']) {
    assert.equal(afterDeletionZip.file('RFDETR_roundtrip/'+partition+'/images/roundtrip_'+number+'.png'),null);
    assert.equal(afterDeletionZip.file('RFDETR_roundtrip/'+partition+'/labels/roundtrip_'+number+'.txt'),null);
  }
  await evaluate(`(async () => { const { clearSession } = await import('/src/lib/db.ts'); await clearSession(); })()`);
  await cdp('Page.reload'); await waitText('Upload your zip files'); await uploadOne(afterDeletionExport);
  await waitText('Train: 135 | Valid: 50');
  assert.equal(await savedRecord('record.session.totalImages'),185);
  console.log('PASS nine Train/Valid deletions, first/middle/final navigation, Train boundary preservation, split after deletion, reload/resume, 185-pair export and re-upload');

  // Do not remove the only Train image; unrelated Valid items must not be reassigned.
  await clickText('Mark as Last Train Image'); await clickText('Update Split'); await waitText('Train: 1 | Valid: 184');
  await waitText('At least one Train image must remain');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete Image').disabled`),true);
  await deleteNamed(4,5,1,183,3);
  // A damaged resumed record must remain navigable and deletable.
  await evaluate(`(async () => {
    const { loadSession,saveSession } = await import('/src/lib/db.ts'); const record = await loadSession();
    const tiled = {...record.tiled,trainImages:[record.tiled.trainImages[0],record.tiled.validImages[0]],
      trainLabels:[record.tiled.trainLabels[0]],validImages:[record.tiled.validImages[1]],validLabels:[record.tiled.validLabels[1]]};
    await saveSession({id:'current',stage:'tile-viewer',updatedAt:Date.now()}, {...record.session,totalImages:3,totalAnnotations:2},null,tiled);
  })()`);
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('Annotation Editor');
  await until(() => evaluate(`Boolean(document.querySelector('[aria-label="Annotation editor canvas"] img')?.naturalWidth)`), 'Damaged session did not resume');
  await clickSelector('[title="roundtrip_5.png"]'); await waitText('The matching annotation is missing');
  await delay(150); await clickText('Delete Image'); await clickText('Delete');
  await waitText('Its matching annotation roundtrip_5.txt was already missing');
  await waitText('Train: 1 | Valid: 1');
  // Final dataset image is protected with a visible explanation.
  await evaluate(`(async () => {
    const { loadSession,saveSession } = await import('/src/lib/db.ts'); const record = await loadSession();
    await saveSession({id:'current',stage:'tile-viewer',updatedAt:Date.now()}, {...record.session,totalImages:1,totalAnnotations:1},null,
      {...record.tiled,validImages:[],validLabels:[]});
  })()`);
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('At least one image must remain in the dataset.');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete Image').disabled`),true);
  assert.equal(browserErrors.length,0,JSON.stringify(browserErrors));
  console.log('PASS final Train/image protection and safe missing-annotation deletion; no browser runtime exceptions');

  // Processed resume must never fall back to raw split/tiling stages.
  await evaluate(`(async () => { const { updateSessionStage } = await import('/src/lib/db.ts'); await updateSessionStage('tiling'); })()`);
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('Annotation Editor'); await waitText('Train: 1 | Valid: 0');
  assert(!(await body()).includes('Choose Train/Valid Split'));
  assert.equal(await savedRecord('record.meta.stage'), 'tile-viewer');

  // A failed import replaces the old saved project just as raw validation does.
  await clickText('Back'); await waitText('Upload your zip files');
  const incomplete = await JSZip.loadAsync(Buffer.from(reopenedExport, 'base64'));
  incomplete.remove('RFDETR_roundtrip/train/labels');
  const incompleteBase64 = await incomplete.generateAsync({ type: 'base64' });
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(incompleteBase64)}), c => c.charCodeAt(0))], 'broken.zip'));
    const input = document.querySelector('input[type=file]'); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await clickText('Validate Files'); await waitText('train labels folder is missing');
  assert.equal(await savedRecord('record.session'), null);
  assert.equal(await savedRecord('record.finalZip'), null);
  await cdp('Page.reload'); await waitText('Upload your zip files');
  assert(!(await body()).includes('Resume Session'));
  assert.equal(browserErrors.length,0,JSON.stringify(browserErrors));
  console.log('PASS precision-preserving dirty save, native split confirmation/Escape, processed resume stage recovery and failed-import stale-session cleanup');

  // Repair actual processed labels from the validation screen, including persistence failures.
  const repairZip = await JSZip.loadAsync(Buffer.from(reopenedExport, 'base64'));
  const repairLabelPath = 'RFDETR_roundtrip/train/labels/roundtrip_1.txt';
  const overflowBox = '0 0.980000 0.500000 0.100000 0.200000';
  const invisibleBox = '0 2 0.5 0.1 0.2';
  const untouchedBox = '1 0.3333333333333333 0.5 0.1234567890123456 0.2';
  repairZip.file(repairLabelPath, [untouchedBox, invisibleBox, ...Array(5).fill(overflowBox)].join('\r\n'));
  async function uploadForRepair(zip) {
    const base64 = await zip.generateAsync({ type: 'base64' });
    await evaluate(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0))], 'boundary-repair.zip'));
      const input = document.querySelector('input[type=file]'); input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await clickText('Validate Files');
  }
  await uploadForRepair(repairZip); await waitText('Fix All 6 Boundary Boxes');
  assert.equal(await savedRecord('record.session'), null);
  assert.equal(await savedRecord('record.processedDraft.tiled.trainImages.length'), 120);
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); window.originalPut = db.sessions.put; db.sessions.put = async () => { throw new Error('Test repair save failure'); }; })()`);
  await clickText('Fix Box'); await waitText('Test repair save failure');
  assert((await body()).includes('Fix All 6 Boundary Boxes'));
  assert((await savedRecord('await record.processedDraft.tiled.trainLabels[0].blob.text()')).includes(invisibleBox));
  await evaluate(`(async () => { const { db } = await import('/src/lib/db.ts'); db.sessions.put = window.originalPut; })()`);
  await clickText('Fix Box'); await waitText('Fix All 5 Boundary Boxes');
  const partiallyFixed = await savedRecord('await record.processedDraft.tiled.trainLabels[0].blob.text()');
  assert(!partiallyFixed.includes(invisibleBox));
  assert.equal(partiallyFixed.split('\r\n').length, 6);
  await cdp('Page.reload'); await waitText('Fix All 5 Boundary Boxes');
  await clickText('Fix All 5 Boundary Boxes'); await waitText('Annotation Editor');
  await waitText('Train: 120 | Valid: 74'); await waitText('6 annotations');
  const repairedText = await savedRecord('await record.tiled.trainLabels[0].blob.text()');
  assert.equal(repairedText.split('\r\n')[0], untouchedBox);
  assert.equal(repairedText.split('\r\n')[1], '0 0.965000 0.500000 0.070000 0.200000');
  assert.equal(await savedRecord('Boolean(record.processedDraft)'), false);
  assert.equal(await savedRecord('record.finalZip'), null);
  assert.equal(await savedRecord('record.split'), null);
  assert(!(await body()).includes('Choose Train/Valid Split'));
  await cdp('Page.reload'); await waitText('Resume Session'); await clickText('Resume Session');
  await waitText('6 annotations');
  assert.equal(await savedRecord('await record.tiled.trainLabels[0].blob.text()'), repairedText);
  await clickText('Finalize'); await waitText('Finalization Summary'); await clickText('Build zip');
  await waitText('Download RFDETR_roundtrip.zip');
  const repairedExport = await savedRecord(`await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(record.finalZip); })`);
  const repairedArchive = await JSZip.loadAsync(Buffer.from(repairedExport, 'base64'));
  assert.equal(await repairedArchive.file(repairLabelPath).async('string'), repairedText);
  for (const original of Object.values(repairZip.files).filter(file => !file.dir && file.name.includes('/images/'))) {
    assert.deepEqual(await repairedArchive.file(original.name).async('uint8array'), await original.async('uint8array'));
  }
  await evaluate(`(async () => { const { clearSession } = await import('/src/lib/db.ts'); await clearSession(); })()`);
  await cdp('Page.reload'); await waitText('Upload your zip files'); await uploadOne(repairedExport);
  await waitText('6 annotations');
  assert.equal(await savedRecord('await record.tiled.trainLabels[0].blob.text()'), repairedText);
  console.log('PASS repair failure/retry, six-to-five individual repair, partial-draft reload, Fix All direct editor, fixed-value resume/export/re-upload and all image bytes unchanged');

  // Mixed errors: boundaries are repaired, the invalid class remains blocking.
  await clickText('Back'); await waitText('Upload your zip files');
  const invalidClassBox = '99 0.5 0.5 0.1 0.1';
  repairZip.file(repairLabelPath, [...Array(5).fill(overflowBox), invalidClassBox].join('\n'));
  await uploadForRepair(repairZip); await waitText('Fix All 5 Boundary Boxes');
  await clickText('Fix All 5 Boundary Boxes'); await waitText('Validation found 1 issue');
  assert((await body()).includes('Class ID 99'));
  assert(!(await body()).includes('Annotation Editor'));
  assert(!(await body()).includes('Fix Box'));
  assert.equal(await savedRecord('record.session'), null);
  assert.equal(await savedRecord('record.tiled'), null);
  assert.equal((await savedRecord('await record.processedDraft.tiled.trainLabels[0].blob.text()')).split('\n')[5], invalidClassBox);
  assert.equal(browserErrors.length,0,JSON.stringify(browserErrors));
  console.log('PASS mixed annotation errors repair only boundaries and retain blocking invalid-class validation');


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
