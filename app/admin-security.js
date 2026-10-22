const message = document.querySelector('#security-message');
const error = document.querySelector('#security-error');
const controls = document.querySelector('#security-controls');
const form = document.querySelector('#security-form');
const method = document.querySelector('#security-method');
const send = document.querySelector('#security-send');
let clerk;

function showError(e) {
  error.textContent = e.errors?.[0]?.longMessage || e.message || 'verification failed, please try again';
}

async function unlock() {
  const token = await clerk.session.getToken({ skipCache: true });
  const response = await fetch('/admin/security/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  // Reload the original admin URL, which is still in the address bar.
  location.reload();
}

async function check() {
  error.textContent = '';
  form.hidden = true;
  const response = await fetch('/admin/security/status', { cache: 'no-store' });
  const status = await response.json();
  if (!response.ok) throw new Error('could not check your account security. try again shortly.');
  if (status.allowed) { location.reload(); return; }
  if (status.error === 'sign_in_required') {
    throw new Error('sign into chat again with your Clerk account, then return here.');
  }
  if (!status.twoFactorEnabled) {
    message.textContent = 'warning: two-factor authentication is not enabled on your Clerk account. enable it in account security to access the admin panel. no admin data or actions are available until verification is complete.';
    return;
  }
  message.textContent = 'two-factor authentication is enabled. verify your second factor to unlock admin access for 15 minutes.';
  // A recent MFA sign-in can satisfy the requirement without another code.
  if (clerk.session.factorVerificationAge?.[1] >= 0 && clerk.session.factorVerificationAge[1] < 15) {
    try { await unlock(); return; } catch { /* Ask Clerk for fresh verification. */ }
  }
  const verification = await clerk.session.startVerification({ level: 'second_factor' });
  method.replaceChildren();
  for (const factor of verification.supportedSecondFactors || []) {
    if (!['totp', 'phone_code', 'backup_code'].includes(factor.strategy)) continue;
    const option = document.createElement('option');
    option.value = factor.strategy;
    option.dataset.phoneNumberId = factor.phoneNumberId || '';
    option.textContent = factor.strategy === 'totp' ? 'authenticator app' : factor.strategy === 'backup_code' ? 'backup code' : `SMS ${factor.safeIdentifier || ''}`;
    method.append(option);
  }
  if (!method.options.length) throw new Error('no supported second factor is available. add an authenticator app in Clerk account security.');
  send.hidden = method.value !== 'phone_code';
  form.hidden = false;
}

method.addEventListener('change', () => { send.hidden = method.value !== 'phone_code'; });
send.addEventListener('click', async () => {
  send.disabled = true;
  try {
    await clerk.session.prepareSecondFactorVerification({ strategy: 'phone_code', phoneNumberId: method.selectedOptions[0].dataset.phoneNumberId });
    message.textContent = 'SMS code sent. enter it below to unlock admin access.';
  } catch (e) { showError(e); } finally { send.disabled = false; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  error.textContent = '';
  try {
    await clerk.session.attemptSecondFactorVerification({ strategy: method.value, code: document.querySelector('#security-code').value.trim() });
    await unlock();
  } catch (e) { showError(e); } finally { button.disabled = false; }
});
document.querySelector('#security-setup').addEventListener('click', () => clerk.openUserProfile());
document.querySelector('#security-check').addEventListener('click', () => check().catch(showError));
window.addEventListener('load', async () => {
  try {
    if (!window.Clerk) throw new Error('could not load Clerk. refresh to try again.');
    clerk = window.Clerk;
    await clerk.load();
    if (!clerk.session) {
      message.textContent = 'sign in with the same Clerk account you use for chat, then refresh this page.';
      clerk.mountSignIn(document.querySelector('#security-signin'));
      return;
    }
    controls.hidden = false;
    await check();
  } catch (e) { showError(e); }
});
