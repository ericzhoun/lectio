// Temporary visual verification for the daily-reading refinements.
// Walks the anonymous daily flow in headless Edge and screenshots each state.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = 'http://localhost:4321';
const out = 'D:/workplace/lectio/.astro/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
p.setDefaultTimeout(20000);

const report = {};

// 1 — Silencio: mid-breath swell, then settled state.
await p.goto(`${base}/today/silencio?lang=en`, { waitUntil: 'load' });
await p.waitForTimeout(1600);
await p.screenshot({ path: `${out}/01-silencio-midbreath.png` });
report.hintMid = await p.textContent('.breath-hint');
await p.waitForTimeout(9800);
await p.screenshot({ path: `${out}/02-silencio-settled.png` });
report.hintAfter = await p.textContent('.breath-hint');
report.actionReadyAfter10s = await p.$eval('.action-bar', (el) => el.classList.contains('ready'));

// 2 — Lectio (unchanged big passage) and Meditatio (shared compact passage).
await p.goto(`${base}/today/lectio?lang=en`, { waitUntil: 'load' });
await p.screenshot({ path: `${out}/03-lectio.png` });
await p.goto(`${base}/today/meditatio?lang=en`, { waitUntil: 'load' });
await p.screenshot({ path: `${out}/04-meditatio-form.png` });
report.passageOnMeditatio = (await p.textContent('.passage-again'))?.slice(0, 60);

// 3 — Submit meditatio, land on oratio: passage must be visible there too.
await p.fill('#step_text', 'The phrase "Lazarus, come out" stayed with me.');
await p.click('.action-bar button[type=submit]');
await p.waitForURL('**/meditatio?saved=1', { waitUntil: 'load' });
await p.screenshot({ path: `${out}/05-meditatio-saved.png` });
await p.click('.action-bar a.advance');
await p.waitForURL('**/oratio', { waitUntil: 'load' });
await p.screenshot({ path: `${out}/06-oratio.png` });
report.passageOnOratio = (await p.textContent('.passage-again'))?.slice(0, 60);

// 4 — Submit oratio, look at actio, then contemplatio (passage + ball).
await p.fill('#step_text', 'I want to ask for courage to speak honestly this week.');
await p.click('.action-bar button[type=submit]');
await p.waitForURL('**/oratio?saved=1', { waitUntil: 'load' });
await p.click('.action-bar a.advance');
await p.waitForURL('**/actio', { waitUntil: 'load' });
await p.screenshot({ path: `${out}/07-actio.png` });
report.passageOnActio = (await p.textContent('.passage-again'))?.slice(0, 60);

await p.goto(`${base}/today/contemplatio?lang=en`, { waitUntil: 'load' });
await p.waitForTimeout(1400);
await p.screenshot({ path: `${out}/08-contemplatio-breath.png` });
report.passageOnContemplatio = (await p.textContent('.passage-again'))?.slice(0, 60);

// 5 — Chinese silencio: localized hint text.
const ctxZh = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const pz = await ctxZh.newPage();
await pz.goto(`${base}/today/silencio?lang=zh`, { waitUntil: 'load' });
await pz.waitForTimeout(900);
report.hintZh = await pz.textContent('.breath-hint');
await pz.screenshot({ path: `${out}/09-silencio-zh.png` });

// 6 — Desktop width for the ball sizing.
const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pd = await ctxD.newPage();
await pd.goto(`${base}/today/silencio?lang=en`, { waitUntil: 'load' });
await pd.waitForTimeout(1200);
await pd.screenshot({ path: `${out}/10-silencio-desktop.png` });

console.log(JSON.stringify(report, null, 2));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS');
await browser.close();
