/** Route-boundary contracts: verified events are durable before acknowledgement. */
import {NextRequest} from 'next/server';
jest.mock('@/lib/payments/paystack',()=>({verifyWebhookSignature:jest.fn()}));
jest.mock('@/lib/payments/webhookInbox',()=>({receivePaystackEvent:jest.fn(),processInboxEvent:jest.fn()}));
jest.mock('@/lib/logger',()=>({logger:{error:jest.fn()}}));
import {verifyWebhookSignature} from '@/lib/payments/paystack';
import {receivePaystackEvent,processInboxEvent} from '@/lib/payments/webhookInbox';
import {POST} from '../paystack/route';
const verify=jest.mocked(verifyWebhookSignature),receive=jest.mocked(receivePaystackEvent),processEvent=jest.mocked(processInboxEvent);
const event={event:'charge.success',data:{reference:'fixture',amount:500000,currency:'NGN'}};
function request(raw=JSON.stringify(event),headers:Record<string,string>={}){return new NextRequest('http://localhost/api/economy/webhooks/paystack',{method:'POST',headers:{'content-type':'application/json','x-paystack-signature':'fixture-signature',...headers},body:raw});}
beforeEach(()=>{jest.clearAllMocks();verify.mockReturnValue(true);receive.mockResolvedValue('inbox-fixture');processEvent.mockResolvedValue(true);});
it('rejects invalid signatures without storing or processing events',async()=>{verify.mockReturnValue(false);expect((await POST(request())).status).toBe(401);expect(receive).not.toHaveBeenCalled();expect(processEvent).not.toHaveBeenCalled();});
it('verifies the exact bytes and stores the raw event before processing',async()=>{const raw=JSON.stringify(event,null,2);processEvent.mockImplementation(async()=>{expect(receive).toHaveBeenCalledWith({event:'charge.success'},raw);return true;});expect((await POST(request(raw))).status).toBe(200);expect(verify).toHaveBeenCalledWith(Buffer.from(raw),'fixture-signature');expect(processEvent).toHaveBeenCalledWith('inbox-fixture');});
it('acknowledges durable events when inline fulfillment fails so the inbox can retry',async()=>{processEvent.mockRejectedValueOnce(Error('Temporary database error'));expect((await POST(request())).status).toBe(200);expect(receive).toHaveBeenCalledTimes(1);});
it('does not acknowledge an event that could not be durably stored',async()=>{receive.mockRejectedValueOnce(Error('Database offline'));expect((await POST(request())).status).toBe(503);expect(processEvent).not.toHaveBeenCalled();});
it('acknowledges an already processed inbox event without requiring a second fulfillment',async()=>{processEvent.mockResolvedValueOnce(false);expect((await POST(request())).status).toBe(200);});
it.each(['{',JSON.stringify(null),JSON.stringify({event:'charge.success',data:[]}),JSON.stringify({event:42,data:{}})])('rejects invalid signed JSON/envelopes: %s',async raw=>{expect((await POST(request(raw))).status).toBe(400);expect(receive).not.toHaveBeenCalled();});
it('rejects malformed signed UTF-8',async()=>{const req=new NextRequest('http://localhost/api/economy/webhooks/paystack',{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([0xc3,0x28])});expect((await POST(req)).status).toBe(400);expect(receive).not.toHaveBeenCalled();});
it('rejects an unexpected media type before signature work',async()=>{expect((await POST(request('{}',{'content-type':'text/plain'}))).status).toBe(415);expect(verify).not.toHaveBeenCalled();});
it('rejects actual oversized bytes even with a misleading content length',async()=>{expect((await POST(request('x'.repeat(256*1024+1),{'content-length':'1'}))).status).toBe(413);expect(verify).not.toHaveBeenCalled();expect(receive).not.toHaveBeenCalled();});
