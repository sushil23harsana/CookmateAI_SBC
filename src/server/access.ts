import { createHash, randomBytes } from 'node:crypto';
import type { Session } from './sessions.js';
import { config } from '../config.js';

/** A separate, high-entropy resume credential; never an ordinary public user id. */
export function resumeIdentity(input: unknown): { token: string; key: string } {
  const token =
    typeof input === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input)
      ? input
      : randomBytes(32).toString('base64url');
  return { token, key: `v2_${createHash('sha256').update(token).digest('hex')}` };
}

export function hasConnection(session: Session): boolean {
  return Boolean(
    session.swiggyToken &&
    (!session.swiggyTokenExpiresAt || session.swiggyTokenExpiresAt > Date.now() + 60_000),
  );
}

/** A non-mutating authenticated read before any paid chat or shopping request. */
export async function verifyConnection(session: Session): Promise<boolean> {
  if (config.provider === 'mock') return process.env.NODE_ENV !== 'production';
  if (!hasConnection(session)) return false;
  // Token presence alone cannot detect revocation. A failed preflight never reaches the LLM.
  if (!session.provider.listAddresses) return false;
  await session.provider.listAddresses();
  return true;
}
