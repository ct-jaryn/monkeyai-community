(()=>{'use strict';const dataNode=document.querySelector('#page-data');if(!dataNode)return;const data=JSON.parse(dataNode.textContent),u=data.ui;const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];// A saved tool that was renamed or delisted leaves a slug no card carries any more:
// the chip kept counting it while the saved filter had nothing to show, and a
// toolkit of nothing but ghosts still claimed to be occupied. Only listed slugs
// are restored, and the stored list is rewritten so the phantom does not return.
let saved=new Set();const listedSlugs=new Set((data.tools||[]).map(t=>t.slug));try{const stored=JSON.parse(localStorage.getItem('monkeyai-toolkit-v1')||'[]');const listed=Array.isArray(stored)?stored:[];const kept=[...new Set(listed)].filter(slug=>listedSlugs.has(slug));saved=new Set(kept);if(!Array.isArray(stored)||kept.length!==listed.length)localStorage.setItem('monkeyai-toolkit-v1',JSON.stringify(kept));}catch{}let toastTimer;function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),2600);}function syncSaved(){ $$('[data-save]').forEach(b=>{const on=saved.has(b.dataset.save);b.setAttribute('aria-pressed',String(on));const label=(on?u.savedLabel:u.save);const tool=data.tools.find(t=>t.slug===b.dataset.save);b.setAttribute('aria-label',label+(tool?': '+tool.name:''));if(b.querySelector('span'))b.querySelector('span').textContent=label;});const chip=document.querySelector('.filter-chip[data-filter="saved"] .saved-count');if(chip)chip.textContent=(chip.dataset.label||'')+(saved.size?' ('+saved.size+')':'');}$$('[data-save]').forEach(b=>b.addEventListener('click',()=>{const slug=b.dataset.save;if(saved.has(slug))saved.delete(slug);else saved.add(slug);try{localStorage.setItem('monkeyai-toolkit-v1',JSON.stringify([...saved]));}catch{}syncSaved();if($('#directory'))filterTools();}));syncSaved();
let closeMenu=()=>{};const mobile=$('.mobile-toggle'),mobileNav=$('.mobile-nav');if(mobile&&mobileNav){const setMenu=open=>{mobile.setAttribute('aria-expanded',String(open));mobile.setAttribute('aria-label',open?mobile.dataset.labelClose:mobile.dataset.labelOpen);mobileNav.hidden=!open;};mobile.addEventListener('click',()=>setMenu(mobile.getAttribute('aria-expanded')!=='true'));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mobile.getAttribute('aria-expanded')==='true'){setMenu(false);mobile.focus();}});document.addEventListener('click',e=>{if(mobile.getAttribute('aria-expanded')==='true'&&!mobileNav.contains(e.target)&&!mobile.contains(e.target))setMenu(false);});closeMenu=()=>setMenu(false);}
// Escape closes the language menu and hands focus back to its summary, the same way it
// closes the navigation menu and the search dialog.
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const open=$('.language-switch[open]');if(!open)return;open.open=false;open.querySelector('summary')?.focus();});document.addEventListener('click',e=>{$$('.language-switch[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;});});
// The hint must name the keys the reader's keyboard actually has: Ctrl+K opens
// the dialog on Windows and Linux, so a hard-coded command sign would promise a
// shortcut that is not there. aria-keyshortcuts on the trigger lists both.
function shortcutLabel(platform){return /^(Mac|iPhone|iPad|iPod)/.test(platform)?'⌘ K':'Ctrl K';}
const shortcutNode=$('[data-open-search] [data-shortcut]');if(shortcutNode)shortcutNode.textContent=shortcutLabel((navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||'');
const dialog=$('#search-dialog'),search=$('#global-search'),results=$('#search-results');let opener=null,pageHiding=false;function say(message){const node=document.querySelector('#search-status');if(node)node.textContent=message;}function lockPageScroll(on){document.documentElement.classList.toggle('scroll-locked',on);}// Following a result away from the page threw the query away with it: coming back
// to look at the second match meant typing the same words again. The last query is
// kept for the lifetime of the tab and restored selected, so the next keystroke
// replaces it instead of appending to it.
const SEARCH_MEMORY='monkeyai-search-last-v1';
function rememberedSearch(){try{return sessionStorage.getItem(SEARCH_MEMORY)||'';}catch{return '';}}
function flushSearchMemory(){try{const value=search.value.trim();if(value)sessionStorage.setItem(SEARCH_MEMORY,value);else sessionStorage.removeItem(SEARCH_MEMORY);}catch{}}
function openSearch(){closeMenu();opener=document.activeElement;lockPageScroll(true);dialog.showModal();if(!search.value.trim()){const last=rememberedSearch();if(last)search.value=last;}search.focus();if(search.value.trim())search.select();renderResults();}function restoreSearchFocus(){if(pageHiding)return;const t=opener&&opener!==document.body&&opener.isConnected?opener:$('[data-open-search]');if(t)t.focus();}function closeSearch(){flushSearchMemory();dialog.close();lockPageScroll(false);restoreSearchFocus();}$$('[data-open-search]').forEach(b=>{b.addEventListener('click',openSearch);b.addEventListener('pointerenter',()=>loadSearch().catch(()=>{}));b.addEventListener('focus',()=>loadSearch().catch(()=>{}));});$('[data-close-search]')?.addEventListener('click',closeSearch);function trapTab(e){if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(n=>n.offsetParent!==null);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}dialog?.addEventListener('keydown',trapTab);dialog?.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSearch();}});dialog?.addEventListener('cancel',e=>{e.preventDefault();closeSearch();});dialog?.addEventListener('close',()=>{lockPageScroll(false);restoreSearchFocus();});
// Following a result away from the page leaves the dialog in the back/forward
// snapshot: coming back would restore an open dialog over a frozen page at the
// top. Closing on pagehide keeps the snapshot in the state the reader left.
window.addEventListener('pagehide',()=>{pageHiding=true;flushSearchMemory();if(dialog.open)closeSearch();});
window.addEventListener('pageshow',e=>{pageHiding=false;if(!e.persisted)return;if(dialog.open)closeSearch();lockPageScroll(false);});
const resultLinks=()=>[...results.querySelectorAll('a')];
search.addEventListener('keydown',e=>{const links=resultLinks();if(e.key==='ArrowDown'&&links.length){e.preventDefault();links[0].focus();}else if(e.key==='Enter'&&!e.isComposing&&links.length){e.preventDefault();links[0].click();}});
results.addEventListener('keydown',e=>{const links=resultLinks();if(!links.length)return;const i=links.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();links[Math.min(i+1,links.length-1)].focus();}else if(e.key==='ArrowUp'){e.preventDefault();if(i<=0)search.focus();else links[i-1].focus();}else if(e.key==='Home'){e.preventDefault();links[0].focus();}else if(e.key==='End'){e.preventDefault();links[links.length-1].focus();}});document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();dialog.open?closeSearch():openSearch();}});let searchItems=null,searchRequest=null,searchShown=12,searchLastQuery=null;function loadSearch(){if(searchItems)return Promise.resolve(searchItems);if(!searchRequest)searchRequest=fetch(data.searchIndex,{credentials:'omit'}).then(r=>{if(!r.ok)throw new Error('search '+r.status);return r.json();}).then(list=>{searchItems=list;return list;}).catch(err=>{searchRequest=null;throw err;});return searchRequest;}// The dialog opens on an empty box, which asks the visitor to already know the
// vocabulary. A few topics the index really covers turn that blank slate into a
// starting point; each chip fills the box and runs the search a person would type.
function suggestionChips(){
  const suggestions=u.searchSuggestions||[];
  if(!suggestions.length)return null;
  const list=document.createElement('div');list.className='search-topics';
  const label=document.createElement('span');label.className='search-topics-label';label.textContent=u.searchTry||'';
  list.append(label);
  for(const term of suggestions){
    const chip=document.createElement('button');chip.type='button';chip.className='search-topic';chip.textContent=term;
    chip.addEventListener('click',()=>{search.value=term;renderResults();search.focus();});
    list.append(chip);
  }
  return list;
}
// Scoring ignores case and accents, so the highlight has to fold the same way while
// still pointing at the original characters: each folded letter remembers the index
// it came from, and a token found in the folded string maps back to a real range.
function foldText(text){
  let flat='';const map=[];
  for(let i=0;i<text.length;i++){
    const folded=text[i].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
    for(const ch of folded){flat+=ch;map.push(i);}
  }
  return {flat,map};
}
function highlight(node,text,terms){
  const ranges=[];
  if(terms.length){
    const folded=foldText(text);
    for(const term of terms){
      let from=0;
      while(ranges.length<8){
        const at=folded.flat.indexOf(term,from);
        if(at<0)break;
        const start=folded.map[at],end=folded.map[at+term.length-1]+1;
        if(end>start&&!ranges.some(r=>start<r[1]&&end>r[0]))ranges.push([start,end]);
        from=at+term.length;
      }
    }
  }
  if(!ranges.length){node.textContent=text;return;}
  ranges.sort((a,b)=>a[0]-b[0]);
  let cursor=0;
  for(const [start,end] of ranges){
    if(start>cursor)node.append(document.createTextNode(text.slice(cursor,start)));
    const mark=document.createElement('mark');mark.textContent=text.slice(start,end);node.append(mark);
    cursor=end;
  }
  if(cursor<text.length)node.append(document.createTextNode(text.slice(cursor)));
}
// Guides are indexed with their section headings and bullets, so a page can match
// on words its summary never mentions. Quoting the words around that match answers
// "why is this here?" far better than repeating a description the reader has just
// typed past; the ellipses say the sentence continues outside the row.
function matchedSnippet(text,terms){
  if(!text||!terms.length)return '';
  const folded=foldText(text);
  let at=-1;
  for(const term of terms){
    const found=folded.flat.indexOf(term);
    if(found>=0&&(at<0||found<at))at=found;
  }
  if(at<0)return '';
  const start=folded.map[at];
  const floor=Math.max(0,start-60);
  let from=floor,to=Math.min(text.length,start+110);
  // The keyword text is a run of section headings and bullets joined by a
  // separator. Starting at the bullet that holds the match, and stopping at the
  // next separator, keeps the quote on one idea: the same 170-character window
  // that holds a sentence in English spans four sections in Chinese, which read
  // as an unrelated run-on in the result row.
  const gapBefore=text.lastIndexOf(' · ',start);
  if(gapBefore>=0&&gapBefore>=floor)from=gapBefore+3;
  else{const before=text.indexOf(' ',from);if(before>=0&&before<start)from=before+1;}
  const gapAfter=text.indexOf(' · ',start);
  let atBoundary=false;
  if(gapAfter>=0&&gapAfter<to){to=gapAfter;atBoundary=true;}
  else{const after=text.indexOf(' ',to);if(after>to&&after-to<40)to=after;}
  const body=text.slice(from,to).replace(/^[\s·]+/,'').replace(/[\s·]+$/,'');
  // A quote that ends on a section boundary is complete, so a closing ellipsis
  // would claim the sentence was cut when it was not.
  return (from>0?'…':'')+body+(to<text.length&&!atBoundary?'…':'');
}
function setSearchCount(text){const node=document.querySelector('#search-count');if(!node)return;node.textContent=text;node.hidden=!text;}function renderResults(){const q=search.value.trim().toLocaleLowerCase();results.replaceChildren();setSearchCount('');if(q!==searchLastQuery){searchLastQuery=q;searchShown=12;}if(!q){const p=document.createElement('p');p.textContent=u.searchPrompt;results.append(p);const chips=suggestionChips();if(chips)results.append(chips);say('');return;}if(!searchItems){const p=document.createElement('p');p.textContent=u.searchLoading;results.append(p);loadSearch().then(()=>{if(dialog.open)renderResults();}).catch(()=>{const e=document.createElement('p');e.textContent=u.searchUnavailable;const retry=document.createElement('button');retry.type='button';retry.className='search-retry';retry.textContent=u.searchRetry||'Try again';retry.addEventListener('click',()=>renderResults());results.replaceChildren(e,retry);say(u.searchUnavailable);});say(u.searchLoading);return;}const normal=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();const query=normal(q);const tokens=query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);const terms=[...new Set(tokens)].filter(token=>token.length>1);if(!tokens.length){const p=document.createElement('p');p.textContent=u.searchPrompt;results.append(p);const chips=suggestionChips();if(chips)results.append(chips);say(u.searchPrompt);return;}const found0=searchItems.map(x=>{const title=normal(x.title),description=normal(x.description),other=normal((x.keywords||'')+' '+x.category);const haystack=title+' '+description+' '+other;const everyToken=tokens.length>1&&tokens.every(token=>haystack.includes(token));const score=!tokens.every(token=>haystack.includes(token))?99:title===query?0:title.startsWith(query)?1:title.includes(query)?2:everyToken?2.5:description.includes(query)?3:4;return {x,score};}).filter(i=>i.score<99).sort((a,b)=>a.score-b.score);const matches=found0.length;const found=found0.slice(0,searchShown).map(i=>i.x);if(!found.length){const p=document.createElement('p');p.textContent=u.searchEmpty;results.append(p);const hub=searchItems.filter(x=>x.hub);if(hub.length){const list=document.createElement('div');list.className='search-suggestions';for(const x of hub){const link=document.createElement('a');link.href=x.url;link.textContent=x.title;list.append(link);}results.append(list);}}for(const x of found){const a=document.createElement('a');a.href=x.url;const title=document.createElement('strong');highlight(title,x.title,terms);const desc=document.createElement('p'),summary=x.description||'',summaryFlat=foldText(summary).flat,snippet=terms.every(term=>summaryFlat.includes(term))?'':matchedSnippet(x.keywords||'',terms);if(snippet)desc.className='search-snippet';highlight(desc,snippet||summary,terms);a.append(title);if(x.category){const category=document.createElement('small');category.textContent=x.category;a.append(category);}a.append(desc);results.append(a);}const shown=found.length,extra=matches-shown;const statusText=shown?(u.searchCount||'{n}').replace('{n}',String(shown)):u.searchEmpty;const moreText=extra>0?(u.searchMore||'{n} more.').replace('{n}',String(extra)):'';say(moreText?statusText+' '+moreText:statusText);setSearchCount(shown?(extra>0?(u.searchCountOf||'{n} of {total} matches.').replace('{n}',String(shown)).replace('{total}',String(matches)):statusText):'');if(extra>0){const more=document.createElement('p');more.className='search-more';more.textContent=moreText+' ';const next=document.createElement('button');next.type='button';next.className='search-more-button';next.textContent=u.searchShowMore||'Show the next results';next.addEventListener('click',()=>{const firstNew=searchShown;searchShown+=12;renderResults();const links=resultLinks();const target=links[firstNew];if(target)target.focus();});more.append(next);results.append(more);}}search?.addEventListener('input',renderResults);let searchMemoryTimer;search?.addEventListener('input',()=>{clearTimeout(searchMemoryTimer);searchMemoryTimer=setTimeout(flushSearchMemory,400);});
let activeFilter='all';const toolSearch=$('#tool-search');const normalizeDirectorySearch=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();function filterTools(){const q=normalizeDirectorySearch((toolSearch?.value||'').trim());let count=0;$$('#tool-grid [data-tool]').forEach(card=>{const match=(activeFilter==='all'||(activeFilter==='saved'?saved.has(card.dataset.tool):card.dataset.category===activeFilter))&&normalizeDirectorySearch(card.dataset.search).includes(q);card.hidden=!match;if(match)count++;});if($('#result-count'))$('#result-count').textContent=count;const resultLabel=$('#result-label');if(resultLabel)resultLabel.textContent=count===1?resultLabel.dataset.one:resultLabel.dataset.many;if($('#empty-state')){const empty=$('#empty-state');empty.hidden=count!==0;const head=empty.querySelector('h2');if(head)head.textContent=activeFilter==='saved'&&saved.size===0?(empty.dataset.savedEmpty||empty.dataset.default||head.textContent):(empty.dataset.default||head.textContent);}$$('[data-filter]').forEach(b=>{const active=b.dataset.filter===activeFilter;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});}function updateUrl(){const params=new URLSearchParams();if(activeFilter!=='all')params.set('category',activeFilter);if(toolSearch?.value.trim())params.set('q',toolSearch.value.trim());history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():''));syncLanguageLinks();}function syncLanguageLinks(){const kept=['category','q','access'];const keep=[...new URLSearchParams(location.search)].filter(([k])=>kept.includes(k));$$('.language-switch a').forEach(a=>{const target=new URL(a.getAttribute('href'),location.origin);kept.forEach(k=>target.searchParams.delete(k));keep.forEach(([k,v])=>target.searchParams.set(k,v));a.setAttribute('href',target.pathname+target.search);});}function readFilters(){if(!$('#directory'))return;const p=new URLSearchParams(location.search),category=p.get('category');activeFilter=['chat','coding','creative','research','saved'].includes(category)?category:'all';if(toolSearch)toolSearch.value=p.get('q')||'';filterTools();syncLanguageLinks();}$$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.filter;filterTools();updateUrl();}));toolSearch?.addEventListener('input',()=>{filterTools();updateUrl();});$('#clear-filters')?.addEventListener('click',()=>{activeFilter='all';toolSearch.value='';filterTools();updateUrl();toolSearch.focus();});window.addEventListener('popstate',readFilters);readFilters();syncLanguageLinks();
// The documentation and model directories rewrite their own URL as the reader types
// or filters, so the language links are refreshed when the menu opens; otherwise a
// search on /docs/ would vanish the moment the reader switched language.
const languageSwitch=$('.language-switch');languageSwitch?.addEventListener('toggle',()=>{if(languageSwitch.open)syncLanguageLinks();});async function copyText(text){try{await navigator.clipboard.writeText(text);toast(u.copied);return true;}catch{toast(u.copyFailed);return false;}}$('#copy-toolkit')?.addEventListener('click',async()=>{const items=data.tools.filter(t=>saved.has(t.slug));if(!items.length){toast(u.copyEmpty);return;}const text=items.map(t=>`${t.name} — ${t.url}`).join('\n');if(!await copyText(text)){const wrap=$('#toolkit-output-wrap'),output=$('#toolkit-output');output.value=text;wrap.hidden=false;output.focus({preventScroll:true});output.select();wrap.scrollIntoView({block:'center',behavior:'instant'});}});$$('.copy-code').forEach(b=>b.addEventListener('click',async()=>{await copyText(b.parentElement.querySelector('code').textContent);}));})();

// Model-family filters use stable shareable URLs; the complete catalogue is in HTML.
(()=>{const root=document.querySelector('#model-directory');if(!root)return;const search=root.querySelector('#model-search'),cards=[...root.querySelectorAll('[data-model]')],buttons=[...root.querySelectorAll('[data-model-filter]')],count=root.querySelector('#model-result-count'),empty=root.querySelector('#model-empty');let access='all';const normalizeDirectorySearch=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();function filter(){const q=normalizeDirectorySearch(search.value.trim());let shown=0;for(const card of cards){const match=(access==='all'||card.dataset.access===access)&&normalizeDirectorySearch(card.dataset.search).includes(q);card.hidden=!match;if(match)shown++;}count.textContent=shown;const modelLabel=root.querySelector('#model-count-label');if(modelLabel)modelLabel.textContent=shown===1?modelLabel.dataset.one:modelLabel.dataset.many;empty.hidden=shown!==0;for(const b of buttons){const active=b.dataset.modelFilter===access;b.setAttribute('aria-pressed',String(active));b.classList.toggle('selected',active);}}function update(){const p=new URLSearchParams();if(access!=='all')p.set('access',access);if(search.value.trim())p.set('q',search.value.trim());history.replaceState(null,'',location.pathname+(p.size?'?'+p.toString():''));}function restore(){const p=new URLSearchParams(location.search),a=p.get('access');access=['hosted','hybrid','open-weights'].includes(a)?a:'all';search.value=p.get('q')||'';filter();}for(const b of buttons)b.addEventListener('click',()=>{access=b.dataset.modelFilter;filter();update();});search.addEventListener('input',()=>{filter();update();});root.querySelector('#clear-model-filters').addEventListener('click',()=>{access='all';search.value='';filter();update();search.focus();});window.addEventListener('popstate',restore);restore();})();

// Documentation search operates on the already-rendered guide index.
(()=>{const root=document.querySelector('.docs-home');if(!root)return;const search=root.querySelector('#doc-search'),items=[...root.querySelectorAll('[data-doc]')],groups=[...root.querySelectorAll('[data-doc-group]')],count=root.querySelector('#doc-count'),empty=root.querySelector('#doc-empty'),clear=root.querySelector('#doc-clear');const normal=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();function filter(){const q=normal(search.value.trim());let total=0;for(const item of items){const match=normal(item.dataset.search).includes(q);item.hidden=!match;if(match)total++;}for(const group of groups){const n=group.querySelectorAll('[data-doc]:not([hidden])').length;group.hidden=n===0;group.querySelector('.docs-topic-count').textContent=n+' '+(n===1?(root.dataset.countLabelOne||root.dataset.countLabel):root.dataset.countLabel);const link=root.querySelector(`.docs-topics a[href="#${group.id}"]`);if(link)link.hidden=n===0;}count.textContent=total+' '+(total===1?(root.dataset.countLabelOne||root.dataset.countLabel):root.dataset.countLabel);empty.hidden=total!==0;}function syncUrl(){try{const p=new URLSearchParams(location.search);if(search.value.trim())p.set('q',search.value.trim());else p.delete('q');history.replaceState(null,'',location.pathname+(p.toString()?'?'+p.toString():''));}catch{}}search.addEventListener('input',()=>{filter();syncUrl();});clear.addEventListener('click',()=>{search.value='';filter();syncUrl();search.focus();});const initial=new URLSearchParams(location.search).get('q');if(initial){search.value=initial;filter();}})();
// A reader on a long guide should be able to glance at the contents list and see
// where they are. The current section is the last heading that has passed under
// the sticky header; at the very bottom the final section wins, so a short last
// section still highlights instead of leaving the previous one marked.
(()=>{
  const links=[...document.querySelectorAll('.toc > a[href^="#"], .guide-toc nav a[href^="#"]')];
  if(!links.length)return;
  const sections=[...new Set(links.map(a=>document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean))];
  if(!sections.length)return;
  const header=document.querySelector('.header');
  const sync=()=>{
    const offset=(header?header.getBoundingClientRect().height:0)+24;
    let current=sections[0];
    if(Math.ceil(scrollY+innerHeight)>=document.documentElement.scrollHeight-2)current=sections[sections.length-1];
    else for(const s of sections)if(s.getBoundingClientRect().top-offset<=1)current=s;
    for(const a of links){
      if(a.getAttribute('href')==='#'+current.id)a.setAttribute('aria-current','true');
      else a.removeAttribute('aria-current');
    }
  };
  // Reading a few positions is cheap next to a layout the browser already did for
  // this scroll, and running directly keeps the mark correct even when animation
  // frames are throttled (background tabs, some headless runs).
  let last=null;
  addEventListener('scroll',()=>{const y=Math.round(scrollY);if(y===last)return;last=y;sync();},{passive:true});
  addEventListener('resize',sync);
  // Choosing a section on a phone closes the picker instead of leaving it open
  // above the reader. A keyboard reader also needs the cursor to follow the jump,
  // so the heading takes focus and wears the same ring as any other target.
  for(const a of links){
    a.addEventListener('click',e=>{
      const target=document.getElementById(a.getAttribute('href').slice(1));
      if(!target)return;
      const picker=a.closest('.guide-toc');
      if(picker)picker.open=false;
      if(e.detail!==0)return;
      // Keyboard: take the jump over so the position and the cursor agree. Left to
      // the browser, the page scrolls while focus stays on a link that has left the
      // screen, and the pending scroll is cancelled the moment the heading is focused.
      e.preventDefault();
      const heading=target.matches('h1,h2,h3')?target:target.querySelector('h1,h2,h3')||target;
      if(!heading.hasAttribute('tabindex'))heading.setAttribute('tabindex','-1');
      history.pushState(null,'','#'+target.id);
      heading.focus({preventScroll:true});
      target.scrollIntoView({block:'start'});
    });
  }
  sync();
})();
// A command wider than a phone screen scrolls inside its own box. Without a tab
// stop that box cannot be reached from the keyboard, so the end of the line stays
// unreadable even though it is on the page. Only overflowing blocks get a tab stop,
// and the label explains why focus landed there.
(()=>{
  const blocks=[...document.querySelectorAll('.code-block pre')];
  if(!blocks.length)return;
  const label=(document.querySelector('#page-data')?JSON.parse(document.querySelector('#page-data').textContent).ui.codeScroll:'')||'Code sample';
  const mark=()=>{
    for(const pre of blocks){
      const over=pre.scrollWidth>pre.clientWidth+1;
      if(over&&!pre.hasAttribute('tabindex')){pre.setAttribute('tabindex','0');pre.setAttribute('role','region');pre.setAttribute('aria-label',label);}
      else if(!over&&pre.dataset.autoScroll){pre.removeAttribute('tabindex');pre.removeAttribute('role');pre.removeAttribute('aria-label');}
      if(over)pre.dataset.autoScroll='1';
    }
  };
  mark();
  addEventListener('resize',mark);
})();
