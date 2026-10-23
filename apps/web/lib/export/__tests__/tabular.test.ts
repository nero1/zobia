import {createDelimitedStream,escapeDelimitedValue} from '../tabular';
it.each(['=HYPERLINK("https://bad")','+cmd','-cmd','@SUM(A1)','  =1','\t=1'])('neutralizes formula text %s',value=>{
  expect(escapeDelimitedValue(value,',').replace(/^"/,'').startsWith("'")).toBe(true);
});
it('preserves numeric cells and RFC quoting',()=>{
  expect(escapeDelimitedValue(-42,',')).toBe('-42');
  expect(escapeDelimitedValue('a,"b"',',')).toBe('"a,""b"""');
});
it('applies backpressure and stops writes when the consumer cancels',async()=>{
  const stream=createDelimitedStream(',');
  const reader=stream.toReadableStream().getReader();
  await stream.writeRow(['x'.repeat(70_000)]);
  let settled=false;
  const pending=stream.writeRow(['y'.repeat(70_000)]).then(()=>{settled=true;},()=>{settled=true;});
  await Promise.resolve();expect(settled).toBe(false);
  await reader.cancel();await pending;expect(settled).toBe(true);
  await expect(stream.writeRow(['after cancel'])).rejects.toThrow();
});
