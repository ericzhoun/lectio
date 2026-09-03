// Headless Chrome CDP probe for the bible arrival animation.
// Usage: node bible-cdp-probe.mjs <url>
const url = process.argv[2] || 'file:///C:/Users/ericz/AppData/Local/Temp/bible-pending.html';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { spawn } = await import('node:child_process');

const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9333',
  ...(process.env.NO_REDUCE ? ['--force-prefers-no-reduced-motion'] : []),
  '--user-data-dir=' + process.env.TEMP + '/cdp-profile-' + Date.now(),
  '--no-first-run', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9333/json/list');
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws error')); });
let msgId = 0;
const pending = new Map();
const pendingEvents = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) {
    pendingEvents.push(msg);
  }
};

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const waitEvent = (method, timeout = 15000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const check = () => {
    const idx = pendingEvents.findIndex(e => e.method === method);
    if (idx >= 0) { const [e] = pendingEvents.splice(idx, 1); resolve(e.params); return; }
    if (Date.now() - t0 > timeout) { reject(new Error('timeout waiting ' + method)); return; }
    setTimeout(check, 100);
  };
  check();
});

async function probe(label) {
  const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const arrive = document.querySelector('.bible-arrive');
    const clip = document.querySelector('.bible-arrive-clip');
    const book = document.querySelector('.bible-arrive-book');
    const verse = document.querySelector('.bible-flow .bible-verse');
    const drawn = document.querySelector('.bible-verse-drawn');
    const head = document.querySelector('.bible-chapter-heading');
    const cs = el => el ? getComputedStyle(el) : null;
    const c = cs(clip), v = cs(verse), d = cs(drawn), h = cs(head), b = cs(book);
    return {
      reducedMotion: mq.matches,
      arriveClass: arrive ? arrive.className : 'MISSING',
      clip: c ? { animationName: c.animationName, clipPath: c.clipPath, marginTop: c.marginTop, opacity: c.opacity, animationPlayState: c.animationPlayState, animationDelay: c.animationDelay } : 'MISSING',
      book: b ? { display: b.display, animationName: b.animationName, opacity: b.opacity } : 'MISSING',
      heading: h ? { opacity: h.opacity, animationName: h.animationName } : 'MISSING',
      verse: v ? { opacity: v.opacity, animationName: v.animationName, animationDelay: v.animationDelay, animationDuration: v.animationDuration, animationFillMode: v.animationFillMode, animationPlayState: v.animationPlayState } : 'MISSING',
      drawn: d ? { opacity: d.opacity, animationName: d.animationName, animationDelay: d.animationDelay, backgroundSize: d.backgroundSize } : 'MISSING',
      verseVd: verse ? verse.style.getPropertyValue('--vd') : 'MISSING'
    };
  })()` });
  console.log(JSON.stringify(result.value, null, 1));
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  if (process.env.EMULATE_NO_REDUCE) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  }
  const nav = waitEvent('Page.loadEventFired');
  await send('Page.navigate', { url });
  await nav;
  await probe('t=+0.2s (should be closed book, verses hidden)');
  await sleep(1200);
  await probe('t=+1.4s (book opening, clip expanding, first verses fading in)');
  await sleep(4600);
  await probe('t=+6.0s (FINAL: verses should be opacity 1)');
  const { result: vis } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const verses = [...document.querySelectorAll('.bible-flow .bible-verse')];
    const visible = verses.filter(v => {
      const r = v.getBoundingClientRect();
      return getComputedStyle(v).opacity === '1' && r.width > 0 && r.height > 0;
    });
    return {
      totalVerses: verses.length,
      visibleVerses: visible.length,
      sampleText: visible.slice(0, 3).map(v => v.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60)),
      drawnVisible: [...document.querySelectorAll('.bible-verse-drawn')].every(v => getComputedStyle(v).opacity === '1'),
      headingVisible: [...document.querySelectorAll('.bible-chapter-heading')].every(v => getComputedStyle(v).opacity === '1')
    };
  })()` });
  console.log('VISIBILITY CHECK:', JSON.stringify(vis.value));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(process.env.TEMP + '/bible-shot/cdp-final.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved');
} catch (e) {
  console.error('PROBE ERROR:', e.message);
} finally {
  proc.kill();
  ws.close();
  process.exit(0);
}
