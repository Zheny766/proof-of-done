// The README screenshots, taken from a running instance (simulated or sandbox). It creates the deals
// it photographs: two demo scenarios and a project with stage 1 paid.
// Usage: CHROME_PATH=/path/to/chrome node scripts/screenshots.mjs http://localhost:3000 docs/screenshots
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core'; // npm i -D playwright-core, or point this at any Playwright install

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const api = async (p, { key, body } = {}) => {
  const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { ...(key ? { 'x-milestone-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(`${p} ${res.status}: ${JSON.stringify(data)}`);
  return data;
};
const settle = async (id, key) => {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const { milestone } = await api(`/api/escrow/milestones/${id}`, { key });
    if (milestone.status !== 'reviewing' && milestone.reviews.at(-1)?.finishedAt) return milestone;
  }
};
async function demo(scenario) {
  const d = await api('/api/demo/start', { body: { scenario } });
  await api('/api/demo/deliver', { key: d.freelancerKey, body: { id: d.id } });
  await settle(d.id, d.clientKey);
  return d;
}

const honest = await demo('honest');
const cheater = await demo('cheater');
// A project with stage 1 paid and stage 2 waiting.
const proj = await api('/api/escrow/projects', {
  body: {
    title: 'Website for a bakery', description: 'Crumb & Co: a one-page site, in two stages.', clientName: 'Maya Chen', clientEmail: 'maya@ember-oak.example',
    freelancerName: 'Diego Alvarez', freelancerEmail: 'diego@studio.example', releaseThreshold: 0.7,
    stages: [
      { title: 'Design mockup', amount: 120, criteria: ['A homepage mockup is delivered as a PNG', 'The mockup shows the menu and opening hours'] },
      { title: 'Live site', amount: 380, criteria: ['The page is live at a public URL', 'The menu lists at least 6 items with prices'] },
    ],
  },
});
const [s1] = proj.milestones;
const { orderId } = await api(`/api/escrow/milestones/${s1.id}/order`, { key: proj.clientKey, body: {} });
await api(`/api/escrow/milestones/${s1.id}/authorize`, { key: proj.clientKey, body: { orderId } });
const fd = new FormData();
fd.set('notes', 'A homepage mockup is delivered as a PNG. The mockup shows the menu and opening hours.');
await fetch(`${base}/api/escrow/milestones/${s1.id}/submit`, { method: 'POST', headers: { 'x-milestone-key': proj.freelancerKey }, body: fd });
await settle(s1.id, proj.clientKey);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
const page = await ctx.newPage();
const hideDev = () => page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
async function shot(name, url, { full = false, clip, before } = {}) {
  await page.goto(base + url, { waitUntil: 'networkidle' });
  await hideDev();
  if (before) await before();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: full, ...(clip && { clip }) });
  console.log('saved', name);
}
await shot('home', '/');
await shot('deal-paid', `/m/${honest.id}?key=${honest.clientKey}`, { full: true });
await shot('deal-cheater', `/m/${cheater.id}?key=${cheater.clientKey}`, { full: true });
await shot('project', `/m/${proj.milestones[1].id}?key=${proj.clientKey}`, { clip: { x: 0, y: 0, width: 1440, height: 900 } });
await shot('jobs', '/jobs', { full: true });
await shot('demo', '/demo', { full: true });
for (const [name, page_] of [['dashboard-trust', 'Trust & PayPal'], ['dashboard-agents', 'Agents & job board']]) {
  await shot(name, '/dashboard', {
    before: async () => {
      await page.getByText('Escrow pipeline: where every dollar is right now').waitFor({ timeout: 90_000 });
      await page.getByRole('button', { name: page_ }).click();
      await page.waitForTimeout(3000);
    },
  });
}
await browser.close();
