import { scryptSync, timingSafeEqual, randomBytes } from "crypto";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { and, gte, sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { db, schema } from "./db";
import { randomUUID } from "crypto";

export type SessionData = { authed?: boolean };

export const SESSION_COOKIE = "et_session";

const g = globalThis as unknown as { __etSecret?: string };

/**
 * Session secret resolution:
 *  1. SESSION_SECRET env var (required on Vercel production)
 *  2. A generated secret persisted under DATA_DIR (survives restarts for
 *     local / Docker installs where the data dir is durable)
 */
export function sessionSecret(): string {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 32) return env;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL)
    throw new Error("SESSION_SECRET (32+ random characters) must be set in production.");
  if (g.__etSecret) return g.__etSecret;
  const dataDir = process.env.DATA_DIR || "./data";
  const dir = path.isAbsolute(dataDir) ? dataDir : path.join(process.cwd(), dataDir);
  const p = path.join(dir, ".session-secret");
  try {
    const s = fs.readFileSync(p, "utf8").trim();
    if (s.length >= 32) {
      g.__etSecret = s;
      return s;
    }
  } catch {
    /* generate below */
  }
  const s = randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, s, { mode: 0o600 });
  } catch {
    /* ephemeral fallback */
  }
  g.__etSecret = s;
  return s;
}

export function sessionOptions(): SessionOptions {
  return {
    cookieName: SESSION_COOKIE,
    password: sessionSecret(),
    ttl: 60 * 60 * 24 * 30, // 30 days
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function isAuthed(): Promise<boolean> {
  const s = await getSession();
  return !!s.authed;
}

// ── Password verification ─────────────────────────────────────────────────
// Preferred: APP_PASSWORD_HASH="scrypt$<salt-hex>$<hash-hex>" (npm run hash-password)
// Fallback:  APP_PASSWORD=<plain> (acceptable for a single-user local install)

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string): boolean {
  const hashed = process.env.APP_PASSWORD_HASH;
  if (hashed) {
    const parts = hashed.split("$");
    if (parts.length === 3 && parts[0] === "scrypt") {
      try {
        const expected = Buffer.from(parts[2], "hex");
        const actual = scryptSync(password, parts[1], expected.length);
        return expected.length === actual.length && timingSafeEqual(expected, actual);
      } catch {
        return false;
      }
    }
    return false;
  }
  const plain = process.env.APP_PASSWORD;
  if (!plain) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(plain);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Simple brute-force guard: max 10 failed attempts per 15 minutes. */
export async function loginRateLimited(): Promise<boolean> {
  const d = await db();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [row] = await d
    .select({ n: sql<number>`count(*)` })
    .from(schema.loginAttempts)
    .where(and(gte(schema.loginAttempts.at, cutoff), sql`${schema.loginAttempts.ok} = 0`));
  return (row?.n ?? 0) >= 10;
}

export async function recordLoginAttempt(ok: boolean): Promise<void> {
  const d = await db();
  await d.insert(schema.loginAttempts).values({ id: randomUUID(), at: new Date().toISOString(), ok });
}
