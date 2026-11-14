import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The search dialog is the one part of the site whose behaviour lives entirely in
// the browser. This harness runs the delivered client script against a minimal DOM
// shim, so the real file is exercised: the on-demand index request, the loading
// line, rendered results, the empty state, and the retry after a failed request.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const failures=[];
let checks=0;
const check=(ok,label)=>{checks++;if(!ok)failures.push(label);};

function makeEl(tag='div'){
  // Only the surface the client script touches: child lists, attributes, listeners.
  const el={
    tagName:tag.toUpperCase(),children:[],attributes:{},listeners:{},dataset:{},hidden:false,
    textContent:'',value:'',open:false,focused:false,href:'',className:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    append(...kids){el.children.push(...kids);},
    appendChild(kid){el.children.push(kid);return kid;},
    replaceChildren(...kids){el.children=kids;},
    setAttribute(name,value){el.attributes[name]=String(value);},
    getAttribute(name){return name in el.attributes?el.attributes[name]:null;},
    addEventListener(type,fn){(el.listeners[type]||(el.listeners[type]=[])).push(fn);},
    dispatch(type,extra={}){for(const fn of el.listeners[type]||[])fn({preventDefault(){},target:el,...extra});},
    querySelector(){return null;},
    querySelectorAll(){return [];},
    focus(){el.focused=true;},
    showModal(){el.open=true;},
    close(){el.open=false;el.dispatch('close',{});},
    contains(){return false;},
  };
  return el;
}

const clientName=fs.readdirSync(path.join(dist,'assets')).find(name=>/^app\.[a-f0-9]+\.js$/.test(name));
const clientSource=fs.readFileSync(path.join(dist,'assets',clientName),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const flatten=el=>el.children.map(kid=>kid.textContent!==''?kid.textContent:flatten(kid)).join('|');

function readPage(file){
  const html=fs.readFileSync(path.join(dist,file),'utf8');
  const raw=html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/);
  if(!raw)throw new Error('page data missing from '+file);
  return JSON.parse(raw[1]);
}

function boot(pageData,fetchIndex,extra={}){
  const dialog=makeEl('dialog'),input=makeEl('input'),results=makeEl('div'),toast=makeEl('div');
  const dataNode=makeEl('script');
  dataNode.textContent=JSON.stringify(pageData);
  const known={'#page-data':dataNode,'#search-dialog':dialog,'#global-search':input,'#search-results':results,'#toast':toast,...extra};
  const document={createElement:makeEl,querySelector:selector=>known[selector]??null,querySelectorAll:()=>[],addEventListener(){},body:makeEl('body')};
  const windowRef={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})};
  const state={requests:[],fetch:fetchIndex};
  const globals={document,window:windowRef,navigator:{clipboard:{writeText:async()=>{}},platform:'MacIntel'},localStorage:{getItem:()=>null,setItem(){}},location:{search:'',pathname:'/'},history:{replaceState(){}},fetch:(...args)=>{state.requests.push(args[0]);return state.fetch(...args);},console,setTimeout,clearTimeout};
  new Function('document','window','navigator','localStorage','location','history','fetch',clientSource)(globals.document,globals.window,globals.navigator,globals.localStorage,globals.location,globals.history,globals.fetch);
  return {dialog,input,results,requests:state.requests,setFetch:fn=>{state.fetch=fn;}};
}

async function onlineRun(locale,file){
  const page=readPage(file);
  const index=JSON.parse(fs.readFileSync(path.join(dist,page.searchIndex),'utf8'));
  const serve=async url=>{if(url!==page.searchIndex)throw new Error('client asked for '+url);return {ok:true,status:200,json:async()=>index};};
  const app=boot(page,serve);
  const at=label=>locale+': '+label;

  app.dialog.showModal();
  app.input.value='';
  app.input.dispatch('input');
  check(app.results.children[0]?.textContent===page.ui.searchPrompt,at('empty query shows the prompt'));
  check(app.requests.length===0,at('typing nothing never touches the network'));

  app.input.value='mcp';
  app.input.dispatch('input');
  check(app.results.children[0]?.textContent===page.ui.searchLoading,at('the first keystroke shows the loading line'));
  await settle();await settle();
  const links=app.results.children.filter(kid=>kid.tagName==='A');
  check(links.length>0,at('results render when the index arrives'));
  check(app.requests.length===1,at('the index is fetched once, not once per keystroke'));
  check(links.every(link=>typeof link.href==='string'&&link.href.startsWith('/')),at('every result carries a site path'));

  app.input.value='zzzznotathing';
  app.input.dispatch('input');
  await settle();
  check(flatten(app.results).includes(page.ui.searchEmpty),at('a miss explains the empty result'));
  const suggestions=app.results.children.find(kid=>kid.className==='search-suggestions');
  check(Boolean(suggestions)&&suggestions.children.length===6,at('a miss still offers the six sections'));

  // A term taken from the index itself, so the probe works in every language.
  app.input.value=index[0].title.slice(0,3);
  app.input.dispatch('input');
  await settle();
  check(app.requests.length===1,at('a later query reuses the cached index'));
  check(app.results.children.filter(kid=>kid.tagName==='A').length>0,at('a later query still renders results'));
}

// The guide index has its own filter with its own empty state, so it gets the
// same treatment: the delivered script runs, and the built digests must keep it
// answering questions about the cards on the page.
function docsFilterRun(){
  const html=fs.readFileSync(path.join(dist,'docs/index.html'),'utf8');
  const cards=[],groups=[],topicLinks=new Map();
  for(const section of html.split('<section class="docs-topic-section"').slice(1)){
    const key=section.match(/data-doc-group="([^"]+)"/)?.[1]||section.match(/id="topic-([^"]+)"/)?.[1];
    if(!key)continue;
    const group=makeEl('section');
    group.id='topic-'+key;
    group.dataset={docGroup:key};
    group.cards=[...section.matchAll(/data-doc="([^"]+)" data-search="([^"]+)"/g)].map(match=>{
      const card=makeEl('a');
      card.dataset={doc:match[1],search:match[2]};
      return card;
    });
    const countStub=makeEl('span');
    group.querySelector=selector=>selector==='.docs-topic-count'?countStub:group.querySelectorAll(selector)[0]??null;
    group.querySelectorAll=selector=>selector==='[data-doc]:not([hidden])'?group.cards.filter(card=>!card.hidden):selector==='[data-doc]'?group.cards:[];
    cards.push(...group.cards);
    groups.push(group);
    const link=makeEl('a');
    topicLinks.set('.docs-topics a[href="#topic-'+key+'"]',link);
  }
  const root=makeEl('div'),search=makeEl('input'),count=makeEl('span'),empty=makeEl('p'),clear=makeEl('button');
  root.dataset={countLabel:'guides'};
  root.querySelector=selector=>{
    if(selector==='#doc-search')return search;
    if(selector==='#doc-count')return count;
    if(selector==='#doc-empty')return empty;
    if(selector==='#doc-clear')return clear;
    return topicLinks.get(selector)??null;
  };
  root.querySelectorAll=selector=>selector==='[data-doc]'?cards:selector==='[data-doc-group]'?groups:[];
  boot(readPage('docs/index.html'),async()=>{throw new Error('the guide filter must not need the network');},{'.docs-home':root});

  const visible=()=>cards.filter(card=>!card.hidden).length;
  const first=cards[0];
  const probe=(first.dataset.search.match(/[a-z]{4,}/i)||['guide'])[0].toLocaleLowerCase();
  search.value=probe;
  search.dispatch('input');
  check(!first.hidden,'docs: a word from a card keeps that card',probe);
  check(visible()>0&&visible()<=cards.length,'docs: the filter keeps a sensible subset','visible='+visible()+'/'+cards.length);
  check(count.textContent===visible()+' guides','docs: the count matches the visible cards',count.textContent);
  check(empty.hidden===true,'docs: the empty state stays hidden while cards match');

  search.value='zzzznotathing';
  search.dispatch('input');
  check(visible()===0,'docs: a miss hides every card');
  check(count.textContent==='0 guides','docs: a miss reports zero',count.textContent);
  check(empty.hidden===false,'docs: a miss shows the empty state');
  check(groups.every(group=>group.hidden===true),'docs: a miss hides the empty topic groups');
  check([...topicLinks.values()].every(link=>link.hidden===true),'docs: a miss hides the topic shortcuts');

  clear.dispatch('click');
  check(visible()===cards.length,'docs: clearing brings every card back');
  check(empty.hidden===true,'docs: clearing hides the empty state again');
}

async function offlineRun(){
  const page=readPage('index.html');
  const app=boot(page,async()=>{throw new Error('offline');});
  app.dialog.showModal();
  app.input.value='guide';
  app.input.dispatch('input');
  await settle();await settle();
  check(app.results.children[0]?.textContent===page.ui.searchUnavailable,'en: a failed fetch explains itself');

  const index=JSON.parse(fs.readFileSync(path.join(dist,page.searchIndex),'utf8'));
  app.setFetch(async()=>({ok:true,status:200,json:async()=>index}));
  app.input.value='mcp';
  app.input.dispatch('input');
  await settle();await settle();
  check(app.requests.length===2,'en: a retry asks again instead of caching the failure');
  check(app.results.children.filter(kid=>kid.tagName==='A').length>0,'en: the retry renders results');
}

try{
  for(const [locale,file] of [['en','index.html'],['zh','zh/index.html'],['es','es/index.html']])await onlineRun(locale,file);
  await offlineRun();
  docsFilterRun();
}catch(error){
  failures.push('harness error: '+error.message);
}
const report={status:failures.length?'failed':'passed',checks,failures};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exit(1);
