import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, validateDataset, validateRun } from './report.mjs';
import { build } from './live-report.mjs';

const load=(p)=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const suite=load('tools/proof-gauntlet/generated/cases.json');
const cases=validateDataset(suite,{pairs:[]});
const manifest=load('tools/proof-gauntlet/generated/manifest.json').cases;

test('new AI evaluation covers exactly the pre-labelled 19 files',()=>{
  assert.equal(cases.size,19);
  assert.equal(manifest.length,19);
  for(const name of ['claude-opus-5-5','claude-haiku-5-5']){
    const run=load('tools/proof-gauntlet/live-results/'+name+'.json');
    const rows=validateRun(cases,run,name);
    assert.equal(rows.size,19);
    assert.deepEqual([...rows.keys()].sort(),[...cases.keys()].sort());
  }
});

test('real AI release-hook decisions require both independent approvals',()=>{
  for(const name of ['claude-opus-5-5','claude-haiku-5-5']){
    const retry='tools/proof-gauntlet/live-results/'+name+'.retry.json';
    const results=[...load('tools/proof-gauntlet/live-results/'+name+'.json').results,...(fs.existsSync(path.join(ROOT,retry))?load(retry).results:[])];
    for(const row of results.filter(r=>r.outcome==='released')){
      assert.equal(row.secondOpinion,'confirmed',name+'/'+row.id+' has no second-model approval');
      assert.equal(row.thirdCheck,'confirmed',name+'/'+row.id+' has no Google approval');
      assert.equal(row.decision,'release');
    }
  }
});

test('counterfactual manifest points to a correct original task and label',()=>{
  const originals=load('eval/cases.json');
  const old=new Map(originals.cases.map(c=>[c.id,c]));
  for(const m of manifest){
    assert.ok(old.has(m.sourceCase),m.id+' missing base');
    assert.equal(old.get(m.sourceCase).expect,'release',m.id);
    assert.equal(old.get(m.sourceCase).milestone,cases.get(m.id).milestone);
    assert.equal(m.expected,cases.get(m.id).expect);
    const expected=m.transformation.startsWith('preserve:')?'release':'hold';
    assert.equal(expected,m.expected,m.id+' expected label inconsistent with mutation description');
  }
});

test('independently rebuilt fresh report has correct source and case dimensions',()=>{
  const {text,summary}=build();
  assert.equal(summary.cases,19);
  assert.match(text,/not a PayPal capture or payout/);
  assert.match(text,/Cross-run metamorphic/);
  assert.match(text,/Source file|Source|SHA-256/);
  assert.ok(Object.keys(summary.sourceHashes).length>=6);
  for(const model of Object.values(summary.models)){
    assert.equal(model.total,19);
    assert.equal(model.plannedBad,12);
    assert.equal(model.bad+model.technicalFailures.filter(x=>/^cf0(18|19)$/.test(x.id)).length,12);
    assert.equal(model.honest,7);
    assert.equal(model.plannedHonest,7);
    assert.equal(model.rows.length,19);
    assert.equal(model.relationsFailed.length,model.eligibleRelations-model.metRelations);
    assert.equal(model.mistakes.length,model.completed-model.correctAnswers);
    assert.equal(model.technicalFailures.length,model.total-model.completed);
    assert.ok(model.cost>0);
  }
});

test('API workspace limit is not counted as a successful rejection',()=>{
  const first=load('tools/proof-gauntlet/live-results/claude-opus-5-5.json');
  const errors=first.results.filter(r=>r.decision==='error');
  assert.deepEqual(errors.map(r=>r.id),['cf018','cf019']);
  for(const r of errors)assert.equal(r.pass,false,r.id+' API error scored as a pass');
  assert.equal(first.summary.passed,17);
  const {summary}=build();
  const opus=summary.models['claude-opus-5-5'];
  const haiku=summary.models['claude-haiku-5-5'];
  assert.deepEqual(opus.firstRunErrors.map(x=>x.id),['cf018','cf019']);
  assert.deepEqual(opus.retried,['cf018','cf019']);
  for(const id of opus.retried){
    const row=opus.rows.find(r=>r.id===id);
    assert.notEqual(row.decision,'error');
    assert.equal(row.retried,true);
  }
  assert.equal(opus.completed,19);
  assert.equal(opus.correctAnswers,19);
  assert.equal(opus.technicalFailures.length,0);
  assert.equal(opus.falseRelease,0);
  assert.equal(haiku.completed,19);
  assert.equal(haiku.correctAnswers,19);
  assert.equal(haiku.technicalFailures.length,0);
  assert.deepEqual(haiku.retried,[]);
});
