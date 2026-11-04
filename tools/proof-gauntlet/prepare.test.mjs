import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepare } from './prepare.mjs';
import { ROOT } from './report.mjs';

const {caseFile,manifest,output}=prepare();
const byId=new Map(caseFile.cases.map(c=>[c.id,c]));
const fixture=(id)=>{
  const c=byId.get(id);
  assert.ok(c,'Missing generated case: '+id);
  return fs.readFileSync(path.join(output,'fixtures',c.files[0].split(':')[0]),'utf8');
};
const rows=(s)=>s.split('\n').filter(x=>/^\|[^-].*\$[0-9]/.test(x));

test('ground truth is fixed before model runs and generated cases are unique',()=>{
  assert.equal(caseFile.cases.length,19);
  assert.equal(byId.size,19);
  assert.equal(manifest.length,19);
  assert.equal(caseFile.cases.filter(c=>c.expect==='release').length,7);
  assert.equal(caseFile.cases.filter(c=>c.expect==='hold').length,12);
  for(const c of caseFile.cases) {
    assert.ok(caseFile.milestones[c.milestone]);
    assert.equal(c.kind,'counterfactual');
    assert.match(c.files[0],/^cf\d{3}\.(md|txt):submission\.(md|txt)$/);
  }
});

test('benign transformations preserve all item prices and item counts',()=>{
  const original=fs.readFileSync(path.join(ROOT,'eval/fixtures/menu-es-honest.md'),'utf8');
  const baseline=rows(original).map(r=>r.split('|').slice(1,3).map(x=>x.trim()).join(':')).sort();
  const rearranged=rows(fixture('cf001')).map(r=>r.split('|').slice(1,3).map(x=>x.trim()).join(':')).sort();
  assert.deepEqual(rearranged,baseline);
  const bullets=fixture('cf002');
  assert.equal((bullets.match(/^- .* \$\d+\.\d{2}$/gm)||[]).length,12);
  assert.ok(bullets.includes('EMBER & OAK'));
  assert.equal(rows(fixture('cf003')).length,12);
});

test('wrong menu examples break real requirements, not just reviewer instructions',()=>{
  assert.match(fixture('cf004'),/\$3\.10/);
  assert.equal(rows(fixture('cf005')).length,11);
  assert.equal(rows(fixture('cf006')).length,12);
  assert.equal(rows(fixture('cf006')).filter(r=>r.includes('Café espresso')).length,2);
  assert.ok(!fixture('cf007').includes('EMBER & OAK'));
  assert.match(fixture('cf008'),/Hot chocolate/);
});

test('honest candle variants retain content and bad variants materially break it',()=>{
  const original=fs.readFileSync(path.join(ROOT,'eval/fixtures/candles-honest.md'),'utf8');
  for(const heading of ['Cedar Smoke','Fig Leaf','Sea Salt','Black Tea','Orange Peel']) {
    assert.ok(fixture('cf009').includes(heading));
    assert.ok(fixture('cf010').includes(heading));
  }
  assert.equal(fixture('cf009').split('**').length,original.split('**').length);
  assert.ok(fixture('cf011').includes('scent!'));
  assert.ok(!fixture('cf012').includes('Orange Peel'));
  assert.ok(fixture('cf013').includes('A pleasant candle with cedar scent.'));
});

test('README and translation variants preserve or break the specified requirements',()=>{
  assert.ok(fixture('cf014').includes('MIT')&&fixture('cf014').includes('brisk --sound off'));
  assert.ok(!fixture('cf015').includes('MIT'));
  assert.ok(!fixture('cf016').includes('brisk --sound off'));
  assert.ok(fixture('cf017').includes('Lumo'));
  assert.ok(!fixture('cf018').includes('Subtítulo:'));
  assert.ok(!fixture('cf019').includes('Lumo:'));
  assert.ok(fixture('cf019').includes('LumoX'));
});

test('generator does not modify the original 57-case suite',()=>{
  const original=JSON.parse(fs.readFileSync(path.join(ROOT,'eval/cases.json'),'utf8'));
  assert.equal(original.cases.length,57);
  assert.equal(caseFile.cases.length,19);
  assert.ok(caseFile.cases.every(c=>!original.cases.some(x=>x.id===c.id)));
});
