// Read-only, reproducible report of *new* counterfactual cases actually run through AI.
// Sources: pre-labelled generated cases + saved API responses, not PayPal money.
// Usage: node tools/proof-gauntlet/live-report.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, validateDataset, validateRun } from './report.mjs';

const HOME=path.join(ROOT,'tools/proof-gauntlet');
const RESULTS=path.join(HOME,'live-results');
const OUTPUT=path.join(ROOT,'docs/PROOF-GAUNTLET-LIVE.md');
const JSONOUT=path.join(RESULTS,'summary.json');
const MODELS=['claude-opus-5-5','claude-haiku-5-5'];
// A case whose first run ended in an API error may be run again on its own; the retry file holds only those cases.
const retryFile=(name)=>path.join(RESULTS,name+'.retry.json');
const read=(file)=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=(file)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const must=(ok,msg)=>{if(!ok)throw Error(msg)};
const count=(a,f)=>a.filter(f).length;
const t=String.fromCharCode(96);
const md=(str)=>String(str).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const dollars=(x)=>'$'+Number(x).toFixed(2);
const median=(a)=>a.length?a.slice().sort((a,b)=>a-b)[Math.floor((a.length-1)/2)]:0;
const p95=(a)=>a.length?a.slice().sort((a,b)=>a-b)[Math.ceil(.95*a.length)-1]:0;

export function build() {
  const files=['tools/proof-gauntlet/generated/cases.json','tools/proof-gauntlet/generated/manifest.json',
    ...MODELS.flatMap(m=>['eval/results/'+m+'.json','tools/proof-gauntlet/live-results/'+m+'.json']),
    'tools/proof-gauntlet/live-results/claude-opus-5-5.raw.json',
    ...MODELS.map(m=>'tools/proof-gauntlet/live-results/'+m+'.retry.json').filter(f=>fs.existsSync(path.join(ROOT,f)))];
  const hashes=Object.fromEntries(files.map(f=>[f,hash(path.join(ROOT,f))]));
  const set=read(path.join(ROOT,files[0]));
  const manifest=read(path.join(ROOT,files[1]));
  const original=read(path.join(ROOT,'eval/cases.json'));
  const cs=validateDataset(set,{pairs:[]});
  const base=new Map(original.cases.map(c=>[c.id,c]));
  must(Array.isArray(manifest.cases)&&manifest.cases.length===cs.size,'Incorrect manifest length');
  const refs=new Map();
  for(const item of manifest.cases){
    must(cs.has(item.id)&&base.has(item.sourceCase),'Unknown generated/base case '+item.id);
    must(!refs.has(item.id),'Duplicate manifest ID');
    const c=cs.get(item.id), old=base.get(item.sourceCase);
    must(old.milestone===c.milestone,'Different contract for '+item.id);
    must(old.expect==='release'&&['release','hold'].includes(item.expected),'Source expected release mismatch');
    must(c.expect===item.expected,'Output label was changed for '+item.id);
    const tag=item.transformation?.split(':')[0];
    must(['preserve','flip'].includes(tag),'Unspecified relation '+item.id);
    must((tag==='preserve')===(old.expect===item.expected),'Incorrect relation expected for '+item.id);
    refs.set(item.id,{...item,relation:tag});
  }
  const models={};
  for(const name of MODELS){
    const live=read(path.join(RESULTS,name+'.json'));
    const saved=read(path.join(ROOT,'eval/results',name+'.json'));
    const current=validateRun(cs,live,name);
    const firstErrors=[...current.values()].filter(r=>r.decision==='error').map(r=>({id:r.id,summary:r.summary}));
    const retried=new Set();
    if(fs.existsSync(retryFile(name))){
      const retry=read(retryFile(name));
      must(retry.summary?.auditModel===live.summary.auditModel,'Retry used a different second opinion for '+name);
      const ids=retry.results?.map(r=>r.id)??[];
      must(ids.length&&ids.every(id=>current.get(id)?.decision==='error'),'A retry may only re-run cases whose first run was an API error');
      for(const [id,r] of validateRun(new Map(ids.map(id=>[id,cs.get(id)])),retry,name)){current.set(id,r);retried.add(id);}
    }
    const older=validateRun(new Map(original.cases.map(c=>[c.id,c])),saved,name);
    const rows=[...current.values()];
    const evaluated=rows.filter(r=>r.decision!=='error');
    const honest=evaluated.filter(r=>r.expect==='release'), bad=evaluated.filter(r=>r.expect==='hold');
    const technicalFailures=rows.filter(r=>r.decision==='error').map(r=>({id:r.id,summary:r.summary}));
    const mapped=rows.map(r=>{
      const ref=refs.get(r.id), previous=older.get(ref.sourceCase);
      must(previous,'No previous comparison for '+r.id);
      return {
        id:r.id,sourceCase:ref.sourceCase,transformation:ref.transformation,relation:ref.relation,
        expected:r.expect,observed:r.outcome,decision:r.decision,pass:r.pass,
        reviewerTriedToPay:r.reviewerTriedToPay,secondOpinion:r.secondOpinion,thirdCheck:r.thirdCheck,
        baseline:previous.outcome,relationMet:r.decision==='error'?null:(ref.relation==='preserve'?previous.outcome===r.outcome:previous.outcome!==r.outcome),
        seconds:r.seconds,cost:r.cost,retried:retried.has(r.id),
      };
    });
    models[name]={
      runDate:live.summary.date,
      auditModel:live.summary.auditModel,geminiConfigured:live.summary.gemini,
      total:rows.length,completed:evaluated.length, bad:bad.length,honest:honest.length,
      plannedBad:count(rows,r=>r.expect==='hold'),plannedHonest:count(rows,r=>r.expect==='release'),
      falseRelease:count(bad,r=>r.outcome==='released'), falseHold:count(honest,r=>r.outcome==='held'),
      badLeadReleasePath:count(bad,r=>r.reviewerTriedToPay),infrastructureErrors:technicalFailures.length,technicalFailures,
      firstRunErrors:firstErrors,retried:[...retried],
      escalated:count(rows,r=>r.decision==='escalate'),thirdInvoked:count(rows,r=>r.thirdCheck!=='not asked'),
      metRelations:count(mapped,r=>r.relationMet===true),eligibleRelations:count(mapped,r=>r.relationMet!==null),correctAnswers:count(evaluated,r=>r.pass),
      cost:Number(rows.reduce((sum,r)=>sum+r.cost,0).toFixed(4)),
      medianSeconds:median(rows.map(r=>r.seconds)),p95Seconds:p95(rows.map(r=>r.seconds)),
      mistakes:mapped.filter(r=>r.decision!=='error'&&!r.pass),relationsFailed:mapped.filter(r=>r.relationMet===false),
      rows:mapped,
    };
  }
  const o=models[MODELS[0]],h=models[MODELS[1]];
  const lines=[
    '# Proof Gauntlet — Fresh Counterfactual AI Run',
    '',
    '**Purpose:** independently verify 19 additional pre-labelled transformations against real Claude and Gemini API calls. The labels and generated files were finalized before the first model call and were not adjusted to obtain favorable results.',
    '',
    '**Method:** 7 honest and 12 deliberately broken deliveries; original contract criteria, real primary Claude reviewer, independent Claude second opinion, Gemini check wherever the release path is reached. All reviews use simulated payment mode: '+t+'released'+t+' is a hook decision, **not a PayPal capture or payout**.',
    '',
    '## Fresh 19-case results',
    '',
    '| Metric | Opus → Haiku + Gemini | Haiku → Sonnet + Gemini |',
    '|---|---:|---:|'
  ];
  const add=(name,f)=>lines.push('| '+name+' | '+f(o)+' | '+f(h)+' |');
  add('Cases submitted',s=>s.total);
  add('Cases adjudicated (no API failure)',s=>s.completed+'/'+s.total);
  add('Correct final decisions (adjudicated only)',s=>s.correctAnswers+'/'+s.completed);
  add('Bad work marked released (adjudicated only)',s=>s.falseRelease+'/'+s.bad);
  add('Honest work held',s=>s.falseHold+'/'+s.honest);
  add('Bad work reaching reviewer release path',s=>s.badLeadReleasePath+'/'+s.bad);
  add('Cases escalated to client',s=>s.escalated);
  add('Gemini consulted',s=>s.thirdInvoked);
  add('Cross-run metamorphic relations satisfied',s=>s.metRelations+'/'+s.eligibleRelations);
  add('Technical reviewer errors',s=>s.infrastructureErrors);
  add('Recorded total case costs',s=>dollars(s.cost));
  add('Median / p95 review time',s=>s.medianSeconds+'s / '+s.p95Seconds+'s');
  lines.push('',
    '**Comparison caveat:** Each counterfactual is compared with its original source case from the earlier 57-case run. These are separate live runs, with possible model variation, so cross-run relations are useful diagnostics, not a controlled paired experiment. The new 19 cases are in addition to the original 57, but are related variants, **not statistically independent**.',
    '',
    '## Exact case-by-case audit trail',
    '',
    '| ID / source | Change | Ground truth | Opus decision | Haiku decision |',
    '|---|---|---|---|---|');
  for(const row of o.rows){
    const other=h.rows.find(x=>x.id===row.id);
    const fmtRow=(r)=>r.decision==='error'?'NOT EVALUATED (API failure)':(r.pass?'PASS':'FAIL')+' '+r.observed+(r.retried?' (re-run)':'');
    lines.push('| '+t+row.id+t+' ← '+t+row.sourceCase+t+' | '+md(row.transformation)+' | '+row.expected+' | '+fmtRow(row)+' | '+fmtRow(other)+' |');
  }
  lines.push('','## Investigation of unexpected outcomes','','All unexpected decisions are reported here; held honest deliveries are not counted as attacker wins.');
  for(const name of MODELS) {
    const s=models[name];
    lines.push('','### '+name,'');
    if(!s.mistakes.length)lines.push('No incorrect model decisions among '+s.completed+' adjudicated cases.');
    else for(const e of s.mistakes)lines.push('- **'+e.id+'**: '+md(e.transformation)+'; expected '+e.expected+', observed '+e.observed+'; lead-review release path: '+(e.reviewerTriedToPay?'yes':'no')+'; auditors: '+md(e.secondOpinion)+' / '+md(e.thirdCheck)+'.');
    for(const error of s.technicalFailures)lines.push('- **'+error.id+'**: technical API failure, **not scored as a correct rejection**. Provider response: '+md(error.summary).slice(0,260)+'.');
    for(const error of s.firstRunErrors.filter(e=>s.retried.includes(e.id)))lines.push('- **'+error.id+'**: the first run got an API failure, not a judgement ('+md((String(error.summary).match(/"message":"([^".]*)/)||[,error.summary])[1]).slice(0,160)+'). After the workspace limit was raised the case was run again on its own, unchanged, with the same models; that run is scored above and saved in '+t+'live-results/'+name+'.retry.json'+t+'.');
    if(s.relationsFailed.length)lines.push('Failed cross-run relations: '+s.relationsFailed.map(r=>r.id+' vs '+r.sourceCase).join(', ')+'.');
  }
  lines.push('',
    '**Bookkeeping correction:** The first evaluator version mistakenly counted the two API errors as PASS because no payment was released. The original output is preserved verbatim in `tools/proof-gauntlet/live-results/claude-opus-5-5.raw.json`. Only derived `pass` values for cf018 and cf019 and the `passed` count were corrected in the scored JSON; model decisions, error payloads and token usage were not altered. The re-run of those two cases is a separate file; the first run\'s errors stay in `claude-opus-5-5.json` as they were.',
    '',
    '## Evidence integrity',
    '',
    'These SHA-256 hashes bind the written report to the exact case specifications and saved model responses. They are not external attestations or PayPal certificates.',
    '',
    '| Input | SHA-256 |','|---|---|'
  );
  for(const [filename,digest] of Object.entries(hashes))lines.push('| '+t+filename+t+' | '+t+digest+t+' |');
  lines.push('',
    '## How to reproduce',
    '',
    '1. Run the offline evidence checker: '+t+'npm run gauntlet:check'+t+'. This performs no paid calls.',
    '2. The new fixture generator is '+t+'npm run gauntlet:prepare'+t+'; it does not update the saved model outputs.',
    '3. To repeat **paid** AI calls, use '+t+'EVAL_CASES'+t+', '+t+'EVAL_FIXTURES'+t+' and '+t+'EVAL_OUT'+t+' with the existing '+t+'eval/run.ts'+t+'. Both Claude and Gemini must have configured keys.',
    '',
    '## Limitations',
    '',
    'This is a small, hand-built evaluation; neither 0/12 nor any other fraction proves a deployment risk rate. '+(o.infrastructureErrors?'Opus had '+o.infrastructureErrors+' technical failures due to the Anthropic workspace usage cap; these did not produce model judgements and are excluded from accuracy and metamorphic denominators. ':'In the first Opus run cf018 and cf019 hit the Anthropic workspace usage cap and produced no judgement; they were run again on their own after the limit was raised, so their Opus decisions come from a later run than the other 17. ')+'Safe holds on technical failure are never counted as model-detected fraud. Cost fields come from evaluator estimates; actual billing can differ. A simulated release is **not a PayPal payout**. No new payment transaction was run.',
    ''
  );
  return {text:lines.join('\n'),summary:{baseline:'db92de6',cases:cs.size,sourceHashes:hashes,models}};
}

export function run(check=false) {
  const built=build(),j=JSON.stringify(built.summary,null,2)+'\n';
  if(check){
    must(fs.existsSync(OUTPUT)&&fs.readFileSync(OUTPUT,'utf8')===built.text,'Outdated fresh counterfactual report');
    must(fs.existsSync(JSONOUT)&&fs.readFileSync(JSONOUT,'utf8')===j,'Outdated fresh counterfactual summary');
    console.log('Proof Gauntlet live-results report verified.');
  }else{
    fs.writeFileSync(OUTPUT,built.text);
    fs.writeFileSync(JSONOUT,j);
    console.log('Wrote '+path.relative(ROOT,OUTPUT)+' and fresh evidence summary.');
  }
  for(const [m,s] of Object.entries(built.summary.models))console.log(m+': '+s.correctAnswers+'/'+s.completed+' judged correct, '+s.infrastructureErrors+' API failures, '+s.falseRelease+' incorrect releases, '+s.falseHold+' honest holds, '+s.metRelations+'/'+s.eligibleRelations+' relations, '+dollars(s.cost));
  return built;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.includes('--check'));
