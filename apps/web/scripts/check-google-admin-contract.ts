import assert from "node:assert/strict";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createSession,
  getSessionFresh,
  invalidateAllSessions,
  refreshAccessToken,
  invalidateSession,
  ACCESS_TOKEN_COOKIE,
} from "../lib/auth/session";
import { verifyAccessToken, signAccessToken } from "../lib/auth/jwt";
import { redis } from "../lib/redis";
import { generateTotpSecret, computeTotp } from "../lib/auth/totp";
import { encryptField } from "../lib/security/fieldEncryption";
import { GET, POST } from "../app/api/auth/admin-session/route";
import { POST as completeOAuth } from "../app/api/auth/2fa/verify/route";
import { GET as overview } from "../app/api/admin/rooms/route";
import { GET as guilds } from "../app/api/admin/guilds/route";
import { GET as support } from "../app/api/admin/support/tickets/route";
import { POST as disableTwoFa } from "../app/api/auth/2fa/disable/route";
import {
  GET as startTwoFa,
  POST as confirmTwoFa,
} from "../app/api/auth/2fa/setup/route";
import {
  withAdminAuth,
  withAdModeratorOrAdminAuth,
} from "../lib/api/middleware";
import { requestContext } from "../lib/logger";
import { getStaffRoles } from "../lib/auth/roles";
async function main() {
  if (
    !/^\/zobia_v3_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname)
  )
    throw Error("Disposable fixture only");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const users: string[] = [];
  async function user(admin = true) {
    const name = "google_" + randomUUID().slice(0, 12).replaceAll("-", "");
    const row = (
      await db.query(
        "INSERT INTO users(username,email,display_name,is_admin,onboarding_completed,google_id) VALUES($1,$2,$1,$3,true,$4) RETURNING id,email,username,is_admin",
        [name, name + "@fixture.invalid", admin, "google_" + randomUUID()],
      )
    ).rows[0];
    users.push(row.id);
    return row;
  }
  const fixtureIp = "2001:db8:" + randomUUID().slice(0, 4) + "::1";
  const ctx = { params: Promise.resolve({}) },
    req = (token: string, body?: unknown, cookie = false) =>
      new NextRequest("http://localhost:3000/api/auth/admin-session", {
        method: body ? "POST" : "GET",
        headers: {
          "x-forwarded-for": fixtureIp,
          ...(cookie
            ? { cookie: `${ACCESS_TOKEN_COOKIE}=${token}` }
            : { authorization: "Bearer " + token }),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
  const cookieToken = (response: Response) => {
    const value = response.headers.get("set-cookie") ?? "";
    return new RegExp(ACCESS_TOKEN_COOKIE + "=([^;]+)").exec(value)?.[1] ?? "";
  };
  try {
    const admin = await user();
    const legacy = await createSession(admin);
    const old = await GET(req(legacy.accessToken), ctx);
    assert.equal(old.status, 200);
    assert.deepEqual((await old.json()).data, {
      state: "authorized",
      userId: admin.id,
      twoFaEnabled: false,
    });
    assert(!old.headers.get("set-cookie"));
    const adminOnly = withAdminAuth(async () =>
      NextResponse.json({ success: true }),
    );
    const ads = withAdModeratorOrAdminAuth(async () =>
      NextResponse.json({ success: true }),
    );
    const staffEndpoints = [
      [overview, "/api/admin/rooms"],
      [guilds, "/api/admin/guilds"],
      [support, "/api/admin/support/tickets"],
      [adminOnly, "/api/admin/fixture"],
      [ads, "/api/admin/ads/fixture"],
    ] as const;
    for (const [handler, path] of staffEndpoints) {
      for (const cookie of [false, true]) {
        const request = new NextRequest("http://localhost:3000" + path, {
          headers: cookie
            ? { cookie: `${ACCESS_TOKEN_COOKIE}=${legacy.accessToken}` }
            : { authorization: "Bearer " + legacy.accessToken },
        });
        assert.equal((await handler(request, ctx)).status, 200, path);
      }
    }
    await requestContext.run(
      {
        requestId: "fixture",
        userId: admin.id,
        route: "/api/kyc/documents/fixture",
        adminSessionVerified: false,
      },
      async () => {
        assert.equal(
          (await getStaffRoles(admin.id, { requireAdminSession: true }))
            .isAdmin,
          true,
        );
      },
    );
    const impersonated = await createSession(admin, {
      impersonatedBy: admin.id,
    });
    assert.equal(
      (await adminOnly(req(impersonated.accessToken), ctx)).status,
      403,
    );
    console.log(
      "PASS new admins default to 2FA off and regular cookie/Bearer sessions reach every staff wrapper; live roles and impersonation boundaries remain enforced",
    );
    const google = await createSession(admin, {
        authProvider: "google",
        ua: "Fixture/1.0",
      }),
      source = await verifyAccessToken(google.accessToken);
    assert.equal(
      (await (await GET(req(google.accessToken), ctx)).json()).data.state,
      "authorized",
    );
    const setups = await Promise.all([
      POST(req(google.accessToken, { action: "setup" }), ctx),
      POST(req(google.accessToken, { action: "setup" }), ctx),
    ]);
    const secrets = await Promise.all(setups.map((r) => r.json()));
    assert.equal(secrets[0].data.secret, secrets[1].data.secret);
    const secret = secrets[0].data.secret;
    assert(
      !(await redis.get(`admin:google:totp:${source.sid}`))?.includes(secret),
    );
    const code = computeTotp(secret, Math.floor(Date.now() / 30000));
    const enrolled = await POST(
      req(google.accessToken, { action: "enroll", code }, true),
      ctx,
    );
    assert.equal(enrolled.status, 200);
    assert(!JSON.stringify(await enrolled.json()).includes("refreshToken"));
    const token = cookieToken(enrolled);
    assert(token);
    const elevated = await verifyAccessToken(token);
    assert.notEqual(elevated.sid, source.sid);
    assert.equal((await getSessionFresh(elevated.sid))?.adminSession, true);
    assert.notEqual((await getSessionFresh(source.sid))?.adminSession, true);
    for (const [handler, path] of staffEndpoints) {
      const denied = await handler(
        new NextRequest("http://localhost:3000" + path, {
          headers: { authorization: "Bearer " + legacy.accessToken },
        }),
        ctx,
      );
      assert.equal(denied.status, 403, path);
      assert.equal((await denied.json()).error.code, "ADMIN_REAUTH_REQUIRED");
    }
    await requestContext.run(
      {
        requestId: "fixture",
        userId: admin.id,
        route: "/api/kyc/documents/fixture",
        adminSessionVerified: false,
      },
      async () => {
        assert.equal(
          (await getStaffRoles(admin.id, { requireAdminSession: true }))
            .isAdmin,
          false,
        );
      },
    );
    assert.equal(
      (
        await overview(
          new NextRequest("http://localhost:3000/api/admin/rooms", {
            headers: { authorization: "Bearer " + google.accessToken },
          }),
          ctx,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await overview(
          new NextRequest("http://localhost:3000/api/admin/rooms", {
            headers: { authorization: "Bearer " + token },
          }),
          ctx,
        )
      ).status,
      200,
    );
    assert.equal(
      (await POST(req(google.accessToken, { action: "verify", code }), ctx))
        .status,
      400,
    );
    assert.equal(
      (await POST(req(google.accessToken, { action: "setup" }), ctx)).status,
      409,
    );
    console.log(
      "PASS explicit Google-only admin enrollment immediately gates old sessions, needs no password, rotates SID, and never exposes refresh tokens in web JSON",
    );
    const disable = (code: string) =>
      disableTwoFa(
        new NextRequest("http://localhost:3000/api/auth/2fa/disable", {
          method: "POST",
          headers: {
            authorization: "Bearer " + google.accessToken,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code }),
        }),
        ctx,
      );
    assert.equal(
      (await disable(code)).status,
      400,
      "Consumed enrollment code cannot disable protection",
    );
    const nextCode = computeTotp(secret, Math.floor(Date.now() / 30000) + 1);
    assert.equal(
      (await disable(nextCode)).status,
      200,
      "Admin can explicitly disable their own factor with a fresh valid code",
    );
    assert.equal(
      (await (await GET(req(legacy.accessToken), ctx)).json()).data
        .twoFaEnabled,
      false,
    );
    assert.equal((await adminOnly(req(legacy.accessToken), ctx)).status, 200);
    console.log(
      "PASS admin disabling requires a valid unused code and normal-session access resumes when the live account setting is off",
    );

    // The general-user feature toggle must not hide the admin's own choice.
    const optional = await user(),
      optionalSession = await createSession(optional);
    await db.query(
      "INSERT INTO x_manifest(key,value) VALUES('auth_2fa_enabled','false') ON CONFLICT(key) DO UPDATE SET value='false'",
    );
    const accountReq = (body?: unknown) =>
      new NextRequest("http://localhost:3000/api/auth/2fa/setup", {
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + optionalSession.accessToken,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const started = await startTwoFa(accountReq(), ctx);
    assert.equal(started.status, 200);
    const optionalFactor = (await started.json()).secret;
    const optedIn = await confirmTwoFa(
      accountReq({
        code: computeTotp(optionalFactor, Math.floor(Date.now() / 30000)),
      }),
      ctx,
    );
    assert.equal(optedIn.status, 200);
    assert.equal(
      (await adminOnly(req(optionalSession.accessToken), ctx)).status,
      403,
    );
    console.log(
      "PASS account Security settings allow admins to opt in even when general-user 2FA enrollment is disabled",
    );
    const second = await user(),
      secondSecret = generateTotpSecret();
    await db.query(
      "UPDATE users SET totp_enabled=true,totp_secret=$2 WHERE id=$1",
      [second.id, encryptField(secondSecret)],
    );
    const secondSource = await createSession(second, {
      authProvider: "google",
      ua: "Fixture/Android",
    });
    const verified = await POST(
      req(secondSource.accessToken, {
        action: "verify",
        code: computeTotp(secondSecret, Math.floor(Date.now() / 30000)),
      }),
      ctx,
    );
    assert.equal(verified.status, 200);
    const pair = (await verified.json()).data;
    assert(pair.accessToken && pair.refreshToken);
    assert(!verified.headers.get("set-cookie"));
    assert.notEqual(
      (await verifyAccessToken(pair.accessToken)).sid,
      (await verifyAccessToken(secondSource.accessToken)).sid,
    );
    assert((await refreshAccessToken(pair.refreshToken)).accessToken);
    const normal = await user(false),
      normalSession = await createSession(normal, { authProvider: "google" });
    assert.equal((await GET(req(normalSession.accessToken), ctx)).status, 403);
    console.log(
      "PASS native admin verification receives a refreshable token pair; non-admin Google accounts remain denied",
    );
    for (const googleSource of [true, false]) {
      const account = await user(),
        factor = generateTotpSecret();
      await db.query(
        "UPDATE users SET totp_enabled=true,totp_secret=$2 WHERE id=$1",
        [account.id, encryptField(factor)],
      );
      const pre = await signAccessToken(
        {
          sub: account.id,
          username: account.username,
          is_admin: true,
          sid: "pre_auth",
          type: "pre_auth",
          ...(googleSource
            ? { auth_provider: "google" as const, return_to: "/gate44/config" }
            : {}),
        },
        300,
      );
      await redis.setex("pre_auth:" + account.id, 300, pre);
      const completed = await completeOAuth(
        new NextRequest("http://localhost:3000/api/auth/2fa/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preAuthToken: pre,
            code: computeTotp(factor, Math.floor(Date.now() / 30000)),
          }),
        }),
      );
      assert.equal(completed.status, 200);
      const data = await completed.json(),
        full = await verifyAccessToken(cookieToken(completed));
      assert.equal(
        !!(await getSessionFresh(full.sid))?.adminSession,
        googleSource,
      );
      assert.equal(data.redirect, googleSource ? "/gate44/config" : undefined);
    }
    console.log(
      "PASS only server-signed Google pre-auth plus a valid authenticator creates admin assurance during normal OAuth login",
    );
    await db.query("UPDATE users SET is_admin=false WHERE id=$1", [second.id]);
    assert.equal((await GET(req(pair.accessToken), ctx)).status, 403);
    const revoked = await createSession(admin, { authProvider: "google" });
    const revokedId = (await verifyAccessToken(revoked.accessToken)).sid;
    await invalidateSession(revokedId, admin.id);
    await assert.rejects(() =>
      createSession(admin, {
        adminSession: true,
        authProvider: "google",
        verifiedGoogleSourceSid: revokedId,
      }),
    );
    console.log(
      "PASS live role removal and revoked Google sources prevent new administrator access",
    );
  } finally {
    for (const id of users) await invalidateAllSessions(id);
    await db.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
