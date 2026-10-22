import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminSecurity } from './admin-security.js';

function fixture() {
  const account = { twoFactorEnabled: true, banned: false };
  const session = { status: 'active', userId: 'user_1' };
  const user = { clerkId: 'user_1', clerkSessionId: 'sess_1' };
  let unavailable = false;
  const security = createAdminSecurity({ clerk: {
    users: { getUser: async () => { if (unavailable) throw new Error('outage'); return account; } },
    sessions: { getSession: async () => session },
  } });
  return { account, session, user, security,
    check: () => security.check('local', user), outage: () => { unavailable = true; } };
}

test('2FA enrollment grants access without a verification challenge', async () => {
  assert.equal((await fixture().check()).allowed, true);
});
test('disabled or removed 2FA blocks access immediately', async () => {
  const f = fixture();
  assert.equal((await f.check()).allowed, true);
  f.account.twoFactorEnabled = false;
  assert.deepEqual(await f.check(), { allowed: false, twoFactorEnabled: false, error: 'setup_required' });
});
test('revoked sessions, account mismatch, bans and outages deny access', async () => {
  for (const change of [f => { f.session.status = 'revoked'; },
    f => { f.session.userId = 'other'; }, f => { f.account.banned = true; }, f => f.outage()]) {
    const f = fixture(); change(f);
    assert.equal((await f.check()).allowed, false);
  }
});
test('guest and legacy sessions cannot acquire access', async () => {
  const f = fixture();
  for (const user of [null, { ...f.user, guest: true }, { email: 'legacy@test' }]) {
    assert.equal((await f.security.check('local', user)).allowed, false);
  }
});
