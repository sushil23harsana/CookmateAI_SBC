import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Runtime home of the Swiggy MCP bearer token. Seeded from SWIGGY_MCP_TOKEN,
 * replaced by the OAuth callback when a user completes the PKCE flow. In-memory
 * only: tokens last 5 days with no refresh in v1, so losing one to a restart
 * just means reconnecting via /oauth/start. The token value is never logged.
 */

let token = config.swiggyMcpToken;
let expiresAt: number | undefined;

export function getSwiggyToken(): string {
  return token;
}

export function setSwiggyToken(next: string, expiresInSec?: number): void {
  token = next;
  expiresAt = expiresInSec ? Date.now() + expiresInSec * 1000 : undefined;
  logger.info('Swiggy MCP token updated', {
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : 'unknown',
  });
}

export function swiggyTokenStatus(): { connected: boolean; expiresAt?: string } {
  return {
    connected: token.length > 0,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  };
}
