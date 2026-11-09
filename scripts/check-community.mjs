import fs from 'node:fs';
import assert from 'node:assert/strict';

const config = JSON.parse(fs.readFileSync('site.config.json', 'utf8'));
const repo = config.communityRepo;
assert.match(repo, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
const toolForm = `${repo}/issues/new?template=tool-suggestion.yml`;
const bugForm = `${repo}/issues/new?template=bug-report.yml`;
for (const prefix of ['', 'zh/', 'es/']) {
  const community = fs.readFileSync(`dist/${prefix}community/index.html`, 'utf8');
  const directory = fs.readFileSync(`dist/${prefix}tools/index.html`, 'utf8');
  const home = fs.readFileSync(`dist/${prefix}index.html`, 'utf8');
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
console.log('Community contribution links and files passed for English, Chinese and Spanish.');
