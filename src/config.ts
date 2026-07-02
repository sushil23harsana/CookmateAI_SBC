import 'dotenv/config';
import { z } from 'zod';
import { ConfigError } from './errors.js';

/**
 * Config is parsed + validated once at import. ANTHROPIC_API_KEY is optional here
 * (so tests can import config without a key); call assertRuntimeConfig() at CLI
 * startup to enforce what an actual run needs.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(''),
  COOKMATE_MODEL: z.string().min(1).default('claude-opus-4-8'),
  COOKMATE_PROVIDER: z.enum(['mock', 'swiggy']).default('mock'),

  SWIGGY_MCP_URL: z.string().url().default('https://mcp.swiggy.com/im'),
  SWIGGY_MCP_TOKEN: z.string().default(''),

  COOKMATE_DELIVERY_FEE: z.coerce.number().min(0).max(1000).default(35),
  COOKMATE_MIN_ORDER_VALUE: z.coerce.number().min(0).max(100000).default(99),
  COOKMATE_MAX_ORDER_VALUE: z.coerce.number().positive().max(1000000).default(5000),

  COOKMATE_PANTRY_FILE: z.string().min(1).default('./data/pantry.json'),
  COOKMATE_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(100).default(24),
  COOKMATE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(60000),
  COOKMATE_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- server hardening ---
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(100000).default(30),
  MESSAGE_MAX_CHARS: z.coerce.number().int().min(1).max(100000).default(2000),
  SESSION_TTL_MS: z.coerce.number().int().min(60000).max(86400000).default(1800000),
  MAX_SESSIONS: z.coerce.number().int().min(1).max(1000000).default(1000),
  // Only honor X-Forwarded-For when explicitly deployed behind a trusted proxy —
  // otherwise clients can spoof fresh IPs per request to dodge the rate limiter.
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

function load() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.COOKMATE_MODEL,
    provider: e.COOKMATE_PROVIDER,
    swiggyMcpUrl: e.SWIGGY_MCP_URL,
    swiggyMcpToken: e.SWIGGY_MCP_TOKEN,
    deliveryFee: e.COOKMATE_DELIVERY_FEE,
    minOrderValue: e.COOKMATE_MIN_ORDER_VALUE,
    maxOrderValue: e.COOKMATE_MAX_ORDER_VALUE,
    pantryFile: e.COOKMATE_PANTRY_FILE,
    maxToolIterations: e.COOKMATE_MAX_TOOL_ITERATIONS,
    requestTimeoutMs: e.COOKMATE_REQUEST_TIMEOUT_MS,
    maxRetries: e.COOKMATE_MAX_RETRIES,
    logLevel: e.LOG_LEVEL,

    port: e.PORT,
    corsOrigin: e.CORS_ORIGIN,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    messageMaxChars: e.MESSAGE_MAX_CHARS,
    sessionTtlMs: e.SESSION_TTL_MS,
    maxSessions: e.MAX_SESSIONS,
    trustProxy: e.TRUST_PROXY === 'true',
  };
}

export const config = load();
export type Config = typeof config;
export type ProviderName = Config['provider'];

/** Enforce what a live run requires. Throws ConfigError with an actionable message. */
export function assertRuntimeConfig(): void {
  if (!config.anthropicApiKey) {
    throw new ConfigError('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  if (config.provider === 'swiggy' && !config.swiggyMcpToken) {
    throw new ConfigError(
      'COOKMATE_PROVIDER=swiggy but SWIGGY_MCP_TOKEN is empty. Set a token, or use COOKMATE_PROVIDER=mock.',
    );
  }
  if (config.maxOrderValue < config.minOrderValue) {
    throw new ConfigError(
      `COOKMATE_MAX_ORDER_VALUE (₹${config.maxOrderValue}) must be >= COOKMATE_MIN_ORDER_VALUE (₹${config.minOrderValue}).`,
    );
  }
}
