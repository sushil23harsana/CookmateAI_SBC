import assert from 'node:assert/strict';

// Synthetic configuration only. These tests must never call a model or Swiggy.
process.env.COOKMATE_LLM = 'openai';
process.env.OPENAI_API_KEY = 'test-not-a-key';
process.env.ANTHROPIC_API_KEY = '';
process.env.COOKMATE_PROVIDER = 'swiggy';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_PER_MIN = '1000';
const { app } = await import('./index.js');
const { createSession, getSession } = await import('./sessions.js');
const { resumeIdentity } = await import('./access.js');

const identity = resumeIdentity(undefined);
assert.equal(identity.token.length, 43);
assert.notEqual(identity.key, identity.token);
assert.deepEqual(resumeIdentity(identity.token), identity);
assert.notEqual(resumeIdentity('legacy-user-id').key, 'legacy-user-id');

const post = (path: string, data: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
const session = createSession();
let modelCalls = 0;
session.agent.send = async () => {
  modelCalls++;
  return 'Test response';
};
const send = () => post('/api/chat', { sessionId: session.id, message: 'Find milk' });

assert.equal((await send()).status, 401);
assert.equal(modelCalls, 0);
assert.equal(session.busy, false);
session.swiggyToken = 'synthetic-token';
session.swiggyTokenExpiresAt = Date.now() - 1000;
assert.equal((await send()).status, 401);
assert.equal(modelCalls, 0);
session.swiggyTokenExpiresAt = Date.now() + 300_000;
session.provider.listAddresses = async () => {
  throw new Error('revoked or unreachable');
};
assert.equal((await send()).status, 503);
assert.equal(modelCalls, 0);
assert.equal(session.busy, false);
assert.equal((await app.request(`/api/swiggy/status?sessionId=${session.id}`)).status, 503);

session.provider.listAddresses = async () => [{ id: 'address-one', label: 'Synthetic home' }];
const successful = await send();
assert.equal(successful.status, 200);
assert.match(await successful.text(), /Test response/);
assert.equal(modelCalls, 1);
assert.equal(successful.headers.get('cache-control'), 'no-store');
assert.equal(session.busy, false);
const malformed = await post('/api/chat', { sessionId: session.id, message: '' });
assert.equal(malformed.status, 400);
assert.equal(session.busy, false);

let release!: () => void;
const pending = new Promise<void>((resolve) => {
  release = resolve;
});
session.agent.send = async () => {
  modelCalls++;
  await pending;
  return 'Finished';
};
const first = await send();
assert.equal((await send()).status, 409);
assert.equal(
  (await post('/api/swiggy/address', { sessionId: session.id, addressId: 'address-one' })).status,
  409,
);
release();
await first.text();
assert.equal(session.busy, false);

const invalidAddress = await post('/api/swiggy/address', {
  sessionId: session.id,
  addressId: 'another-account',
});
assert.equal(invalidAddress.status, 400);
assert.equal(session.swiggyAddressId, undefined);

const legacy = await post('/api/session', { userId: 'legacy-public-user-id' });
const legacyBody = (await legacy.json()) as { sessionId: string; resumeToken: string };
assert.match(getSession(legacyBody.sessionId)!.userId!, /^v2_/);
assert.equal(getSession(legacyBody.sessionId)!.swiggyToken, undefined);
const resumed = await post('/api/session', { resumeToken: legacyBody.resumeToken });
assert.equal(((await resumed.json()) as { sessionId: string }).sessionId, legacyBody.sessionId);

assert.equal((await post('/api/order', { sessionId: session.id, cartId: 'old-cart' })).status, 409);
assert.equal((await post('/api/swiggy/disconnect', { sessionId: session.id })).status, 200);
assert.equal(getSession(session.id), undefined);
assert.equal((await send()).status, 404);

const { config } = await import('../config.js');
const { verifyConnection } = await import('./access.js');
config.provider = 'mock';
process.env.NODE_ENV = 'production';
assert.equal(
  await verifyConnection(createSession()),
  false,
  'public mock mode cannot spend anonymous model credits',
);

console.log(
  '✓ access gates: missing/expired/revoked login invokes zero model calls; locks, resume and disconnect passed',
);
