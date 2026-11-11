import fs from 'node:fs';
import assert from 'node:assert/strict';
import {communityUi} from '../src/community-ui.mjs';

const config = JSON.parse(fs.readFileSync('site.config.json', 'utf8'));
const tools = JSON.parse(fs.readFileSync('src/data/tools.json', 'utf8'));
const sponsorTerms = 'https://globalaiproductindex.com/sponsors/#express-listing';
const listingKeys = ['listingTitle','listingLead','listingLinkLabel','listingTermsNote','listingEmailNote','listingRulesLink','listingDirectoryNote','purposeTitle','limitsTitle','limitsUnknown','recordTitle','recordText','visitorText','sponsorRecordText','liabilityText','sponsoredBadge'];
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
  for (const link of [toolForm, bugForm, `${repo}/pulls`, `${repo}/blob/main/CONTRIBUTING.md`, `${config.upstream}/issues`]) {
    assert.ok(community.includes(`href="${link.replaceAll('&', '&amp;')}"`), `${prefix || 'en/'}community missing ${link}`);
  }
  assert.ok(directory.includes(`href="${toolForm}"`), `${prefix || 'en/'}tools missing tool suggestion form`);
  assert.ok(home.includes(`href="${repo}"`), `${prefix || 'en/'}home missing community repository`);
  // A public issue is the wrong place for a vulnerability or a conduct concern; the
  // page must point at the private routes instead of letting people guess.
  for (const link of [`${repo}/security/advisories/new`, `${repo}/blob/main/CODE_OF_CONDUCT.md`]) {
    assert.ok(community.includes(`href="${link}"`), `${prefix || 'en/'}community missing ${link}`);
  }
}
for (const path of ['.github/ISSUE_TEMPLATE/tool-suggestion.yml', '.github/ISSUE_TEMPLATE/bug-report.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) {
  assert.ok(fs.existsSync(path), `missing contribution file ${path}`);
}
const contributing = fs.readFileSync('CONTRIBUTING.md', 'utf8');
const suggestion = fs.readFileSync('.github/ISSUE_TEMPLATE/tool-suggestion.yml', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
for (const [name, text] of [['CONTRIBUTING.md', contributing], ['tool-suggestion.yml', suggestion], ['README.md', readme]]) {
  assert.ok(text.includes(sponsorTerms), `${name} missing sponsor terms`);
  assert.ok(text.includes('$7') || text.includes('7 美元') || text.includes('7 USD'), `${name} missing Express price`);
  assert.ok(text.includes('$15') || text.includes('15 美元') || text.includes('15 USD'), `${name} missing home-feature price`);
  assert.ok(/do not claim to remove legal responsibility|并不声称能绝对免除法律责任|no pretenden eliminar la responsabilidad legal|no eliminan la responsabilidad legal/.test(text), `${name} missing liability limit`);
  assert.ok(/Email only supplements|邮件只补充个别审核通知|El correo solo complementa/.test(text), `${name} missing email limit`);
  assert.ok(!/<form/i.test(text), `${name} adds a form`);
}
assert.ok(contributing.includes('并不声称能绝对免除法律责任') && contributing.includes('no pretenden eliminar la responsabilidad legal'), 'CONTRIBUTING.md is missing a language');
assert.ok(readme.includes('并不声称能绝对免除法律责任') && readme.includes('no eliminan la responsabilidad legal'), 'README.md is missing a language');
assert.match(suggestion, /id: eligibility/);
assert.doesNotMatch(suggestion, /type: textarea\n\s+id: email|id: email/);
console.log('Community contribution links and files passed for English, Chinese and Spanish.');
