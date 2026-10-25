const mockRequest = jest.fn(),
  mockDestroy = jest.fn(async () => {});
jest.mock("undici", () => ({
  Agent: jest.fn(() => ({ destroy: mockDestroy })),
  fetch: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock("node:dns", () => ({
  promises: {
    resolve4: async (host: string) =>
      host === "private.tiktok.com" ? ["127.0.0.1"] : ["8.8.8.8"],
    resolve6: async () => [],
  },
}));
import { safeFetch } from "../ssrf";
beforeEach(() => {
  mockRequest.mockReset();
  mockDestroy.mockClear();
});
it("resolves only named public HTTPS redirects and preserves the final URL", async () => {
  mockRequest
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://www.tiktok.com/@fixture/video/123" },
      }),
    )
    .mockResolvedValueOnce(new Response("ok"));
  const r = await safeFetch(
    "https://vm.tiktok.com/fixture",
    {},
    { allowedRedirectHosts: ["www.tiktok.com"] },
  );
  expect(r.url).toBe("https://www.tiktok.com/@fixture/video/123");
  expect(await r.text()).toBe("ok");
  expect(mockDestroy).toHaveBeenCalledTimes(2);
});
it.each([
  "https://169.254.169.254/latest",
  "http://www.tiktok.com/video/123",
  "https://private.tiktok.com/video/123",
  "https://attacker.invalid/video/123",
])("does not contact unsafe redirect destination %s", async (destination) => {
  mockRequest.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: destination } }),
  );
  await expect(
    safeFetch(
      "https://vm.tiktok.com/fixture",
      {},
      { allowedRedirectHosts: ["www.tiktok.com", "private.tiktok.com"] },
    ),
  ).rejects.toThrow();
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
it("does not forward authorization across origins even to named redirect hosts", async () => {
  mockRequest.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "https://www.tiktok.com/video/123" },
    }),
  );
  await expect(
    safeFetch(
      "https://vm.tiktok.com/fixture",
      { headers: { authorization: "private-token" } },
      { allowedRedirectHosts: ["www.tiktok.com"] },
    ),
  ).rejects.toThrow("Unsafe outbound redirect");
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
