import { neon } from '@neondatabase/serverless';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Durable home for each user's Swiggy bearer token, keyed by the browser's
 * anonymous user id (a random uuid — deliberately no PII, per Swiggy's DPDP
 * guidance). Lets a connection survive session expiry and Render's free-tier
 * sleep/restarts; tokens still expire after 5 days regardless.
 *
 * OPTIONAL: without DATABASE_URL every call is a no-op and the app behaves
 * exactly as before (connections die with the in-memory session). DB failures
 * degrade the same way — persistence is never allowed to break ordering.
 */

const sql = config.databaseUrl ? neon(config.databaseUrl) : undefined;
let ready: Promise<unknown> | undefined;

export const tokenPersistenceEnabled = Boolean(sql);

function init(): Promise<unknown> {
  if (!sql) return Promise.resolve();
  ready ??= sql`
    CREATE TABLE IF NOT EXISTS swiggy_tokens (
      user_id    text PRIMARY KEY,
      token      text NOT NULL,
      expires_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  return ready;
}

export async function loadToken(userId: string): Promise<{ token: string; expiresAt?: number } | undefined> {
  if (!sql) return undefined;
  try {
    await init();
    const rows = (await sql`
      SELECT token, expires_at FROM swiggy_tokens
      WHERE user_id = ${userId} AND (expires_at IS NULL OR expires_at > now())`) as Array<{
      token: string;
      expires_at: string | Date | null;
    }>;
    const row = rows[0];
    if (!row) return undefined;
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : undefined;
    return { token: row.token, expiresAt };
  } catch (err) {
    logger.warn('token load failed — continuing without persistence', { message: msg(err) });
    return undefined;
  }
}

export async function saveToken(userId: string, token: string, expiresAt?: number): Promise<void> {
  if (!sql) return;
  try {
    await init();
    await sql`
      INSERT INTO swiggy_tokens (user_id, token, expires_at, updated_at)
      VALUES (${userId}, ${token}, ${expiresAt ? new Date(expiresAt).toISOString() : null}, now())
      ON CONFLICT (user_id)
      DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at, updated_at = now()`;
    // Opportunistic hygiene: expired tokens are useless (no refresh in v1).
    await sql`DELETE FROM swiggy_tokens WHERE expires_at < now()`;
  } catch (err) {
    logger.warn('token save failed — connection will not persist across restarts', {
      message: msg(err),
    });
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
