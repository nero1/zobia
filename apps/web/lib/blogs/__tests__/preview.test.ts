import {paywallPreview} from '../preview';
describe('paywall previews',()=>{
  it.each([0,1,4,5,20,99,100,499,1000])('does not disclose the full %i-word article',length=>{
    const words=Array.from({length},(_,n)=>`word${n}`);
    const result=paywallPreview(words.join(' '));
    expect(result.wordCount).toBe(Math.min(100,Math.floor(length*.2)));
    if(length)expect(result.text).not.toBe(words.join(' '));
  });
});
