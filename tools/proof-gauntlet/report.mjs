// Proof Gauntlet: deterministic, read-only analysis of recorded model calls.
// Does not call AI models or PayPal. Node.js built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOME = path.join(ROOT, 'tools/proof-gauntlet');
const MODELS = ['claude-opus-5-5', 'claude-haiku-5-5'];
const SRC = (name) => path.join(ROOT, 'eval/results', name + '.json');
const fromJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const must = (condition, message) => { if (!condition) throw new Error(message); };
const count = (rows, pred) => rows.filter(pred).length;
const fmt = (n) => Number(n).toFixed(2);
const percent = (x,n) => n ? (x/n*100).toFixed(1) + '%' : 'n/a';
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const tick = String.fromCharCode(96);

export function validateDataset(dataset, relationFile) {
  must(Array.isArray(dataset.cases) && dataset.milestones, 'Invalid suite');
  const cases = new Map();
  for (const c of dataset.cases) {
    must(c.id && !cases.has(c.id) && dataset.milestones[c.milestone], 'Invalid case: ' + c.id);
    must(['hold','release'].includes(c.expect), 'Invalid label: ' + c.id);
    cases.set(c.id,c);
  }
  must(Array.isArray(relationFile.pairs), 'No relation pairs');
  const seen = new Set();
  for (const p of relationFile.pairs) {
    must(cases.has(p.a) && cases.has(p.b) && p.a!==p.b, 'Unknown pair: '+p.a+'/'+p.b);
    const a=cases.get(p.a), b=cases.get(p.b);
    must(a.milestone===b.milestone, 'Different contract in pair '+p.a+'/'+p.b);
    must((p.relation==='preserve' && a.expect===b.expect) || (p.relation==='flip' && a.expect!==b.expect), 'Incorrect relation label '+p.a+'/'+p.b);
    const k=[p.a,p.b].sort().join('|');
    must(!seen.has(k), 'Duplicated pair '+k);
    seen.add(k);
  }
  return cases;
}

export function validateRun(cases, run, name) {
  must(Array.isArray(run.results) && run.summary?.reviewModel===name, 'Invalid recorded run '+name);
  must(run.summary.gemini===true, 'The saved run did not include Gemini configuration');
  const map = new Map();
  for (const r of run.results) {
    must(cases.has(r.id) && !map.has(r.id), 'Unknown/duplicate result '+r.id);
    must(r.expect===cases.get(r.id).expect, 'Ground truth changed for '+r.id);
    must(['held','released'].includes(r.outcome), 'Unrecognized result '+r.id);
    must(r.pass===(r.decision!=='error'&&((r.expect==='release')===(r.outcome==='released'))), 'Incorrect pass flag '+r.id);
    must(Number.isFinite(r.cost) && r.cost>=0 && Number.isFinite(r.seconds) && r.seconds>=0, 'Invalid cost or latency '+r.id);
    must(typeof r.thirdCheck==='string', 'Missing third check field '+r.id);
    map.set(r.id,r);
  }
  must(map.size===cases.size, name+' missing '+(cases.size-map.size)+' cases');
  return map;
}

export function wilsonUpper(successes, sampleSize) {
  if (!sampleSize) return null;
  const z=1.96, p=successes/sampleSize, zz=z*z;
  return (p+zz/(2*sampleSize)+z*Math.sqrt((p*(1-p)+zz/(4*sampleSize))/sampleSize))/(1+zz/sampleSize);
}

export function analyze(cases, results, pairs) {
  const rows=[...results.values()];
  const honest=rows.filter(r=>r.expect==='release');
  const bad=rows.filter(r=>r.expect==='hold');
  const relations=pairs.pairs.map(p=>{
    const a=results.get(p.a), b=results.get(p.b);
    return {...p, observedA:a.outcome, observedB:b.outcome, relationMet:p.relation==='preserve' ? a.outcome===b.outcome : a.outcome!==b.outcome, bothCorrect:a.pass&&b.pass};
  });
  const seconds=rows.map(r=>r.seconds).sort((a,b)=>a-b);
  const totalCost=rows.reduce((sum,r)=>sum+r.cost,0);
  return {
    cases:rows.length, honest:honest.length, bad:bad.length,
    falseRelease:count(bad,r=>r.outcome==='released'),
    honestHeld:count(honest,r=>r.outcome==='held'),
    reviewerReleasePathBad:count(bad,r=>r.reviewerTriedToPay===true),
    escalated:count(rows,r=>r.decision==='escalate'),
    geminiConsulted:count(rows,r=>r.thirdCheck!=='not asked'),
    costUsd:Number(totalCost.toFixed(4)),
    medianSeconds:seconds[Math.floor((seconds.length-1)/2)],
    p95Seconds:seconds[Math.ceil(seconds.length*.95)-1],
    relationsPassed:count(relations,r=>r.relationMet),
    pairsFullyCorrect:count(relations,r=>r.bothCorrect),
    relations,
    errors:rows.filter(r=>!r.pass).map(r=>({id:r.id,expected:r.expect,actual:r.outcome})),
    byTask:[...new Set([...cases.values()].map(c=>c.milestone))].map(task=>{
      const rs=rows.filter(r=>cases.get(r.id).milestone===task);
      return {task, cases:rs.length, errors:count(rs,r=>!r.pass)};
    }),
  };
}

export function summarizeForged(cases, raw) {
  must(Array.isArray(raw.results), 'No forged-audit data');
  const seen=new Set();
  for (const r of raw.results) {
    must(cases.has(r.id) && !seen.has(r.id) && r.expect===cases.get(r.id).expect, 'Bad forged case '+r.id);
    seen.add(r.id);
  }
  must(seen.size===cases.size,'Incomplete forged data');
  const bad=raw.results.filter(r=>r.expect==='hold');
  const honest=raw.results.filter(r=>r.expect==='release');
  const paired=(rs,key)=>({good:count(rs,r=>r[key]===true),total:count(rs,r=>typeof r[key]==='boolean')});
  return {badHaiku:paired(bad,'secondOk'),badGemini:paired(bad,'thirdOk'),
    honestHaiku:paired(honest,'secondOk'),honestGemini:paired(honest,'thirdOk'),
    bothMissed:bad.filter(r=>r.secondOk===false&&r.thirdOk===false).map(r=>r.id)};
}

export function build() {
  const files=['eval/cases.json','tools/proof-gauntlet/pairs.json',...MODELS.map(m=>'eval/results/'+m+'.json'),'eval/results/forged-claude-haiku-5-5.json'];
  const hashes=Object.fromEntries(files.map(f=>[f,sha256(path.join(ROOT,f))]));
  const dataset=fromJson(path.join(ROOT,files[0])), pairs=fromJson(path.join(ROOT,files[1]));
  const cases=validateDataset(dataset,pairs);
  const models={};
  for(const name of MODELS) models[name]=analyze(cases,validateRun(cases,fromJson(SRC(name)),name),pairs);
  const forged=summarizeForged(cases,fromJson(SRC('forged-claude-haiku-5-5')));
  const o=models[MODELS[0]],h=models[MODELS[1]];
  const lines=[
    '# Proof Gauntlet — Independent Model Evaluation',
    '',
    '**Baseline:** 4 November 2026, commit '+tick+'91d76c1'+tick+'. Analysis generated from existing real-model response files; no new AI or PayPal requests.',
    '',
    '## Method and important boundaries',
    '',
    '- **57 labelled deliveries**: 16 honest (release expected) and 41 deliberately wrong or adversarial (hold expected).',
    '- **Two configurations**: Claude Opus + Haiku + Gemini; Claude Haiku + Sonnet + Gemini.',
    '- **28 curated counterfactual pairs**, reused from those same 57 deliveries. The pairs do **not** increase the evaluation sample size.',
    '- The saved evaluation uses **simulated payment mode**. A release means the reviewer reached its release hook, **not** a real PayPal capture or payout.',
    '- Only cases entering the independent-audit path invoke Gemini; not every case used all three models.',
    '',
    '## Measured results',
    '',
    '| Measure | Opus / Haiku / Gemini | Haiku / Sonnet / Gemini |',
    '|---|---:|---:|',
  ];
  const add=(name,fn)=>lines.push('| '+name+' | '+fn(o)+' | '+fn(h)+' |');
  add('Complete labelled submissions',s=>s.cases);
  add('Bad submissions reaching release path before independent checks',s=>s.reviewerReleasePathBad+'/'+s.bad);
  add('Bad submissions ultimately marked released',s=>s.falseRelease+'/'+s.bad);
  add('Honest submissions held',s=>s.honestHeld+'/'+s.honest);
  add('Human escalation verdicts',s=>s.escalated);
  add('Gemini consulted',s=>s.geminiConsulted);
  add('Counterfactual relationship checks passed',s=>s.relationsPassed+'/'+s.relations.length);
  add('Pairs with both individual answers correct',s=>s.pairsFullyCorrect+'/'+s.relations.length);
  add('Sum of recorded per-case costs',s=>'$'+fmt(s.costUsd));
  add('Median / 95th percentile evaluation time',s=>s.medianSeconds+'s / '+s.p95Seconds+'s');
  lines.push('',
    '**Observed:** Both configurations stopped all 41 wrong deliveries. Both held the same legitimate 17,000-word candle-description file. The extra models prevented release after the reviewer entered the release path on 10 Opus cases and 8 Haiku cases.',
    '',
    '**Do not extrapolate 0/41 to 100% security.** Under a hypothetical independent identically distributed sample, the Wilson 95% upper bound for a zero-error rate over 41 cases is '+percent(wilsonUpper(0,41),1)+'. These attacks are prepared and correlated, so even that statistical assumption is not justified for deployment.',
    '',
    '## Fresh counterfactuals: a second recorded AI run',
    '',
    'A separate generator produced **19 additional, pre-labelled cases**: 7 honest and 12 broken. These were evaluated in a **new recorded live-model run** ([full case-level report](PROOF-GAUNTLET-LIVE.md)): Haiku + Sonnet + Gemini correctly judged 19/19; Opus + Haiku + Gemini correctly judged 17/17 completed cases, with 2 API workspace-limit errors **excluded** from the accuracy denominator. These 19 are related variants, not independent samples; no PayPal captures were performed. The fixture generator is `npm run gauntlet:prepare`.',
    '',
    '## Counterfactual and metamorphic relations',
    '',
    'A preserve pair expects the same decision after a benign change. A flip pair expects opposite decisions after a material change. All pairs use the same contract criteria. Curated pairs are correlations among existing evidence, not new model calls.',
    '',
    '| First case → second case | Expected | Opus panel | Haiku panel | Reason |',
    '|---|---|---|---|---|'
  );
  for(const a of o.relations) {
    const b=h.relations.find(r=>r.a===a.a&&r.b===a.b);
    lines.push('| '+cell(a.a)+' → '+cell(a.b)+' | '+a.relation+' | '+(a.relationMet?'PASS':'FAIL')+' | '+(b.relationMet?'PASS':'FAIL')+' | '+cell(a.reason)+' |');
  }
  lines.push('',
    '## Deliberately forged lead reviewer',
    '',
    'This separate drill **artificially supplied** independent auditors with a lead-reviewer answer asserting all criteria passed. It was not an observed compromise of the lead model.',
    '',
    '- Haiku caught bad deliveries: '+forged.badHaiku.good+'/'+forged.badHaiku.total+' cases where it returned a verdict.',
    '- Gemini caught bad deliveries: '+forged.badGemini.good+'/'+forged.badGemini.total+' cases where it returned a verdict.',
    '- Honest cases confirmed: Haiku '+forged.honestHaiku.good+'/'+forged.honestHaiku.total+', Gemini '+forged.honestGemini.good+'/'+forged.honestGemini.total+'.',
    '- Both independent auditors missed: '+(forged.bothMissed.join(', ')||'none')+'. The follow-up mitigation in reviewer.ts requires an actual sandbox code execution before payment for code tasks; that is a separate code change, not a retroactive improvement of these recorded answers.',
    '',
    '## Known failures / caveats'
  );
  for(const name of MODELS) lines.push('- '+name+': '+(models[name].errors.map(e=>e.id+' (expected '+e.expected+', got '+e.actual+')').join('; ')||'no labelled errors in this suite')+'.');
  lines.push('',
    '## Reproducibility',
    '',
    '- Run: '+tick+'node tools/proof-gauntlet/report.mjs'+tick+'.',
    '- Verify saved report: '+tick+'node tools/proof-gauntlet/report.mjs --check'+tick+'.',
    '- Unit tests: '+tick+'node --test tools/proof-gauntlet/report.test.mjs'+tick+'.',
    '- The generator validates every case ID, every expected label, every result and every pair relation before producing this report.',
    '- Costs are summed from recorded **per-case cost** fields, not a partial-run budget counter left after merging results.',
    '',
    '| Input | SHA-256 |',
    '|---|---|'
  );
  for(const [file,hash] of Object.entries(hashes)) lines.push('| '+tick+file+tick+' | '+tick+hash+tick+' |');
  lines.push('',
    '## Limitations',
    '',
    '1. This was a team-built dataset, not independent external certification. Many cases are correlated variants.',
    '2. Neither the release-hook outcome nor the artificially forged reviewer is a real PayPal payment.',
    '3. Some code scenarios require independent execution checks; model agreement alone is not proof.',
    '4. Changing model versions, prompts or fixtures may change outcomes. Re-run after major modifications.',
    '5. The PayPal Sandbox transactions are documented separately at /sandbox.',
    ''
  );
  return {text:lines.join('\n'),summary:{baselineCommit:'91d76c1',date:'2026-11-04',caseCount:cases.size,hashes,models,forged}};
}

export function run(check=false) {
  const {text,summary}=build();
  const doc=path.join(ROOT,'docs/PROOF-GAUNTLET.md');
  const json=path.join(HOME,'summary.json');
  const jtext=JSON.stringify(summary,null,2)+'\n';
  if(check) {
    must(fs.existsSync(doc)&&fs.readFileSync(doc,'utf8')===text,'Report out of date');
    must(fs.existsSync(json)&&fs.readFileSync(json,'utf8')===jtext,'Summary JSON out of date');
    console.log('Proof Gauntlet report verified.');
  } else {
    fs.writeFileSync(doc,text);
    fs.writeFileSync(json,jtext);
    console.log('Wrote docs/PROOF-GAUNTLET.md and tools/proof-gauntlet/summary.json');
  }
  for(const [name,s] of Object.entries(summary.models)) console.log(name+': '+s.cases+' cases, false releases '+s.falseRelease+', honest holds '+s.honestHeld+', metamorphic '+s.relationsPassed+'/'+s.relations.length+', cost $'+fmt(s.costUsd));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) run(process.argv.includes('--check'));
