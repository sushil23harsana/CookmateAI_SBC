import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * OAuth 2.1 + PKCE against the Swiggy MCP gateway
 * (docs: mcp.swiggy.com/builders/docs/start/authenticate).
 *
 * Per-user: /oauth/start?session=<id> binds the flow to that web session via
 * the state, and /oauth/callback exchanges the code (single-use, 120-second
 * lifetime) for a 5-day bearer token that belongs to THAT session's user — no
 * refresh in v1, so expiry means running the flow again. Codes, verifiers, and
 * tokens are never logged or echoed anywhere.
 */

const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 100;

const pending = new Map<string, { verifier: string; sessionId: string; createdAt: number }>();

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** S256: code_challenge = base64url(sha256(code_verifier)) — RFC 7636. */
export const challengeFrom = (verifier: string): string =>
  b64url(createHash('sha256').update(verifier).digest());

export function issueState(sessionId: string): { state: string; verifier: string } {
  // Sweep expired entries and cap the map so hammering /oauth/start can't grow it.
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > STATE_TTL_MS) pending.delete(k);
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32)); // 43 chars — the RFC 7636 minimum
  pending.set(state, { verifier, sessionId, createdAt: now });
  return { state, verifier };
}

/** One-shot: a state validates exactly once, and only within its TTL. */
export function consumeState(state: string): { verifier: string; sessionId: string } | undefined {
  const hit = pending.get(state);
  if (!hit) return undefined;
  pending.delete(state);
  if (Date.now() - hit.createdAt > STATE_TTL_MS) return undefined;
  return { verifier: hit.verifier, sessionId: hit.sessionId };
}

let dcrClientId = '';

/** Configured client id, or self-register once via Dynamic Client Registration. */
async function ensureClientId(): Promise<string> {
  if (config.swiggyClientId) return config.swiggyClientId;
  if (dcrClientId) return dcrClientId;
  const res = await fetch(`${config.swiggyAuthBase}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'CookMate AI',
      redirect_uris: [config.oauthRedirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client — PKCE carries the proof
      scope: 'mcp:tools mcp:resources mcp:prompts',
    }),
  });
  if (!res.ok) throw new Error(`Swiggy client registration failed (HTTP ${res.status})`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error('Swiggy client registration returned no client_id');
  dcrClientId = body.client_id;
  logger.info('registered OAuth client with Swiggy — set SWIGGY_CLIENT_ID to pin it across restarts', {
    clientId: dcrClientId,
  });
  return dcrClientId;
}

/** Build the Swiggy authorize URL for a fresh state + PKCE pair, bound to one session. */
export async function beginAuthorization(sessionId: string): Promise<string> {
  const clientId = await ensureClientId();
  const { state, verifier } = issueState(sessionId);
  const u = new URL(`${config.swiggyAuthBase}/auth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', config.oauthRedirectUri);
  u.searchParams.set('code_challenge', challengeFrom(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  // All three documented scopes: tool CALLS need mcp:tools, but the tool
  // CATALOG (tools/list) is metadata — observed empty with mcp:tools alone.
  u.searchParams.set('scope', 'mcp:tools mcp:resources mcp:prompts');
  return u.toString();
}

/** Exchange the callback's code for a bearer token, returning whose session it belongs to. */
export async function completeAuthorization(
  code: string,
  state: string,
): Promise<{ sessionId: string; accessToken: string; expiresInSec?: number }> {
  const hit = consumeState(state);
  if (!hit) throw new Error('unknown, reused, or expired OAuth state');
  const res = await fetch(`${config.swiggyAuthBase}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: hit.verifier,
      redirect_uri: config.oauthRedirectUri,
      client_id: await ensureClientId(),
    }),
  });
  if (!res.ok) throw new Error(`Swiggy token exchange failed (HTTP ${res.status})`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Swiggy token response had no access_token');
  return { sessionId: hit.sessionId, accessToken: body.access_token, expiresInSec: body.expires_in };
}
