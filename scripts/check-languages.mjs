import fs from 'node:fs';

// The site promises the same guide in English, Chinese and Spanish. A section
// count mismatch or an untranslated paragraph means one language silently
// received less than the others, which is easy to miss by eye across 19 guides.
const files=['guides.json','model-selection-guide.json','docs-install.json','docs-model-integration.json','docs-mcp-faq.json','docs-client-usage.json'];
const guides=files.flatMap(f=>JSON.parse(fs.readFileSync('src/data/'+f,'utf8')));
const hasCJK=s=>/[\u4e00-\u9fff]/.test(s);
const hasLatinWord=s=>/[a-zA-Z]{4,}/.test(s);
const issues=[];
const error=(where,message)=>issues.push(where+': '+message);

for(const g of guides){
  if(!/^[a-z0-9-]+$/.test(g.slug||''))error('guides/'+g.slug,'slug must be lowercase words joined by hyphens');
  for(const l of ['zh','es']){
    const t=g[l],e=g.en;
    if(!t){error(g.slug,'missing language '+l);continue;}
    if(t.sections.length!==e.sections.length)error(g.slug+'/'+l,`${t.sections.length} sections, English has ${e.sections.length}`);
    e.sections.forEach((es,i)=>{
      const ts=t.sections[i];
      if(!ts){error(g.slug+'/'+l,'missing section '+(i+1)+' ('+es.heading+')');return;}
      if(!ts.heading)error(g.slug+'/'+l,'section '+(i+1)+' has no heading');
      const ep=(es.paragraphs||[]).length,tp=(ts.paragraphs||[]).length;
      if(ep!==tp)error(g.slug+'/'+l,`section ${i+1} has ${tp} paragraphs, English has ${ep}`);
      const eb=(es.bullets||[]).length,tb=(ts.bullets||[]).length;
      if(eb!==tb)error(g.slug+'/'+l,`section ${i+1} has ${tb} bullets, English has ${eb}`);
      (ts.paragraphs||[]).forEach((p,j)=>{
        if(p===(es.paragraphs||[])[j])error(g.slug+'/'+l,`section ${i+1} paragraph ${j+1} is still English`);
        if(l==='zh'&&!hasCJK(p)&&hasLatinWord(p))error(g.slug+'/zh',`section ${i+1} paragraph ${j+1} contains no Chinese text`);
      });
      (ts.bullets||[]).forEach((b,j)=>{
        if(b===(es.bullets||[])[j])error(g.slug+'/'+l,`section ${i+1} bullet ${j+1} is still English`);
      });
    });
  }
}

if(issues.length){
  console.error('Language consistency failed:\n'+issues.map(i=>'- '+i).join('\n'));
  process.exit(1);
}
console.log(`Language consistency passed for ${guides.length} guides in English, Chinese and Spanish.`);
