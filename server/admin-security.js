// Clerk owns MFA sign-in; admin access requires enrollment on the live account.
export function createAdminSecurity({ clerk }) {

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
        return { allowed: false, error: "sign_in_required" };
      }
      if (!account.twoFactorEnabled) {
        return { allowed: false, twoFactorEnabled: false, error: "setup_required" };
      }
      return { allowed: true, twoFactorEnabled: true, error: null };
    } catch {
      return { allowed: false, error: "unavailable" };
    }
  }

  return { check };
}
