// Admin grants belong to one local session and expire after 15 minutes.
// Nothing is persisted: a restart requires verification again.
export function createAdminSecurity({ clerk, verifyToken, secretKey, now = Date.now }) {
  const grants = new Map();
  const windowMs = 15 * 60 * 1000;

  async function check(sessionId, user) {
    if (!user || user.guest || !user.clerkId || !user.clerkSessionId) {
      return { allowed: false, error: "sign_in_required" };
    }
    try {
      const [account, session] = await Promise.all([
        clerk.users.getUser(user.clerkId),
        clerk.sessions.getSession(user.clerkSessionId),
      ]);
      if (session.status !== "active" || session.userId !== user.clerkId || account.banned) {
        grants.delete(sessionId);
        return { allowed: false, error: "sign_in_required" };
      }
      if (!account.twoFactorEnabled) {
        grants.delete(sessionId);
        return { allowed: false, twoFactorEnabled: false, error: "setup_required" };
      }
      const grant = grants.get(sessionId);
      const allowed = !!grant && grant.until > now() &&
        grant.userId === user.clerkId && grant.sid === user.clerkSessionId;
      if (!allowed) grants.delete(sessionId);
      return { allowed, twoFactorEnabled: true, error: allowed ? null : "verification_required" };
    } catch {
      grants.delete(sessionId);
      return { allowed: false, error: "unavailable" };
    }
  }

  async function verify(sessionId, user, token, origin) {
    if (typeof token !== "string" || !user?.clerkId || !user?.clerkSessionId) throw new Error("missing identity");
    const claims = await verifyToken(token, { secretKey, authorizedParties: [origin] });
    if (claims.azp !== origin || claims.sub !== user.clerkId || claims.sid !== user.clerkSessionId || claims.act) {
      throw new Error("identity mismatch");
    }
    const age = claims.fva?.[1];
    if (!Number.isInteger(age) || age < 0 || age >= 15 || !Number.isFinite(claims.iat)) {
      throw new Error("second factor required");
    }
    const status = await check(sessionId, user);
    if (status.twoFactorEnabled !== true) throw new Error("2fa unavailable");
    const until = Math.min(now(), claims.iat * 1000) - age * 60000 + windowMs;
    if (until <= now()) throw new Error("verification expired");
    for (const [id, grant] of grants) if (grant.until <= now()) grants.delete(id);
    grants.set(sessionId, { userId: user.clerkId, sid: user.clerkSessionId, until });
  }

  return { check, verify };
}
