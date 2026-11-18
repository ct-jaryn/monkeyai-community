import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ui} from '../src/i18n.mjs';

// The DOM shim proves the scripts do the right thing with the nodes they are
// given. It cannot prove that a browser lays the pages out, that the search dialog
// really opens, or that a phone-width page stays inside the screen. This harness
// drives a local Chrome over the DevTools protocol instead, so those questions are
// answered by an engine rather than by reading CSS.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const toolsData=JSON.parse(fs.readFileSync(path.join(root,'src/data/tools.json'),'utf8'));
const failures=[];
let checks=0;
const check=(ok,label)=>{checks++;if(!ok)failures.push(label);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const browserPaths=[
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browserPath=browserPaths.find(p=>fs.existsSync(p));
if(!browserPath){
  console.log(JSON.stringify({status:'skipped',reason:'no Chrome or Chromium binary found; set CHROME to run the browser checks'},null,2));
  process.exit(0);
}
if(!fs.existsSync(path.join(dist,'index.html'))){
  console.error('Browser checks need a build: run npm run build first.');
  process.exit(1);
}

// A tiny static server keeps the harness self-contained: directory URLs resolve,
// unknown paths get the built 404, and nothing leaves the machine.
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.xml':'application/xml'};
const server=http.createServer((req,res)=>{
  let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  let file=path.join(dist,pathname);
  if(!file.startsWith(dist)){res.writeHead(403).end();return;}
  if(pathname.endsWith('/'))file=path.join(file,'index.html');
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){
    const notFound=fs.readFileSync(path.join(dist,'404.html'));
    res.writeHead(404,{'content-type':'text/html; charset=utf-8'}).end(notFound);
    return;
  }
  res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'mai-browser-'));
const debugPort=9300+Math.floor(Math.random()*400);
// A loaded machine can take over a minute to open the port; the budget stays
// finite so a machine that cannot start Chrome still fails instead of hanging.
const startupBudget=Number(process.env.CHECK_BROWSER_START_MS||15000);
const chrome=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'about:blank'],{stdio:'ignore'});

const stop=()=>{
  try{chrome.kill('SIGKILL');}catch{}
  try{server.close();}catch{}
  try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
};
process.on('exit',stop);

async function waitForDevtools(){
  for(let i=0;i<Math.ceil(startupBudget/100);i++){
    try{
      const version=await (await fetch('http://127.0.0.1:'+debugPort+'/json/version')).json();
      if(version.webSocketDebuggerUrl)return;
    }catch{}
    await sleep(100);
  }
  throw new Error('Chrome did not open its debugging port');
}

let socket,nextId=0;
const pending=new Map();
function send(method,params={}){
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('timeout: '+method));},15000);
    pending.set(id,message=>{clearTimeout(timer);message.error?reject(new Error(method+': '+message.error.message)):resolve(message.result);});
    socket.send(JSON.stringify({id,method,params}));
  });
}
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+' '+(result.exceptionDetails.exception?.description||''));
  return result.result.value;
};

// Wait for a condition instead of sleeping a fixed time: fetches and layout both
// finish on their own schedule, and a fixed pause only hides that.
async function until(expression,timeout=8000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    if(await evaluate(expression))return true;
    await sleep(80);
  }
  return false;
}

// Contrast is a property of the rendered page, not of a token in the stylesheet:
// the same colour passes on white and fails on lavender. This measures every text
// node against the background it is actually painted on. Illustrations marked
// role="img" and hidden subtrees are exempt, because their text is a picture.
const contrastAudit=String.raw`(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
  const lum = ({r,g,b}) => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const blend = (t,u) => ({ r:t.r*t.a+u.r*(1-t.a), g:t.g*t.a+u.g*(1-t.a), b:t.b*t.a+u.b*(1-t.a), a:1 });
  const bgOf = el => {
    let node=el, stack=[];
    while (node && node!==document.documentElement) {
      const cs=getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage!=='none') return {unknown:true};
      const c=parse(cs.backgroundColor);
      if (c && c.a>0) { stack.push(c); if (c.a===1) break; }
      node=node.parentElement;
    }
    let base={r:252,g:251,b:249,a:1};
    for (let i=stack.length-1;i>=0;i--) base = stack[i].a===1 ? {...stack[i]} : blend(stack[i],base);
    return base;
  };
  const out=[], seen=new Set();
  const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text=walker.currentNode.textContent.trim();
    if (!text) continue;
    const el=walker.currentNode.parentElement;
    if (!el || el.closest('[aria-hidden="true"]') || el.closest('[role="img"]') || el.closest('script,style,noscript')) continue;
    const rect=el.getBoundingClientRect();
    if (rect.width<2 || rect.height<2) continue;
    const cs=getComputedStyle(el);
    if (cs.visibility==='hidden' || cs.display==='none' || Number(cs.opacity)===0) continue;
    const fg=parse(cs.color);
    if (!fg || fg.a===0) continue;
    const bg=bgOf(el);
    if (bg.unknown) continue;
    const color=fg.a<1?blend(fg,bg):fg;
    const weight=Number(cs.fontWeight)||400, size=parseFloat(cs.fontSize);
    const large=size>=24||(size>=18.66&&weight>=700);
    const r=ratio(color,bg), need=large?3:4.5;
    if (r+0.05<need) {
      const key=cs.color+'|'+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+'|'+size+'|'+weight;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({text:text.slice(0,30), ratio:Number(r.toFixed(2)), need, cls:(el.className&&el.className.toString().slice(0,30))||el.tagName});
    }
  }
  return JSON.stringify(out);
})()`;

async function viewport(width,height=900){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
}
async function visit(route){
  await send('Page.navigate',{url:origin+route});
  await until('document.readyState==="complete"');
}

try{
  await waitForDevtools();
  const targets=await (await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();
  const target=targets.find(t=>t.type==='page');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(new Error('could not attach to the page'));});
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}
  };
  await send('Page.enable');
  await send('Runtime.enable');
  // A hidden page freezes smooth scrolling, so a jump animation started here would
  // never advance and the position assertions would fail for the harness rather
  // than for the site. Bringing the tab to the front keeps it visible.
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled',{enabled:true});

  // Nine static subsets became two variable faces. A page should fetch at most two
  // font files, and weight 550 must lay out differently from 600 — proof that the
  // weight axis is real rather than silently rounded to the nearest static file.
  await viewport(1280);
  await visit('/');
  await until('document.fonts.status==="loaded"');
  const fontUsage=JSON.parse(await evaluate(`JSON.stringify((()=>{
    const fonts=performance.getEntriesByType('resource').filter(r=>r.name.indexOf('/fonts/')>=0);
    const measure=(weight,text)=>{
      const ctx=document.createElement('canvas').getContext('2d');
      ctx.font=weight+' 40px Manrope, sans-serif';
      return Math.round(ctx.measureText(text).width*100)/100;
    };
    const sample='MonkeyAI community guides';
    return {
      count:fonts.length,
      bytes:fonts.reduce((sum,r)=>sum+(r.encodedBodySize||0),0),
      external:fonts.filter(r=>r.name.indexOf(location.origin+'/fonts/')!==0).map(r=>r.name),
      w400:measure(400,sample),w550:measure(550,sample),w600:measure(600,sample),w800:measure(800,sample)
    };
  })())`));
  check(fontUsage.count<=2,'/ requests '+fontUsage.count+' font files; only the two variable faces should ship');
  check(fontUsage.bytes<=45000,'/ downloads '+Math.round(fontUsage.bytes/1024)+'KB of fonts, above the 45KB budget for the two cut-down variable faces');
  check(fontUsage.external.length===0,'/ loads fonts from '+fontUsage.external.join(', ')+' instead of its own origin');
  check(fontUsage.w550!==fontUsage.w600,'/ lays out weight 550 exactly like 600, so the variable weight axis is missing');
  check(fontUsage.w800>fontUsage.w400,'/ renders weight 800 no wider than 400');

  // The brand mark ships as a 10KB WebP with the PNG kept only as a fallback, and
  // the tab icon is a small dedicated file instead of the 30KB logo.
  const brand=JSON.parse(await evaluate(`JSON.stringify((()=>{
    const img=document.querySelector('.header .brand-mark img');
    const resources=performance.getEntriesByType('resource')
      .filter(r=>r.name.indexOf('/brand/')>=0)
      .map(r=>({name:r.name.split('/').pop(),size:r.encodedBodySize||0}));
    return {currentSrc:img?img.currentSrc:'',resources};
  })())`));
  check(/\.webp$/.test(brand.currentSrc),'/ renders the brand mark from '+brand.currentSrc+' instead of the WebP source');
  const logoWebp=brand.resources.find(r=>r.name==='monkeyai-logo-256.webp');
  check(Boolean(logoWebp)&&logoWebp.size>0&&logoWebp.size<=16000,'/ fetches the brand mark as '+(logoWebp?Math.round(logoWebp.size/1024)+'KB':'nothing'));
  check(!brand.resources.some(r=>r.name==='monkeyai-logo-128.png'),'/ downloads the PNG logo even though the WebP source is supported');
  check(brand.resources.some(r=>r.name==='favicon-32.png'),'/ does not request the small favicon');

  // The footer repeats the header lockup. A bare `.footer a` rule once outranked
  // `.brand` and turned it into an inline block, so the wordmark was painted on top
  // of the logo at every width. The pair has to sit side by side, on one row, and
  // stay clear of the paragraph under it.
  const lockupProbe=String.raw`JSON.stringify((()=>{
    const b=document.querySelector('.footer .brand');
    if(!b)return null;
    const rect=el=>{const r=el.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom)};};
    const mark=b.querySelector('.brand-mark');
    const text=b.querySelector('span:not(.brand-mark)');
    const para=b.parentElement.querySelector('p');
    return {display:getComputedStyle(b).display,mark:rect(mark),text:rect(text),para:para?rect(para):null};
  })())`;
  for(const width of [390,1280]){
    await viewport(width,900);
    await visit('/');
    const lockup=JSON.parse(await evaluate(lockupProbe));
    check(Boolean(lockup),'/ at '+width+'px has no footer lockup to measure');
    if(!lockup)continue;
    check(/flex/.test(lockup.display),'/ at '+width+'px: the footer lockup is '+lockup.display+', so the logo and the wordmark are not a row');
    check(lockup.mark.r<=lockup.text.l+1,'/ at '+width+'px: the footer wordmark starts at '+lockup.text.l+'px while the logo ends at '+lockup.mark.r+'px, so they overlap');
    check(lockup.text.t<lockup.mark.b&&lockup.mark.t<lockup.text.b,'/ at '+width+'px: the footer logo and wordmark are not on the same row');
    if(lockup.para)check(lockup.mark.b<=lockup.para.t,'/ at '+width+'px: the footer logo runs into the paragraph below it');
  }

  // Raster tool logos carry a WebP twin. The directory should decode the smaller
  // file everywhere it exists, and the raster set must stay inside a small budget.
  await viewport(1280);
  await visit('/tools/');
  await evaluate('window.scrollTo({top:document.body.scrollHeight,behavior:"instant"});window.dispatchEvent(new Event("scroll"))');
  await sleep(600);
  const logoLoad=JSON.parse(await evaluate(`JSON.stringify((()=>{
    const resources=performance.getEntriesByType('resource').filter(r=>r.name.indexOf('/logos/')>=0);
    const imgs=[...document.querySelectorAll('.tool-logo img')];
    return {
      raster:resources.filter(r=>!/\.svg$/i.test(r.name)).map(r=>({name:r.name.split('/').pop(),size:r.encodedBodySize||0})),
      broken:imgs.filter(i=>i.complete&&i.naturalWidth===0).length,
      cards:imgs.length,
      pngInUse:imgs.map(i=>i.currentSrc).filter(s=>/\.png$/i.test(s)).map(s=>s.split('/').pop())
    };
  })())`));
  check(logoLoad.cards>=14,'/tools/ shows '+logoLoad.cards+' tool logos');
  check(logoLoad.broken===0,'/tools/ has '+logoLoad.broken+' tool logos that failed to decode');
  check(logoLoad.pngInUse.length===0,'/tools/ still renders PNG logos: '+logoLoad.pngInUse.join(', '));
  const rasterKB=Math.round(logoLoad.raster.reduce((sum,r)=>sum+r.size,0)/1024);
  check(rasterKB<=20,'/tools/ downloads '+rasterKB+'KB of raster logos, above the 20KB budget');

  // Nothing should stick out of a phone screen. A single wide table or unbreakable
  // URL makes the whole page scroll sideways, which is what this measures.
  for(const route of ['/','/tools/','/models/','/models/openai-gpt/','/docs/','/docs/getting-started/','/zh/docs/','/es/tools/']){
    await viewport(390,844);
    await visit(route);
    const layout=await evaluate('JSON.stringify({inner:innerWidth,scroll:document.documentElement.scrollWidth,main:!!document.querySelector("main")})');
    const {inner,scroll,main}=JSON.parse(layout);
    check(inner===390,route+': the viewport override did not apply (innerWidth '+inner+')');
    check(main,route+': the page has no main landmark in the browser');
    check(scroll<=inner+1,route+': content is '+scroll+'px wide on a '+inner+'px screen');
  }

  // A page that fits 390 can still break at 320, which is what 400% zoom on a
  // desktop produces and what WCAG reflow is measured against.
  for(const route of ['/','/tools/','/models/openai-gpt/','/models/compare/','/docs/getting-started/','/zh/tools/','/es/']){
    await viewport(320,720);
    await visit(route);
    const layout=await evaluate('JSON.stringify({inner:innerWidth,scroll:document.documentElement.scrollWidth})');
    const {inner,scroll}=JSON.parse(layout);
    check(inner===320,route+': the 320px viewport override did not apply (innerWidth '+inner+')');
    check(scroll<=inner+1,route+': content is '+scroll+'px wide at a 320px viewport, so 400% zoom scrolls sideways');
  }

  // A detail page is read as a hierarchy, so its title has to stay the loudest thing
  // on the page. The recommendation strips at the bottom reused the landing-page
  // heading scale and rendered larger than the page title itself on a phone.
  const outlineAt=async route=>{
    await visit(route);
    return JSON.parse(await evaluate(String.raw`JSON.stringify((()=>{
      const size=el=>el?parseFloat(getComputedStyle(el).fontSize):null;
      const shown=[...document.querySelectorAll("h2,h3")].filter(el=>{const r=el.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(el).visibility!=="hidden";});
      const top=shown.sort((a,b)=>size(b)-size(a))[0];
      const strip=document.querySelector(".related-section h2");
      return {h1:size(document.querySelector("h1")),top:top?{text:top.textContent.trim().slice(0,24),size:size(top)}:null,strip:size(strip),body:size(document.querySelector(".prose h2"))};
    })())`));
  };
  for(const width of [320,1280]){
    await viewport(width,900);
    for(const route of ["/tools/claude/","/models/openai-gpt/"]){
      const o=await outlineAt(route);
      check(Boolean(o.top)&&o.top.size<o.h1,route+" at "+width+"px: the \""+(o.top?o.top.text:"")+"\" heading is "+o.top.size+"px under a "+o.h1+"px page title");
      check(o.strip!==null&&Math.abs(o.strip-o.body)<0.1,route+" at "+width+"px: the related strip heading is "+o.strip+"px next to "+o.body+"px section headings");
    }
  }

  // A phone screen is smaller; that is not a reason for smaller text. These
  // labels and controls are already compact, so the phone size must not undercut
  // the desktop one — a media query that shrinks 11px to 9px makes the decisions
  // on the card harder to read on the device where they matter most.
  const sizeSelectors=['.filter-chip','.category-dot','.license-tag','.tool-bottom','.breadcrumbs','.article-meta','.directory-meta','.subtle-link','.model-card .model-access','.model-provider','.footer-grid>div:not(:first-child)>a'];
  const sizesAt=async(route,width)=>{
    await viewport(width,900);
    await visit(route);
    return JSON.parse(await evaluate('JSON.stringify(Object.fromEntries('+JSON.stringify(sizeSelectors)+'.map(s=>{const el=document.querySelector(s);return [s,el?parseFloat(getComputedStyle(el).fontSize):null];})))'));
  };
  for(const route of ['/tools/','/docs/getting-started/','/models/']){
    const desktop=await sizesAt(route,1280);
    const phone=await sizesAt(route,390);
    for(const sel of sizeSelectors){
      if(desktop[sel]==null||phone[sel]==null)continue;
      check(phone[sel]>=desktop[sel]-0.4,route+': '+sel+' drops from '+desktop[sel]+'px on desktop to '+phone[sel]+'px on a phone');
    }
  }

  // The privacy page promises no account system, no newsletter database and no
  // advertising trackers. That is a statement about what the browser actually
  // requests, so it is measured here rather than trusted to review.
  const privacyProbe='JSON.stringify({third:performance.getEntriesByType("resource").map(r=>r.name).filter(u=>!u.startsWith(location.origin)),cookies:document.cookie})';
  for(const route of ['/','/tools/','/tools/claude/','/models/compare/','/docs/getting-started/','/es/','/zh/']){
    await viewport(1280,900);
    await visit(route);
    await until('document.readyState==="complete"');
    const {third,cookies}=JSON.parse(await evaluate(privacyProbe));
    check(third.length===0,route+': the page loads '+third.slice(0,3).join(', ')+' from another origin, which no privacy page promises');
    check(cookies==='',route+': the page sets a cookie ('+cookies+') although the site promises no tracking');
  }

  // A 24px square is the smallest comfortable thumb target. Links inside a
  // sentence are exempt from that rule, so only controls and navigation lists are
  // measured; a short input or summary here is a real miss.
  const tapSelectors=['.language-switch summary','.search-field input','.guide-toc nav a','.mobile-guide-nav summary','.footer a','.breadcrumbs a','.faq-list summary','.text-link','.subtle-link','.tool-title a'];
  const measure='JSON.stringify([...document.querySelectorAll('+JSON.stringify(tapSelectors.join(','))+')].filter(el=>{const r=el.getBoundingClientRect();return r.height>0&&r.height<24;}).map(el=>el.tagName.toLowerCase()+" "+Math.round(el.getBoundingClientRect().height)+"px"))';
  for(const route of ['/','/tools/','/docs/','/docs/getting-started/','/zh/']){
    await viewport(390,844);
    await visit(route);
    const short=JSON.parse(await evaluate(measure))||[];
    check(short.length===0,route+': a tap target is shorter than 24px ('+short.slice(0,4).join(', ')+')');
  }

  // The card itself is the link now, so the corner arrow is only a visual cue: a
  // second anchor to the same page doubles every card's tab stop and makes a
  // screen reader read the same destination twice. The arrow still has to sit
  // inside the link, so a thumb on it opens the tool like anywhere else.
  await viewport(390,844);
  await visit('/tools/');
  const cardLinks=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".tool-card")].map(c=>[...c.querySelectorAll("a[href]")].map(a=>a.getAttribute("href"))))'));
  check(cardLinks.length>=14,'/tools/: only '+cardLinks.length+' cards were measured');
  const doubled=cardLinks.filter(list=>list.length!==1);
  check(doubled.length===0,'/tools/: '+doubled.length+' cards expose '+JSON.stringify(doubled[0]||[])+' links to the same page');
  check(await evaluate('!!document.querySelector(".tool-card .tool-arrow")'),'/tools/: the card arrow disappeared instead of turning into a cue');
  await evaluate('(()=>{const c=document.querySelector(".tool-card");window.scrollTo(0,c.getBoundingClientRect().top+scrollY-100);})()');
  await sleep(500);
  const arrowHit=await evaluate('(()=>{const c=document.querySelector(".tool-card");const a=c.querySelector(".tool-arrow");const r=a.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const link=el&&el.closest("a");return link?link.getAttribute("href"):"none";})()');
  check(arrowHit==='/tools/'+JSON.parse(await evaluate('JSON.stringify(document.querySelector(".tool-card").dataset.tool)'))+'/','/tools/: the corner arrow resolves to "'+arrowHit+'" instead of the tool page');

  // Cards in a row stretch to the same height, but the content above the footer
  // differs: a two-line summary or an extra licence line pushed the divider and the
  // domain row up or down inside otherwise equal cards, so every row looked ragged.
  for(const width of [768,1280]){
    await viewport(width,1000);
    for(const route of ["/","/tools/"]){
      await visit(route);
      const spreads=JSON.parse(await evaluate(String.raw`JSON.stringify((()=>{
        const rows=new Map();
        for(const card of document.querySelectorAll(".tool-card")){
          const foot=card.querySelector(".tool-bottom");
          if(!foot)continue;
          const key=Math.round(card.getBoundingClientRect().top+scrollY);
          if(!rows.has(key))rows.set(key,[]);
          rows.get(key).push(Math.round(foot.getBoundingClientRect().bottom+scrollY));
        }
        return [...rows.values()].filter(list=>list.length>1).map(list=>Math.max(...list)-Math.min(...list));
      })())`));
      check(spreads.length>0,route+" at "+width+"px: no card row was measured");
      check(spreads.every(gap=>gap<=1),route+" at "+width+"px: card footers in one row sit "+Math.max(...spreads)+"px apart, so the dividers do not line up");
    }
  }

  // A card is one target on a phone: the title, the logo and the description all
  // sit inside the same link, so a thumb anywhere on the card opens the tool. The
  // bookmark stays on top and must keep working where it sits.
  await viewport(390,844);
  await visit('/tools/');
  await evaluate('(()=>{const c=document.querySelector(".tool-card");window.scrollTo(0,c.getBoundingClientRect().top+scrollY-120);})()');
  await sleep(500);
  const cardHit=JSON.parse(await evaluate(`(()=>{const c=document.querySelector('.tool-card');const p=c.querySelector('p').getBoundingClientRect();const b=c.querySelector('.save-button').getBoundingClientRect();return JSON.stringify({slug:c.dataset.tool,para:[Math.round(p.x+p.width/2),Math.round(p.y+p.height/2)],save:[Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)]});})()`));
  const bodyHref=await evaluate('(()=>{const el=document.elementFromPoint('+cardHit.para[0]+','+cardHit.para[1]+');const a=el&&el.closest("a");return a?a.getAttribute("href"):"";})()');
  check(bodyHref==='/tools/'+cardHit.slug+'/','/tools/: the middle of a card links to "'+bodyHref+'" instead of /tools/'+cardHit.slug+'/');
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:cardHit.para[0],y:cardHit.para[1],button:'left',clickCount:1});
  check(await until('location.pathname==="/tools/'+cardHit.slug+'/"',3000),'/tools/: clicking the card body does not open the tool');
  await visit('/tools/');
  await evaluate('(()=>{const c=document.querySelector(".tool-card");window.scrollTo(0,c.getBoundingClientRect().top+scrollY-120);})()');
  await sleep(500);
  const savePoint=JSON.parse(await evaluate('(()=>{const r=document.querySelector(".save-button").getBoundingClientRect();return JSON.stringify([Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]);})()'));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:savePoint[0],y:savePoint[1],button:'left',clickCount:1});
  await sleep(250);
  check(await evaluate('document.querySelector(".save-button").getAttribute("aria-pressed")')==='true','/tools/: the card link covers the bookmark, so saving does nothing');
  check(await evaluate('location.pathname')==='/tools/','/tools/: clicking the bookmark also navigates away');
  // Put the toolkit back to empty: the checks below start from a clean set.
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:savePoint[0],y:savePoint[1],button:'left',clickCount:1});
  await evaluate('localStorage.removeItem("monkeyai-toolkit-v1")');

  // The whole card is the link, so the focus ring belongs around the card. The
  // anchor wraps only the title, so the ring is painted on its ::after; without
  // this a keyboard reader sees a ring around three words and cannot tell which
  // card has focus.
  const ringOf='(()=>{const a=document.activeElement;const cs=getComputedStyle(a);const after=getComputedStyle(a,"::after");const card=a.closest(".tool-card,.model-card");return JSON.stringify({inCard:!!card,own:cs.outlineStyle,after:after.outlineStyle,width:parseFloat(after.outlineWidth)||0});})()';
  const tabOnce=async()=>{for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});await sleep(200);};
  await viewport(1280,900);
  await visit('/tools/');
  await evaluate('document.querySelector(".save-button").focus()');
  await tabOnce();
  const toolRing=JSON.parse(await evaluate(ringOf));
  check(toolRing.inCard,'/tools/: Tab from the bookmark does not reach the card link');
  check(toolRing.own==='none','/tools/: the focused card rings only the title, not the card');
  check(toolRing.after==='solid'&&toolRing.width>=2,'/tools/: the focused card shows no ring at all');
  await visit('/models/');
  await evaluate('document.querySelector(".text-link").focus()');
  await tabOnce();
  const modelRing=JSON.parse(await evaluate(ringOf));
  check(modelRing.inCard,'/models/: Tab from the guide link does not reach a model card');
  check(modelRing.own==='none','/models/: the focused model card rings only its title');
  check(modelRing.after==='solid'&&modelRing.width>=2,'/models/: the focused model card shows no ring at all');
  // A licence link used to live only on the detail page, so readers had to open
  // every card to learn which tools are open source. The cards now say it, and
  // the directory filter has to agree with them in each language.
  const licensed=toolsData.filter(t=>t.license).map(t=>t.slug);
  const licensedCount=licensed.length;
  for(const [route,word] of [['/tools/','open source'],['/zh/tools/','开源'],['/es/tools/','código abierto']]){
    await viewport(1280,900);
    await visit(route);
    const tags=Number(await evaluate('document.querySelectorAll(".tool-card .license-tag").length'));
    check(tags===licensedCount,route+': the directory shows '+tags+' open-source tags for '+licensedCount+' licensed tools');
    const tagsVisible=await evaluate('[...document.querySelectorAll(".tool-card .license-tag")].every(el=>el.getBoundingClientRect().height>0)');
    check(tagsVisible,route+': an open-source tag is rendered but has no height');
    await evaluate('(()=>{const i=document.querySelector(".directory-toolbar input");i.focus();i.value='+JSON.stringify(word)+';i.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await sleep(200);
    const visibleSlugs=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".tool-card")].filter(c=>c.getBoundingClientRect().height>0&&getComputedStyle(c).display!=="none").map(c=>c.dataset.tool))'));
    const hidden=licensed.filter(slug=>!visibleSlugs.includes(slug));
    check(hidden.length===0,route+': searching "'+word+'" hides licensed tools ('+hidden.join(', ')+')');
  }

  // Filter chips are real buttons, so the keyboard should drive them. Enter and
  // Space only reach the browser's default action when the synthesised key event
  // carries text — a bare keydown ("keyDown" with no text) activates nothing, so
  // an assertion built on one would pass without testing the page.
  const chatTools=toolsData.filter(t=>t.category==='chat').length;
  for(const [key,code,vk,text] of [['Enter','Enter',13,'\r'],[' ','Space',32,' ']]){
    await viewport(1280,900);
    await visit('/tools/');
    await evaluate('document.querySelector("[data-filter=chat]").focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,text,unmodifiedText:text,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
    await sleep(150);
    const selected=await evaluate('(document.querySelector("[data-filter].selected")||{}).dataset?.filter');
    check(selected==='chat','/tools/: pressing '+key+' on the chat chip selects "'+selected+'" instead');
    const shown=Number(await evaluate('[...document.querySelectorAll(".tool-card")].filter(c=>!c.hidden).length'));
    check(shown===chatTools,'/tools/: '+key+' on the chat chip shows '+shown+' cards instead of '+chatTools);
    check(await evaluate('document.querySelector("[data-filter=chat]").getAttribute("aria-pressed")')==='true','/tools/: '+key+' does not update aria-pressed on the chip');
  }
  // A keyboard visitor has to see where they are; hover styling is not enough.
  await viewport(1280,900);
  await visit('/tools/');
  await evaluate('document.querySelector("[data-filter=chat]").focus()');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9});
  const ring=JSON.parse(await evaluate('(()=>{const el=document.activeElement,cs=getComputedStyle(el);return JSON.stringify({tag:el.tagName,outline:cs.outlineStyle,width:parseFloat(cs.outlineWidth)});})()'));
  check(ring.outline!=='none'&&ring.width>=2,'/tools/: the keyboard focus ring is '+ring.outline+' '+ring.width+'px on '+ring.tag);

  // The hero illustration bleeds past its column on purpose. At 768px the
  // decorative orbit used to push the document 4px sideways, so a tablet got a
  // horizontal scrollbar for art that is meant to run off the edge.
  await viewport(768,900);
  await visit('/');
  check(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),'home at 768px: the page scrolls sideways');

  await viewport(1280,900);
  await visit('/');
  check(await evaluate('!!document.querySelector("[data-open-search]")'),'home: the search trigger is missing at desktop width');
  check(await evaluate('!!document.querySelector(".mobile-toggle")&&getComputedStyle(document.querySelector(".mobile-toggle")).display==="none"'),'home: the mobile menu button is visible on a desktop');

  // Broad queries match more pages than the twelve the dialog shows. Saying so
  // keeps the list honest; a narrow query must not carry the note.
  await viewport(1280,900);
  await visit('/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the truncation check');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'a'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('!!document.querySelector(".search-more")'),'search: a broad query silently stops at twelve results');
  check(/^\d+ more matches/.test(await evaluate('(document.querySelector(".search-more")||{}).textContent||""')),'search: the note does not say how many matches were left out');
  check(/^Matches: \d+[.。]\s+\S/.test(await evaluate('document.querySelector("#search-status").textContent')),'search: the count runs into the overflow note in the status line');
  check(await evaluate('document.querySelectorAll("#search-results a").length<=12'),'search: more than twelve results are rendered at once');
  // The count only reached a screen reader, so a sighted reader could not tell
  // twelve visible rows from forty matches. It is printed above the list as well,
  // without being announced twice.
  const countState=JSON.parse(await evaluate('JSON.stringify({hidden:document.querySelector("#search-count").hidden,aria:document.querySelector("#search-count").getAttribute("aria-hidden"),text:document.querySelector("#search-count").textContent,status:document.querySelector("#search-status").textContent})'));
  check(countState.hidden===false,'search: the dialog hides how many matches the query has');
  check(countState.aria==='true','search: the visible count is announced a second time by screen readers');
  check(/^\d+ of \d+ matches\.$/.test(countState.text),'search: the visible count reads "'+countState.text+'" instead of "12 of 59 matches."');
  check(countState.text!==countState.status,'search: the visible count repeats the whole status sentence');
  await viewport(390,844);
  const countBox=JSON.parse(await evaluate('JSON.stringify({h:document.querySelector("#search-count").getBoundingClientRect().height,w:document.querySelector("#search-count").scrollWidth,c:document.querySelector("#search-count").clientWidth})'));
  check(countBox.h<=26,'search: the match count wraps to '+Math.round(countBox.h)+'px on a phone');
  check(countBox.w<=countBox.c+1,'search: the match count overflows the dialog on a phone');
  await viewport(1280,900);
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: the narrow query shows nothing after the truncation check');
  check(await evaluate('!document.querySelector(".search-more")'),'search: a narrow query still claims results were left out');
  check(await evaluate('document.querySelector("#search-count").textContent===document.querySelector("#search-status").textContent'),'search: a narrow query does not show its exact count');
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await evaluate('document.querySelector("#search-count").hidden'),'search: the match count survives the query being cleared');
  // Guides are indexed with their section headings and bullets, so a page can match
  // on words its summary never mentions. The row then quotes the words around the
  // match; repeating an unrelated summary leaves the reader guessing why it is there.
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'permissions'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('!!Array.from(document.querySelectorAll("#search-results a")).find(a=>a.getAttribute("href")==="/docs/models-and-mcp/")'),'search: a word that only appears in a guide section no longer finds that guide');
  const keywordRow=JSON.parse(await evaluate("JSON.stringify((()=>{const a=Array.from(document.querySelectorAll('#search-results a')).find(x=>x.getAttribute('href')==='/docs/models-and-mcp/');const p=a&&a.querySelector('p');return {text:p?p.textContent:'',marks:p?p.querySelectorAll('mark').length:0};})())"));
  check(/permissions/i.test(keywordRow.text),'search: a keyword-only result repeats a summary without the query ("'+keywordRow.text.slice(0,80)+'")');
  check(keywordRow.marks>0,'search: the words that matched a keyword-only result are not highlighted');
  check(keywordRow.text.length>30&&keywordRow.text.length<=240,'search: the keyword-only snippet has an odd length ('+keywordRow.text.length+' characters)');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(150);

  // A reader who knows they want open-source software should reach those tools
  // from the dialog too, in the language they are reading. The directory filter
  // and the dialog are separate code paths, so both are asked the same question.
  for(const [route,word,slug,countPattern] of [['/','open source','ollama',/matches/i],['/zh/','开源','blender',/匹配结果|共|条/],['/es/','código abierto','orkas',/coincidencias/i]]){
    await viewport(1280,900);
    await visit(route);
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
    check(await until('document.querySelector("#search-dialog")?.open===true'),route+': the search dialog does not open for the licence query');
    await evaluate('document.querySelector("#global-search").focus()');
    await send('Input.insertText',{text:word});
    await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
    check(await until('!!document.querySelector(\'#search-results a[href$="/tools/'+slug+'/"]\')'),route+': searching "'+word+'" does not find /tools/'+slug+'/');
    const localizedCount=JSON.parse(await evaluate('JSON.stringify({text:document.querySelector("#search-count").textContent,hidden:document.querySelector("#search-count").hidden})'));
    check(localizedCount.hidden===false&&countPattern.test(localizedCount.text),route+': the visible match count is missing or untranslated ("'+localizedCount.text+'")');
    await evaluate('document.querySelector("[data-close-search]").click()');
    await sleep(120);
  }
  // A quote of the matching line is only useful if it reads as one line. The
  // character window that holds a sentence in English covers four sections in
  // Chinese, so these two languages are asked the same question the English
  // check above asks: does the row quote the matching bullet, and only that.
  for(const [route,word,href] of [['/zh/','先了解工','/zh/docs/getting-started/'],['/es/','Conoce','/es/docs/getting-started/']]){
    await viewport(1280,900);
    await visit(route);
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
    check(await until('document.querySelector("#search-dialog")?.open===true'),route+': the search dialog does not open for the snippet check');
    await evaluate('document.querySelector("#global-search").focus()');
    await send('Input.insertText',{text:word});
    await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
    check(await until('!!Array.from(document.querySelectorAll("#search-results a")).find(a=>a.getAttribute("href")==='+JSON.stringify(href)+')'),route+': searching "'+word+'" does not find '+href);
    const rowProbe='JSON.stringify((()=>{const a=Array.from(document.querySelectorAll("#search-results a")).find(x=>x.getAttribute("href")==='+JSON.stringify(href)+');const p=a?a.querySelector("p"):null;return {text:p?p.textContent:"",cls:p?p.className:"",marks:p?p.querySelectorAll("mark").length:0};})())';
    const row=JSON.parse(await evaluate(rowProbe));
    check(row.cls==='search-snippet',route+': the row repeats a summary instead of quoting the matching line for "'+word+'"');
    check(row.marks>0,route+': the quoted line does not mark the word that matched ('+word+')');
    check(row.text.indexOf(' · ')<0,route+': the quote splices several sections together ("'+row.text.slice(0,70)+'")');
    check(!/…$/.test(row.text),route+': a quote that ends on a section boundary still closes with an ellipsis ("'+row.text+'")');
    check(row.text.length<120,route+': one matching bullet is quoted as '+row.text.length+' characters');
    await evaluate('document.querySelector("[data-close-search]").click()');
    await sleep(120);
  }

  // The checks below read English copy, so leave the browser on an English page.
  await viewport(1280,900);
  await visit('/');

  // The shortcut is the part a DOM shim cannot exercise: a key event on document,
  // the dialog opening, the index arriving over the network, and Escape closing it.
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the keyboard shortcut does not open the dialog');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: typing a known term shows no results in a real browser');
  // A live region on the whole list re-reads a dozen links on every keystroke. One
  // status line saying how many matched is the feedback a screen-reader user needs.
  check(await evaluate('document.querySelector("#search-results").getAttribute("aria-live")===null'),'search: the whole result list is still a live region');
  check(/^Matches: \d+/.test(await evaluate('document.querySelector("#search-status").textContent')),'search: the result count is not announced in the status line');
  const realLinks=await evaluate('[...document.querySelectorAll("#search-results a")].every(a=>a.getAttribute("href").startsWith("/"))');
  check(realLinks,'search: a rendered result does not link to a site path');
  // Escape is a macOS virtual key 53 and a Windows/Linux key 27; send both forms
  // so the check fails on the site rather than on the platform the check runs on.
  for(const nativeVirtualKeyCode of [53,27]){
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    if(await until('document.querySelector("#search-dialog")?.open===false',600))break;
  }
  check(await evaluate('document.querySelector("#search-dialog").open===false'),'search: Escape does not close the dialog');
  // Closing must hand focus back to the control that opened the dialog. Opened
  // from the shortcut, there is no such control in focus, so the trigger takes
  // it; otherwise the next Tab restarts at the top of the page.
  check(await evaluate('document.activeElement===document.querySelector("[data-open-search]")'),'search: closing the dialog leaves focus on the page body');

  // A broad query is normal — "model" matches thirty-two pages — and the other
  // twenty used to be unreachable: a sentence told the reader to add a word and the
  // results themselves had no way in. The list continues on demand, says how many
  // are left, and puts the keyboard on the first row that had not been seen.
  await visit('/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the longer result set');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'model'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: a broad query shows no results');
  const pageState='JSON.stringify({links:document.querySelectorAll("#search-results a").length,button:document.querySelector(".search-more-button")?document.querySelector(".search-more-button").textContent:"",more:document.querySelector(".search-more")?document.querySelector(".search-more").textContent:"",count:document.querySelector("#search-count").textContent,ui:JSON.parse(document.querySelector("#page-data").textContent).ui})';
  const firstPage=JSON.parse(await evaluate(pageState));
  check(firstPage.links===12,'search: a broad query renders '+firstPage.links+' rows instead of one page of twelve');
  check(firstPage.button!==''&&firstPage.button===firstPage.ui.searchShowMore,'search: the continuation button is missing or does not speak the page language ("'+firstPage.button+'")');
  const remaining=Number((firstPage.more.match(/\d+/)||['0'])[0]);
  const total=firstPage.links+remaining;
  check(remaining>0,'search: the broad query did not exceed one page ('+total+' matches)');
  if(remaining>0){
    await evaluate('document.querySelector(".search-more-button").click()');
    check(await until('document.querySelectorAll("#search-results a").length>'+firstPage.links),'search: the continuation button reveals nothing');
    const secondPage=JSON.parse(await evaluate(pageState));
    const expected=Math.min(firstPage.links+12,total);
    check(secondPage.links===expected,'search: the continuation reveals '+secondPage.links+' rows instead of '+expected);
    check(await evaluate('document.activeElement===document.querySelectorAll("#search-results a")['+firstPage.links+']'),'search: the continuation leaves the keyboard on the button it removed');
    let guard=0;
    while(guard++<6&&await evaluate('!!document.querySelector(".search-more-button")')){
      await evaluate('document.querySelector(".search-more-button").click()');
      await sleep(120);
    }
    const lastPage=JSON.parse(await evaluate(pageState));
    check(!lastPage.button,'search: the continuation button survives after every match is shown');
    check(lastPage.links===total,'search: only '+lastPage.links+' of '+total+' matches are reachable');
    const fullCount=(lastPage.ui.searchCount||'{n}').replace('{n}',String(total));
    check(lastPage.count===fullCount,'search: the visible count still reports a partial list ("'+lastPage.count+'")');
    await evaluate('document.querySelector("[data-close-search]").click()');
    await sleep(120);
  }

  // Leaving a result and coming back means wanting the second match, not retyping
  // the query. The last query survives the navigation inside the tab and returns
  // selected, so the next keystroke replaces it instead of appending to it.
  await visit('/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the memory check');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'workflow'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: no results for the memory check');
  await sleep(600);
  await visit('/tools/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open on the second page');
  check(await evaluate('document.querySelector("#global-search").value==="workflow"'),'search: the last query is lost when the reader changes page');
  const memoryState=JSON.parse(await evaluate('JSON.stringify((()=>{const i=document.querySelector("#global-search");return {from:i.selectionStart,to:i.selectionEnd,len:i.value.length};})())'));
  check(memoryState.from===0&&memoryState.to===memoryState.len&&memoryState.len>0,'search: the restored query is not selected for replacement');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: the restored query shows no results');
  // Clearing the box must clear the memory too. An empty field that reopens with the
  // old words looks like the reader's edit was ignored.
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(600);
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(120);
  await visit('/models/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the cleared-memory check');
  check(await evaluate('document.querySelector("#global-search").value===""'),'search: a cleared query is restored from memory anyway');
  check(await evaluate('document.querySelectorAll("#search-results a").length===0'),'search: a cleared query still renders the old results');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(120);

  // A modal dialog should keep Tab inside it. Without a trap, focus lands on the
  // document body between the last control and the first, so the focus ring
  // disappears for one key press and screen readers lose the context.
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not reopen for the focus cycle');
  const tabThrough=async shift=>{for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48,modifiers:shift?8:0});await sleep(120);};
  let outside=0;
  for(let i=0;i<8;i++){
    await tabThrough(false);
    if(!await evaluate('document.querySelector("#search-dialog").contains(document.activeElement)'))outside++;
  }
  check(outside===0,`search: Tab leaves the dialog ${outside} time(s) instead of wrapping inside it`);
  await evaluate('document.querySelector("#global-search").focus()');
  await tabThrough(true);
  check(await evaluate('document.querySelector("#search-dialog").contains(document.activeElement)'),'search: Shift+Tab from the search box leaves the dialog');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(150);

  // A dialog that leaves the page beneath it scrollable moves the article behind
  // the backdrop while the reader is scrolling the results, and closes back at a
  // different place. The page must hold still; the result list keeps its own scroll.
  await viewport(390,844);
  await visit('/tools/');
  await evaluate('window.scrollTo({top:600,behavior:"instant"})');
  await sleep(250);
  const scrollBefore=await evaluate('Math.round(scrollY)');
  check(scrollBefore>0,'search: the page did not scroll for the background-scroll check');
  await evaluate('document.querySelector("[data-open-search]").click()');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the background-scroll check');
  await sleep(250);
  // The page behind a modal must hold still. Wheel and keyboard probes land in
  // whichever scroll box holds focus in a headless run, so the guarantee is read
  // from the root the reader would actually scroll: its own scroll is switched off
  // while the dialog is open, and the result list keeps its separate scroll.
  const rootState=JSON.parse(await evaluate('JSON.stringify({cls:document.documentElement.classList.contains("scroll-locked"),overflow:getComputedStyle(document.documentElement).overflowY})'));
  check(rootState.cls===true,'search: the open dialog does not lock the page');
  check(rootState.overflow==='hidden','search: the page behind the open dialog is still scrollable');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'a'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: no results for the result-list scroll check');
  await sleep(200);
  check(await evaluate('(()=>{const r=document.querySelector("#search-results");r.scrollTop=120;return r.scrollTop>0;})()'),'search: locking the page also froze the result list');
  for(const nativeVirtualKeyCode of [53,27]){
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    if(await until('document.querySelector("#search-dialog")?.open===false',600))break;
  }
  check(await evaluate('document.querySelector("#search-dialog").open===false'),'search: Escape does not close the dialog on the background-scroll check');
  await sleep(200);
  // Keyboard scrolling is unreliable straight after a modal closes (focus sits on a
  // button, and Chrome latches the gesture), so the unlock is read from the root:
  // the lock is one style on the document element and it must be gone, not stale.
  const unlocked=await evaluate('(()=>{const cs=getComputedStyle(document.documentElement);return {cls:document.documentElement.classList.contains("scroll-locked"),overflow:cs.overflowY,open:document.querySelector("#search-dialog").open};})()');
  const unlockDone=JSON.parse(JSON.stringify(unlocked));
  check(unlockDone.cls===false&&unlockDone.overflow!=="hidden",'search: the page stays locked after the dialog closes');
  check(unlockDone.open===false,'search: the dialog is still open after the background-scroll check');
  // Reserving the scrollbar gutter keeps the layout from jumping when the lock
  // hides the scrollbar; the header must not move sideways when the dialog opens.
  await viewport(1280,900);
  await visit('/tools/');
  const brandBefore=await evaluate('Math.round(document.querySelector(".brand").getBoundingClientRect().left)');
  await evaluate('document.querySelector("[data-open-search]").click()');
  await until('document.querySelector("#search-dialog")?.open===true');
  await sleep(200);
  const brandDuring=await evaluate('Math.round(document.querySelector(".brand").getBoundingClientRect().left)');
  check(brandDuring===brandBefore,'search: opening the dialog shifts the page sideways ('+brandBefore+' → '+brandDuring+')');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(150);
  // A result opens in the same tab. Leaving with the dialog still open used to put
  // it in the back/forward snapshot: coming back showed an open dialog over a page
  // locked at the top. Going back must land where the reader left.
  await viewport(1280,900);
  await visit('/tools/');
  await evaluate('window.scrollTo({top:600,behavior:"instant"})');
  await sleep(250);
  const backBefore=await evaluate('Math.round(scrollY)');
  check(backBefore>0,'search: the page did not scroll for the back-navigation check');
  await evaluate('document.querySelector("[data-open-search]").click()');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the back-navigation check');
  await evaluate('document.querySelector("#global-search").value="claude";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0',4000),'search: no results for the back-navigation check');
  await evaluate('document.querySelector("#search-results a").click()');
  check(await until('location.pathname!=="/tools/"',4000),'search: clicking a result does not leave the directory');
  await sleep(300);
  await evaluate('history.back()');
  check(await until('location.pathname==="/tools/"',4000),'search: Back does not return to the directory');
  // Chrome restores the old scroll offset after the navigation commits, and on a
  // loaded machine that lands later than any fixed sleep would guess. Poll for the
  // offset instead of sampling once, then report the last observed value.
  const restored=await until('Math.round(scrollY)>='+(backBefore-80),3000);
  const backState=JSON.parse(await evaluate('JSON.stringify({open:document.querySelector("#search-dialog").open,cls:document.documentElement.classList.contains("scroll-locked"),overflow:getComputedStyle(document.documentElement).overflowY,scroll:Math.round(scrollY)})'));
  check(backState.open===false,'search: Back restores an open search dialog');
  check(backState.cls===false&&backState.overflow!=="hidden",'search: Back restores the page with scrolling locked');
  check(restored,'search: Back returns to y='+backState.scroll+' instead of '+backBefore);
  // Narrow screens keep the guide contents inside the article; wide screens use the
  // sticky rail. Reading this from the engine is the only way to know the cascade
  // and the breakpoint agree.
  await viewport(1024,900);
  await visit('/docs/getting-started/');
  check(await evaluate('getComputedStyle(document.querySelector(".guide-toc")).display==="block"'),'guide at 1024px: the in-page contents are not shown');
  check(await evaluate('getComputedStyle(document.querySelector(".toc")).display==="none"'),'guide at 1024px: the sticky rail is shown as well');
  await viewport(1280,900);
  await visit('/docs/getting-started/');
  check(await evaluate('getComputedStyle(document.querySelector(".guide-toc")).display==="none"'),'guide at 1280px: the in-page contents duplicate the rail');
  check(await evaluate('getComputedStyle(document.querySelector(".toc")).display!=="none"'),'guide at 1280px: the sticky rail is missing');
  // The contents list should follow the reader: scrolling into section three
  // marks that entry and clears the earlier one.
  await evaluate('{const s=document.getElementById("section-3");scrollTo({top:s.getBoundingClientRect().top+scrollY-60,behavior:"instant"});}');
  // A headless page reports visibilityState "hidden", and Chrome withholds the
  // scroll events a programmatic jump would normally produce. Dispatching the same
  // event keeps the handler under test; without a listener the mark never moves.
  await evaluate('dispatchEvent(new Event("scroll"))');
  check(await until("document.querySelector('.toc > a[href=\"#section-3\"]')?.getAttribute('aria-current')==='true'"),'guide at 1280px: the contents list does not follow the reader');
  check(await evaluate("document.querySelector('.toc > a[href=\"#section-1\"]').getAttribute('aria-current')===null"),'guide at 1280px: more than one contents entry is marked current');
  await viewport(390,844);
  await visit('/docs/getting-started/');
  await evaluate('{const s=document.getElementById("section-3");scrollTo({top:s.getBoundingClientRect().top+scrollY-60,behavior:"instant"});}');
  await evaluate('dispatchEvent(new Event("scroll"))');
  check(await until("document.querySelector('.guide-toc nav a[href=\"#section-3\"]')?.getAttribute('aria-current')==='true'"),'guide at 390px: the in-page contents do not follow the reader');

  // Picking a section on a phone should collapse the picker and, for a keyboard
  // reader, move the cursor to the section itself. Without that the reader tabs
  // through entries that are no longer on screen while the picker covers the text.
  await viewport(390,844);
  await visit('/docs/getting-started/');
  await evaluate('document.querySelector(".guide-toc summary").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(await until('document.querySelector(".guide-toc").open===true'),'guide at 390px: Enter does not open the section picker');
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  check(await until('document.activeElement.matches(".guide-toc a")'),'guide at 390px: Tab does not reach the open picker entries');
  // A headless page parks animation frames, so a smooth scroll started here never
  // advances and the jump reads as a no-op even though it lands in a real browser.
  // Pinning the behaviour to auto keeps the landing spot, focus and hash under test
  // without making the result depend on sandbox timing.
  await evaluate('{const s=document.createElement("style");s.textContent="html{scroll-behavior:auto !important}";document.head.append(s);}');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  check(await until('document.getElementById("section-1")?.getBoundingClientRect().top<200',2000),'guide at 390px: the chosen section never scrolls into view');
  await sleep(150);
  const picked=JSON.parse(await evaluate('JSON.stringify((()=>{const t=document.querySelector(".guide-toc");const h=document.activeElement;const sec=document.getElementById(location.hash.slice(1));return {open:t.open,tag:h.tagName,outline:h.tagName==="H2"?getComputedStyle(h).outlineStyle:"",top:sec?Math.round(sec.getBoundingClientRect().top):null,hash:location.hash};})())'));
  check(picked.open===false,'guide at 390px: choosing a section leaves the picker open over the article');
  check(picked.tag==='H2','guide at 390px: keyboard focus stays in the picker instead of following the jump');
  check(picked.outline==='solid','guide at 390px: the section that took focus shows no ring');
  check(picked.hash==='#section-1'&&picked.top>=60&&picked.top<=180,'guide at 390px: the chosen section lands at '+picked.top+'px instead of under the header');
  // A tap collapses the picker too, but must not move focus into the article: the
  // reader is not driving the page from the keyboard.
  await visit('/docs/getting-started/');
  const summaryPoint=JSON.parse(await evaluate('JSON.stringify((()=>{const r=document.querySelector(".guide-toc summary").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})())'));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:summaryPoint[0],y:summaryPoint[1],button:'left',clickCount:1});
  await sleep(200);
  const thirdPoint=JSON.parse(await evaluate('JSON.stringify((()=>{const r=document.querySelectorAll(".guide-toc a")[2].getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})())'));
  for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:thirdPoint[0],y:thirdPoint[1],button:'left',clickCount:1});
  await sleep(900);
  const tapped=JSON.parse(await evaluate('JSON.stringify({open:document.querySelector(".guide-toc").open,hash:location.hash,tag:document.activeElement.tagName})'));
  check(tapped.open===false,'guide at 390px: a tap leaves the picker open over the article');
  check(tapped.hash==='#section-3','guide at 390px: a tap on a section entry does not navigate to it');
  check(tapped.tag!=='H2','guide at 390px: a tap moves keyboard focus into the article');
  // The rail on a wide screen behaves the same for the keyboard.
  await viewport(1280,900);
  await visit('/docs/getting-started/');
  await evaluate('document.querySelector(".toc a").focus()');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await sleep(700);
  check(await evaluate('document.activeElement.tagName==="H2"'),'guide at 1280px: the rail does not hand focus to the section');

  // A long command scrolls inside its own box on a phone. That box needs a tab stop
  // and a name, or the end of the line is unreachable without a mouse.
  await viewport(390,844);
  await visit('/docs/install-from-source-docker-compose/');
  check(await evaluate('[...document.querySelectorAll(".code-block pre")].filter(p=>p.scrollWidth>p.clientWidth+1).every(p=>p.getAttribute("tabindex")==="0"&&p.getAttribute("role")==="region"&&(p.getAttribute("aria-label")||"").length>4)'),'code blocks: an overflowing sample cannot be reached from the keyboard');
  check(await evaluate('[...document.querySelectorAll(".code-block pre")].filter(p=>p.scrollWidth<=p.clientWidth+1).every(p=>!p.hasAttribute("tabindex"))'),'code blocks: a sample that fits still takes a tab stop');
  await evaluate('document.querySelector(".code-block .copy-code").focus()');
  for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
  await sleep(150);
  check(await evaluate('document.activeElement.tagName==="PRE"'),'code blocks: Tab does not reach the overflowing sample');
  check(await evaluate('getComputedStyle(document.activeElement).outlineStyle==="solid"'),'code blocks: the focused sample shows no ring');
  await viewport(1280,900);
  await visit('/docs/install-from-source-docker-compose/');
  check(await evaluate('[...document.querySelectorAll(".code-block pre")].every(p=>!p.hasAttribute("tabindex"))'),'code blocks: a wide screen still adds tab stops to code that fits');

  // A miss in the guide index must look like a miss in the other directories: a
  // heading, a way back, and focus where the typing happened.
  await viewport(390,844);
  await visit('/docs/');
  await evaluate('document.querySelector("#doc-search").focus()');
  await send('Input.insertText',{text:'zzzznotathing'});
  await evaluate('document.querySelector("#doc-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelector("#doc-empty").hidden===false'),'docs: a miss shows no empty state');
  check(await evaluate('(document.querySelector("#doc-empty h2")||{textContent:""}).textContent.length>5'),'docs: the empty state has no heading');
  check(await evaluate('document.querySelector("#doc-count").textContent==="0 guides"'),'docs: a miss still counts guides');
  await evaluate('document.querySelector("#doc-clear").click()');
  check(await evaluate('document.querySelector("#doc-empty").hidden===true'),'docs: clearing does not bring the guides back');
  check(await evaluate('document.activeElement.id==="doc-search"'),'docs: clearing does not return focus to the search box');

  // Every aside is a complementary landmark; two carrying the same name, or none,
  // are announced identically, so the guide list and the page contents sound alike.
  for(const route of ['/docs/getting-started/','/models/openai-gpt/','/tools/claude/']){
    await viewport(1280,900);
    await visit(route);
    const names=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("aside")].map(a=>{const ref=a.getAttribute("aria-labelledby");return (a.getAttribute("aria-label")||(ref?document.getElementById(ref)?.textContent:"")||"").trim();}))'));
    check(names.length>0,route+': the page has no complementary landmark to check');
    check(names.every(name=>name.length>0),route+': an aside has no accessible name');
    check(new Set(names).size===names.length,route+': two asides share one name ('+names.join(', ')+')');
  }

  // A control can have a focus rule and still show nothing, because a later rule of
  // equal specificity wins the cascade: the tool search lost its ring that way, and
  // the comparison table fell back to the browser's one-pixel ring. Walking the real
  // tab order catches both, and proves the first stop is the skip link.
  const focusStop=`(()=>{const el=document.activeElement;const style=getComputedStyle(el);const rect=el.getBoundingClientRect();return JSON.stringify({tag:el.tagName,cls:(el.className&&el.className.toString().slice(0,30))||'',outline:style.outlineStyle,width:parseFloat(style.outlineWidth),w:rect.width,h:rect.height,top:Math.round(rect.top)});})()`;
  for(const route of ['/','/tools/','/models/compare/']){
    await viewport(1280,900);
    await visit(route);
    for(let step=1;step<=12;step++){
      for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
      await sleep(60);
      const stop=JSON.parse(await evaluate(focusStop));
      const where=stop.tag.toLowerCase()+(stop.cls?'.'+stop.cls:'');
      check(stop.tag!=='BODY'&&stop.tag!=='HTML',route+': Tab '+step+' lands on the page body instead of a control');
      check(stop.outline==='solid'&&stop.width>=2,route+': the focus ring on '+where+' at Tab '+step+' is '+stop.outline+' '+stop.width+'px');
      if(step===1)check(stop.cls==='skip-link'&&stop.top>=0,route+': the first Tab does not reveal the skip link ('+where+', top '+stop.top+')');
    }
  }

  // A token can look fine in isolation and still land under 4.5:1 on the colour it
  // is painted over, which is how the FAQ toggle and a model link were missed.
  for(const route of ['/','/tools/claude/','/models/compare/','/docs/getting-started/']){
    await viewport(390,844);
    await visit(route);
    const low=JSON.parse(await evaluate(contrastAudit));
    check(low.length===0,route+': text under AA contrast ('+low.slice(0,3).map(item=>item.ratio+':1 needs '+item.need+' — '+item.cls).join(', ')+')');
  }

  // A licence name is a term of use: "GNU GPL" does not say which version a reader
  // is bound by, and someone deciding whether a modified local build can be shared
  // needs that version. The detail page states the SPDX name and links to the
  // licensor, and the translated pages carry the same name with their own label.
  const licenseProbe='JSON.stringify((()=>{const link=[...document.querySelectorAll("aside a[href]")].find(a=>a.href.indexOf("blender.org/about/license")>=0);const small=link?link.closest("small"):null;return {text:small?small.textContent.trim():"",href:link?link.getAttribute("href"):"",rel:link?link.getAttribute("rel"):"",target:link?link.getAttribute("target"):""};})())';
  await viewport(390,844);
  await visit('/tools/blender/');
  const licenseRow=JSON.parse(await evaluate(licenseProbe));
  check(/GPL-3\.0-or-later/.test(licenseRow.text),'tools: the licence line does not name the GPL version ('+licenseRow.text+')');
  check(licenseRow.href==='https://www.blender.org/about/license/','tools: the licence name does not link to the licensor page ('+licenseRow.href+')');
  check(licenseRow.target==='_blank'&&licenseRow.rel.indexOf('noopener')>=0,'tools: the licence link is not opened safely in a new tab');
  await visit('/zh/tools/blender/');
  const zhLicense=JSON.parse(await evaluate(licenseProbe));
  check(/GPL-3\.0-or-later/.test(zhLicense.text),'tools: the Chinese licence line drops the SPDX name ('+zhLicense.text+')');
  check(!/^License:/.test(zhLicense.text),'tools: the Chinese licence line keeps the English label ('+zhLicense.text+')');

  // The mobile menu and the saved-tool toggle both write to the live DOM; the shim
  // only checks the handlers, so the browser confirms the visible result.
  await viewport(390,844);
  await visit('/tools/');
  check(await evaluate('getComputedStyle(document.querySelector(".mobile-toggle")).display!=="none"'),'tools at 390px: the mobile menu button is hidden');
  await evaluate('document.querySelector(".mobile-toggle").click()');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="true"'),'mobile menu: the button does not report an expanded state');
  check(await evaluate('document.querySelector(".mobile-nav").hidden===false'),'mobile menu: the navigation stays hidden after the click');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-label")==="Close menu"'),'mobile menu: the button still offers to open a menu that is open');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-controls")==="mobile-nav"'),'mobile menu: the button does not name the panel it controls');
  // Escape closes an overlay and returns focus; a menu that only closes by
  // pressing its own button again traps a keyboard user's attention.
  for(const nativeVirtualKeyCode of [53,27]){
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});
    if(await until('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="false"',600))break;
  }
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="false"'),'mobile menu: Escape does not close the menu');
  check(await evaluate('document.querySelector(".mobile-nav").hidden===true'),'mobile menu: the navigation stays open after Escape');
  check(await evaluate('document.activeElement===document.querySelector(".mobile-toggle")'),'mobile menu: Escape does not return focus to the button');
  if(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")!=="true"'))await evaluate('document.querySelector(".mobile-toggle").click()');
  check(await evaluate('document.querySelector(".mobile-nav").hidden===false'),'mobile menu: the menu is not open for the outside-click check');
  // Desktop marks the current section; the phone panel is a separate list that used
  // to render every entry identically, so a visitor opening it on a tool page had no
  // way to tell where they already were.
  const activeEntry=JSON.parse(await evaluate('(()=>{const links=[...document.querySelectorAll(".mobile-nav a")];const on=links.find(a=>a.getAttribute("aria-current")==="page");const off=links.find(a=>a!==on);return JSON.stringify({href:on&&on.getAttribute("href"),differs:!!on&&!!off&&getComputedStyle(on).color!==getComputedStyle(off).color});})()'));
  check(activeEntry.href==='/tools/','mobile menu: the current section is not marked on a tool page (got '+(activeEntry.href||'nothing')+')');
  check(activeEntry.differs,'mobile menu: the current section looks like every other entry');
  const menuContrast=JSON.parse(await evaluate(contrastAudit));
  check(menuContrast.length===0,'mobile menu: an entry is below AA contrast ('+menuContrast.slice(0,3).map(item=>item.ratio+':1 '+item.cls).join(', ')+')');

  await evaluate('document.querySelector("h1").click()');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="false"'),'mobile menu: a click outside the menu leaves it open');
  // The language menu is a details element, so Escape has to be wired by hand; a
  // menu that only closes by choosing a language is a dead end for the keyboard.
  const escapeOnce=async()=>{for(const nativeVirtualKeyCode of [53,27]){await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode});await sleep(120);}};
  await viewport(1280,900);
  await visit('/');
  await evaluate('document.querySelector(".language-switch").open=true');
  await evaluate('document.querySelector(".language-menu a").focus()');
  await escapeOnce();
  check(await evaluate('document.querySelector(".language-switch").open===false'),'language menu: Escape leaves the menu open');
  check(await evaluate('document.activeElement===document.querySelector(".language-switch summary")'),'language menu: Escape does not return focus to the summary');
  // Switching language should not throw away the reader's place: someone who
  // filtered the directory to chat tools and then switched to Chinese should see
  // the same slice, not all fourteen cards again.
  const langHrefs='JSON.stringify([...document.querySelectorAll(".language-switch a")].map(a=>a.getAttribute("href")))';
  const chatCardCount=toolsData.filter(t=>t.category==='chat').length;
  for(const [route,needle] of [['/tools/?category=chat','category=chat'],['/tools/?q=ollama','q=ollama']]){
    await viewport(1280,900);
    await visit(route);
    const hrefs=JSON.parse(await evaluate(langHrefs));
    check(hrefs.length===3,route+': the header offers '+hrefs.length+' language links');
    check(hrefs.every(href=>href.includes(needle)),route+': the language switch drops '+needle+' ('+hrefs.join(', ')+')');
  }
  await viewport(1280,900);
  await visit('/tools/');
  const plainHrefs=JSON.parse(await evaluate(langHrefs))||[];
  check(plainHrefs.length>0&&plainHrefs.every(href=>!href.includes('?')),'/tools/: the language switch invents a query string on an unfiltered page ('+plainHrefs.join(', ')+')');
  await visit('/tools/?category=chat');
  await evaluate('document.querySelector(".language-switch a[lang=zh]").click()');
  await until('location.pathname==="/zh/tools/"');
  await sleep(250);
  const keptFilter=await evaluate('(document.querySelector("[data-filter].selected")||{}).dataset?.filter');
  check(keptFilter==='chat','/zh/tools/: arriving from a filtered English page selects "'+keptFilter+'" instead of chat');
  const keptCards=Number(await evaluate('[...document.querySelectorAll(".tool-card")].filter(c=>!c.hidden).length'));
  check(keptCards===chatCardCount,'/zh/tools/: arriving from a filtered English page shows '+keptCards+' cards instead of '+chatCardCount);

  // Guides and models rewrite their own URL as the reader types; the language links
  // have to follow, or switching language silently resets the search or the filter.
  for(const [route,needle] of [['/docs/?q=docker','q=docker'],['/models/?access=hosted','access=hosted']]){
    await viewport(1280,900);
    await visit(route);
    const hrefs=JSON.parse(await evaluate(langHrefs));
    check(hrefs.length===3,route+': the header offers '+hrefs.length+' language links');
    check(hrefs.every(href=>href.includes(needle)),route+': the language switch drops '+needle+' ('+hrefs.join(', ')+')');
  }
  // The query and the section are separate promises: a filtered directory opened at
  // a section has to survive a language switch with both, not just one of them.
  await viewport(1280,900);
  await visit('/tools/?category=chat#directory');
  const carried=JSON.parse(await evaluate(langHrefs));
  check(carried.every(href=>href.includes('category=chat')&&href.endsWith('#directory')),'tools: the language switch drops the filter or the section when the page has both ('+carried.join(', ')+')');
  await viewport(1280,900);
  await visit('/docs/');
  await evaluate('document.querySelector("#doc-search").focus()');
  await send('Input.insertText',{text:'docker'});
  await evaluate('document.querySelector("#doc-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('location.search==="?q=docker"',2000),'docs: typing does not share the query in the URL');
  await evaluate('document.querySelector(".language-switch").open=true');
  check(await until('[...document.querySelectorAll(".language-switch a")].every(a=>a.getAttribute("href").includes("q=docker"))',2000),'docs: opening the language menu after typing keeps a stale link');
  await evaluate('document.querySelector(".language-switch").open=false');
  await visit('/docs/');
  const cleanDocs=JSON.parse(await evaluate(langHrefs))||[];
  check(cleanDocs.every(href=>!href.includes('?')),'docs: the language switch invents a query string on an unfiltered page ('+cleanDocs.join(', ')+')');
  await viewport(390,844);
  await visit('/docs/?q=docker');
  check(await evaluate('document.querySelector("#doc-search").value==="docker"'),'docs at 390px: the query from the URL is not in the search box');
  // Only one overlay at a time: opening search over the navigation menu must not
  // leave the menu expanded behind the dialog.
  await viewport(390,844);
  await visit('/tools/');
  await evaluate('document.querySelector(".mobile-toggle").click()');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open over the mobile menu');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="false"'),'search: the mobile menu stays open behind the dialog');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(150);
  await evaluate('document.querySelector("[data-save]").click()');
  check(await evaluate('document.querySelector("[data-save]").getAttribute("aria-pressed")==="true"'),'toolkit: saving a tool does not update the button');
  check(await evaluate('JSON.parse(localStorage.getItem("monkeyai-toolkit-v1")||"[]").length===1'),'toolkit: the saved tool is not written to storage');
  check(await evaluate("document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(1)')"),'toolkit: the directory does not show how many tools are saved');
  await visit('/tools/');
  check(await evaluate("document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(1)')"),'toolkit: the saved count is lost after a reload');
  // A shared or bookmarked saved view may open with nothing saved; that state has
  // to explain how to fill it instead of claiming the filter found nothing.
  await evaluate('localStorage.clear()');
  await visit('/tools/?category=saved');
  check(await evaluate('document.querySelector("#empty-state").hidden===false'),'toolkit: an empty saved view shows no message');
  check(await evaluate('/is empty/i.test(document.querySelector("#empty-state h2").textContent)'),'toolkit: an empty saved view does not explain how to save a tool');

  // A tool that was renamed or delisted leaves a slug behind that no card carries.
  // The chip counted it while the saved filter showed nothing, and a toolkit of
  // nothing but ghosts still claimed to be occupied. Unknown slugs are dropped on
  // load and the stored list rewritten, so the phantom does not return.
  await evaluate('localStorage.setItem("monkeyai-toolkit-v1",JSON.stringify(["claude","gone-tool-from-an-older-release"]))');
  await visit('/tools/');
  check(await evaluate('(()=>{const kept=JSON.parse(localStorage.getItem("monkeyai-toolkit-v1")||"[]");return kept.length===1&&kept[0]==="claude";})()'),'toolkit: a saved tool that no longer exists survives in storage');
  check(await evaluate("document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(1)')"),'toolkit: a stale save is still counted in the directory');
  await evaluate('document.querySelector(".filter-chip[data-filter=saved]").click()');
  check(await evaluate('document.querySelector("#result-count").textContent==="1"&&[...document.querySelectorAll("#tool-grid [data-tool]")].filter(card=>!card.hidden).length===1'),'toolkit: the saved filter does not match the count it advertises');
  await evaluate('localStorage.setItem("monkeyai-toolkit-v1",JSON.stringify(["gone-a","gone-b"]))');
  await visit('/tools/');
  check(await evaluate("!document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(')"),'toolkit: an all-stale toolkit still shows a count');
  await evaluate('document.querySelector(".filter-chip[data-filter=saved]").click()');
  check(await evaluate('document.querySelector("#empty-state").hidden===false&&document.querySelector("#empty-state h2").textContent===document.querySelector("#empty-state").dataset.savedEmpty'),'toolkit: an all-stale toolkit shows the wrong empty message');
  await visit('/tools/');
  // Selection must survive without colour: high-contrast modes and monochrome
  // printing drop the lavender fill, so a drawn tick is what distinguishes the
  // filter. It is an empty box, so it must not leak into the accessible name.
  const markerStyle='(()=>{const s=getComputedStyle(document.querySelector(".filter-chip[aria-pressed=true]"),"::after");return JSON.stringify({content:s.content,width:s.width,border:s.borderLeftWidth});})()';
  const marker=JSON.parse(await evaluate(markerStyle));
  check(marker.width==='7px'&&marker.border==='2px','tools: the active filter is marked by colour alone');
  check(marker.content==='""','tools: the selection tick leaks text into the filter name');
  check(await evaluate('getComputedStyle(document.querySelector(".filter-chip[aria-pressed=false]"),"::after").content')==='none','tools: an inactive filter also shows the selection tick');
  await evaluate('document.querySelector(".filter-chip[data-filter=coding]").click()');
  check(await evaluate('getComputedStyle(document.querySelector(".filter-chip[data-filter=coding]"),"::after").width==="7px"'),'tools: the tick does not follow the active filter');
  check(await evaluate('document.querySelector(".filter-chip[data-filter=all]").getAttribute("aria-pressed")==="false"'),'tools: the previous filter stays pressed');
  await visit('/models/');
  check(await evaluate('getComputedStyle(document.querySelector(".filter-chip[aria-pressed=true]"),"::after").width==="7px"'),'models: the active filter is marked by colour alone');
  await visit('/');
  check(await evaluate('getComputedStyle(document.querySelector(".home-categories .filter-chip.selected"),"::after").width==="7px"'),'home: the current category is marked by colour alone');
  await visit('/tools/');
  // Filtering must be announced, not only drawn: without a live region a screen
  // reader user changes the list and hears nothing, so the count is the feedback.
  check(await evaluate('document.querySelector("#result-count").parentElement.getAttribute("aria-live")==="polite"'),'tools: the result count is not a live region');
  const countBefore=await evaluate('document.querySelector("#result-count").textContent');
  await evaluate('document.querySelector("#tool-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#tool-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelector("#result-count").textContent!=='+JSON.stringify(countBefore)),'tools: the result count does not change when the list is filtered');
  // The dialog finds a tool by its licence name, so the directory's own box has to
  // answer the same question: typing "GPL" used to empty the list while the dialog
  // listed both GPL tools. The card also has to name the licence, or a matched card
  // gives no reason for being there.
  for(const [route,word,expected] of [['/tools/','GPL',['blender','comfyui']],['/tools/','MIT',['localai','ollama','orkas']],['/zh/tools/','GPL',['blender','comfyui']]]){
    await visit(route);
    await evaluate('(()=>{const i=document.querySelector("#tool-search");i.focus();i.value='+JSON.stringify(word)+';i.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await until('document.querySelectorAll("#tool-grid [data-tool]:not([hidden])").length>0');
    const visible=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("#tool-grid [data-tool]:not([hidden])")].map(c=>c.dataset.tool))'));
    for(const slug of expected)check(visible.includes(slug),route+': searching "'+word+'" does not list /tools/'+slug+'/');
    const tags=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("#tool-grid [data-tool]:not([hidden]) .tool-license")].map(e=>e.textContent))'));
    check(tags.some(t=>t.toUpperCase().includes(word)),route+': the cards found for "'+word+'" do not name the licence ("'+tags.slice(0,3).join(' / ')+'")');
    check(await evaluate('document.querySelector("#empty-state").hidden'),route+': searching "'+word+'" still shows the empty state');
  }
  // A copy button that copies nothing but empties the list reads as data loss.
  await visit('/tools/');
  await evaluate('document.querySelector("#copy-toolkit").click()');
  await sleep(200);
  check(await evaluate('location.search===""'),'toolkit: copying an empty toolkit changes the filter');
  check(await evaluate('document.querySelectorAll("#tool-grid [data-tool]:not([hidden])").length>5'),'toolkit: copying an empty toolkit hides every tool');
  check(await evaluate('document.querySelector("#toast").classList.contains("visible")&&document.querySelector("#toast").textContent.length>10'),'toolkit: copying an empty toolkit says nothing');
  await evaluate('document.querySelector("[data-save]").click()');
  await evaluate('document.querySelector("#copy-toolkit").click()');
  await sleep(250);
  check(await evaluate('document.querySelector("#toast").textContent!==JSON.parse(document.querySelector("#page-data").textContent).ui.copyEmpty'),'toolkit: a saved tool still reports an empty toolkit');
  // When the clipboard refuses, the text must appear where the click happened and
  // must be reachable without a mouse; it used to sit after every card.
  await viewport(390,844);
  await evaluate('localStorage.setItem("monkeyai-toolkit-v1",JSON.stringify(["claude"]))');
  await visit('/tools/');
  await evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:()=>Promise.reject(new Error("denied"))}})');
  await evaluate('document.querySelector("#copy-toolkit").click()');
  check(await until('document.querySelector("#toolkit-output-wrap").hidden===false'),'toolkit: a refused clipboard leaves nothing to copy from');
  check(await evaluate('(()=>{const o=document.querySelector("#toolkit-output");return o instanceof HTMLTextAreaElement&&o.readOnly;})()'),'toolkit: the fallback list is not a read-only field');
  check(await evaluate('document.activeElement.id==="toolkit-output"'),'toolkit: the fallback text does not take focus');
  check(await evaluate('(()=>{const o=document.querySelector("#toolkit-output");return o.selectionStart===0&&o.selectionEnd===o.value.length;})()'),'toolkit: the fallback list is not selected, so a copy key would copy nothing');
  check(await evaluate('(()=>{const o=document.querySelector("#toolkit-output");return (o.labels?.[0]?.textContent||"").trim().length>10;})()'),'toolkit: the fallback field has no visible, associated label');
  check(await until('(()=>{const r=document.querySelector("#toolkit-output").getBoundingClientRect();return r.top>=0&&r.top<innerHeight;})()'),'toolkit: the fallback text appears out of view');
  check(await evaluate('document.querySelector("#toolkit-output").value.includes("https://")'),'toolkit: the fallback text is empty');
  check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'toolkit: the fallback text pushes the page sideways');
  await visit('/tools/?category=saved');
  check(await evaluate('document.querySelector("#result-count").textContent==="1"&&document.querySelector("#result-label").textContent==="tool to explore"'),'tools: one saved tool is still counted as "1 tools"');
  await viewport(1280,900);
  await visit('/models/');
  // A search that finds nothing used to end at a clear button, even when the answer
  // sat on the other directory: "docker" and "mcp" name guides, not tools.
  await viewport(1280,900);
  await visit('/tools/?q=docker');
  const crossDocs=JSON.parse(await evaluate('JSON.stringify((()=>{const a=document.querySelector("#empty-search-docs");return {empty:!document.querySelector("#empty-state").hidden,hidden:a.hidden,href:a.getAttribute("href"),text:a.textContent.trim(),height:Math.round(a.getBoundingClientRect().height)};})())'));
  check(crossDocs.empty===true&&crossDocs.hidden===false,'/tools/?q=docker: the empty state does not offer the guides');
  check(crossDocs.href==='/docs/?q=docker','/tools/: the guides link goes to "'+crossDocs.href+'"');
  check(crossDocs.text.includes('docker')&&crossDocs.height>=24,'/tools/: the guides link reads "'+crossDocs.text+'" at '+crossDocs.height+'px');
  await evaluate('(()=>{const i=document.querySelector("#tool-search");i.value="";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(300);
  check(await evaluate('document.querySelector("#empty-search-docs").hidden===true'),'/tools/: the guides link stays after the query is cleared');
  await evaluate('document.querySelector("#empty-search-docs").click()');
  await sleep(900);
  check(await until('location.pathname==="/docs/"&&document.querySelector("#doc-search").value==="docker"'),'/tools/: following the guides link does not carry the query');
  check(await evaluate('document.querySelectorAll("[data-doc]:not([hidden])").length>0'),'/docs/?q=docker: the carried query finds nothing');
  await visit('/docs/?q=zzzz');
  check(await evaluate('(()=>{const a=document.querySelector("#empty-search-tools");return !a.hidden&&a.getAttribute("href")==="/tools/?q=zzzz"&&a.textContent.includes("zzzz");})()'),'/docs/: an empty guide search does not offer the tools');
  await visit('/zh/tools/?q=docker');
  check(await evaluate('(()=>{const a=document.querySelector("#empty-search-docs");return a.getAttribute("href")==="/zh/docs/?q=docker"&&a.textContent.includes("docker");})()'),'/zh/tools/: the guides link is not localized');
  // The next assertions measure /models/, so put the page back where they expect it.
  await viewport(1280,900);
  await visit('/models/');

  const modelName=await evaluate('document.querySelector("[data-model] h3").textContent');
  await evaluate('document.querySelector("#model-search").focus()');
  await send('Input.insertText',{text:modelName});
  await evaluate('document.querySelector("#model-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelector("#model-result-count").textContent==="1"'),'models: searching one model name does not narrow to one');
  check(await evaluate('document.querySelector("#model-count-label").textContent==="model family"'),'models: one match is still called "1 model families"');
  await viewport(1280,900);
  await visit('/models/');
  check(await evaluate('document.querySelector("#model-result-count").parentElement.getAttribute("aria-live")==="polite"'),'models: the result count is not a live region');
  // A chip that only says "Open weights" makes a reader click to learn how many
  // models that is, and after a query it hides whether the access type still has
  // matches; the count answers both before the click.
  const chipState=async()=>JSON.parse(await evaluate('JSON.stringify((()=>{const chips=[...document.querySelectorAll("[data-model-filter]")];const counts=chips.map(b=>Number(b.querySelector(".chip-count").textContent));return {counts,sum:counts.slice(1).reduce((s,n)=>s+n,0),shown:[...document.querySelectorAll(".model-card")].filter(c=>!c.hidden).length,total:document.querySelectorAll(".model-card").length};})())'));
  const chipsAll=await chipState();
  check(chipsAll.counts[0]===chipsAll.total,'/models/: the all-access chip says '+chipsAll.counts[0]+' while '+chipsAll.total+' models render');
  check(chipsAll.sum===chipsAll.counts[0],'/models/: the access chips add up to '+chipsAll.sum+' while all-access says '+chipsAll.counts[0]);
  await evaluate('(()=>{const i=document.querySelector("#model-search");i.focus();i.value="gemini";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(300);
  const chipsQuery=await chipState();
  check(chipsQuery.counts.every((n,i)=>n<=chipsAll.counts[i]),'/models/: after a query a chip claims '+chipsQuery.counts.join('/')+' of the earlier '+chipsAll.counts.join('/')+' models');
  check(chipsQuery.sum===chipsQuery.shown,'/models/: after a query the chips add up to '+chipsQuery.sum+' while '+chipsQuery.shown+' cards render');
  await evaluate('(()=>{const i=document.querySelector("#model-search");i.value="zzzz";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(300);
  const chipsNone=await chipState();
  check(chipsNone.counts.every(n=>n===0),'/models/: a query with no matches leaves the chips at '+chipsNone.counts.join('/'));
  await evaluate('(()=>{const i=document.querySelector("#model-search");i.value="";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(300);
  const chipsBack=await chipState();
  check(chipsBack.counts.join()===chipsAll.counts.join(),'/models/: clearing the query leaves the chips at '+chipsBack.counts.join('/'));

  // The model card follows the tool card: one link per card, and the whole card
  // opens the profile, so a thumb on the logo or the description does not miss.
  await viewport(390,844);
  await visit('/models/');
  const modelLinks=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".model-card")].map(c=>[...c.querySelectorAll("a[href]")].map(a=>a.getAttribute("href"))))'));
  check(modelLinks.length>=10,'/models/: only '+modelLinks.length+' model cards were measured');
  const modelDoubled=modelLinks.filter(list=>list.length!==1);
  check(modelDoubled.length===0,'/models/: '+modelDoubled.length+' model cards expose '+JSON.stringify(modelDoubled[0]||[])+' links to the same profile');
  const modelTarget=await evaluate('document.querySelector(".model-card").dataset.model');
  await evaluate('(()=>{const c=document.querySelector(".model-card");window.scrollTo({top:c.getBoundingClientRect().top+scrollY-120,behavior:"instant"});})()');
  await sleep(400);
  const modelHit=await evaluate('(()=>{const c=document.querySelector(".model-card");const r=c.getBoundingClientRect();const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const a=el&&el.closest("a");return a?a.getAttribute("href"):"none";})()');
  check(modelHit==='/models/'+modelTarget+'/','/models/: the middle of a model card links to "'+modelHit+'" instead of the profile');
  check(await evaluate('!!document.querySelector(".model-card .text-link")'),'/models/: the card cue disappeared instead of turning into a label');
  const modelSpot=JSON.parse(await evaluate('(()=>{const r=document.querySelector(".model-card>p").getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()'));
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:modelSpot.x,y:modelSpot.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:modelSpot.x,y:modelSpot.y,button:'left',clickCount:1});
  check(await until('location.pathname==='+JSON.stringify('/models/'+modelTarget+'/'),3000),'/models/: clicking the description of a model card does not open the profile');
  // Typing a query and pressing Enter should open the top result, which is what a
  // visitor expects from a search box once the list is on screen.
  await viewport(1280,900);
  await visit('/');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,ctrlKey:true,bubbles:true}))');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the Enter check');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: no results to open with Enter');
  const firstHref=await evaluate('document.querySelector("#search-results a").getAttribute("href")');
  for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36});
  check(await until('location.pathname==='+JSON.stringify(firstHref),3000),'search: Enter does not open the first result');
  // A mistyped address should still let a visitor search instead of dead-ending.
  await viewport(1280,900);
  await visit('/no-such-page-here/');
  check(await evaluate('!!document.querySelector("[data-open-search]")'),'404: a missing page offers no search');
  await evaluate('document.querySelector("[data-open-search]").focus();document.querySelector("[data-open-search]").click();');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'404: the search trigger does not open the dialog');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'404: searching from a missing page returns no results');
  // A filtered guide index should survive a reload or a shared link, the way the
  // tool directory already does.
  await viewport(1280,900);
  await visit('/docs/');
  await evaluate('document.querySelector("#doc-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#doc-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('location.search.includes("q=mcp")'),'docs: filtering the guide index does not update the address');
  await visit('/docs/?q=mcp');
  check(await evaluate('document.querySelector("#doc-search").value==="mcp"'),'docs: a filtered guide link does not restore the query');
  check(await evaluate('document.querySelectorAll("[data-doc]:not([hidden])").length>0'),'docs: a restored query hides every guide');

  // The dialog opens on an empty box, which is a dead end for someone who does not
  // know the site's vocabulary. Topics the index really covers must appear, be
  // reachable with Tab, and run a real search when chosen.
  await viewport(1280,900);
  await visit('/');
  await evaluate('document.querySelector("[data-open-search]").click()');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the topic check');
  check(await until('document.querySelectorAll(".search-topic").length>=3'),'search: an empty dialog offers no starting topics');
  await evaluate('document.querySelector("#global-search").focus()');
  for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:48});
  await sleep(150);
  check(await evaluate('document.activeElement.classList.contains("search-topic")'),'search: a topic chip cannot be reached with Tab');
  const topic=await evaluate('document.querySelector(".search-topic").textContent');
  await evaluate('document.querySelector(".search-topic").click()');
  check(await evaluate('document.querySelector("#global-search").value==='+JSON.stringify(topic)),'search: a topic chip does not fill the search box');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: a suggested topic returns no results');
  const marks=await evaluate('[...document.querySelectorAll("#search-results mark")].map(m=>m.textContent.toLowerCase())');
  check(Array.isArray(marks)&&marks.length>0&&marks.every(mark=>mark===topic.toLowerCase()),'search: the suggested topic is not marked in the results ('+String(marks).slice(0,60)+')');
  // The query becomes marked-up text inside a result, so it must stay text: a
  // pasted tag is a search string, not a template.
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'<img src=x onerror=window.__maiXss=1>'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(400);
  check(await evaluate('!document.querySelector("#search-results img")&&window.__maiXss!==1'),'search: a typed tag is parsed as HTML');
  // Marking every occurrence of one letter would speckle the list without helping.
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'a'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: the one-letter query renders nothing to inspect');
  check(await evaluate('document.querySelectorAll("#search-results mark").length===0'),'search: a one-letter query marks almost every character');
  // A flaky connection must not leave the dialog stuck on an apology. The retry
  // button repeats the failed request and keeps the query that led nowhere.
  await viewport(1280,900);
  await visit('/');
  await evaluate('{const real=window.fetch;window.__maiFailSearch=true;window.fetch=(input,init)=>window.__maiFailSearch?Promise.reject(new Error("offline")):real(input,init);}');
  await evaluate('document.querySelector("[data-open-search]").click()');
  check(await until('document.querySelector("#search-dialog")?.open===true'),'search: the dialog does not open for the retry check');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('!!document.querySelector(".search-retry")'),'search: a failed load leaves no way to retry');
  check(await evaluate('document.querySelector("#search-status").textContent.length>0'),'search: a failed load says nothing in the status line');
  await evaluate('window.__maiFailSearch=false');
  await evaluate('document.querySelector(".search-retry").click()');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: the retry button does not recover');
  check(await evaluate('document.querySelector("#global-search").value==="mcp"'),'search: the retry loses the query');
  // The comparison matrix is wider than a phone. Once a reader scrolls it, the
  // model name has to stay in view, otherwise every row loses its subject.
  await viewport(390,844);
  await visit('/models/compare/');
  const matrix='(()=>{const w=document.querySelector(".table-scroll");const wr=w.getBoundingClientRect();const off=e=>Math.round(e.getBoundingClientRect().left-wr.left);return JSON.stringify({scrollable:w.scrollWidth-w.clientWidth,head:off(w.querySelector("thead th")),cell:off(w.querySelector("tbody th")),data:off(w.querySelector("tbody td"))});})()';
  const matrixBefore=JSON.parse(await evaluate(matrix));
  check(matrixBefore.scrollable>0,'compare: the matrix no longer scrolls on a phone');
  check(matrixBefore.cell<5,'compare: the model name does not start at the left edge');
  await evaluate('(()=>{const w=document.querySelector(".table-scroll");w.scrollLeft=160;w.dispatchEvent(new Event("scroll"));})()');
  await sleep(200);
  const matrixAfter=JSON.parse(await evaluate(matrix));
  check(Math.abs(matrixAfter.cell-matrixBefore.cell)<=2,'compare: the model name scrolls out of view');
  check(Math.abs(matrixAfter.head-matrixBefore.head)<=2,'compare: the column heading scrolls out of view');
  check(matrixAfter.data<matrixBefore.data-100,'compare: scrolling the matrix does not move its other columns');
  // A matrix that fits has nothing to scroll, so a tab stop there is a keyboard stop
  // with nothing to do; and the documentation links in its cells were 17px tall,
  // under the 24px target size the rest of the site meets.
  const compareFocus=async width=>{
    await viewport(width,900);
    await visit('/models/compare/');
    return JSON.parse(await evaluate('JSON.stringify((()=>{const b=document.querySelector(".table-scroll");const d=[...document.querySelectorAll(".comparison-docs")].map(a=>Math.round(a.getBoundingClientRect().height));return {fits:b.scrollWidth<=b.clientWidth+1,tab:b.getAttribute("tabindex"),role:b.getAttribute("role"),label:(b.getAttribute("aria-label")||"").length,docs:Math.min(...d)};})())'));
  };
  const wideMatrix=await compareFocus(1280);
  check(wideMatrix.fits===true,'compare: the matrix still overflows at 1280px, so the tab-stop check cannot tell the two states apart');
  check(wideMatrix.tab===null,'/models/compare/ at 1280px: the matrix keeps a tab stop although nothing can scroll');
  check(wideMatrix.role==='region'&&wideMatrix.label>10,'/models/compare/ at 1280px: the matrix loses its region label together with the tab stop');
  check(wideMatrix.docs>=24,'/models/compare/ at 1280px: the documentation links are '+wideMatrix.docs+'px tall, under the 24px target size');
  const narrowMatrix=await compareFocus(390);
  check(narrowMatrix.tab==='0'&&narrowMatrix.role==='region'&&narrowMatrix.label>10,'/models/compare/ at 390px: the scrolling matrix is not reachable with the keyboard');
  check(narrowMatrix.docs>=24,'/models/compare/ at 390px: the documentation links are '+narrowMatrix.docs+'px tall, under the 24px target size');

  // A printed guide should be the article alone: no site chrome, no clipped code.
  await viewport(1280,900);
  await send('Emulation.setEmulatedMedia',{media:'print'});
  await visit('/docs/install-with-official-installer/');
  check(await evaluate('getComputedStyle(document.querySelector(".header")).display==="none"'),'print: the site header still prints');
  check(await evaluate('getComputedStyle(document.querySelector(".footer")).display==="none"'),'print: the site footer still prints');
  check(await evaluate('getComputedStyle(document.querySelector(".docs-sidebar")).display==="none"'),'print: the guide sidebar still prints');
  check(await evaluate('getComputedStyle(document.querySelector(".toc")).display==="none"'),'print: the in-page contents still print');
  check(await evaluate('getComputedStyle(document.body).backgroundColor==="rgb(255, 255, 255)"'),'print: the page background still uses a tint');
  check(await evaluate('(()=>{const pre=document.querySelector(".code-block pre");return !!pre&&getComputedStyle(pre).overflowX==="visible"&&getComputedStyle(pre).whiteSpace==="pre-wrap";})()'),'print: a code sample is still a clipped scroll box');
  check(await evaluate('(()=>{const s=document.querySelector(".source-box");return !!s&&getComputedStyle(s).display!=="none"&&getComputedStyle(s).backgroundColor==="rgb(255, 255, 255)";})()'),'print: the source list loses its white background');
  await visit('/');
  check(await evaluate('getComputedStyle(document.querySelector(".hero-art")).display==="none"'),'print: the hero illustration still prints');
  // The scroll note is written for a thumb, not for paper: on a printed matrix it
  // would sit above a table that is fully visible.
  await viewport(768,900);
  await visit('/models/compare/');
  check(await evaluate('getComputedStyle(document.querySelector(".table-scroll-hint")).display==="none"'),'print: the sideways-scroll note still prints above the comparison matrix');
  await send('Emulation.setEmulatedMedia',{media:''});
  await viewport(1280,900);
  // Scripts run the dialog, the filters and the save buttons, and a phone menu
  // cannot open without them. With scripts blocked the page must drop the dead
  // controls, lay the navigation out in the header, and say what still works.
  await send('Emulation.setScriptExecutionDisabled',{value:true});
  const noJsProbe=`JSON.stringify((()=>{
    const display=selector=>{const el=document.querySelector(selector);return el?getComputedStyle(el).display:'absent';};
    const note=document.querySelector('.noscript-note');
    const nav=document.querySelector('.mobile-nav');
    const first=document.querySelector('.tool-card,.model-card,.doc-result');
    const navBox=nav?nav.getBoundingClientRect():null;
    return {
      trigger:display('[data-open-search]'),filters:display('.filter-bar'),save:display('[data-save]'),
      copy:display('#copy-toolkit'),field:display('.directory-toolbar .search-field'),docsField:display('.docs-home-search .search-field'),
      note:note?note.textContent:'',noteHeight:note?Math.round(note.getBoundingClientRect().height):0,
      nav:nav?getComputedStyle(nav).display:'absent',navLinks:nav?[...nav.querySelectorAll('a')].filter(a=>a.getBoundingClientRect().height>0).length:0,
      navBottom:navBox?Math.round(navBox.bottom):0,firstTop:first?Math.round(first.getBoundingClientRect().top):0,
      tools:document.querySelectorAll('.tool-card').length,models:document.querySelectorAll('.model-card').length,
      toolLinks:[...document.querySelectorAll('.tool-card a')].every(a=>(a.getAttribute('href')||'').includes('/tools/')),
      scroll:document.documentElement.scrollWidth,inner:innerWidth
    };
  })())`;
  const gone=state=>state==='none'||state==='absent';
  for(const [route,width,locale,key,cards] of [['/tools/',390,'en','noScriptList','tools'],['/tools/',1280,'en','noScriptList','tools'],['/zh/tools/',390,'zh','noScriptList','tools'],['/docs/',390,'en','noScriptDocs','docs'],['/models/',1280,'en','noScriptList','models']]){
    const label=route+' ('+width+'px)';
    await viewport(width,900);
    await visit(route);
    const noJs=JSON.parse(await evaluate(noJsProbe));
    check(noJs.trigger==='none',label+': the search trigger still invites a click when scripts cannot run');
    check(gone(noJs.filters),label+': the filter bar still invites a click when scripts cannot run');
    check(gone(noJs.save),label+': the save buttons still promise a toolkit when scripts cannot run');
    check(gone(noJs.copy),label+': the copy button still promises a toolkit when scripts cannot run');
    check(gone(noJs.field)&&gone(noJs.docsField),label+': a search field nothing can filter still invites typing');
    check(noJs.note===ui[locale][key],label+': the no-script note is missing or in the wrong language ("'+noJs.note.slice(0,40)+'")');
    check(noJs.noteHeight>0,label+': the no-script note is hidden');
    check(noJs.scroll<=noJs.inner+1,label+': the no-script page is '+noJs.scroll+'px wide on a '+noJs.inner+'px screen');
    if(width<=720){
      check(noJs.nav==='grid'&&noJs.navLinks>=4,label+': the phone navigation stays collapsed when no script can open it ('+noJs.nav+'/'+noJs.navLinks+')');
      check(noJs.navBottom<=noJs.firstTop,label+': the no-script navigation overlaps the content ('+noJs.navBottom+' > '+noJs.firstTop+')');
    }else{
      check(noJs.nav==='none',label+': the no-script navigation is shown twice on a wide screen');
    }
    if(cards==='tools'){
      check(noJs.tools===14&&noJs.toolLinks,label+': the listings are no longer plain links without scripts ('+noJs.tools+' cards)');
    }
    if(cards==='models'){
      check(noJs.models>=10,label+': only '+noJs.models+' model cards render without scripts');
    }
  }
  // Every button on this site is run by the script: with it blocked a visible one
  // is a control that cannot do anything, whatever page it sits on.
  for(const route of ['/','/tools/','/models/','/docs/','/docs/install-with-official-installer/','/models/compare/','/404.html']){
    await viewport(1280,900);
    await visit(route);
    const dead=JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('button,[role="button"],[onclick]')].filter(el=>{const box=el.getBoundingClientRect();const cs=getComputedStyle(el);return box.width>0&&box.height>0&&cs.display!=='none'&&cs.visibility!=='hidden';}).map(el=>(el.className||el.id||el.tagName)+' '+(el.textContent||'').trim().slice(0,20)))`));
    check(dead.length===0,route+': '+dead.length+' button(s) stay clickable with no script to run them ('+dead.slice(0,3).join(', ')+')');
  }
  await send('Emulation.setScriptExecutionDisabled',{value:false});

  // Layout can only be judged on the painted page. This walks the text and image
  // boxes of the main pages and asks the engine whether two of them really sit on
  // top of each other: the centre of their intersection must be painted by one of
  // the pair, and neither box may live in a positioned, clipped or collapsed
  // subtree (menus, decorative layers and closed <details> overlap on purpose).
  // The footer lockup bug above was exactly this shape — the wordmark painted over
  // the logo — and nothing else in the suite would have noticed.
  const overlapProbe=String.raw`JSON.stringify((()=>{
    const name=el=>{const c=(el.className&&el.className.toString().trim().split(/\s+/)[0])||'';return el.tagName.toLowerCase()+(c?'.'+c:'');};
    const ignored=el=>{
      for(let n=el;n&&n!==document.body;n=n.parentElement){
        const cs=getComputedStyle(n);
        if(cs.position==='absolute'||cs.position==='fixed')return true;
        if(n.tagName==='DETAILS'&&!n.open){
          const s=[...n.children].find(c=>c.tagName==='SUMMARY');
          if(s&&!s.contains(el))return true;
        }
        if(cs.overflow!=='visible'&&(n.clientHeight===0||n.clientWidth===0))return true;
      }
      return false;
    };
    const shown=el=>{const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)===0)return false;const r=el.getBoundingClientRect();return r.width>2&&r.height>2;};
    const items=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const text=walker.currentNode.textContent.trim();
      if(!text)continue;
      const el=walker.currentNode.parentElement;
      if(!el||el.closest('script,style,noscript,[aria-hidden="true"]'))continue;
      if(!shown(el)||ignored(el))continue;
      // A link or emphasis that wraps paints its own lines, but its union box also
      // covers the space between them, so a neighbour on the next line looked like
      // a collision. Compare the line boxes the browser actually paints instead.
      const rects=Array.from(el.getClientRects());
      if(rects.length>1&&/^inline/.test(getComputedStyle(el).display)){
        for(const rect of rects)if(rect.width>2&&rect.height>2)items.push({el,text:text.slice(0,22),r:rect});
        continue;
      }
      items.push({el,text:text.slice(0,22),r:el.getBoundingClientRect()});
    }
    for(const el of document.querySelectorAll('img')){
      if(!shown(el)||ignored(el))continue;
      items.push({el,text:'<img>',r:el.getBoundingClientRect()});
    }
    const pairs=[];
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const a=items[i],b=items[j];
      if(a.el===b.el||a.el.contains(b.el)||b.el.contains(a.el))continue;
      const ox=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left);
      const oy=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
      if(ox<4||oy<4)continue;
      pairs.push({a,b,ox,oy});
    }
    // elementFromPoint only sees the viewport, so each candidate pair is scrolled
    // into view before the engine is asked what is painted at its centre.
    const hits=[];
    const restore=window.scrollY;
    for(const p of pairs.slice(0,40)){
      const cx=Math.max(p.a.r.left,p.b.r.left)+p.ox/2;
      const cy=Math.max(p.a.r.top,p.b.r.top)+p.oy/2;
      window.scrollTo({top:Math.max(0,cy-innerHeight/2),behavior:'instant'});
      const ra=p.a.el.getBoundingClientRect(),rb=p.b.el.getBoundingClientRect();
      const ox=Math.min(ra.right,rb.right)-Math.max(ra.left,rb.left);
      const oy=Math.min(ra.bottom,rb.bottom)-Math.max(ra.top,rb.top);
      if(ox<4||oy<4)continue;
      const px=Math.max(ra.left,rb.left)+ox/2;
      const py=Math.max(ra.top,rb.top)+oy/2;
      if(px<0||py<0||px>=innerWidth||py>=innerHeight)continue;
      const stack=document.elementsFromPoint(px,py);
      if(!stack.some(n=>p.a.el===n||p.b.el===n||p.a.el.contains(n)||p.b.el.contains(n)))continue;
      hits.push({a:name(p.a.el),b:name(p.b.el),ta:p.a.text,tb:p.b.text,x:Math.round(ox),y:Math.round(oy)});
    }
    window.scrollTo({top:restore,behavior:'instant'});
    return hits;
  })())`;
  // 768 is the width where the layouts switch: the phone nav is replaced by the
  // desktop bar, the tool grid gains a column and the guide keeps its sidebar, so
  // boxes that never met at 390 or 1280 can collide there.
  for(const width of [390,768,1280]){
    await viewport(width,1200);
    for(const route of ['/','/tools/','/models/compare/','/docs/getting-started/','/community/','/zh/models/compare/']){
      await visit(route);
      const hits=JSON.parse(await evaluate(overlapProbe));
      const first=hits[0];
      check(hits.length===0,route+' at '+width+'px: '+(first?'"'+first.ta+'" is painted over "'+first.tb+'" ('+first.x+'x'+first.y+'px)'+(hits.length>1?' and '+(hits.length-1)+' other overlapping pairs':''):'nothing')+' — two visible boxes share the same pixels');
    }
  }

  // Two links cross a page boundary, so the DOM shim cannot see them: a URL that
  // carries the model filter has to arrive with that filter applied, and a tool
  // saved on its own page has to turn up in the directory's saved view.
  await viewport(1280,1000);
  await visit('/models/?access=open-weights');
  const deepFilter=JSON.parse(await evaluate('JSON.stringify({pressed:[...document.querySelectorAll("[data-model-filter]")].map(b=>b.dataset.modelFilter+":"+b.getAttribute("aria-pressed")),shown:[...document.querySelectorAll("[data-model]")].filter(c=>!c.hidden).map(c=>c.dataset.access),count:document.querySelector("#model-result-count").textContent.trim()})'));
  const pressedOnce=deepFilter.pressed.filter(p=>p.endsWith(':true'));
  check(pressedOnce.join(',')==='open-weights:true','/models/?access=open-weights marks '+deepFilter.pressed.join(', ')+' instead of the open-weights filter alone');
  check(deepFilter.shown.length>0&&deepFilter.shown.every(a=>a==='open-weights'),'/models/?access=open-weights lists '+deepFilter.shown.join(', ')+' cards');
  check(deepFilter.count===String(deepFilter.shown.length),'/models/ says "'+deepFilter.count+'" while the open-weights filter leaves '+deepFilter.shown.length+' cards');
  await evaluate('try{localStorage.removeItem("monkeyai-toolkit-v1")}catch{}');
  await visit('/tools/cursor/');
  check(await evaluate('!!document.querySelector("[data-save]")'),'/tools/cursor/ has no save control, so the tool cannot be added from its own page');
  await evaluate('document.querySelector("[data-save]").click()');
  await sleep(250);
  await visit('/tools/?category=saved');
  const fromDetail=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("#tool-grid [data-tool]")].filter(c=>!c.hidden).map(c=>c.dataset.tool))'));
  check(fromDetail.length===1&&fromDetail[0]==='cursor','a tool saved on its own page is listed as '+fromDetail.join(', ')+' under /tools/?category=saved');
  check(await evaluate('document.querySelector(".filter-chip[data-filter=saved] .saved-count").textContent.includes("(1)")'),'/tools/?category=saved shows no toolkit count after a save made on a detail page');
  await evaluate('try{localStorage.removeItem("monkeyai-toolkit-v1")}catch{}');

  // The comparison matrix is wider than its box on everything below a laptop, and
  // the note that explains the sideways scroll used to be tied to the phone
  // breakpoint: at 768px and 860px the last columns were cut off and nothing said
  // they could be reached. The note has to follow the overflow, at one size.
  const hintAt=async width=>{
    await viewport(width,900);
    await visit('/models/compare/');
    return JSON.parse(await evaluate('JSON.stringify((()=>{const t=document.querySelector(".table-scroll"),h=document.querySelector(".table-scroll-hint");const r=h.getBoundingClientRect();return {overflow:t.scrollWidth>t.clientWidth+1,shown:getComputedStyle(h).display!=="none"&&r.height>2,size:parseFloat(getComputedStyle(h).fontSize)};})())'));
  };
  const hintSizes=[];
  for(const width of [390,768,860,1024,1280]){
    const hint=await hintAt(width);
    hintSizes.push(hint.size);
    check(hint.shown===hint.overflow,'/models/compare/ at '+width+'px: the table '+(hint.overflow?'is cut off':'fits')+' while the scroll hint is '+(hint.shown?'shown':'hidden'));
  }
  check(new Set(hintSizes).size===1,'/models/compare/: the scroll hint is '+hintSizes.join('px, ')+'px across widths instead of one size');

  // Section ids are index based on every translation, so a reader three sections
  // into a guide who switches language should stay there instead of being sent
  // back to the top; an id the target page lacks is left off rather than dangling.
  await viewport(1280,900);
  await visit('/docs/getting-started/#section-3');
  const switchHrefs='JSON.stringify([...document.querySelectorAll(".language-menu a[lang]")].map(a=>a.getAttribute("href")))';
  let switched=JSON.parse(await evaluate(switchHrefs));
  check(switched.length===3,'language: the switch offers '+switched.length+' languages');
  check(switched.every(h=>h.endsWith('#section-3')),'language: switching drops the section the reader is on ('+switched.join(', ')+')');
  check(switched.includes('/zh/docs/getting-started/#section-3'),'language: the Chinese switch does not open the same guide at the same section ('+switched.join(', ')+')');
  await evaluate('document.querySelector(".toc a[href=\\"#section-2\\"]").click()');
  await sleep(300);
  switched=JSON.parse(await evaluate(switchHrefs));
  check(switched.every(h=>h.endsWith('#section-2')),'language: jumping to another section leaves the switch pointing at the old one ('+switched.join(', ')+')');
  await evaluate('location.hash="#no-such-section"');
  await sleep(300);
  switched=JSON.parse(await evaluate(switchHrefs));
  check(switched.every(h=>h.indexOf('#')<0),'language: the switch carries a fragment the target page does not have ('+switched.join(', ')+')');
}catch(error){
  failures.push('harness error: '+error.message);
}finally{
  stop();
}

const report={status:failures.length?'failed':'passed',checks,failures};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
