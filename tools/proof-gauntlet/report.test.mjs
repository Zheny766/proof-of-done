import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, validateDataset, validateRun, wilsonUpper, analyze, summarizeForged, build } from './report.mjs';
import fs from 'node:fs';

const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8'));
const dataset=read('eval/cases.json');
const pairs=read('tools/proof-gauntlet/pairs.json');
const opus=read('eval/results/claude-opus-5-5.json');
const haiku=read('eval/results/claude-haiku-5-5.json');
const forged=read('eval/results/forged-claude-haiku-5-5.json');
const clone = (o) => structuredClone(o);

test('source data is internally complete and all 28 relations are labelled consistently', () => {
  const cases=validateDataset(dataset,pairs);
  assert.equal(cases.size,57);
  assert.equal(pairs.pairs.length,28);
  assert.equal([...cases.values()].filter(c=>c.expect==='release').length,16);
  assert.equal([...cases.values()].filter(c=>c.expect==='hold').length,41);
});

test('Opus and Haiku source outcomes are independently validated', () => {
  const cases=validateDataset(dataset,pairs);
  for(const [name,raw] of [['claude-opus-5-5',opus],['claude-haiku-5-5',haiku]]) {
    const observed=validateRun(cases,raw,name);
    const result=analyze(cases,observed,pairs);
    assert.equal(result.cases,57);
    assert.equal(result.falseRelease,0);
    assert.equal(result.honestHeld,1);
    assert.equal(result.relationsPassed,27);
    assert.equal(result.pairsFullyCorrect,27);
    assert.deepEqual(result.errors.map(x=>x.id),['candles-long-honest']);
  }
});

test('a forged expected answer is never accepted as ground truth',()=>{
  const cases=validateDataset(dataset,pairs);
  const tampered=clone(opus);
  tampered.results.find(x=>x.id==='menu-short').expect='release';
  assert.throws(()=>validateRun(cases,tampered,'claude-opus-5-5'),/Ground truth changed/);
});

test('a forged pass field or wrong result is never silently counted as valid',()=>{
  const cases=validateDataset(dataset,pairs);
  const tampered=clone(opus);
  tampered.results.find(x=>x.id==='menu-short').outcome='released';
  assert.throws(()=>validateRun(cases,tampered,'claude-opus-5-5'),/Incorrect pass flag/);
});

test('missing, duplicated and unknown cases cause hard failure',()=>{
  const cases=validateDataset(dataset,pairs);
  let tampered=clone(opus);
  tampered.results.pop();
  assert.throws(()=>validateRun(cases,tampered,'claude-opus-5-5'),/missing/);
  tampered=clone(opus);
  tampered.results.push({...tampered.results[0]});
  assert.throws(()=>validateRun(cases,tampered,'claude-opus-5-5'),/Unknown\/duplicate/);
});

test('a metamorphic pair cannot silently point at different contracts',()=>{
  const faulty=clone(pairs);
  faulty.pairs[0].b='candles-honest';
  assert.throws(()=>validateDataset(dataset,faulty),/Different contract/);
});

test('a metamorphic relation cannot be chosen to flatter actual model output',()=>{
  const faulty=clone(pairs);
  const i=faulty.pairs.findIndex(p=>p.relation==='flip');
  faulty.pairs[i].relation='preserve';
  assert.throws(()=>validateDataset(dataset,faulty),/Incorrect relation label/);
});

test('forged-reviewer drill is a different experimental condition',()=>{
  const cases=validateDataset(dataset,pairs);
  const result=summarizeForged(cases,forged);
  assert.equal(result.badHaiku.good,39);
  assert.equal(result.badHaiku.total,41);
  assert.deepEqual(result.bothMissed,['email-screenshot-only']);
  const tampered=clone(forged);
  tampered.results[0].expect='hold';
  assert.throws(()=>summarizeForged(cases,tampered),/Bad forged case/);
});

test('Wilson bound warns that zero observed errors is not a guarantee',()=>{
  assert.ok(wilsonUpper(0,41)>0.08&&wilsonUpper(0,41)<0.09);
  assert.equal(wilsonUpper(0,0),null);
});

test('report is reproducible and cost comes from per-case records',()=>{
  const {summary,text}=build();
  assert.ok(text.includes('PayPal capture or payout'));
  assert.equal(summary.caseCount,57);
  assert.equal(summary.models['claude-opus-5-5'].costUsd,7.7967);
  assert.equal(summary.models['claude-haiku-5-5'].costUsd,0.7915);
});
