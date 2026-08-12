import assert from 'node:assert/strict';
import { challengeFrom, issueState, consumeState } from './swiggyOauth.js';

// 1) S256 challenge matches the RFC 7636 Appendix B test vector.
assert.equal(
  challengeFrom('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
);

// 2) Verifier meets the RFC minimum length and the state is strictly one-shot.
{
  const { state, verifier } = issueState();
  assert.ok(verifier.length >= 43);
  assert.equal(consumeState(state), verifier); // valid exactly once
  assert.equal(consumeState(state), undefined); // never twice (replay = new flow)
}

// 3) A state we never issued validates nothing.
assert.equal(consumeState('forged-state'), undefined);

// 4) Distinct flows get distinct state + verifier pairs.
{
  const a = issueState();
  const b = issueState();
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
}

console.log('✓ swiggy oauth (pkce + one-shot state) tests passed');
