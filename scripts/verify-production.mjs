import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Read-only production verification. This script never changes DNS or the server.
// Run after building and deploying: node scripts/verify-production.mjs
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const config=JSON.parse(read('site.config.json'));
const manifest=JSON.parse(read('route-manifest.json'));
const logos=JSON.parse(read('src/data/logos.json'));
const models=[...JSON.parse(read('src/data/models-core.json')),...JSON.parse(read('src/data/models-extended.json'))];
const origin=new URL(config.origin);
if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('site.config.json origin must be a bare HTTPS origin');
const timeoutMs=Number(process.env.PRODUCTION_VERIFY_TIMEOUT_MS||20000);
const concurrency=4;
const issues=[];
const report={
  checkedAt:new Date().toISOString(),origin:origin.origin,
  scope:'Public canonical GET responses; no cache-busting is used as acceptance evidence',
  egressRegion:'unknown',concurrency,timeoutMs,
  metrics:{requests:0,pagesChecked:0,pagesPassed:0,languageGroups:0,jsonLdBlocks:0,sitemapUrls:0,redirectCases:0,redirectCasesPassed:0,auxiliaryChecks:0,auxiliaryPassed:0,modelFamilies:models.length,logoMappings:Object.keys(logos).length,assetsChecked:0,assetsPassed:0,runtimeAssetsChecked:0,runtimeAssetsPassed:0},
  samples:[],redirects:[],assets:[],runtimeAssets:[],hostingInjectedScripts:[],issues,
};
function issue(url,check,message,response){issues.push({url,check,message,...(response?{status:response.status,cacheStatus:response.headers.get('cf-cache-status'),cfRay:response.headers.get('cf-ray')}: {})});}
function expect(condition,url,check,message,response){if(!condition)issue(url,check,message,response);return condition;}
async function request(url){
  report.metrics.requests++;
  return fetch(url,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'MonkeyAI-Production-Verification/1.0','Accept':'text/html,application/xml,text/plain,image/png,image/svg+xml,image/webp;q=0.9,*/*;q=0.8'}});
}
async function pool(items,work){let cursor=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const i=cursor++;await work(items[i],i);}}));}
const decode=s=>String(s).replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|#39);/gi,(whole,n)=>{
  if(n)return String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10));
  return {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[whole.toLowerCase()]||whole;
});
const plain=s=>decode(String(s).replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function attrs(tag){const result={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);return result;}
function parse(html){
  const links=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>attrs(m[0]));
  const metas=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0]));
  return {
    lang:attrs(html.match(/<html\b[^>]*>/i)?.[0]||'').lang,
    titles:[...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)].map(m=>plain(m[1])),
    main:[...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/gi)].map(m=>plain(m[1])),
    h1:[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map(m=>plain(m[1])),
    canonical:links.filter(l=>(l.rel||'').split(/\s+/).includes('canonical')).map(l=>l.href),
    alternate:links.filter(l=>(l.rel||'').split(/\s+/).includes('alternate')&&l.hreflang),
    descriptions:metas.filter(m=>m.name?.toLowerCase()==='description').map(m=>m.content),
    robots:metas.filter(m=>m.name?.toLowerCase()==='robots').map(m=>m.content||''),
    images:[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>attrs(m[0])),
    stylesheets:links.filter(l=>(l.rel||'').split(/\s+/).includes('stylesheet')).map(l=>l.href),
    scripts:[...html.matchAll(/<script\b[^>]*>/gi)].map(m=>attrs(m[0])).filter(a=>a.src).map(a=>a.src),
    jsonld:[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>attrs(m[1]).type==='application/ld+json').map(m=>m[2]),
  };
}
const runtimeReferences=new Set();
const observedHostingScripts=new Map();
function isKnownHostingScript(src){
  try{const u=new URL(src,origin);return u.protocol==='https:'&&u.hostname==='static.cloudflareinsights.com'&&/^\/beacon\.min\.js(?:\/|$)/.test(u.pathname);}catch{return false;}
}
function comparableScripts(doc,local,pageUrl){
  // Cloudflare may append its own analytics beacon to HTML. Record that delivery
  // behavior explicitly, while retaining strict comparison for all site scripts
  // and any other unexpected third-party script.
  return doc.scripts.filter(src=>{
    if(local.scripts.includes(src)||!isKnownHostingScript(src))return true;
    const record=observedHostingScripts.get(src)||{url:src,provider:'Cloudflare',declaredInBuild:false,occurrences:0,samplePages:[]};
    record.occurrences++;
    if(record.samplePages.length<3&&!record.samplePages.includes(pageUrl))record.samplePages.push(pageUrl);
    observedHostingScripts.set(src,record);
    return false;
  });
}
const langTags={en:'en',zh:'zh-Hans',es:'es'};
const equivalent=p=>p.replace(/^\/(?:zh|es)(?=\/)/,'');
const groups=new Map();
for(const r of manifest){const key=equivalent(r.path);if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(r.lang,r.path);}
report.metrics.languageGroups=groups.size;
await pool(manifest,async r=>{
  const url=new URL(r.path,origin).href,start=issues.length;
  report.metrics.pagesChecked++;
  try{
    const response=await request(url),html=await response.text(),doc=parse(html);
    // Count per-page issues separately because requests run concurrently.
    const pageIssues=[];
    const check=(ok,name,message)=>{if(!ok){pageIssues.push(name);issue(url,name,message,response);}};
    check(response.status===200,'status',`Expected 200 at the exact canonical URL, received ${response.status}${response.headers.get('location')?' Location='+response.headers.get('location'):''}`);
    check((response.headers.get('content-type')||'').includes('text/html'),'content-type','Canonical page must return HTML');
    const localPath=path.join(root,'dist',r.path,'index.html');
    const local=parse(fs.readFileSync(localPath,'utf8'));
    for(const asset of [...local.stylesheets,...local.scripts])runtimeReferences.add(asset);
    check(JSON.stringify(doc.stylesheets)===JSON.stringify(local.stylesheets),'stylesheet-references','Delivered stylesheet URLs differ from the built fingerprinted version');
    check(JSON.stringify(comparableScripts(doc,local,url))===JSON.stringify(local.scripts),'script-references','Delivered runtime script URLs differ from the built fingerprinted version');
    check(doc.titles.length===1&&doc.titles[0]===local.titles[0],'title',`Expected delivered title ${JSON.stringify(local.titles[0])}; received ${JSON.stringify(doc.titles)}`);
    check(doc.lang===langTags[r.lang],'language',`Expected ${langTags[r.lang]}, received ${doc.lang}`);
    check(doc.main.length===1&&doc.main[0]===local.main[0]&&doc.main[0].length>100,'static-body','Complete visible main text must match the built page, not a login, challenge, stale page, or JS-only shell');
    check(doc.h1.length===1&&doc.h1[0]===local.h1[0],'h1','H1 must match the built page');
    check(doc.descriptions.length===1&&doc.descriptions[0]===local.descriptions[0],'description','Meta description must match the localized built page');
    check(doc.canonical.length===1&&doc.canonical[0]===url,'canonical',`Expected self canonical ${url}; received ${JSON.stringify(doc.canonical)}`);
    check(!doc.robots.some(s=>/\bnoindex\b/i.test(s))&&!/\bnoindex\b/i.test(response.headers.get('x-robots-tag')||''),'indexability','Canonical page has a noindex directive');
    const alternates=new Map(doc.alternate.map(a=>[a.hreflang,a.href]));
    const group=groups.get(equivalent(r.path));
    check(alternates.size===4&&doc.alternate.length===4,'hreflang-count','Expected exactly four unique en/zh-Hans/es/x-default variants');
    for(const [lang,tag] of Object.entries(langTags))check(alternates.get(tag)===new URL(group.get(lang),origin).href,'hreflang',`${tag} must refer to the exact corresponding page`);
    check(alternates.get('x-default')===new URL(group.get('en'),origin).href,'hreflang-default','x-default must refer to the English equivalent');
    check(doc.jsonld.length===local.jsonld.length&&doc.jsonld.length>0,'jsonld-count','JSON-LD blocks missing or unexpectedly duplicated');
    const expectedImages=local.images.filter(i=>i.src?.startsWith('/logos/')).map(i=>i.src).sort();
    const actualImages=doc.images.filter(i=>i.src?.startsWith('/logos/')).map(i=>i.src).sort();
    check(JSON.stringify(actualImages)===JSON.stringify(expectedImages),'product-images','Product/model logo references differ from the built page');
    for(const [i,block] of doc.jsonld.entries()){
      report.metrics.jsonLdBlocks++;
      try{
        const data=JSON.parse(block),nodes=data['@graph']||[data];
        check(data['@context']==='https://schema.org','jsonld-context','JSON-LD context is not schema.org');
        const page=nodes.find(n=>n.url===url&&n['@type']!=='WebSite');
        check(Boolean(page)&&page.inLanguage===langTags[r.lang],'jsonld-page','JSON-LD page URL/language does not match this page');
        check(JSON.stringify(data)===JSON.stringify(JSON.parse(local.jsonld[i]||'null')),'jsonld-content','Delivered structured data differs from the verified build');
        const modelSlug=equivalent(r.path).match(/^\/models\/([^/]+)\/$/)?.[1],model=models.find(m=>m.slug===modelSlug);
        if(model)check(page?.about?.name===model.name&&page?.about?.sameAs===model.officialUrl,'model-entity','Model about entity differs from the visible family or official reference');
      }catch(e){check(false,'jsonld-json',e.message);}
    }
    if(!pageIssues.length)report.metrics.pagesPassed++;
    if(['/', '/zh/docs/getting-started/', '/es/tools/', '/models/', '/zh/models/claude/', '/es/models/compare/'].includes(r.path))report.samples.push({url,status:response.status,title:doc.titles[0],lang:doc.lang,canonical:doc.canonical[0],mainTextCharacters:doc.main[0]?.length||0,cacheStatus:response.headers.get('cf-cache-status'),cfRay:response.headers.get('cf-ray'),passed:pageIssues.length===0});
  }catch(e){issue(url,'request',`${e.name}: ${e.message}`);}
});

const probePath='/es/docs/models-and-mcp/?verification=path%20query&lang=es';
const target=new URL(probePath,origin).href;
const www=new URL(origin);www.hostname='www.'+origin.hostname.replace(/^www\./,'');
const redirectInputs=[new URL(probePath,'http://'+origin.host).href,new URL(probePath,'http://'+www.host).href,new URL(probePath,www).href];
await pool(redirectInputs,async startUrl=>{
  report.metrics.redirectCases++;const chain=[];let current=startUrl,ok=true;
  try{
    for(let i=0;i<5;i++){
      const response=await request(current),location=response.headers.get('location');
      await response.arrayBuffer();chain.push({url:current,status:response.status,location});
      if(current===target){ok=expect(response.status===200,startUrl,'redirect-final',`Final canonical response is ${response.status}`,response)&&ok;break;}
      if(!expect([301,308].includes(response.status)&&Boolean(location),current,'redirect',`Expected a permanent redirect toward ${target}`,response)){ok=false;break;}
      const next=new URL(location,current);
      if(!expect(next.pathname===new URL(target).pathname&&next.search===new URL(target).search,current,'redirect-preserves-url','Redirect lost or changed the path/query',response)){ok=false;break;}
      current=next.href;
      if(i===4){issue(startUrl,'redirect-loop','Did not reach canonical HTTPS apex within five requests');ok=false;}
    }
    if(current!==target){issue(startUrl,'redirect-destination',`Final observed URL ${current}; expected ${target}`);ok=false;}
  }catch(e){issue(current,'redirect-request',`${e.name}: ${e.message}`);ok=false;}
  if(ok)report.metrics.redirectCasesPassed++;
  report.redirects.push({startUrl,expected:target,passed:ok,chain});
});

async function auxiliary(pathname,fn){
  const url=new URL(pathname,origin).href;report.metrics.auxiliaryChecks++;const before=issues.length;
  try{const response=await request(url);await fn(response,url);if(issues.length===before)report.metrics.auxiliaryPassed++;}catch(e){issue(url,'request',`${e.name}: ${e.message}`);}
}
await auxiliary('/robots.txt',async(response,url)=>{
  const text=await response.text();expect(response.status===200,url,'robots-status','robots.txt must return 200',response);
  expect((response.headers.get('content-type')||'').includes('text/plain'),url,'robots-type','robots.txt must return plain text',response);
  expect(text.split(/\r?\n/).some(line=>line.trim()===`Sitemap: ${origin.origin}/sitemap.xml`),url,'robots-sitemap','Missing canonical sitemap declaration',response);
  let applies=false,blocked=false;
  for(const line of text.split(/\r?\n/)){const s=line.replace(/#.*/,'').trim();if(/^user-agent\s*:/i.test(s))applies=/^user-agent\s*:\s*\*\s*$/i.test(s);if(applies&&/^disallow\s*:\s*\/\s*$/i.test(s))blocked=true;}
  expect(!blocked,url,'robots-allow','robots.txt disallows the whole public site',response);
});
await auxiliary('/sitemap.xml',async(response,url)=>{
  const text=await response.text();expect(response.status===200,url,'sitemap-status','sitemap.xml must return 200',response);
  expect(/<(?:\w+:)?urlset\b[^>]*>/i.test(text)&&/<\/(?:\w+:)?urlset\s*>/i.test(text),url,'sitemap-xml','Missing XML urlset root',response);
  const locs=[...text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map(m=>decode(m[1].trim()));report.metrics.sitemapUrls=locs.length;
  const expected=new Set(manifest.map(r=>new URL(r.path,origin).href));
  expect(locs.length===expected.size&&new Set(locs).size===locs.length,url,'sitemap-count',`Expected ${expected.size} unique sitemap URLs; received ${locs.length}`,response);
  for(const expectedUrl of expected)expect(locs.includes(expectedUrl),url,'sitemap-missing',`Missing ${expectedUrl}`,response);
  for(const actual of locs)expect(expected.has(actual),url,'sitemap-extra',`Unexpected sitemap URL ${actual}`,response);
});
await auxiliary('/__monkeyai-production-verification-nonexistent__/',async(response,url)=>{
  const html=await response.text(),doc=parse(html);
  const local=parse(fs.readFileSync(path.join(root,'dist/404.html'),'utf8'));
  for(const asset of [...local.stylesheets,...local.scripts])runtimeReferences.add(asset);
  expect(JSON.stringify(doc.stylesheets)===JSON.stringify(local.stylesheets)&&JSON.stringify(comparableScripts(doc,local,url))===JSON.stringify(local.scripts),url,'404-runtime-references','404 uses stale or unexpected CSS/JS references',response);
  expect(response.status===404,url,'404-status',`Expected a genuine HTTP 404, received ${response.status}`,response);
  expect(doc.robots.some(s=>/\bnoindex\b/i.test(s))||/\bnoindex\b/i.test(response.headers.get('x-robots-tag')||''),url,'404-noindex','Error page is missing noindex',response);
  expect(doc.h1.length===1&&doc.main.length===1&&doc.main[0].length>20,url,'404-body','Error page is missing its useful static content',response);
});
// Check every distinct delivered logo, including aliases shared by tool/model entries.
const logoPaths=[...new Set(['/brand/monkeyai-logo.png',...Object.values(logos).map(logo=>logo.src)])].sort();
const mimeTypes={'.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
await pool(logoPaths,async pathname=>{
  const url=new URL(pathname,origin).href;report.metrics.assetsChecked++;let ok=true;
  try{
    const response=await request(url),data=Buffer.from(await response.arrayBuffer());
    const check=(condition,name,message)=>{if(!condition){ok=false;issue(url,name,message,response);}};
    check(response.status===200,'logo-status',`Logo must return 200, received ${response.status}`);
    const mime=mimeTypes[path.extname(pathname).toLowerCase()];
    check(Boolean(mime)&&(response.headers.get('content-type')||'').includes(mime),'logo-type',`Logo MIME type must be ${mime}`);
    const local=fs.readFileSync(path.join(root,'public',pathname));
    const expected=crypto.createHash('sha256').update(local).digest('hex'),actual=crypto.createHash('sha256').update(data).digest('hex');
    check(actual===expected,'logo-sha256',`Logo differs from verified local asset: expected ${expected}, received ${actual}`);
    const result={url,path:pathname,sha256:actual,expectedSha256:expected,bytes:data.length,mime:response.headers.get('content-type'),cacheStatus:response.headers.get('cf-cache-status'),cfRay:response.headers.get('cf-ray'),passed:ok};
    report.assets.push(result);
    if(pathname==='/brand/monkeyai-logo.png')report.logo=result;
    if(ok)report.metrics.assetsPassed++;
  }catch(e){issue(url,'logo-request',`${e.name}: ${e.message}`);report.assets.push({url,path:pathname,passed:false,error:e.message});}
});

// Verify the exact CSS/JS URLs declared by the delivered build, not cache-busted aliases.
// These assets are content-addressed so an existing browser cannot reuse old styling/code.
await pool([...runtimeReferences].sort(),async reference=>{
  const url=new URL(reference,origin).href;report.metrics.runtimeAssetsChecked++;let ok=true;
  try{
    const parsedUrl=new URL(url),ext=path.extname(parsedUrl.pathname).toLowerCase();
    const response=await request(url),data=Buffer.from(await response.arrayBuffer());
    const check=(condition,name,message)=>{if(!condition){ok=false;issue(url,name,message,response);}};
    check(parsedUrl.origin===origin.origin&&!parsedUrl.search&&!parsedUrl.hash,'runtime-canonical-url','Runtime asset must use a stable same-origin canonical URL');
    check(/^\/assets\/[^/]+\.[a-f0-9]{12}\.(?:css|js)$/.test(parsedUrl.pathname),'runtime-fingerprint','Runtime CSS/JS asset must have a content fingerprint in its path');
    check(response.status===200,'runtime-status',`Runtime asset must return 200, received ${response.status}`);
    const expectedMimes=ext==='.css'?['text/css']:ext==='.js'?['application/javascript','text/javascript']:[];
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    check(expectedMimes.includes(mime),'runtime-mime',`Expected ${expectedMimes.join(' or ')}, received ${mime}`);
    const local=fs.readFileSync(path.join(root,'dist',decodeURIComponent(parsedUrl.pathname)));
    const expected=crypto.createHash('sha256').update(local).digest('hex'),actual=crypto.createHash('sha256').update(data).digest('hex');
    check(actual===expected,'runtime-sha256',`Runtime asset differs: expected ${expected}, received ${actual}`);
    report.runtimeAssets.push({url,path:parsedUrl.pathname,sha256:actual,expectedSha256:expected,bytes:data.length,mime,cacheControl:response.headers.get('cache-control'),cacheStatus:response.headers.get('cf-cache-status'),cfRay:response.headers.get('cf-ray'),passed:ok});
    if(ok)report.metrics.runtimeAssetsPassed++;
  }catch(e){issue(url,'runtime-request',`${e.name}: ${e.message}`);report.runtimeAssets.push({url,passed:false,error:e.message});}
});

report.hostingInjectedScripts=[...observedHostingScripts.values()].sort((a,b)=>a.url.localeCompare(b.url));
report.status=issues.length?'failed':'passed';
report.metrics.issues=issues.length;
report.runtimeAssets.sort((a,b)=>a.url.localeCompare(b.url));
report.assets.sort((a,b)=>a.url.localeCompare(b.url));
report.samples.sort((a,b)=>a.url.localeCompare(b.url));report.redirects.sort((a,b)=>a.startUrl.localeCompare(b.startUrl));
console.log(JSON.stringify(report,null,2));
if(issues.length)process.exitCode=1;
