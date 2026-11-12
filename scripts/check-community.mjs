import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {communityUi} from '../src/community-ui.mjs';
import {ui} from '../src/i18n.mjs';

const config = JSON.parse(fs.readFileSync('site.config.json', 'utf8'));
const tools = JSON.parse(fs.readFileSync('src/data/tools.json', 'utf8'));
const sponsorTerms = 'https://globalaiproductindex.com/sponsors/#express-listing';
const listingKeys = ['listingTitle','listingLead','listingLinkLabel','listingTermsNote','listingEmailNote','listingMailLink','listingMailSubject','listingMailBody','correctionMailSubject','correctionMailBody','listingRulesLink','listingDirectoryNote','purposeTitle','limitsTitle','limitsUnknown','recordTitle','recordText','visitorText','sponsorRecordText','liabilityText','sponsoredBadge'];
assert.equal(config.contactEmail, 'contact@monkeyai.online');
const pointCount = communityUi.en.listingPoints.length;
assert.equal(pointCount, 7);
for (const l of ['en','zh','es']) {
  assert.equal(communityUi[l].listingPoints.length, pointCount, `${l} listing points drifted`);
  for (const key of listingKeys) assert.equal(typeof communityUi[l][key], 'string', `${l} missing ${key}`);
  const joined = communityUi[l].listingPoints.join('\n');
  assert.match(joined, /7/);
  assert.match(joined, /15/);
  assert.match(joined, /30/);
  assert.doesNotMatch(joined, /@/);
  assert.match(joined, /small compan|小公司|empresas? pequeñas?/);
  assert.match(joined, /large or well-known|大型或知名|grandes? o conocidas?/);
  assert.match(joined, /no fixed date|没有固定日期|sin fecha fija/);
  assert.match(joined, /no guarantee of approval|也不保证通过|sin garantía de aprobación/);
  assert.match(joined, /may also be listed on our related sister directories|可能会被列入我们的相关姐妹目录|puede figurar también en nuestros directorios hermanos relacionados/);
  assert.doesNotMatch(joined, /will also be listed|will be listed on our|一定会被列入|将被列入我们的相关|se incluirá en nuestros|se publicará en nuestros/);
  assert.match(communityUi[l].listingDirectoryNote, /small compan|小公司|empresas pequeñas/);
  assert.match(communityUi[l].listingMailBody, /may also be listed on our related sister directories|可能会被列入我们的相关姐妹目录|puede figurar también en nuestros directorios hermanos relacionados/);
  assert.match(communityUi[l].listingMailBody, /mailto:|\$7|7 美元|7 USD|Express/);
}
const repo = config.communityRepo;
assert.match(repo, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
const toolForm = `${repo}/issues/new?template=tool-suggestion.yml`;
const bugForm = `${repo}/issues/new?template=bug-report.yml`;
for (const [prefix, lang] of [['', 'en'], ['zh/', 'zh'], ['es/', 'es']]) {
  const community = fs.readFileSync(`dist/${prefix}community/index.html`, 'utf8');
  const about = fs.readFileSync(`dist/${prefix}about/index.html`, 'utf8');
  const directory = fs.readFileSync(`dist/${prefix}tools/index.html`, 'utf8');
  const home = fs.readFileSync(`dist/${prefix}index.html`, 'utf8');
  const copy = communityUi[lang];
  for (const page of [community, about]) {
    assert.ok(page.includes('id="listing-rules"'), `${prefix || 'en/'} listing rules missing`);
    assert.ok(page.includes(`href="${sponsorTerms}"`), `${prefix || 'en/'} sponsor terms link missing`);
    assert.ok(page.includes(copy.listingEmailNote), `${prefix || 'en/'} email note missing`);
    assert.ok(page.includes(`mailto:${config.contactEmail}?subject=`), `${prefix || 'en/'} mailto draft missing`);
    assert.ok(page.includes(encodeURIComponent(copy.listingMailSubject)), `${prefix || 'en/'} mailto subject missing`);
    assert.ok(!page.includes('mail.grokbot.com'), `${prefix || 'en/'} private forward address leaked`);
    assert.ok(!/It is not a way to apply|不是投稿入口|No sirve para solicitar/.test(page), `${prefix || 'en/'} still says email cannot apply`);
    assert.ok(!page.includes('<form'), `${prefix || 'en/'} unexpected listing form`);
    for (const point of copy.listingPoints) assert.ok(page.includes(point), `${prefix || 'en/'} missing a listing rule`);
  }
  assert.ok(directory.includes(`href="${sponsorTerms}"`) === false, `${prefix || 'en/'} directory should point at the community rules, not duplicate a payment page`);
  assert.ok(directory.includes('href="/community/#listing-rules"') || directory.includes(`href="/${prefix}community/#listing-rules"`), `${prefix || 'en/'} directory missing listing rules link`);
  assert.ok(directory.includes(copy.listingDirectoryNote), `${prefix || 'en/'} directory missing queue note`);
  assert.ok(home.includes('#listing-rules'), `${prefix || 'en/'} home missing listing rules link`);
  const orkas = fs.readFileSync(`dist/${prefix}tools/orkas/index.html`, 'utf8');
  assert.ok(orkas.includes('<h1>Orkas</h1>'), `${prefix || 'en/'} Orkas heading missing`);
  assert.ok(orkas.includes('id="known-limits"'), `${prefix || 'en/'} Orkas limits section missing`);
  for (const tool of tools) {
    const detail = fs.readFileSync(`dist/${prefix}tools/${tool.slug}/index.html`, 'utf8');
    const tr = tool[lang];
    assert.ok(detail.includes(tr.description), `${prefix || 'en/'}${tool.slug} purpose missing`);
    assert.ok(detail.includes(tr.caveat || copy.limitsUnknown), `${prefix || 'en/'}${tool.slug} known limits missing`);
    assert.ok(detail.includes(copy.recordText), `${prefix || 'en/'}${tool.slug} third-party notice missing`);
    assert.ok(detail.includes(copy.visitorText), `${prefix || 'en/'}${tool.slug} visitor notice missing`);
    assert.ok(detail.includes(copy.liabilityText), `${prefix || 'en/'}${tool.slug} liability notice missing`);
    assert.ok(detail.includes(`rel="${tool.sponsored ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}"`), `${prefix || 'en/'}${tool.slug} visit link rel mismatch`);
    if (!tool.sponsored) assert.ok(!detail.includes('class="sponsor-flag"'), `${prefix || 'en/'}${tool.slug} is labelled sponsored without a sponsorship record`);
  }
  for (const link of [`${repo}/pulls`, `${repo}/blob/main/CONTRIBUTING.md`, `${config.upstream}/issues`]) {
    assert.ok(community.includes(`href="${link.replaceAll('&', '&amp;')}"`), `${prefix || 'en/'}community missing ${link}`);
  }
  assert.ok(directory.includes(`mailto:${config.contactEmail}?subject=`), `${prefix || 'en/'}tools missing mailto draft`);
  assert.ok(directory.includes(encodeURIComponent(copy.listingMailSubject)), `${prefix || 'en/'}tools missing the suggestion subject`);
  const suggestionSubject = encodeURIComponent(copy.listingMailSubject);
  const correctionSubject = encodeURIComponent(copy.correctionMailSubject);
  const visitorIntake = [community, about, ...tools.map(tool => fs.readFileSync(`dist/${prefix}tools/${tool.slug}/index.html`, 'utf8'))];
  for (const page of visitorIntake) {
    assert.ok(!page.includes(toolForm), `${prefix || 'en/'} still links visitors to the GitHub suggestion form`);
    assert.ok(!page.includes(bugForm), `${prefix || 'en/'} still links visitors to the GitHub bug form`);
    assert.ok(page.includes(`mailto:${config.contactEmail}?subject=${suggestionSubject}`), `${prefix || 'en/'} missing the public suggestion draft`);
    assert.ok(page.includes(`mailto:${config.contactEmail}?subject=${correctionSubject}`), `${prefix || 'en/'} missing the public correction draft`);
  }
  assert.ok(!community.includes('listingGithubNote') && !/Prefer GitHub\?|更习惯用 GitHub|¿Prefieres GitHub/.test(community), `${prefix || 'en/'} community still offers a GitHub suggestion route`);
  assert.ok(home.includes(`href="${repo}"`), `${prefix || 'en/'}home missing community repository`);
  // A public issue is the wrong place for a vulnerability or a conduct concern; the
  // page must point at the private routes instead of letting people guess.
  for (const link of [`${repo}/security/advisories/new`, `${repo}/blob/main/CODE_OF_CONDUCT.md`]) {
    assert.ok(community.includes(`href="${link}"`), `${prefix || 'en/'}community missing ${link}`);
  }
}
// Visitor pages may name the public upstream product tracker. They must not
// offer a GitHub issue form for a tool suggestion, a recommendation, contact, or a correction.
function collectHtml(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(full, found);
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}
const allowedIssueHref = `${config.upstream}/issues`;
for (const file of collectHtml('dist')) {
  const html = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(html, /template=tool-suggestion\.yml|template=bug-report\.yml/, `${file} still links a visitor to a GitHub issue form`);
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/github\.com\/[^/"']+\/[^/"']+\/issues/.test(href)) {
      assert.equal(href, allowedIssueHref, `${file} has a visitor GitHub issue link: ${href}`);
    }
  }
}
for (const file of ['.github/ISSUE_TEMPLATE/tool-suggestion.yml', '.github/ISSUE_TEMPLATE/bug-report.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) {
  assert.ok(fs.existsSync(file), `missing contribution file ${file}`);
}
const contributing = fs.readFileSync('CONTRIBUTING.md', 'utf8');
const suggestion = fs.readFileSync('.github/ISSUE_TEMPLATE/tool-suggestion.yml', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
for (const [name, text] of [['CONTRIBUTING.md', contributing], ['tool-suggestion.yml', suggestion], ['README.md', readme]]) {
  assert.ok(text.includes(sponsorTerms), `${name} missing sponsor terms`);
  assert.ok(text.includes('$7') || text.includes('7 美元') || text.includes('7 USD'), `${name} missing Express price`);
  assert.ok(text.includes('$15') || text.includes('15 美元') || text.includes('15 USD'), `${name} missing home-feature price`);
  assert.ok(/do not claim to remove legal responsibility|并不声称能绝对免除法律责任|no pretenden eliminar la responsabilidad legal|no eliminan la responsabilidad legal/.test(text), `${name} missing liability limit`);
  assert.ok(text.includes(config.contactEmail), `${name} missing public contact address`);
  assert.ok(/prepares a draft|只准备一封草稿|solo prepara un borrador/.test(text), `${name} missing draft notice`);
  assert.ok(!/It is not a way to apply|不是投稿入口|no es una solicitud/.test(text), `${name} still says email cannot apply`);
  assert.ok(!/<form/i.test(text), `${name} adds a form`);
  assert.match(text, /small compan|小公司|empresas pequeñas/);
  assert.match(text, /may also be listed on our related sister directories|可能会被列入我们的相关姐妹目录|directorios hermanos relacionados/);
  assert.doesNotMatch(text, /Only an AI tool can join the free review queue|只有 AI 工具可以免费排队审核|Solo una herramienta de IA puede entrar en la cola de revisión gratuita|Solo las herramientas de IA entran en la cola gratuita/);
  assert.doesNotMatch(text, /will also be listed|will be listed on our|一定会被列入|将被列入我们的相关|se incluirá en nuestros|se publicará en nuestros/);
}
for (const [lang, pattern] of [['en', /small companies, startups and independent developers/], ['zh', /小公司、初创团队和独立开发者/], ['es', /empresas pequeñas, startups y desarrolladores independientes/]]) {
  assert.match(ui[lang].answer3, pattern, `${lang} FAQ still uses the old free-review rule`);
  assert.match(ui[lang].answer3, /\$7|7 美元|7 USD/);
  assert.match(ui[lang].answer3, /\$15|15 美元|15 USD/);
}
const contributingGuide = JSON.parse(fs.readFileSync('src/data/guides.json', 'utf8')).find(guide => guide.slug === 'contributing');
assert.match(contributingGuide.en.sections[0].paragraphs[0], /small companies, startups and independent developers/);
assert.match(contributingGuide.zh.sections[0].paragraphs[0], /小公司、初创团队和独立开发者/);
assert.match(contributingGuide.es.sections[0].paragraphs[0], /empresas pequeñas, startups y desarrolladores independientes/);
assert.match(contributingGuide.en.sections[0].paragraphs[0], /may also be listed on our related sister directories/);
assert.match(contributingGuide.zh.sections[0].paragraphs[0], /可能会被列入我们的相关姐妹目录/);
assert.match(contributingGuide.es.sections[0].paragraphs[0], /puede figurar también en nuestros directorios hermanos relacionados/);
assert.ok(contributing.includes('并不声称能绝对免除法律责任') && contributing.includes('no pretenden eliminar la responsabilidad legal'), 'CONTRIBUTING.md is missing a language');
assert.ok(contributing.includes(toolForm), 'CONTRIBUTING.md dropped the repository suggestion issue');
assert.ok(contributing.includes(`${repo}/pulls`) || contributing.includes('pull request'), 'CONTRIBUTING.md dropped pull requests');
assert.ok(readme.includes('并不声称能绝对免除法律责任') && readme.includes('no eliminan la responsabilidad legal'), 'README.md is missing a language');
assert.match(suggestion, /id: eligibility/);
assert.doesNotMatch(suggestion, /type: textarea\n\s+id: email|id: email/);
console.log('Community contribution links and files passed for English, Chinese and Spanish.');
