import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
function flatten(object, prefix = '') {
  return Object.fromEntries(Object.entries(object).flatMap(([key, value]) =>
    value && typeof value === 'object' ? Object.entries(flatten(value, `${prefix}${key}.`)) : [[`${prefix}${key}`, value]]));
}
const english = flatten(read('shared/i18n/locales/en.json'));
const placeholders = (text) => [...String(text).matchAll(/{{\s*([^}]+)\s*}}/g)].map((m) => m[1].trim()).sort().join('|');
const report = {};
for (const file of fs.readdirSync(new URL('shared/i18n/locales/', root)).filter((name) => name.endsWith('.json'))) {
  if (file === 'en.json') continue;
  const messages = flatten(read(`shared/i18n/locales/${file}`));
  report[path.basename(file, '.json')] = {
    missing: Object.keys(english).filter((key) => !(key in messages)),
    obsolete: Object.keys(messages).filter((key) => !(key in english)),
    placeholderMismatch: Object.keys(messages).filter((key) => key in english && placeholders(messages[key]) !== placeholders(english[key])),
    englishFallback: Object.keys(messages).filter((key) => messages[key] === english[key]),
  };
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else for (const [locale, result] of Object.entries(report)) console.log(`${locale}: ${result.missing.length} missing, ${result.obsolete.length} obsolete, ${result.placeholderMismatch.length} interpolation mismatches, ${result.englishFallback.length} identical to English (review required)`);
if (process.argv.includes('--check') && Object.values(report).some((r) => r.missing.length || r.placeholderMismatch.length)) process.exitCode = 1;
