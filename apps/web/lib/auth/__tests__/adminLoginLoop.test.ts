import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { signAccessToken } from "../jwt";
it("lets an admin account reach the two-factor login instead of looping back into rejected admin APIs", async () => {
  const token = await signAccessToken({
    sub: "11111111-1111-4111-8111-111111111111",
    sid: "22222222-2222-4222-8222-222222222222",
    is_admin: true,
    email: "admin@fixture.invalid",
    username: "admin_fixture",
  });
  for (const target of ["/gate44", "/gate44/config", "/gate44/users"]) {
    const response = await middleware(
      new NextRequest(
        "https://zobia.test/gate44/login?redirect=" +
          encodeURIComponent(target),
        { headers: { cookie: "zobia_at=" + token } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  }
});
