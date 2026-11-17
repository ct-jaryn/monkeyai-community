import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The DOM shim proves the scripts do the right thing with the nodes they are
// given. It cannot prove that a browser lays the pages out, that the search dialog
// really opens, or that a phone-width page stays inside the screen. This harness
// drives a local Chrome over the DevTools protocol instead, so those questions are
// answered by an engine rather than by reading CSS.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
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
  for(const route of ['/','/tools/','/models/','/docs/','/docs/getting-started/','/zh/docs/','/es/tools/']){
    await viewport(390,844);
    await visit(route);
    const layout=await evaluate('JSON.stringify({inner:innerWidth,scroll:document.documentElement.scrollWidth,main:!!document.querySelector("main")})');
    const {inner,scroll,main}=JSON.parse(layout);
    check(inner===390,route+': the viewport override did not apply (innerWidth '+inner+')');
    check(main,route+': the page has no main landmark in the browser');
    check(scroll<=inner+1,route+': content is '+scroll+'px wide on a '+inner+'px screen');
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

  // An icon-only card action carries the whole "open this tool" decision, so
  // unlike a link inside a sentence it has to clear 24px on both sides at phone
  // width; the icon itself stays small.
  await viewport(390,844);
  await visit('/tools/');
  const cardActions=JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll(".tool-bottom a")].map(el=>{const r=el.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)];}))'));
  const tightActions=cardActions.filter(([w,h])=>w<24||h<24);
  check(cardActions.length>0,'/tools/: no card action links were measured');
  check(tightActions.length===0,'/tools/: a card action link is smaller than 24x24 ('+JSON.stringify(tightActions.slice(0,3))+')');

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
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector("#global-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelectorAll("#search-results a").length>0'),'search: the narrow query shows nothing after the truncation check');
  check(await evaluate('!document.querySelector(".search-more")'),'search: a narrow query still claims results were left out');
  await evaluate('document.querySelector("#global-search").value="";document.querySelector("#global-search").dispatchEvent(new Event("input",{bubbles:true}))');
  await evaluate('document.querySelector("[data-close-search]").click()');
  await sleep(150);

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
  const modelName=await evaluate('document.querySelector("[data-model] h3").textContent');
  await evaluate('document.querySelector("#model-search").focus()');
  await send('Input.insertText',{text:modelName});
  await evaluate('document.querySelector("#model-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelector("#model-result-count").textContent==="1"'),'models: searching one model name does not narrow to one');
  check(await evaluate('document.querySelector("#model-count-label").textContent==="model family"'),'models: one match is still called "1 model families"');
  await viewport(1280,900);
  await visit('/models/');
  check(await evaluate('document.querySelector("#model-result-count").parentElement.getAttribute("aria-live")==="polite"'),'models: the result count is not a live region');
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
  await send('Emulation.setEmulatedMedia',{media:''});
}catch(error){
  failures.push('harness error: '+error.message);
}finally{
  stop();
}

const report={status:failures.length?'failed':'passed',checks,failures};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
