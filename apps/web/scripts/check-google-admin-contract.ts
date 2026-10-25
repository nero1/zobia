import assert from "node:assert/strict";
import { Client } from "pg";
import { NextRequest } from "next/server";
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
    assert.equal((await old.json()).data.state, "google_required");
    assert(!old.headers.get("set-cookie"));
    const google = await createSession(admin, {
        authProvider: "google",
        ua: "Fixture/1.0",
      }),
      source = await verifyAccessToken(google.accessToken);
    assert.equal(
      (await (await GET(req(google.accessToken), ctx)).json()).data.state,
      "setup_required",
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
      "PASS Google-only admin enrollment needs no password, is bound to a live source, rotates SID, leaves the old token unprivileged, and never exposes refresh tokens in web JSON",
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
