import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../deploy/cloudflare-workers/worker.js';

// Two layers answer a request: the Worker for everything run_worker_first keeps, and
// the static-assets layer with its `_headers` file for everything it skips. Caching
// is decided independently in both places, so a change to one easily leaves the other
// behind — a logo then revalidates on every view while its twin one directory over is
// cached for a day. This check asks each layer for the same file and compares the two
// answers with what worker.js itself intends.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const failures=[];
let checks=0;
const check=(ok,label)=>{checks++;if(!ok)failures.push(label);};

if(!fs.existsSync(dist)){console.error('Deploy checks need a build: run npm run build first.');process.exit(1);}

const glob=pattern=>new RegExp('^'+pattern.replace(/[.+^$(){}|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$');
const matches=(patterns,pathname)=>patterns.some(p=>glob(p).test(pathname));

// run_worker_first: the Worker runs for `/*`, minus every listed negation.
const wrangler=JSON.parse(fs.readFileSync(path.join(root,'deploy/cloudflare-workers/wrangler.jsonc'),'utf8').replace(/^\s*\/\/.*$/gm,''));
const rules=wrangler.assets.run_worker_first;
const negations=rules.filter(r=>r.startsWith('!')).map(r=>r.slice(1));
const workerRuns=pathname=>matches(rules.filter(r=>!r.startsWith('!')),pathname)&&!matches(negations,pathname);

// _headers: blocks of `pattern` followed by `Name: value` or `! Name` (unset).
const headerBlocks=[];
for(const block of fs.readFileSync(path.join(root,'deploy/cloudflare-workers/_headers'),'utf8').split(/\n\s*\n/)){
  const lines=block.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  if(!lines.length)continue;
  const entry={pattern:lines[0],set:{},unset:[]};
  for(const line of lines.slice(1)){
    if(line.startsWith('!')){entry.unset.push(line.slice(1).trim());continue;}
    const at=line.indexOf(':');
    if(at>0)entry.set[line.slice(0,at).trim()]=line.slice(at+1).trim();
  }
  headerBlocks.push(entry);
}
const headerValue=(pathname,name)=>{
  let value=null;
  for(const block of headerBlocks){
    if(!glob(block.pattern).test(pathname))continue;
    if(block.unset.includes(name))value=null;
    if(name in block.set)value=block.set[name];
  }
  return value;
};

const MIME={html:'text/html',png:'image/png',svg:'image/svg+xml',webp:'image/webp',avif:'image/avif',woff2:'font/woff2',ttf:'font/ttf',css:'text/css',js:'text/javascript',txt:'text/plain',json:'application/json',xml:'application/xml'};
const files=[];
(function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else files.push('/'+path.relative(dist,full).split(path.sep).join('/'));
  }
})(dist);
const representative=new Map();
for(const file of files){
  const ext=path.extname(file).slice(1);
  if(!MIME[ext])continue;
  if(!representative.has(ext))representative.set(ext,file);
}

// What the Worker says it wants for this exact file, when it is the one answering.
const workerCache=async(file,ext)=>{
  const res=await worker.fetch(new Request('https://monkeyai.online'+file,{redirect:'manual'}),{ASSETS:{async fetch(){return new Response('x',{status:200,headers:{'Content-Type':MIME[ext]}});}}},{waitUntil(){}});
  return res.headers.get('Cache-Control');
};

// A page is the one type where the assets layer answers with its own default, so the
// comparison starts there rather than at a file name the Worker redirects.
representative.set('html','/');
for(const [ext,file] of representative){
  const wanted=await workerCache(file,ext);
  if(file.startsWith('/assets/')){
    // Hashed build assets are the documented exception: `_headers` keeps them for a
    // year, which is only safe while the name really carries the hash.
    const value=headerValue(file,'Cache-Control');
    check(value==='public, max-age=31536000, immutable',file+' is cached as '+value+' instead of a year as immutable');
    check(/\.[0-9a-f]{8,}\./.test(path.basename(file)),file+' is cached for a year as immutable but its name carries no content hash');
    continue;
  }
  const served=workerRuns(file)?wanted:(headerValue(file,'Cache-Control')||'no-cache');
  check(served===wanted,file+' is served with Cache-Control: '+served+' while worker.js asks for '+wanted);
}

// The Worker's security headers are repeated in `_headers`; a request that skips the
// Worker must not lose one of them.
const workerHeaders=await worker.fetch(new Request('https://monkeyai.online/tools/',{redirect:'manual'}),{ASSETS:{async fetch(){return new Response('x',{status:200,headers:{'Content-Type':'text/html'}});}}},{waitUntil(){}});
for(const name of ['X-Content-Type-Options','Referrer-Policy','X-Frame-Options','Content-Security-Policy','Permissions-Policy'])
  check(headerValue('/tools/',name)===workerHeaders.headers.get(name),'the assets layer sends '+name+': '+headerValue('/tools/',name)+' while the Worker sends '+workerHeaders.headers.get(name));
check(headerValue('/tools/','X-Robots-Tag')===null,'the assets layer sets X-Robots-Tag on the live host, which would keep the site out of search');

if(failures.length){
  console.log(JSON.stringify({status:'failed',checks,failures},null,2));
  process.exit(1);
}
console.log(JSON.stringify({status:'passed',checks,types:[...representative.keys()].join(' ')} ,null,2));
