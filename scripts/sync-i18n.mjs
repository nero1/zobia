import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const canonical = new URL('shared/i18n/locales/', root);
const web = new URL('apps/web/lib/i18n/locales/', root);
let failures = 0;
for (const file of fs.readdirSync(canonical).filter(name => name.endsWith('.json'))) {
  const text = fs.readFileSync(new URL(file, canonical), 'utf8');
  JSON.parse(text);
  const target = new URL(file, web);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) {
      console.error(`${file}: web catalog differs from shared catalog`); failures++;
    }
  } else fs.writeFileSync(target, text);
}
if (failures) process.exitCode = 1;
else console.log(process.argv.includes('--check') ? 'Web and Capacitor catalogs match.' : 'Web catalogs synchronized from shared catalogs.');
