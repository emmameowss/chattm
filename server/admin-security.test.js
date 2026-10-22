import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminSecurity } from './admin-security.js';

function fixture() {
  let time = 1800000000000;
  const account = { twoFactorEnabled: true, banned: false };
  const session = { status: 'active', userId: 'user_1' };
  const user = { clerkId: 'user_1', clerkSessionId: 'sess_1' };
  const claims = { sub: 'user_1', sid: 'sess_1', azp: 'https://chat.test', fva: [0, 0], iat: time / 1000 };
  let unavailable = false;
  const security = createAdminSecurity({
    clerk: {
      users: { getUser: async () => { if (unavailable) throw new Error('outage'); return account; } },
      sessions: { getSession: async () => session },
    },
    verifyToken: async () => claims,
    now: () => time,
  });
  return { security, user, account, session, claims,
    verify: () => security.verify('local_1', user, 'signed-token', 'https://chat.test'),
    check: () => security.check('local_1', user),
    advance: ms => { time += ms; }, outage: () => { unavailable = true; } };
}

test('enrollment alone grants no access; verified grant is local-session bound and expires', async () => {
  const f = fixture();
  assert.equal((await f.check()).allowed, false);
  await f.verify();
  assert.equal((await f.check()).allowed, true);
  assert.equal((await f.security.check('other-local', f.user)).allowed, false);
  f.advance(15 * 60000);
  assert.equal((await f.check()).allowed, false);
});

test('no enrollment, removed enrollment, revoked session, ban and outage deny access', async () => {
  for (const change of [f => { f.account.twoFactorEnabled = false; },
    f => { f.session.status = 'revoked'; }, f => { f.account.banned = true; },
    f => { f.session.userId = 'other'; }, f => f.outage()]) {
    const f = fixture();
    await f.verify();
    change(f);
    assert.equal((await f.check()).allowed, false);
  }
  const f = fixture();
  f.account.twoFactorEnabled = false;
  await assert.rejects(f.verify());
  assert.equal((await f.check()).error, 'setup_required');
});

test('missing, stale, malformed and never-verified factor claims are rejected', async () => {
  for (const fva of [undefined, [0, -1], [0, 15], [0, '0'], [0, null], [0, 0.5]]) {
    const f = fixture();
    f.claims.fva = fva;
    await assert.rejects(f.verify());
  }
});

test('wrong account, session, origin and impersonation are rejected', async () => {
  for (const mutation of [{ sub: 'other' }, { sid: 'other' }, { azp: 'https://other.test' }, { act: { sub: 'actor' } }]) {
    const f = fixture();
    Object.assign(f.claims, mutation);
    await assert.rejects(f.verify());
  }
});

test('replaying an older valid proof cannot extend its original verification window', async () => {
  const f = fixture();
  await f.verify();
  f.advance(14 * 60000);
  await f.verify();
  f.advance(60000);
  assert.equal((await f.check()).allowed, false);
  await assert.rejects(f.verify());
});

test('guest and legacy sessions cannot acquire access', async () => {
  const f = fixture();
  for (const user of [null, { guest: true }, { email: 'legacy@test' }]) {
    assert.equal((await f.security.check('local', user)).allowed, false);
    await assert.rejects(f.security.verify('local', user, 'token', 'https://chat.test'));
  }
});
