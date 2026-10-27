// Renders the demo deliveries: the Ember & Oak menu with the full logo (12 items, and a 10-item
// variant) and a brunch menu that is only half done. Committed; rerun only when they change:
//   PLAYWRIGHT_CORE=/path/to/playwright-core CHROMIUM=/path/to/chrome node demo/files/make.mjs
import path from 'node:path';
import { createRequire } from 'node:module';

const out = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

// An oak leaf: rounded lobes along a central vein, plus a stem.
const lobes = [[27, 11, 4.6], [21.5, 16, 4.6], [32.5, 16, 4.6], [19.5, 23.5, 5], [34.5, 23.5, 5], [21, 31, 4.8], [33, 31, 4.8], [24.5, 37.5, 4.4], [29.5, 37.5, 4.4]];
const oak = `<svg width="64" height="64" viewBox="0 0 54 54"><circle cx="27" cy="27" r="26" fill="#3b2a1a"/>
  <g fill="#d9a441">${lobes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}<ellipse cx="27" cy="24" rx="6" ry="15"/></g>
  <path d="M27 9v34M27 44v5" stroke="#3b2a1a" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M27 18l-5-3M27 18l5-3M27 25l-6-2M27 25l6-2M27 32l-5-1.5M27 32l5-1.5" stroke="#3b2a1a" stroke-width="1" stroke-linecap="round"/></svg>`;
const style = `body{font-family:Georgia,serif;color:#2b1d12;margin:48px 56px} h1{margin:0;font-size:34px;letter-spacing:1px} .head{display:flex;gap:16px;align-items:center;border-bottom:2px solid #3b2a1a;padding-bottom:14px;margin-bottom:22px} h2{font-size:18px;text-transform:uppercase;letter-spacing:2px;margin:22px 0 8px} .row{display:flex;justify-content:space-between;font-size:16px;padding:5px 0;border-bottom:1px dotted #b9a68f} .tag{font-size:13px;color:#6b5844}`;
const rows = (l) => l.map(([n, p]) => `<div class="row"><span>${n}</span><span>$${p}</span></div>`).join('');
const head = `<div class="head">${oak}<div><h1>EMBER &amp; OAK</h1><div class="tag">Coffee roastery &amp; cafe · 214 Linden Street · open daily 7am-6pm</div></div></div>`;
const coffee = [['Espresso', '3.00'], ['Americano', '3.50'], ['Flat white', '4.25'], ['Cappuccino', '4.25'], ['Oat latte', '4.75'], ['Pour-over of the day', '5.00']];
const page = (body) => `<html><head><style>${style}</style></head><body>${body}</body></html>`;
const files = {
  'ember-oak-menu.pdf': page(`${head}<h2>Coffee</h2>${rows(coffee)}<h2>Not coffee</h2>${rows([['Chai latte', '4.50'], ['Hot chocolate', '4.00'], ['Fresh orange juice', '4.50']])}<h2>Bakery</h2>${rows([['Butter croissant', '3.25'], ['Cardamom bun', '3.75'], ['Banana bread slice', '3.50']])}`),
  'winter-menu.pdf': page(`${head}<h2>Coffee</h2>${rows(coffee)}<h2>Winter specials</h2>${rows([['Gingerbread latte', '5.25'], ['Spiced hot chocolate', '4.50'], ['Mulled apple cider', '4.25'], ['Cinnamon bun', '3.75']])}`),
  'brunch-menu-draft.pdf': page(`<h1 style="margin-bottom:20px">Menu</h1>${rows([['Espresso', '3.00'], ['Americano', '3.50'], ['Cappuccino', '4.25'], ['Latte', '4.50'], ['Croissant', '3.25'], ['Muffin', '3.00']])}`),
};
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage();
for (const [name, html] of Object.entries(files)) {
  await tab.setContent(html);
  await tab.pdf({ path: path.join(out, name), format: 'A4', printBackground: true });
}
await browser.close();
console.log('demo files written to', out);
