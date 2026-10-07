// Shared presentation and keyboard behavior; moderation stays in the page scripts.
(() => {
  const rowSelector = '.admin-user-row, .admin-emoji-row';
  const overlay = document.querySelector('#modal-overlay');
  const main = document.querySelector('.admin-main');
  const sidebar = document.querySelector('.admin-shell-sidebar');
  let activeDialog = null;
  let returnFocus = null;
  let lastActivation = null;
  const focusOrigins = new WeakMap();

  // Page scripts focus inputs synchronously, before the observer sees a dialog.
  document.addEventListener('click', event => {
    if (!event.target.closest('#modal-box')) {
      lastActivation = event.target.closest('button, a, [role="button"]');
    }
  }, true);

  function visible(element) {
    return element && element.getClientRects().length > 0;
  }

  function focusable(dialog) {
    return [...dialog.querySelectorAll('button, input, select, a[href], [tabindex="0"]')]
      .filter(element => !element.disabled && visible(element));
  }

  function enhance() {
    document.querySelectorAll(rowSelector).forEach(row => {
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-pressed', String(row.classList.contains('selected')));
    });
    document.querySelectorAll('.admin-clerk-id button').forEach(button => {
      button.setAttribute('aria-label', 'copy ' + (button.closest('#admin-emoji-detail') ? 'emoji URL' : 'Clerk ID'));
    });
    const sessionsDialog = document.querySelector('.admin-sessions-modal-content');
    if (sessionsDialog) {
      sessionsDialog.setAttribute('role', 'dialog');
      sessionsDialog.setAttribute('aria-modal', 'true');
      sessionsDialog.setAttribute('aria-label', 'active sessions');
      sessionsDialog.querySelector('.admin-sessions-modal-close')?.setAttribute('aria-label', 'close active sessions');
    }

    const dialog = visible(overlay) ? document.querySelector('#modal-box')
      : visible(sessionsDialog) ? sessionsDialog : null;
    if (dialog === activeDialog) return;

    const previousFocus = returnFocus;
    main.inert = false;
    sidebar.inert = false;
    if (activeDialog && previousFocus?.isConnected && visible(previousFocus)) previousFocus.focus();
    // Preserve the session dialog's original trigger while its confirmation is open.
    if (activeDialog && (activeDialog.id === 'modal-box' || !activeDialog.isConnected)) {
      focusOrigins.delete(activeDialog);
    }
    activeDialog = dialog;
    returnFocus = null;
    if (!dialog) {
      lastActivation = null;
      return;
    }

    if (!focusOrigins.has(dialog)) focusOrigins.set(dialog, lastActivation || document.activeElement);
    returnFocus = focusOrigins.get(dialog);
    lastActivation = null;
    main.inert = true;
    sidebar.inert = true;
    const field = [...dialog.querySelectorAll('input, select')].find(visible);
    const cancel = dialog.querySelector('#modal-cancel, .admin-sessions-modal-close');
    if (!dialog.contains(document.activeElement)) (field || cancel || focusable(dialog)[0])?.focus();
  }

  document.addEventListener('keydown', event => {
    if (activeDialog) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        activeDialog.querySelector('#modal-cancel, .admin-sessions-modal-close')?.click();
      } else if (event.key === 'Tab') {
        const items = focusable(activeDialog);
        const first = items[0];
        const last = items[items.length - 1];
        if (!items.length) event.preventDefault();
        else if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }

    const row = event.target.closest(rowSelector);
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const list = row.parentElement;
      row.click();
      // Page scripts recreate the list on selection; keep keyboard focus there.
      enhance();
      list.querySelector('.selected')?.focus();
    }
  }, true);

  new MutationObserver(enhance).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style']
  });
  enhance();
})();
