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
const chrome=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--user-data-dir='+profile,'--remote-debugging-port='+debugPort,'about:blank'],{stdio:'ignore'});

const stop=()=>{
  try{chrome.kill('SIGKILL');}catch{}
  try{server.close();}catch{}
  try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
};
process.on('exit',stop);

async function waitForDevtools(){
  for(let i=0;i<100;i++){
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
  const tapSelectors=['.language-switch summary','.search-field input','.guide-toc nav a','.mobile-guide-nav summary','.footer a','.breadcrumbs a'];
  const measure='JSON.stringify([...document.querySelectorAll('+JSON.stringify(tapSelectors.join(','))+')].filter(el=>{const r=el.getBoundingClientRect();return r.height>0&&r.height<24;}).map(el=>el.tagName.toLowerCase()+" "+Math.round(el.getBoundingClientRect().height)+"px"))';
  for(const route of ['/','/tools/','/docs/','/docs/getting-started/','/zh/']){
    await viewport(390,844);
    await visit(route);
    const short=JSON.parse(await evaluate(measure))||[];
    check(short.length===0,route+': a tap target is shorter than 24px ('+short.slice(0,4).join(', ')+')');
  }

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
  check(/^Matches: \d+$/.test(await evaluate('document.querySelector("#search-status").textContent')),'search: the result count is not announced in the status line');
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

  // The mobile menu and the saved-tool toggle both write to the live DOM; the shim
  // only checks the handlers, so the browser confirms the visible result.
  await viewport(390,844);
  await visit('/tools/');
  check(await evaluate('getComputedStyle(document.querySelector(".mobile-toggle")).display!=="none"'),'tools at 390px: the mobile menu button is hidden');
  await evaluate('document.querySelector(".mobile-toggle").click()');
  check(await evaluate('document.querySelector(".mobile-toggle").getAttribute("aria-expanded")==="true"'),'mobile menu: the button does not report an expanded state');
  check(await evaluate('document.querySelector(".mobile-nav").hidden===false'),'mobile menu: the navigation stays hidden after the click');
  await evaluate('document.querySelector("[data-save]").click()');
  check(await evaluate('document.querySelector("[data-save]").getAttribute("aria-pressed")==="true"'),'toolkit: saving a tool does not update the button');
  check(await evaluate('JSON.parse(localStorage.getItem("monkeyai-toolkit-v1")||"[]").length===1'),'toolkit: the saved tool is not written to storage');
  check(await evaluate("document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(1)')"),'toolkit: the directory does not show how many tools are saved');
  await visit('/tools/');
  check(await evaluate("document.querySelector('.filter-chip[data-filter=\"saved\"] .saved-count').textContent.includes('(1)')"),'toolkit: the saved count is lost after a reload');
  // Filtering must be announced, not only drawn: without a live region a screen
  // reader user changes the list and hears nothing, so the count is the feedback.
  check(await evaluate('document.querySelector("#result-count").parentElement.getAttribute("aria-live")==="polite"'),'tools: the result count is not a live region');
  const countBefore=await evaluate('document.querySelector("#result-count").textContent');
  await evaluate('document.querySelector("#tool-search").focus()');
  await send('Input.insertText',{text:'mcp'});
  await evaluate('document.querySelector("#tool-search").dispatchEvent(new Event("input",{bubbles:true}))');
  check(await until('document.querySelector("#result-count").textContent!=='+JSON.stringify(countBefore)),'tools: the result count does not change when the list is filtered');
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
}catch(error){
  failures.push('harness error: '+error.message);
}finally{
  stop();
}

const report={status:failures.length?'failed':'passed',checks,failures};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
