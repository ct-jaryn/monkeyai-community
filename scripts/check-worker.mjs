import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../deploy/cloudflare-workers/worker.js';

// The Worker in front of the static assets is the only part of this site that runs
// per request. Its redirects, the 403 for dotfiles and the cache map are what a
// deploy relies on, so they are exercised here against the real module with a fake
// ASSETS binding instead of being reviewed by eye.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
let checks=0;
const check=(ok,label)=>{checks++;if(!ok)failures.push(label);};

const forwarded=[];
const assets=routes=>({
  async fetch(request){
    const url=new URL(request.url);
    forwarded.push(url.pathname+url.search);
    const hit=routes[url.pathname];
    if(!hit)return new Response('<html>gone</html>',{status:404,headers:{'Content-Type':'text/html'}});
    return new Response(hit.body===undefined?'ok':hit.body,{status:hit.status||200,headers:hit.headers||{'Content-Type':'text/html'}});
  },
});
const request_=(url,routes={})=>worker.fetch(new Request(url,{redirect:'manual'}),{ASSETS:assets(routes)},{waitUntil(){}});

const SECURITY={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"frame-ancestors 'none'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
};
const missingSecurity=res=>Object.entries(SECURITY).filter(([k,v])=>res.headers.get(k)!==v).map(([k])=>k);

// 1. Plain http and the www host go to the apex over https, keeping path and query.
for(const [from,to] of [
  ['http://monkeyai.online/tools/?q=docker',  'https://monkeyai.online/tools/?q=docker'],
  ['https://www.monkeyai.online/docs/',       'https://monkeyai.online/docs/'],
  ['http://www.monkeyai.online/zh/models/',   'https://monkeyai.online/zh/models/'],
]){
  const res=await request_(from);
  check(res.status===301,from+' answers '+res.status+' instead of a 301');
  check(res.headers.get('Location')===to,from+' redirects to '+res.headers.get('Location')+' instead of '+to);
  const missing=missingSecurity(res);
  check(missing.length===0,from+': the redirect drops '+missing.join(', '));
}

// 2. Dotfiles are refused, and the refusal is a page rather than an empty body.
for(const p of ['/.git/config','/.env','/.well-known/hidden']){
  const res=await request_('https://monkeyai.online'+p);
  check(res.status===403,'https://monkeyai.online'+p+' answers '+res.status+' instead of 403');
  check(res.headers.get('Content-Type')==='text/html; charset=utf-8','https://monkeyai.online'+p+' answers without a UTF-8 HTML type ('+res.headers.get('Content-Type')+')');
  check(missingSecurity(res).length===0,'https://monkeyai.online'+p+': the 403 drops '+missingSecurity(res).join(', '));
  check((await res.text()).includes('403'),'https://monkeyai.online'+p+' returns a 403 without saying so in the body');
}

// 3. The certificate renewal path must reach the origin rather than the assets.
{
  const realFetch=globalThis.fetch;
  let passedThrough=null;
  globalThis.fetch=async req=>{passedThrough=new URL(req.url).pathname;return new Response('token',{status:200});};
  const res=await request_('https://monkeyai.online/.well-known/acme-challenge/abc123');
  globalThis.fetch=realFetch;
  check(passedThrough==='/.well-known/acme-challenge/abc123','the ACME challenge is not passed through to the origin (saw '+passedThrough+')');
  check(res.status===200,'the ACME challenge answers '+res.status);
}

// 4. A missing page is a 404 that is never cached, and /404.html behaves the same.
for(const route of ['/no-such-page/','/404.html']){
  const res=await request_('https://monkeyai.online'+route,{'/__not-found__/':{status:200,body:'<html>gone</html>'}});
  check(res.status===404,route+' answers '+res.status+' instead of 404');
  check(res.headers.get('Cache-Control')==='no-store',route+': a missing page is cached as '+res.headers.get('Cache-Control'));
  check(res.headers.get('Content-Type')==='text/html; charset=utf-8',route+' answers without a UTF-8 HTML type ('+res.headers.get('Content-Type')+')');
  check((await res.text()).includes('gone'),route+' does not return the built 404 page');
}

// 5. The assets layer answers a directory without its slash with a temporary
// redirect; the Worker turns that into the permanent one search engines expect.
{
  forwarded.length=0;
  const res=await request_('https://monkeyai.online/tools?x=1',{'/tools':{status:307,headers:{Location:'/tools/?x=1'}}});
  check(res.status===301,'a directory without its slash answers '+res.status+' instead of 301');
  check(res.headers.get('Location')==='https://monkeyai.online/tools/?x=1','a directory redirect points at '+res.headers.get('Location'));
  check(missingSecurity(res).length===0,'the directory redirect drops '+missingSecurity(res).join(', '));
  forwarded.length=0;
  await request_('https://monkeyai.online/docs/getting-started/index.html',{});
  check(forwarded[0]==='/docs/getting-started/','index.html is fetched as '+forwarded[0]+' instead of the directory');
}

// 6. The cache map: images and fonts for a day, CSS/JS/text for four hours at the
// edge, pages not at all, and nothing cached when the page is missing.
for(const [route,headers,want] of [
  ['/brand/monkeyai-logo-256.webp',{'Content-Type':'image/webp'},'public, max-age=86400'],
  ['/fonts/manrope-latin.woff2',{'Content-Type':'font/woff2'},'public, max-age=86400'],
  ['/assets/app.1234abcd.js',{'Content-Type':'text/javascript'},'max-age=14400'],
  ['/robots.txt',{'Content-Type':'text/plain'},'max-age=14400'],
  ['/tools/',{'Content-Type':'text/html'},'no-cache'],
]){
  const res=await request_('https://monkeyai.online'+route,{[route]:{status:200,headers}});
  check(res.headers.get('Cache-Control')===want,route+': Cache-Control is '+res.headers.get('Cache-Control')+' instead of '+want);
}

// 7. Text keeps its charset, and JSON is not relabelled as text.
{
  const html=await request_('https://monkeyai.online/tools/',{'/tools/':{status:200,headers:{'Content-Type':'text/html'}}});
  check(html.headers.get('Content-Type')==='text/html; charset=utf-8','an HTML page answers '+html.headers.get('Content-Type'));
  const xml=await request_('https://monkeyai.online/sitemap.xml',{'/sitemap.xml':{status:200,headers:{'Content-Type':'application/xml'}}});
  check(xml.headers.get('Content-Type')==='text/xml; charset=utf-8','the sitemap answers '+xml.headers.get('Content-Type'));
}

// 8. A preview host is readable but must never be indexed.
{
  const res=await request_('https://monkeyai-community.workers.dev/tools/',{'/tools/':{status:200,headers:{'Content-Type':'text/html'}}});
  check(res.status===200,'the workers.dev host answers '+res.status+' instead of serving the page');
  check(res.headers.get('X-Robots-Tag')==='noindex','the workers.dev host answers without X-Robots-Tag: noindex');
  const apex=await request_('https://monkeyai.online/tools/',{'/tools/':{status:200,headers:{'Content-Type':'text/html'}}});
  check(apex.headers.get('X-Robots-Tag')===null,'the live host sends X-Robots-Tag, which would keep the site out of search');
}

if(failures.length){
  console.log(JSON.stringify({status:'failed',checks,failures},null,2));
  process.exit(1);
}
console.log(JSON.stringify({status:'passed',checks},null,2));
