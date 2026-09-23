import { SignJWT } from "jose";
import pg from "pg";
import { createClient } from "redis";
import { randomUUID } from "crypto";

const secret = new TextEncoder().encode("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

const client = new pg.Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/zobia_test" });
await client.connect();
const res = await client.query("SELECT id, username, email, is_admin FROM users WHERE username='adm1' LIMIT 1");
const user = res.rows[0];
await client.end();

const sid = randomUUID();

const token = await new SignJWT({
  sub: user.id,
  email: user.email,
  username: user.username,
  is_admin: true,
  sid,
  type: "access",
})
  .setProtectedHeader({ alg: "HS256", kid: "v1" })
  .setIssuedAt()
  .setIssuer("zobia-social")
  .setAudience("zobia-web")
  .setExpirationTime("30m")
  .sign(secret);

const redis = createClient({ url: "redis://localhost:6379" });
await redis.connect();
const sessionRecord = {
  uid: user.id,
  sid,
  username: user.username,
  is_admin: true,
  adminSession: true,
  created_at: new Date().toISOString(),
};
await redis.set(`session:${sid}`, JSON.stringify(sessionRecord), { EX: 3600 });
await redis.quit();

console.log(token);
