import {issueAdReceipt,verifyAdReceipt} from '../receipts';
describe('Ad billing proof',()=>{
  beforeAll(()=>{process.env.JWT_SECRET='test-receipt-key-with-at-least-32-characters';});
  it('binds one unforgeable serve to its viewer, creative and placement',()=>{
    const receipt=issueAdReceipt('alice','creative','feed');
    expect(verifyAdReceipt(receipt,'alice','creative','feed')).not.toBeNull();
    expect(verifyAdReceipt(receipt,'bob','creative','feed')).toBeNull();
    expect(verifyAdReceipt(receipt,'alice','other','feed')).toBeNull();
    expect(verifyAdReceipt(receipt,'alice','creative','sidebar')).toBeNull();
    const [body,mac]=receipt.split('.');const modified=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url').toString()),userId:'bob'})).toString('base64url');
    expect(verifyAdReceipt(`${modified}.${mac}`,'bob','creative','feed')).toBeNull();
  });
  it('expires and produces unique billing identities',()=>{
    jest.spyOn(Date,'now').mockReturnValue(1000);
    const a=issueAdReceipt('alice','creative','feed'),b=issueAdReceipt('alice','creative','feed');
    expect(a).not.toBe(b);
    jest.spyOn(Date,'now').mockReturnValue(1000+24*60*60_000);
    expect(verifyAdReceipt(a,'alice','creative','feed')).toBeNull();
    jest.restoreAllMocks();
  });
});
