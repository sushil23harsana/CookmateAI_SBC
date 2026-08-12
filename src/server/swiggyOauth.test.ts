import assert from 'node:assert/strict';
import { challengeFrom, issueState, consumeState } from './swiggyOauth.js';

// 1) S256 challenge matches the RFC 7636 Appendix B test vector.
assert.equal(
  challengeFrom('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
);

// 2) Verifier meets the RFC minimum length, the state is strictly one-shot, and
//    the token lands on the SAME session that started the flow.
{
  const { state, verifier } = issueState('sess-alpha');
  assert.ok(verifier.length >= 43);
  assert.deepEqual(consumeState(state), { verifier, sessionId: 'sess-alpha' }); // valid exactly once
  assert.equal(consumeState(state), undefined); // never twice (replay = new flow)
}

// 3) A state we never issued validates nothing.
assert.equal(consumeState('forged-state'), undefined);

// 4) Distinct flows get distinct state + verifier pairs, each bound to its own session.
{
  const a = issueState('sess-a');
  const b = issueState('sess-b');
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(consumeState(b.state)?.sessionId, 'sess-b');
  assert.equal(consumeState(a.state)?.sessionId, 'sess-a');
}

console.log('✓ swiggy oauth (pkce + one-shot state) tests passed');
