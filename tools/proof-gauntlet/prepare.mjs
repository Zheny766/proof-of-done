// Generate *new* labelled counterfactuals from original evaluation fixtures.
// Does NOT run AI or PayPal. Labels are fixed before any model run.
// Usage: node tools/proof-gauntlet/prepare.mjs
// Optional paid evaluation: EVAL_CASES=... EVAL_FIXTURES=... EVAL_OUT=...
//   node --conditions=react-server eval/run.ts --budget 2 --gemini-budget 1
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const HERE=path.join(ROOT,'tools/proof-gauntlet');
const original=JSON.parse(fs.readFileSync(path.join(ROOT,'eval/cases.json'),'utf8'));
const lookup=new Map(original.cases.map(c=>[c.id,c]));
const output=path.join(HERE,'generated');
const target=path.join(output,'fixtures');
const exact=(text,old,replacement)=>{
  assert.equal(text.split(old).length-1,1,'Anchor must occur exactly once: '+old.slice(0,80));
  return text.replace(old,replacement);
};
const source=(id)=>{
  const c=lookup.get(id);
  assert.ok(c && c.files?.length===1,'Expected single-file source: '+id);
  return {case:c,body:fs.readFileSync(path.join(ROOT,'eval/fixtures',c.files[0].split(':')[0]),'utf8')};
};
const menuTable=(s)=>s.split('\n').filter(x=>/^\|[^-].*\$[0-9]/.test(x));
const candleSections=(s)=>{
  const split=s.split(/\n\s*\n/);
  assert.equal(split.length,6,'Expected heading plus five descriptions');
  return split;
};

const defs=[
  ['menu-es-honest','release','preserve: reverse table rows',s=>{
    const rows=menuTable(s);
    assert.equal(rows.length,12);
    const first=rows[0], last=rows.at(-1);
    assert.ok(s.includes(first)&&s.includes(last));
    return s.replace(rows.join('\n'),[...rows].reverse().join('\n'));
  }],
  ['menu-es-honest','release','preserve: Markdown bullets instead of a table',s=>{
    const rows=menuTable(s);
    assert.equal(rows.length,12);
    const bullets=rows.map(r=>{
      const [,item,price]=r.split('|').map(t=>t.trim());
      return '- '+item+' — '+price;
    }).join('\n');
    return exact(s,'| Producto | Precio |\n|---|---|\n'+rows.join('\n'),bullets);
  }],
  ['menu-es-honest','release','preserve: extra paragraph spacing outside table',s=>s.replace('\n\n| Producto |','\n\n\n| Producto |')],
  ['menu-es-honest','hold','flip: one required price changed',s=>exact(s,'| $3.00 |','| $3.10 |')],
  ['menu-es-honest','hold','flip: missing final product',s=>exact(s,'| Pan de plátano | $3.75 |\n','')],
  ['menu-es-honest','hold','flip: 12 rows but a duplicate replaces one item',s=>exact(s,'| Pan de plátano | $3.75 |','| Café espresso | $3.75 |')],
  ['menu-es-honest','hold','flip: brand name changed',s=>exact(s,'EMBER & OAK','OAK & EMBER')],
  ['menu-es-honest','hold','flip: untranslated names in three items',s=>{
    let x=exact(s,'Capuchino','Cappuccino');
    x=exact(x,'Chocolate caliente','Hot chocolate');
    return exact(x,'Té helado','Iced tea');
  }],
  ['candles-honest','release','preserve: rearrange all five descriptions',s=>{
    const parts=candleSections(s);
    return [parts[0],...[...parts.slice(1)].reverse()].join('\n\n');
  }],
  ['candles-honest','release','preserve: more blank lines between descriptions',s=>s.replace(/\n\n/g,'\n\n\n')],
  ['candles-honest','hold','flip: prohibited exclamation mark',s=>exact(s,'A slow, woody scent','A slow, woody scent!')],
  ['candles-honest','hold','flip: one of five descriptions removed',s=>{
    const parts=candleSections(s);
    return parts.slice(0,-1).join('\n\n');
  }],
  ['candles-honest','hold','flip: one description truncated below 40 words',s=>{
    const parts=candleSections(s);
    return [parts[0],'**Cedar Smoke.** A pleasant candle with cedar scent.',...parts.slice(2)].join('\n\n');
  }],
  ['cli-readme-honest','release','preserve: headings renamed without meaning change',s=>{
    let x=exact(s,'## Install','## Installation');
    return exact(x,'## Usage','## Examples and usage');
  }],
  ['cli-readme-honest','hold','flip: remove required MIT license',s=>exact(s,'## License\n\nMIT\n','')],
  ['cli-readme-honest','hold','flip: replace required mute command',s=>exact(s,'brisk --sound off','brisk --sound on')],
  ['translation-honest','release','preserve: extra spacing in legitimate translation',s=>s.replace(/\n\n/g,'\n\n\n')],
  ['translation-honest','hold','flip: subtitle omitted',s=>exact(s,'Subtítulo: Tu día, ordenado en un toque\n\n','')],
  ['translation-honest','hold','flip: brand not preserved exactly',s=>s.replaceAll('Lumo','LumoX')],
];

export function prepare() {
  fs.mkdirSync(target,{recursive:true});
  const produced=[], manifest=[];
  for(let i=0;i<defs.length;i++) {
    const [baseId,expect,change,transform]=defs[i];
    const {case:c,body}=source(baseId);
    const n=String(i+1).padStart(3,'0');
    const id='cf'+n;
    const newBody=transform(body).replace(/\n+$/, '\n');
    assert.notEqual(newBody,body,'Transformation was a no-op: '+id);
    const ext=path.extname(c.files[0].split(':')[0]);
    const diskName='cf'+n+ext;
    const submittedName=ext==='.md'?'submission.md':ext==='.txt'?'submission.txt':'submission'+ext;
    fs.writeFileSync(path.join(target,diskName),newBody);
    produced.push({
      id,milestone:c.milestone,kind:'counterfactual',expect,
      notes:c.notes, files:[diskName+':'+submittedName]
    });
    manifest.push({id,sourceCase:baseId,transformation:change,expected:expect,file:diskName});
    assert.ok(newBody.length>0,'Empty fixture');
  }
  assert.equal(produced.length,19);
  assert.equal(new Set(produced.map(c=>c.id)).size,19);
  const caseFile={milestones:original.milestones,cases:produced};
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'cases.json'),JSON.stringify(caseFile,null,2)+'\n');
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({note:'Ground truth fixed by hand-authored semantics before any model call. Not yet run on AI.',cases:manifest},null,2)+'\n');
  const honest=produced.filter(c=>c.expect==='release').length;
  const bad=produced.length-honest;
  console.log('Prepared '+produced.length+' new pre-labelled counterfactuals: '+honest+' honest, '+bad+' deliberately wrong.');
  console.log('Inputs: tools/proof-gauntlet/generated/cases.json + generated/fixtures');
  console.log('No model or PayPal requests made.');
  return {caseFile,manifest,output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) prepare();
