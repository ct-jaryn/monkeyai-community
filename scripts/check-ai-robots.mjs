import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Validates visible declarations and REP-style access rules. Content-Signal is
// not part of RFC 9309; this cannot prove how a third-party consumer combines
// multiple declarations or whether a real crawler is admitted by a WAF.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const config=JSON.parse(read('site.config.json'));
const origin=new URL(config.origin);
const publicMode=process.argv.includes('--public');
if(process.argv.slice(2).some(a=>a!=='--public'))throw Error('Usage: node scripts/check-ai-robots.mjs [--public]');
const issues=[];
function expect(ok,message){if(!ok)issues.push(message);}

function parseRobots(text){
  const groups=[],sitemaps=[];let group=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/#.*/,'').trim();if(!line)continue;
    const colon=line.indexOf(':');if(colon<0)continue;
    const key=line.slice(0,colon).trim().toLowerCase(),value=line.slice(colon+1).trim();
    if(key==='user-agent'){
      if(!value)continue;
      if(!group||hasRules){group={agents:[],rules:[],signals:[]};groups.push(group);hasRules=false;}
      group.agents.push(value.toLowerCase());
    }else if(key==='sitemap'){
      if(value)sitemaps.push(value);
    }else if(group&&(key==='allow'||key==='disallow')){
      group.rules.push({key,value});hasRules=true;
    }else if(group&&key==='content-signal'){
      const fields={};let invalid=false;
      for(const term of value.split(',')){
        const pair=term.trim().match(/^([a-z][a-z-]*)\s*=\s*([a-z]+)$/i);
        if(!pair){invalid=true;continue;}
        const name=pair[1].toLowerCase(),field=pair[2].toLowerCase();
        if(name in fields&&fields[name]!==field)invalid=true;
        fields[name]=field;
      }
      group.signals.push({raw:value,fields,invalid});hasRules=true;
    }
  }
  return {groups,sitemaps};
}
function matchingGroups(parsed,agent){
  const name=agent.toLowerCase();let longest=0;
  for(const g of parsed.groups)for(const a of g.agents)if(a!=='*'&&name.includes(a))longest=Math.max(longest,a.length);
  return parsed.groups.filter(g=>g.agents.some(a=>longest?a!=='*'&&a.length===longest&&name.includes(a):a==='*'));
}
function matchingRules(parsed,agent){return matchingGroups(parsed,agent).flatMap(g=>g.rules);}
function allows(parsed,agent,uri){
  let best=-1,allow=true;
  for(const rule of matchingRules(parsed,agent)){
    if(!rule.value)continue;
    const anchored=rule.value.endsWith('$');
    const pattern=(anchored?rule.value.slice(0,-1):rule.value).split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
    const re=new RegExp('^'+pattern+(anchored?'$':''));
    if(!re.test(uri))continue;
    const length=rule.value.replace(/\*/g,'').replace(/\$$/,'').length;
    if(length>best||(length===best&&rule.key==='allow')){best=length;allow=rule.key==='allow';}
  }
  return allow;
}
function inspectSignals(parsed,label){
  const wildcard=parsed.groups.filter(g=>g.agents.includes('*')).flatMap(g=>g.signals);
  expect(wildcard.length>0,`${label}: missing wildcard Content-Signal`);
  let complete=false;
  for(const [i,s] of wildcard.entries()){
    expect(!s.invalid,`${label}: malformed or internally conflicting wildcard Content-Signal ${i+1}`);
    for(const [key,expected] of Object.entries({search:'yes','ai-input':'yes','ai-train':'no',use:'reference'})){
      if(key in s.fields)expect(s.fields[key]===expected,`${label}: conflicting ${key}=${s.fields[key]}`);
    }
    if(s.fields.search==='yes'&&s.fields['ai-input']==='yes'&&s.fields['ai-train']==='no')complete=true;
  }
  expect(complete,`${label}: no complete wildcard declaration with search=yes, ai-input=yes and ai-train=no`);
  for(const g of parsed.groups)for(const s of g.signals){
    expect(!s.invalid,`${label}: malformed Content-Signal for ${g.agents.join(', ')}`);
    if('ai-train' in s.fields)expect(s.fields['ai-train']==='no',`${label}: found ai-train=${s.fields['ai-train']} for ${g.agents.join(', ')}`);
  }
  return wildcard.map(s=>s.raw);
}
function inspectCommon(parsed,label){
  const expected=new URL('/sitemap.xml',origin).href;
  expect(parsed.sitemaps.includes(expected),`${label}: missing canonical sitemap ${expected}`);
  return inspectSignals(parsed,label);
}
const local=parseRobots(read('dist/robots.txt'));
const localSignals=inspectCommon(local,'origin build');
for(const p of ['/','/docs/mcp-team-connector-setup/'])expect(allows(local,'*',p),`origin build: wildcard disallows ${p}`);
const report={scope:'Raw Content-Signal declarations and REP-style URL access; consumer interpretation and verified crawler identity are not tested',origin:origin.origin,checkedAt:new Date().toISOString(),local:{sitemaps:local.sitemaps,wildcardSignals:localSignals},issues};
if(publicMode){
  try{
    const response=await fetch(new URL('/robots.txt',origin),{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'MonkeyAI-Production-Verification/1.0','Accept':'text/plain,*/*;q=0.8'}});
    const body=await response.text();
    expect(response.status===200,`public robots: expected 200, got ${response.status}`);
    expect((response.headers.get('content-type')||'').includes('text/plain'),'public robots: expected text/plain');
    const parsed=parseRobots(body),signals=inspectCommon(parsed,'public robots');
    const training=[...new Set(JSON.parse(read('src/data/training-bot-baseline.json')).map(a=>a.toLowerCase()))].sort();
    expect(training.length>0,'baseline: no training crawler disallows identified');
    for(const agent of training){
      const matched=matchingGroups(parsed,agent),rules=matched.flatMap(g=>g.rules);
      expect(matched.some(g=>g.agents.includes(agent)),`public robots: missing baseline-specific training group ${agent}`);
      expect(rules.some(r=>r.key==='disallow'&&r.value==='/'),`public robots: training disallow removed for ${agent}`);
      expect(!rules.some(r=>r.key==='allow'&&r.value),`public robots: new training allow exception for ${agent}`);
      expect(!allows(parsed,agent,'/'),`public robots: training crawler ${agent} allowed at /`);
    }
    const permitted=['Googlebot','bingbot','OAI-SearchBot','Claude-SearchBot','PerplexityBot','ChatGPT-User','Claude-User','Perplexity-User','Google-Agent','Google-NotebookLM'];
    for(const agent of permitted)for(const urlPath of ['/','/docs/mcp-team-connector-setup/'])expect(allows(parsed,agent,urlPath),`public robots: ${agent} blocked at ${urlPath}`);
    report.public={status:response.status,contentType:response.headers.get('content-type'),cacheStatus:response.headers.get('cf-cache-status'),cfRay:response.headers.get('cf-ray'),egressRegion:'unknown',sitemaps:parsed.sitemaps,wildcardSignals:signals,baselineTrainingAgents:training,permittedAgentsChecked:permitted,pathsChecked:['/','/docs/mcp-team-connector-setup/']};
  }catch(e){issues.push(`public robots request or baseline: ${e.name}: ${e.message}`);}
}
report.status=issues.length?'failed':'passed';
console.log(JSON.stringify(report,null,2));
if(issues.length)process.exitCode=1;
