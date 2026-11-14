import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Parse the delivered HTML independently of the generator. No browser or package
// installation is required; Python's standard library handles entities and tags.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const issues=[];
const metrics={htmlFiles:0,indexableRoutes:0,languageGroups:0,internalLinks:0,assetReferences:0,jsonLdBlocks:0,sitemapUrls:0,tools:0,guides:0,models:0,logoMappings:0,uniqueLogoAssets:0,brandInstances:0,svgAssetsChecked:0,localizedDataEntries:0,contrastPairsChecked:0};
const error=(where,message)=>issues.push(`${where}: ${message}`);
const expect=(ok,where,message)=>{if(!ok)error(where,message);};
const exists=p=>fs.existsSync(path.join(root,p));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let config,manifest,tools,guides,models,logos,logoSources;
try{
  config=JSON.parse(read('site.config.json'));
  manifest=JSON.parse(read('route-manifest.json'));
  tools=JSON.parse(read('src/data/tools.json'));
  guides=['guides.json','model-selection-guide.json','docs-install.json','docs-model-integration.json','docs-mcp-faq.json','docs-client-usage.json','docs-scenarios.json'].flatMap(file=>JSON.parse(read('src/data/'+file)));
  models=[...JSON.parse(read('src/data/models-core.json')),...JSON.parse(read('src/data/models-extended.json'))];
  logos=JSON.parse(read('src/data/logos.json'));
  logoSources=JSON.parse(read('docs/logo-sources.json'));
}catch(e){console.error(`Check could not start: ${e.message}\nRun npm run build after completing source data.`);process.exit(1);}
// Every listed product carries the date its facts were last checked against the
// official source, so a record that was never verified cannot pass unnoticed.
for (const tool of tools) {
  expect(/^\d{4}-\d{2}-\d{2}$/.test(tool.reviewed || ''), `tools/${tool.slug}`, 'tool has no reviewed date');
  expect(typeof tool.sourceUrl === 'string' && tool.sourceUrl.startsWith('https://'), `tools/${tool.slug}`, 'tool has no official source URL');
}
for (const model of models) {
  expect(/^\d{4}-\d{2}-\d{2}$/.test(model.reviewed || ''), `models/${model.slug}`, 'model has no reviewed date');
}
let origin;
try{origin=new URL(config.origin);expect(origin.protocol==='https:'&&origin.pathname==='/'&&!origin.search&&!origin.hash,'config','origin must be an HTTPS origin');}catch{error('config','invalid origin');}
if(!origin){console.error(issues.join('\n'));process.exit(1);}
const parser=String.raw`
import sys,json,pathlib
from html.parser import HTMLParser
from xml.etree import ElementTree

class Document(HTMLParser):
 voids={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
 def __init__(self):
  super().__init__(convert_charrefs=True)
  self.doc={'lang':None,'titles':[],'descriptions':[],'canonicals':[],'alternates':[],'robots':[],'ids':[],'hrefs':[],'assets':[],'jsonld':[],'h1':[],'mainText':[],'visible':[],'mainCount':0,'images':[],'brands':[],'cards':[],'logoBoxes':[],'links':[]}
  self.stack=[];self.title=None;self.h1=None;self.script=None;self.mainDepth=0;self.excluded=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='html':self.doc['lang']=a.get('lang')
  if 'id' in a:self.doc['ids'].append(a['id'])
  if tag=='a' and 'href' in a:self.doc['hrefs'].append(a['href'])
  if tag=='link':
   rel=(a.get('rel') or '').lower().split()
   if 'canonical' in rel:self.doc['canonicals'].append(a.get('href'))
   if 'alternate' in rel and a.get('hreflang'):self.doc['alternates'].append({'lang':a['hreflang'],'href':a.get('href')})
   if 'stylesheet' in rel or 'icon' in rel:self.doc['assets'].append(a.get('href'))
  if tag=='meta':
   name=(a.get('name') or '').lower()
   if name=='description':self.doc['descriptions'].append(a.get('content',''))
   if name=='robots':self.doc['robots'].append(a.get('content',''))
  if tag=='script':
   self.script={'type':a.get('type',''),'body':''}
   if a.get('src'):self.doc['assets'].append(a['src'])
  if tag in ('img','source') and a.get('src'):self.doc['assets'].append(a['src'])
  if tag=='img':
   self.doc['images'].append(a)
   for f in self.stack:
    if f['brand'] or f['card'] or f['logobox']:f['images'].append(a)
  if tag=='title':self.title=''
  if tag=='h1':self.h1=''
  if tag=='main':self.mainDepth+=1;self.doc['mainCount']+=1
  if tag in ('script','style','svg'):self.excluded+=1
  if tag not in self.voids:
   self.stack.append({'tag':tag,'brand':a.get('data-brand'),'card':('tool' if 'data-tool' in a else 'model' if 'data-model' in a else None),'slug':a.get('data-tool',a.get('data-model')),'logobox':'tool-logo' in (a.get('class') or '').split(),'images':[],'text':[],'href':a.get('href') if tag=='a' else None,'inMain':self.mainDepth>0,'hidden':'hidden' in a or a.get('aria-hidden')=='true' or any(f['hidden'] for f in self.stack)})
 def handle_startendtag(self,tag,attrs):
  self.handle_starttag(tag,attrs)
  if tag not in self.voids:self.handle_endtag(tag)
 def handle_endtag(self,tag):
  if tag=='title' and self.title is not None:self.doc['titles'].append(self.title.strip());self.title=None
  if tag=='h1' and self.h1 is not None:self.doc['h1'].append(self.h1.strip());self.h1=None
  if tag=='script' and self.script is not None:
   if self.script['type']=='application/ld+json':self.doc['jsonld'].append(self.script['body'])
   self.script=None
  if tag in ('script','style','svg'):self.excluded=max(0,self.excluded-1)
  if tag=='main':self.mainDepth=max(0,self.mainDepth-1)
  indices=[i for i,f in enumerate(self.stack) if f['tag']==tag]
  if indices:
   frames=self.stack[indices[-1]:];self.stack=self.stack[:indices[-1]]
   for f in frames:
    f['text']=' '.join(f['text']).strip()
    if f['brand']:self.doc['brands'].append({'key':f['brand'],'images':f['images'],'text':f['text']})
    if f['card']:self.doc['cards'].append({'kind':f['card'],'slug':f['slug'],'images':f['images']})
    if f['logobox']:self.doc['logoBoxes'].append({'images':f['images'],'text':f['text']})
    if f['href'] is not None:self.doc['links'].append({'href':f['href'],'text':f['text'],'inMain':f['inMain'],'hidden':f['hidden']})
 def handle_data(self,data):
  if self.title is not None:self.title+=data
  if self.h1 is not None:self.h1+=data
  if self.script is not None:self.script['body']+=data
  if not self.excluded:
   self.doc['visible'].append(data)
   if self.mainDepth:self.doc['mainText'].append(data)
   for f in self.stack:
    if not f['hidden'] and (f['brand'] or f['card'] or f['logobox'] or f['href'] is not None):f['text'].append(data)

base=pathlib.Path(sys.argv[1]);docs={}
for f in sorted(base.rglob('*.html')):
 p=Document();p.feed(f.read_text());p.close()
 p.doc['mainText']=' '.join(p.doc['mainText']);p.doc['visible']=' '.join(p.doc['visible'])
 docs[f.relative_to(base).as_posix()]=p.doc
sitemap=ElementTree.parse(base/'sitemap.xml').getroot()
ns='{http://www.sitemaps.org/schemas/sitemap/0.9}'
entries=[{'loc':u.findtext(ns+'loc'),'lastmod':u.findtext(ns+'lastmod')} for u in sitemap.findall(ns+'url')]
print(json.dumps({'documents':docs,'sitemap':[e['loc'] for e in entries],'sitemapEntries':entries},ensure_ascii=False))
`;
const parsed=spawnSync('python3',['-c',parser,path.join(root,'dist')],{encoding:'utf8',maxBuffer:32*1024*1024});
if(parsed.error||parsed.status!==0){console.error(`HTML/XML parser failed: ${parsed.error?.message||parsed.stderr}`);process.exit(1);}
const {documents,sitemap,sitemapEntries}=JSON.parse(parsed.stdout);
metrics.htmlFiles=Object.keys(documents).length;
metrics.indexableRoutes=manifest.length;
const languages={en:'en',zh:'zh-Hans',es:'es'};
const routeMap=new Map();
const titleMap=new Map();
const descriptionMap=new Map();
const htmlPath=p=>p.endsWith('/')?p.slice(1)+'index.html':p.slice(1);
const resourceKey=p=>p.replace(/^\/(?:zh|es)(?=\/)/,'');
const groups=new Map();
for(const r of manifest){
  expect(typeof r.path==='string'&&r.path.startsWith('/')&&r.path.endsWith('/'),'manifest',`invalid route ${r.path}`);
  expect(!routeMap.has(r.path),'manifest',`duplicate route ${r.path}`);
  routeMap.set(r.path,r);
  const group=groups.get(resourceKey(r.path))||new Map();
  expect(!group.has(r.lang),r.path,`duplicate ${r.lang} translation`);
  group.set(r.lang,r.path);groups.set(resourceKey(r.path),group);
}
metrics.languageGroups=groups.size;
for(const [key,group] of groups)for(const l of Object.keys(languages))expect(group.has(l),key,`missing ${l} route`);
// Derive required route coverage from all source records, independently of the manifest.
const localizedPath=(l,p='')=>`${l==='en'?'':`/${l}`}/${p?`${p}/`:''}`;
const requiredKeys=['','tools','docs','community','about','models','models/compare',...tools.map(t=>`tools/${t.slug}`),...guides.map(g=>`docs/${g.slug}`),...models.map(m=>`models/${m.slug}`)];
const requiredRoutes=new Set(Object.keys(languages).flatMap(l=>requiredKeys.map(p=>localizedPath(l,p))));
expect(routeMap.size===requiredRoutes.size,'manifest',`expected ${requiredRoutes.size} routes derived from source records; received ${routeMap.size}`);
for(const p of requiredRoutes)expect(routeMap.has(p),p,'source record has no delivered route');
for(const p of routeMap.keys())expect(requiredRoutes.has(p),p,'unexpected indexable route without a source record');
for(const r of manifest){
  const doc=documents[htmlPath(r.path)];
  if(!doc){error(r.path,'HTML output is missing');continue;}
  const absolute=new URL(r.path,origin).href;
  expect(doc.lang===languages[r.lang],r.path,`html lang ${doc.lang} does not match ${r.lang}`);
  expect(doc.titles.length===1&&Boolean(doc.titles[0]),r.path,'requires exactly one nonempty title');
  expect(doc.descriptions.length===1&&doc.descriptions[0].trim().length>20,r.path,'requires one substantive meta description');
  // Search results truncate long snippets; keep titles and descriptions inside a
  // readable length so the page's own summary survives intact.
  expect(doc.titles[0].length<=90,r.path,`title is ${doc.titles[0].length} characters; search results truncate near 60`);
  expect(doc.descriptions[0].length<=165,r.path,`description is ${doc.descriptions[0].length} characters; search results truncate near 160`);
  const toolMatch=resourceKey(r.path).match(/^\/tools\/([^/]+)\/$/),tool=toolMatch&&tools.find(t=>t.slug===toolMatch[1]);
  if(tool)expect(doc.descriptions[0]===tool[r.lang]?.seoDescription,r.path,'tool meta description must match localized source summary');
  for(const [value,index,label] of [[doc.titles[0],titleMap,'title'],[doc.descriptions[0],descriptionMap,'description']]){
    if(value){expect(!index.has(value),r.path,`${label} duplicates ${index.get(value)}`);index.set(value,r.path);}
  }
  expect(doc.canonicals.length===1&&doc.canonicals[0]===absolute,r.path,`canonical must self-reference ${absolute}`);
  expect(!doc.robots.some(v=>/\bnoindex\b/i.test(v)),r.path,'indexable route has noindex');
  expect(doc.mainCount===1,r.path,'requires one main landmark');
  expect(doc.h1.length===1&&doc.h1[0].length>1,r.path,'requires one substantive H1');
  expect(doc.mainText.trim().length>100,r.path,'main content is missing from delivered HTML');
  expect(!/\bundefined\b|\[object Object\]|\bTODO\b|\bLorem ipsum\b/.test(doc.visible),r.path,'contains unresolved placeholder content');
  const altMap=new Map();
  for(const a of doc.alternates){expect(!altMap.has(a.lang),r.path,`duplicate hreflang ${a.lang}`);altMap.set(a.lang,a.href);}
  const group=groups.get(resourceKey(r.path));
  for(const [l,tag] of Object.entries(languages)){
    const target=group?.get(l);
    expect(Boolean(target)&&altMap.get(tag)===new URL(target||'/',origin).href,r.path,`hreflang ${tag} must point to the corresponding translation`);
    if(target){
      const targetDoc=documents[htmlPath(target)];
      expect(targetDoc?.alternates.some(a=>a.lang===languages[r.lang]&&a.href===absolute),r.path,`hreflang ${tag} does not return to this page`);
    }
  }
  expect(altMap.size===4,r.path,'expected only en, zh-Hans, es and x-default alternates');
  expect(altMap.get('x-default')===new URL(group?.get('en')||'/',origin).href,r.path,'x-default must resolve to the English equivalent');
  expect(doc.jsonld.length>0,r.path,'missing JSON-LD');
  for(const block of doc.jsonld){
    metrics.jsonLdBlocks++;
    try{
      const ld=JSON.parse(block),nodes=ld['@graph']||[ld];
      expect(ld['@context']==='https://schema.org',r.path,'JSON-LD context must be schema.org');
      const page=nodes.find(n=>n.url===absolute&&n['@type']!=='WebSite');
      expect(Boolean(page),r.path,'JSON-LD lacks this page entity');
      if(page){expect(page.inLanguage===doc.lang,r.path,'JSON-LD page language disagrees with HTML');expect(Boolean(page.name||page.headline),r.path,'JSON-LD page has no name');
        const match=resourceKey(r.path).match(/^\/models\/([^/]+)\/$/);
        const model=match&&models.find(m=>m.slug===match[1]);
        if(model){
          expect(page.about?.name===model.name&&page.about?.sameAs===model.officialUrl,r.path,'model JSON-LD about must identify the visible family and official URL');
          const citations=Array.isArray(page.citation)?page.citation:[page.citation].filter(Boolean);
          for(const source of model.sourceUrls)expect(citations.includes(source),r.path,`model JSON-LD missing citation ${source}`);
        }
      }
    }catch(e){error(r.path,`invalid JSON-LD: ${e.message}`);}
  }
}
const deliveredIndexable=new Set(Object.keys(documents).filter(f=>f!=='404.html').map(f=>f==='index.html'?'/':'/'+f.replace(/index\.html$/,'')));
for(const p of deliveredIndexable)expect(routeMap.has(p),p,'HTML exists outside the route manifest');
for(const [file,doc] of Object.entries(documents)){
  const pagePath=file==='index.html'?'/':'/'+file.replace(/index\.html$/,'');
  for(const image of doc.images)expect(typeof image.src==='string'&&image.src.trim()&&!/^(?:data:text|javascript):/i.test(image.src),pagePath,'image has no real safe src');
  for(const brand of doc.brands){
    metrics.brandInstances++;
    const declared=logos[brand.key];
    expect(Boolean(declared),pagePath,`unknown brand mapping ${brand.key}`);
    if(declared)expect(brand.images.some(i=>i.src===declared.src),pagePath,`brand ${brand.key} does not display its declared logo image`);
    expect(!brand.text.trim(),pagePath,`brand ${brand.key} still contains a letter/text placeholder`);
  }
  for(const box of doc.logoBoxes)expect(box.images.length>0&&!box.text.trim(),pagePath,'tool-logo container has no image or contains placeholder text');
  for(const card of doc.cards){
    const expected=logos[card.slug];
    expect(Boolean(expected)&&card.images.some(i=>i.src===expected.src),pagePath,`${card.kind} card ${card.slug} lacks its actual logo`);
  }
  expect(new Set(doc.ids).size===doc.ids.length,pagePath,'duplicate element IDs');
  for(const href of doc.hrefs){
    let target;
    try{target=new URL(href,new URL(pagePath,origin));}catch{error(pagePath,`malformed href ${href}`);continue;}
    if(target.origin!==origin.origin||!['http:','https:'].includes(target.protocol))continue;
    metrics.internalLinks++;
    let pathname;
    try{pathname=decodeURIComponent(target.pathname);}catch{error(pagePath,`invalid URL encoding ${href}`);continue;}
    const targetFile=htmlPath(pathname);
    expect(exists('dist/'+targetFile),pagePath,`broken internal link ${href}`);
    if(target.hash){
      let anchor;
      try{anchor=decodeURIComponent(target.hash.slice(1));}catch{error(pagePath,`invalid anchor encoding ${href}`);continue;}
      if(anchor)expect(documents[targetFile]?.ids.includes(anchor),pagePath,`missing target anchor ${href}`);
    }
  }
  for(const asset of doc.assets){
    if(!asset)continue;
    let target;
    try{target=new URL(asset,new URL(pagePath,origin));}catch{error(pagePath,`malformed asset reference ${asset}`);continue;}
    if(target.origin!==origin.origin)continue;
    metrics.assetReferences++;
    expect(exists('dist/'+decodeURIComponent(target.pathname).slice(1)),pagePath,`missing local asset ${asset}`);
    // The deploy headers cache /assets/* for a year, which is only safe while every
    // file there carries a content hash in its name.
    if(target.pathname.startsWith('/assets/'))expect(/^\/assets\/[a-z0-9-]+\.[0-9a-f]{8,}\.(js|css|woff2?|png|svg)$/i.test(target.pathname),pagePath,`asset lacks a content hash: ${asset}`);
  }
}
// Hashed assets are served with a one-year immutable cache, so the deploy header
// file has to keep that promise for the /assets/ prefix.
if(exists('deploy/cloudflare-workers/_headers'))expect(/^\/assets\/\*\s*\n\s*! Cache-Control\s*\n\s*Cache-Control: public, max-age=31536000, immutable/m.test(read('deploy/cloudflare-workers/_headers')),'headers','/assets/* must be cached as immutable');
// Heading levels must not skip: a section that jumps from h1 to an h3 card
// title is announced out of order by screen readers and flattens the outline.
// The 404 page is exempt; its only deep headings sit in the footer.
for(const file of Object.keys(documents)){
  if(file==='404.html')continue;
  const levels=[...read('dist/'+file).matchAll(/<h([1-6])[\s>]/g)].map(m=>Number(m[1]));
  const pagePath=file==='index.html'?'/':'/'+file.replace(/index\.html$/,'');
  let previous=0;
  for(const level of levels){
    expect(!previous||level<=previous+1,pagePath,`heading level jumps from h${previous} to h${level}`);
    previous=level;
  }
}
const notFound=documents['404.html'];
expect(Boolean(notFound),'404','404.html is missing');
if(notFound)expect(notFound.robots.some(v=>/\bnoindex\b/i.test(v)),'404','must have noindex');
// CSS references fonts and images that no HTML page names directly, so a
// renamed font would otherwise ship as a silent 404.
metrics.cssReferences=0;
for(const file of fs.readdirSync(path.join(root,'dist/assets')).filter(f=>f.endsWith('.css'))){
  const css=read('dist/assets/'+file);
  for(const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)){
    const target=match[2].trim();
    if(/^(?:data:|https?:|\/\/)/i.test(target))continue;
    metrics.cssReferences++;
    const clean=decodeURIComponent(target.split(/[?#]/)[0]).replace(/^\//,'');
    expect(exists('dist/'+clean),'assets/'+file,`missing CSS reference ${target}`);
  }
}
// The woff2 fonts are subsets of the original families, so a character added
// later could silently fall back to a different face. The coverage list is
// regenerated from the fonts themselves; CJK text renders from system fonts.
if(exists('docs/font-coverage.json')){
  const covered=new Set(JSON.parse(read('docs/font-coverage.json')).codepoints);
  const used=new Set();
  for(const doc of Object.values(documents))for(const ch of doc.visible)used.add(ch);
  const systemFont=/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u{20000}-\u{2FA1F}\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2700-\u27BF]/u;
  const missing=[...used].filter(ch=>ch.trim()&&!systemFont.test(ch)&&!covered.has(ch.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')));
  expect(missing.length===0,'fonts','woff2 subsets lack '+missing.slice(0,8).map(c=>JSON.stringify(c)).join(', ')+'; add these glyphs to the subsets in public/fonts');
}
metrics.sitemapUrls=sitemap.length;
const sitemapSet=new Set(sitemap);
expect(sitemapSet.size===sitemap.length,'sitemap','contains duplicate URLs');
for(const r of manifest)expect(sitemapSet.has(new URL(r.path,origin).href),'sitemap',`missing ${r.path}`);
for(const r of manifest){const entry=sitemapEntries.find(e=>e.loc===new URL(r.path,origin).href);expect(Boolean(entry)&&entry.lastmod===r.lastmod,'sitemap',`lastmod differs from the content review date for ${r.path}`);}
for(const loc of sitemap){
  try{const u=new URL(loc);expect(u.origin===origin.origin&&routeMap.has(u.pathname)&&!u.search&&!u.hash,'sitemap',`unexpected URL ${loc}`);}catch{error('sitemap',`invalid absolute URL ${loc}`);}
}
expect(!sitemap.some(s=>/404(?:\.html|\/)/.test(s)),'sitemap','must exclude the error page');
if(exists('dist/robots.txt'))expect(read('dist/robots.txt').includes(`Sitemap: ${origin.origin}/sitemap.xml`),'robots','missing canonical sitemap declaration');else error('robots','robots.txt missing');
// llms.txt is generated from the same records as the pages. Keep it complete and
// honest: every English route must appear, and nothing may point at a page that
// was not built.
if(exists('dist/llms.txt')){
  const llms=read('dist/llms.txt');
  expect(llms.startsWith('# MonkeyAI Community'),'llms','must open with the site heading');
  expect(!/\bundefined\b|\[object Object\]|\bTODO\b/.test(llms),'llms','contains placeholder content');
  const listed=[...llms.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m=>new URL(m[1]).pathname);
  for(const p of listed){if(p==='/sitemap.xml'||p==='/robots.txt')continue;if(/\.json$/.test(p)){expect(exists('dist'+p),'llms',`points at a data file that is not built: ${p}`);continue;}expect(routeMap.has(p),'llms',`points at a page that is not built: ${p}`);}
  for(const r of routeMap.values())if(r.lang==='en')expect(listed.includes(r.path),'llms',`omits ${r.path}`);
}else error('llms','llms.txt missing');
// The site search has to reach the section landing pages by name, not only the
// individual entries, or a query like "community" returns an empty state.
for(const [l,prefix] of [['en',''],['zh','zh/'],['es','es/']]){
  const file=`dist/${prefix}search-index.json`;
  if(!exists(file)){error('search',`${prefix}search-index.json missing`);continue;}
  let index;
  try{index=JSON.parse(read(file));}catch(e){error('search',`${prefix}search-index.json is not valid JSON`);continue;}
  for(const route of ['docs','tools','models','models/compare','community','about'])
    expect(index.some(x=>x.url===`/${prefix}${route}/`),'search',`${prefix}search-index.json omits /${prefix}${route}/`);
}
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
for(const [kind,items] of [['tools',tools],['guides',guides],['models',models]]){
  expect(Array.isArray(items)&&items.length>0,kind,'source data must contain entries');
  metrics[kind]=items.length;
  const slugs=new Set();
  for(const item of items){
    const where=`${kind}/${item.slug}`;
    expect(nonempty(item.slug)&&!slugs.has(item.slug),where,'missing or duplicate slug');slugs.add(item.slug);
    for(const l of Object.keys(languages)){
      const tr=item[l];metrics.localizedDataEntries++;
      if(!tr){error(where,`missing ${l} content`);continue;}
      // Completeness is checked through the localized fields and guide sections,
      // not a shared character quota that penalizes concise Chinese descriptions.
      expect(nonempty(tr.description),where,`${l} description missing`);
      if(l!=='en')expect(tr.description!==item.en?.description,where,`${l} description is untranslated`);
      if(l==='zh')expect(/[\u3400-\u9fff]/u.test(tr.description),where,'Chinese description has no Chinese text');
      if(kind==='tools'){
        expect(nonempty(tr.seoDescription),where,`${l} search summary missing`);
        if(l!=='en')expect(tr.seoDescription!==item.en?.seoDescription,where,`${l} search summary is untranslated`);
        expect(nonempty(tr.tagline)&&nonempty(tr.caveat),where,`${l} tagline or caveat missing`);
        expect(Array.isArray(tr.useCases)&&tr.useCases.length>=3&&tr.useCases.every(nonempty),where,`${l} use cases incomplete`);
      }else if(kind==='models'){
        expect(nonempty(tr.tagline)&&nonempty(tr.accessNote)&&nonempty(tr.selectionTip),where,`${l} model summary/access/selection text incomplete`);
        expect(Array.isArray(tr.overview)&&tr.overview.length>=2&&tr.overview.every(nonempty),where,`${l} model overview incomplete`);
        expect(Array.isArray(tr.strengths)&&tr.strengths.length>=3&&tr.strengths.every(nonempty),where,`${l} model tasks incomplete`);
        expect(Array.isArray(tr.limitations)&&tr.limitations.length>=2&&tr.limitations.every(nonempty),where,`${l} model limitations incomplete`);
      }else{
        expect(nonempty(tr.title),where,`${l} title missing`);
        expect(Array.isArray(tr.sections)&&tr.sections.length>=3,where,`${l} guide needs at least three sections`);
        if(Array.isArray(tr.sections))for(const [i,s] of tr.sections.entries()){
          expect(nonempty(s.heading),where,`${l} section ${i+1} heading missing`);
          expect((s.paragraphs||[]).some(nonempty)||(s.bullets||[]).some(nonempty),where,`${l} section ${i+1} content missing`);
        }
      }
    }
    const sourceUrls=kind==='tools'?[item.url,item.sourceUrl]:item.sourceUrls;
    expect(Array.isArray(sourceUrls)&&sourceUrls.length>0,where,'missing sources');
    for(const source of sourceUrls||[])try{expect(new URL(source).protocol==='https:',where,`non-HTTPS source ${source}`);}catch{error(where,`invalid source URL ${source}`);}
  }
}
// The skip link only helps if its target can take focus. Without tabindex="-1"
// on <main> the browser moves the hash but leaves focus on <body>, so the next
// Tab starts over in the header.
for(const file of Object.keys(documents)){
  const html=read('dist/'+file);
  // Match on attributes, not on attribute order: several equivalent spellings
  // behave identically, so the check should not demand one exact tag.
  const skip=[...html.matchAll(/<a\b[^>]*>/g)].map(m=>m[0]).find(tag=>/class="[^"]*\bskip-link\b/.test(tag)&&/href="#main"/.test(tag));
  expect(Boolean(skip),file,'skip link missing or not pointing at #main');
  const main=html.match(/<main\b[^>]*>/);
  expect(Boolean(main)&&/id="main"/.test(main[0])&&/tabindex="-1"/.test(main[0]),file,'main region cannot receive skip-link focus');
}
// The search hint is read by people whose keyboards differ. Every page must ship
// both the advertised shortcuts and the label that the client rewrites for
// non-Mac platforms; a hard-coded command sign alone is a false promise.
const clientAsset=fs.readdirSync(path.join(root,'dist/assets')).find(name=>/^app\.[a-f0-9]+\.js$/.test(name));
expect(Boolean(clientAsset),'dist/assets','no hashed client script found');
const clientSource=clientAsset?read('dist/assets/'+clientAsset):'';
expect(/function shortcutLabel\(platform\)\{[^}]*'Ctrl K'/.test(clientSource),'app.js','client script cannot relabel the shortcut for non-Mac keyboards');
for(const file of Object.keys(documents)){
  // The 404 page is a deliberate minimal page with no header search.
  if(file==='404.html')continue;
  const html=read('dist/'+file);
  const trigger=html.match(/<button\b[^>]*data-open-search[^>]*>[\s\S]*?<\/button>/);
  expect(Boolean(trigger),file,'search trigger missing');
  if(!trigger)continue;
  expect(/aria-keyshortcuts="Meta\+K Control\+K"/.test(trigger[0]),file,'search trigger does not list both keyboard shortcuts');
  expect(/<span[^>]*data-shortcut[^>]*>/.test(trigger[0]),file,'search trigger has no platform-aware shortcut label');
}
// The sitemap and the Article schema describe the same page. Two different
// freshness dates read as a contradiction, so both must come from one source.
const sitemapDates=new Map(sitemapEntries.map(e=>[e.loc,e.lastmod]));
for(const file of Object.keys(documents)){
  if(file==='404.html')continue;
  const html=read('dist/'+file);
  const raw=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if(!raw)continue;
  let graph;
  try{graph=JSON.parse(raw[1])['@graph']||[];}catch{error(file,'structured data is not valid JSON');continue;}
  const article=graph.find(node=>node['@type']==='Article');
  const dated=graph.filter(node=>typeof node.dateModified==='string');
  if(!article&&!dated.length)continue;
  const route=file==='index.html'?'/':'/'+file.replace(/index\.html$/,'');
  const date=sitemapDates.get(new URL(route,origin).href);
  expect(Boolean(date),file,'page with a review date is absent from the sitemap');
  // An Article without a date cannot be compared, so it must not slip through.
  if(article)expect(/^\d{4}-\d{2}-\d{2}$/.test(article.dateModified||''),file,'Article carries no review date');
  for(const node of dated)if(date)expect(node.dateModified===date,file,`schema dateModified ${node.dateModified} differs from sitemap ${date}`);
}

const officialHosts={
  'openai-gpt':['developers.openai.com','platform.openai.com'],
  claude:['platform.claude.com','docs.anthropic.com','anthropic.com','www.anthropic.com','claude.com'],
  gemini:['ai.google.dev','aistudio.google.com','deepmind.google','cloud.google.com','docs.cloud.google.com'],
  deepseek:['api-docs.deepseek.com','deepseek.com','www.deepseek.com'],
  qwen:['qwen.readthedocs.io','qwenlm.github.io','qwen.ai','www.alibabacloud.com'],
  llama:['llama.com','www.llama.com','dev.meta.ai','ai.meta.com','llama.developer.meta.com'],
  mistral:['mistral.ai','docs.mistral.ai'],grok:['x.ai','docs.x.ai','grok.com'],
  kimi:['kimi.com','www.kimi.com','platform.kimi.ai','platform.moonshot.ai','moonshotai.github.io'],
  glm:['z.ai','docs.z.ai','bigmodel.cn','docs.bigmodel.cn'],
};
const officialOrganizations={'openai-gpt':['openai'],claude:['anthropics'],gemini:['google','google-deepmind'],deepseek:['deepseek-ai'],qwen:['qwenlm','qwen'],llama:['meta-llama'],mistral:['mistralai'],grok:['xai-org'],kimi:['moonshotai'],glm:['zai-org','thudm']};
function officialSource(slug,source){try{const u=new URL(source);if(u.protocol!=='https:')return false;if((officialHosts[slug]||[]).includes(u.hostname))return true;if(['github.com','huggingface.co'].includes(u.hostname))return (officialOrganizations[slug]||[]).includes(u.pathname.split('/')[1].toLowerCase());return false;}catch{return false;}}
const normalized=s=>String(s).replace(/\s+/g,' ').trim();
for(const model of models){
  const where=`models/${model.slug}`;
  expect(nonempty(model.name)&&nonempty(model.provider)&&['hosted','hybrid','open-weights'].includes(model.access),where,'model identity or delivery route incomplete');
  expect(/^\d{4}-\d{2}-\d{2}$/.test(model.reviewed||''),where,'missing dated review');
  expect(Array.isArray(model.sourceUrls)&&model.sourceUrls.length>=2,where,'requires primary references for model claims');
  for(const source of model.sourceUrls||[])expect(officialSource(model.slug,source),where,`reference is not a recognized official provider/repository URL: ${source}`);
  for(const link of [model.officialUrl,model.apiDocsUrl])expect(officialSource(model.slug,link),where,`official/API URL is not recognized: ${link}`);
  for(const slug of model.relatedTools||[])expect(tools.some(t=>t.slug===slug),where,`related tool ${slug} does not exist`);
  for(const l of Object.keys(languages)){
    const route=localizedPath(l,`models/${model.slug}`),doc=documents[htmlPath(route)];
    if(!doc)continue;
    expect(doc.images.some(i=>i.src===logos[model.slug]?.src),route,'model detail lacks its corresponding logo');
    const text=normalized(doc.mainText),tr=model[l];
    for(const paragraph of tr.overview||[])expect(text.includes(normalized(paragraph)),route,'model overview paragraph is absent from static main content');
    expect(text.includes(normalized(tr.accessNote))&&text.includes(normalized(tr.selectionTip)),route,'model access/selection guidance is absent from static main content');
    for(const source of model.sourceUrls||[])expect(doc.links.some(a=>a.inMain&&!a.hidden&&a.href===source&&a.text.trim()),route,`source is not visibly cited in main content: ${source}`);
  }
}
for(const guide of guides){
  for(const l of Object.keys(languages)){
    const route=localizedPath(l,`docs/${guide.slug}`),doc=documents[htmlPath(route)];
    if(!doc)continue;
    const content=normalized(doc.mainText),tr=guide[l];
    for(const section of tr.sections||[]){
      expect(content.includes(normalized(section.heading)),route,'guide heading missing from static HTML');
      for(const paragraph of section.paragraphs||[])expect(content.includes(normalized(paragraph)),route,'guide paragraph missing from static HTML');
      if(section.code)expect(content.includes(normalized(section.code)),route,'guide code block missing from static HTML');
    }
    for(const source of guide.sourceUrls||[])expect(doc.links.some(a=>a.inMain&&!a.hidden&&a.href===source&&a.text.trim()),route,`official source is not visibly linked: ${source}`);
    try{const nodes=JSON.parse(doc.jsonld[0])['@graph'],page=nodes.find(n=>n.url===new URL(route,origin).href&&n['@type']==='Article');
      expect(page?.dateModified===(guide.reviewed||config.updated),route,'article dateModified must match the guide review date');
      for(const source of guide.sourceUrls||[])expect(page?.citation?.includes(source),route,`article JSON-LD is missing cited source ${source}`);
    }catch(e){error(route,`cannot inspect guide article JSON-LD: ${e.message}`);}
  }
}
for(const l of Object.keys(languages)){
  const toolsDoc=documents[htmlPath(localizedPath(l,'tools'))],modelsDoc=documents[htmlPath(localizedPath(l,'models'))],compareDoc=documents[htmlPath(localizedPath(l,'models/compare'))],docsDoc=documents[htmlPath(localizedPath(l,'docs'))];
  for(const tool of tools){
    const detail=documents[htmlPath(localizedPath(l,`tools/${tool.slug}`))];
    expect(detail?.images.some(i=>i.src===logos[tool.slug]?.src),localizedPath(l,`tools/${tool.slug}`),'tool detail lacks its corresponding logo');
    expect(toolsDoc?.cards.some(c=>c.kind==='tool'&&c.slug===tool.slug),localizedPath(l,'tools'),`tool ${tool.slug} missing from directory`);
  }
  for(const model of models){
    expect(modelsDoc?.cards.some(c=>c.kind==='model'&&c.slug===model.slug),localizedPath(l,'models'),`model ${model.slug} missing from directory`);
    expect(compareDoc?.hrefs.includes(localizedPath(l,`models/${model.slug}`)),localizedPath(l,'models/compare'),`comparison does not link to ${model.slug}`);
  }
  expect(modelsDoc?.hrefs.includes(localizedPath(l,'models/compare')),localizedPath(l,'models'),'model directory has no comparison entry');
  for(const guide of guides)expect(docsDoc?.hrefs.includes(localizedPath(l,`docs/${guide.slug}`)),localizedPath(l,'docs'),`guide ${guide.slug} missing from guide directory`);
}
const requiredBrands=new Set([...tools,...models].map(x=>x.slug));
metrics.logoMappings=Object.keys(logos).length;
const logoAssets=new Set();
for(const key of requiredBrands){
  const logo=logos[key];
  expect(Boolean(logo),`logos/${key}`,'missing official logo mapping');if(!logo)continue;
  expect(typeof logo.src==='string'&&logo.src.startsWith('/logos/')&&!logo.src.includes('..')&&!/[?#]/.test(logo.src),`logos/${key}`,'logo must be a stable local /logos/ asset');
  expect(['official-logo','official-favicon'].includes(logo.kind),`logos/${key}`,'logo kind/source is not declared');
  expect(/^#[a-f0-9]{6}$/i.test(logo.background||''),`logos/${key}`,'missing safe logo background color');
  let source;try{source=new URL(logo.sourceUrl);expect(source.protocol==='https:',`logos/${key}`,'source must be HTTPS');}catch{error(`logos/${key}`,'invalid source URL');}
  if(typeof logo.src!=='string')continue;
  const local='public'+logo.src;
  expect(exists(local)&&exists('dist'+logo.src),`logos/${key}`,'logo source or delivered asset missing');
  if(!exists(local))continue;
  const bytes=fs.readFileSync(path.join(root,local)),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  const record=logoSources.find(s=>s.key===key)||logoSources.find(s=>s.file===local&&s.sourceUrl===logo.sourceUrl);
  expect(record?.sha256===sha&&record?.sourceUrl===logo.sourceUrl&&record?.file===local,`logos/${key}`,'provenance record differs from local bytes, source, or file');
  if(exists('dist'+logo.src))expect(fs.readFileSync(path.join(root,'dist'+logo.src)).equals(bytes),`logos/${key}`,'built logo differs from source asset');
  logoAssets.add(logo.src);
}
metrics.uniqueLogoAssets=logoAssets.size;
for(const src of logoAssets){
  const bytes=fs.readFileSync(path.join(root,'public'+src)),ext=path.extname(src).toLowerCase();
  expect(bytes.length>50,src,'logo asset is empty or implausibly small');
  if(ext==='.png')expect(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24&&bytes.readUInt32BE(16)>1&&bytes.readUInt32BE(20)>1,src,'not a usable PNG image');
  else if(ext==='.svg'){
    metrics.svgAssetsChecked++;
    const svgCheck=spawnSync('python3',['-c',String.raw`import sys,re,xml.etree.ElementTree as E
s=open(sys.argv[1]).read()
assert not re.search(r'<!DOCTYPE|<!ENTITY',s,re.I),'DTD/entity declarations are forbidden'
r=E.fromstring(s)
assert r.tag.split('}')[-1].lower()=='svg','root is not SVG'
for e in r.iter():
 t=e.tag.split('}')[-1].lower()
 assert t not in ['script','foreignobject','iframe','object','embed','audio','video'],'active SVG element '+t
 for k,v in e.attrib.items():
  k=k.split('}')[-1].lower()
  assert not k.startswith('on'),'event handler '+k
  if k in ['href','src']:assert v.startswith('#') or re.match(r'data:image/(png|jpeg|webp);base64,',v,re.I),'external or active resource '+v
  for ref in re.findall(r'url\(\s*["\']?(.*?)["\']?\s*\)',v,re.I):assert ref.startswith('#'),'external CSS resource '+ref
 for text in [e.text or '']:
  assert not re.search(r'@import|javascript:',text,re.I),'active style content'
  for ref in re.findall(r'url\(\s*["\']?(.*?)["\']?\s*\)',text,re.I):assert ref.startswith('#'),'external style resource '+ref
print('safe')`,path.join(root,'public'+src)],{encoding:'utf8'});
    expect(svgCheck.status===0,src,`SVG is not safely static: ${svgCheck.stderr.trim()}`);
  }else expect(['.webp','.jpg','.jpeg'].includes(ext),src,'unsupported logo image format');
}

// Small-text contrast guard. The palette leans on pale lavender grays, so the
// metadata selectors below are pinned to WCAG AA against the background each
// one actually renders on. Without this, a later palette tweak can quietly drop
// breadcrumbs, review dates, or the in-page table of contents below 4.5:1.
const contrastPairs=[
  ['.breadcrumbs','#fcfbf9'],
  ['.article-meta','#fcfbf9'],
  ['.toc>a','#fcfbf9'],
  ['.tool-bottom','#ffffff'],
  ['.footer-bottom p','#f5f3f0'],
  ['.directory-meta','#fcfbf9'],
  ['.docs-sidebar>a','#fcfbf9'],
  ['.search-trigger','#fcfbf9'],
  ['.comparison-table td','#ffffff'],
  ['.comparison-model small','#ffffff'],
  ['.comparison-docs','#ffffff'],
  ['.evaluation-steps article>span','#ffffff'],
  ['.comparison-table caption','#f7f3fa'],
  ['.docs-intro>a','#f4f0f8'],
  ['.docs-home-search>span','#fcfbf9'],
  ['.docs-topic-count','#fcfbf9'],
  ['.doc-result-body>span','#fcfbf9'],
  ['.model-side-facts>span','#fcfbf9'],
  ['.not-found>span','#fcfbf9'],
  ['.footer-heart','#f0ebf5'],
  ['.ribbon-inner','#f0ebf5'],
];
const cssRules=[...read('public/styles.css').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selectors:match[1].split(',').map(s=>s.trim()),body:match[2]}));
const channel=v=>{const c=v/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
const luminance=hex=>0.2126*channel(parseInt(hex.slice(1,3),16))+0.7152*channel(parseInt(hex.slice(3,5),16))+0.0722*channel(parseInt(hex.slice(5,7),16));
const contrast=(a,b)=>{const [lighter,darker]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (lighter+0.05)/(darker+0.05);};
for(const [selector,background] of contrastPairs){
  // A selector can appear in several rules; only the one that declares a text
  // color is relevant, otherwise the first hit may be a layout-only rule.
  const rule=cssRules.find(item=>item.selectors.includes(selector)&&/(?:^|;)color:/.test(item.body));
  expect(Boolean(rule),`styles.css ${selector}`,'no rule declares this selector');
  if(!rule)continue;
  const color=rule.body.match(/(?:^|;)color:\s*(#[0-9a-f]{6})/i);
  expect(Boolean(color),`styles.css ${selector}`,'text color is not a literal hex value');
  if(!color)continue;
  const ratio=contrast(color[1],background);
  expect(ratio>=4.5,`styles.css ${selector}`,`contrast ${ratio.toFixed(2)}:1 against ${background} is below the 4.5:1 minimum`);
  metrics.contrastPairsChecked++;
}
console.log(JSON.stringify({status:issues.length?'failed':'passed',...metrics,issues:issues.length},null,2));
if(issues.length){for(const message of issues)console.error(`- ${message}`);process.exitCode=1;}
else console.log('All delivered routes, reciprocal language groups, static content, links, sources, and sitemap checks passed.');
