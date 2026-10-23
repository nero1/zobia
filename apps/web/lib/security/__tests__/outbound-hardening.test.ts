import {isPublicAddress} from '../ssrf';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const sanitizeSvg=(input:string):string=>execFileSync(process.execPath,[require.resolve('tsx/cli'),'-e',`import {sanitizeSvg} from './lib/uploads/sanitizeSvg'; process.stdout.write(sanitizeSvg(${JSON.stringify(input)}));`],{cwd:path.resolve(__dirname,'../../..'),encoding:'utf8'});
describe('Outbound and SVG boundaries',()=>{
 it.each(['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','192.168.0.1','0.0.0.0','224.1.2.3','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])('rejects non-public address %s',address=>expect(isPublicAddress(address)).toBe(false));
 it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('allows public address %s',address=>expect(isPublicAddress(address)).toBe(true));
 it('preserves SVG viewBox and gradients while rejecting external and escaped CSS references',()=>{
  const result=sanitizeSvg('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><path fill="url(#g)" d="M0 0"/><path fill="url(https://evil.invalid/x)"/><path stroke="u\\72l(https://evil.invalid/x)"/><script>alert(1)</script><foreignObject>bad</foreignObject></svg>');
  expect(result).toContain('viewBox="0 0 10 10"');expect(result).toContain('linearGradient');expect(result).toContain('fill="url(#g)"');expect(result).not.toMatch(/evil|script|foreignObject|\\72/);
 });
});
