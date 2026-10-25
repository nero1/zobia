jest.mock("@/lib/google/serviceAccountAuth", () => ({
  getGoogleServiceAccountAccessToken: async () => "fixture-google-token",
}));
import {
  verifyGooglePlayProductPurchase,
  verifyGooglePlaySubscriptionPurchase,
  consumeGooglePlayPurchase,
  acknowledgeGooglePlaySubscription,
  cancelGooglePlaySubscription,
} from "../googlePlayVerify";
const original = global.fetch,
  serviceAccount = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
afterEach(() => {
  global.fetch = original;
  if (serviceAccount === undefined)
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = serviceAccount;
});
it("keeps hostile purchase tokens within one provider path segment for verification and mutations", async () => {
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "fixture@fixture.invalid",
    private_key: "fixture",
  });
  const requests: string[] = [];
  global.fetch = jest.fn(async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ purchaseState: 0, paymentState: 1 }), {
      status: 200,
    });
  }) as typeof fetch;
  const token = "token/../../other?access_token=attacker#fragment";
  for (const fn of [
    verifyGooglePlayProductPurchase,
    verifyGooglePlaySubscriptionPurchase,
    consumeGooglePlayPurchase,
    acknowledgeGooglePlaySubscription,
    cancelGooglePlaySubscription,
  ])
    await fn("com.zobiasocial.app", "fixture_product", token);
  expect(requests).toHaveLength(5);
  for (const request of requests) {
    const url = new URL(request);
    expect(url.origin).toBe("https://androidpublisher.googleapis.com");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(url.pathname).toContain("/tokens/" + encodeURIComponent(token));
  }
});

it.each([".","..","\ud800"])("rejects invalid path segment %j before sending provider credentials",async token=>{
 process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:"fixture@fixture.invalid",private_key:"fixture"});
 const fetchMock=jest.fn();global.fetch=fetchMock as typeof fetch;
 for(const fn of [verifyGooglePlayProductPurchase,verifyGooglePlaySubscriptionPurchase,consumeGooglePlayPurchase,acknowledgeGooglePlaySubscription,cancelGooglePlaySubscription])await expect(fn("com.zobiasocial.app","fixture_product",token)).rejects.toMatchObject({code:"INVALID_PLAY_IDENTIFIER"});
 expect(fetchMock).not.toHaveBeenCalled();
});
