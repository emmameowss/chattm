// Shared presentation and keyboard behavior; moderation stays in the page scripts.
(() => {
  const rowSelector = '.admin-user-row, .admin-emoji-row, .admin-log-row, .admin-report-row';
  const overlay = document.querySelector('#modal-overlay');
  const main = document.querySelector('.admin-main');
  const sidebar = document.querySelector('.admin-shell-sidebar');
  const drawer = document.querySelector('#admin-user-drawer, #admin-emoji-drawer, #admin-log-drawer, #admin-report-drawer');
  let activeDialog = null;
  let returnFocus = null;
  let lastActivation = null;
  const focusOrigins = new WeakMap();
  const drawerExits = new WeakMap();
  const modalMotions = new WeakMap();

  function cancelModalMotion(overlay) {
    modalMotions.get(overlay)?.forEach(animation => animation.cancel());
    modalMotions.delete(overlay);
  }

  function animateAdminModal(overlay, closing, finish = () => {}) {
    cancelModalMotion(overlay);
    const panel = overlay.querySelector('#modal-box');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || !overlay.animate || !panel?.animate) {
      if (closing) overlay.style.display = 'none';
      overlay.classList.remove('admin-modal-closing');
      finish();
      return;
    }

    const overlayOpacity = getComputedStyle(overlay).opacity;
    const panelOpacity = getComputedStyle(panel).opacity;
    const panelTransform = getComputedStyle(panel).transform;
    if (closing) overlay.classList.add('admin-modal-closing');
    const duration = closing ? 160 : 230;
    const easing = closing ? 'cubic-bezier(.4, 0, 1, 1)' : 'cubic-bezier(.22, 1, .36, 1)';
    const animations = closing
      ? [
          overlay.animate([{ opacity: overlayOpacity }, { opacity: 0 }], { duration, easing, fill: 'forwards' }),
          panel.animate([
            { opacity: panelOpacity, transform: panelTransform },
            { opacity: 0, transform: 'translate3d(36px, 0, 0) scale(.985)' },
          ], { duration, easing, fill: 'forwards' }),
        ]
      : [
          overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing, fill: 'forwards' }),
          panel.animate([
            { opacity: 0, transform: 'translate3d(36px, 0, 0) scale(.985)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          ], { duration, easing, fill: 'forwards' }),
        ];
    modalMotions.set(overlay, animations);
    Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
      if (modalMotions.get(overlay) !== animations) return;
      modalMotions.delete(overlay);
      animations.forEach(animation => animation.cancel());
      if (closing) {
        overlay.style.display = 'none';
        overlay.classList.remove('admin-modal-closing');
      }
      finish();
    });
  }

  window.openAdminModal = overlay => {
    cancelModalMotion(overlay);
    overlay.classList.remove('admin-modal-closing');
    overlay.style.display = 'flex';
    animateAdminModal(overlay, false);
  };

  window.closeAdminModal = (overlay, finish) => {
    if (overlay.classList.contains('admin-modal-closing')) return;
    animateAdminModal(overlay, true, finish);
  };

  window.showAdminToast = (message, type = 'info') => {
    const container = document.querySelector('#toast-container');
    if (!container) return;
    const variants = {
      success: ['check', 'success'],
      error: ['alert-triangle', 'error'],
      info: ['info-circle', 'info'],
    };
    const [iconName, variant] = variants[type] || variants.info;
    const toast = document.createElement('div');
    toast.className = `toast admin-toast ${variant}`;
    const icon = document.createElement('i');
    icon.className = `ti ti-${iconName}`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(icon, text);
    container.append(toast);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion && toast.animate) {
      toast.animate([
        { opacity: 0, transform: 'translate3d(36px, 0, 0) scale(.985)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      ], { duration: 220, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
    setTimeout(() => {
      if (!toast.isConnected) return;
      if (reducedMotion || !toast.animate) {
        toast.remove();
        return;
      }
      const animation = toast.animate([
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        { opacity: 0, transform: 'translate3d(36px, 0, 0) scale(.985)' },
      ], { duration: 160, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
      animation.finished.then(() => toast.remove()).catch(() => toast.remove());
    }, 4000);
  };

  // Keep focus and the backdrop in place until an outside-click exit finishes.
  window.closeAdminDrawer = (drawer, finish, animate = false) => {
    const pending = drawerExits.get(drawer);
    if (animate && pending) return;
    pending?.cancel();
    drawerExits.delete(drawer);
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }

    const animation = drawer.animate([
      { transform: getComputedStyle(drawer).transform },
      { transform: 'translate3d(100%, 0, 0)' }
    ], { duration: 160, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    drawerExits.set(drawer, animation);
    animation.onfinish = () => {
      if (drawerExits.get(drawer) !== animation) return;
      drawerExits.delete(drawer);
      finish();
      animation.cancel();
    };
  };

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

  function within(root, selector) {
    const matches = [...root.querySelectorAll(selector)];
    if (root.matches?.(selector)) matches.unshift(root);
    return matches;
  }

  function enhanceContent(root) {
    within(root, rowSelector).forEach(row => {
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-pressed', String(row.classList.contains('selected')));
    });
    within(root, '.admin-clerk-id button').forEach(button => {
      button.setAttribute('aria-label', 'copy ' + (button.closest('#admin-emoji-detail') ? 'emoji URL' : 'Clerk ID'));
    });
    within(root, '.admin-sessions-modal-content').forEach(sessionsDialog => {
      sessionsDialog.setAttribute('role', 'dialog');
      sessionsDialog.setAttribute('aria-modal', 'true');
      sessionsDialog.setAttribute('aria-label', 'active sessions');
      sessionsDialog.querySelector('.admin-sessions-modal-close')?.setAttribute('aria-label', 'close active sessions');
    });
  }

  function enhance() {
    const sessionsDialog = document.querySelector('.admin-sessions-modal-content');

    const dialog = overlay && overlay.style.display !== 'none' && !overlay.hidden ? document.querySelector('#modal-box')
      : sessionsDialog || (drawer?.open ? drawer : null);
    if (dialog === activeDialog) {
      if (dialog && !dialog.contains(document.activeElement)) {
        (dialog.querySelector('#modal-cancel, .admin-sessions-modal-close, #admin-user-drawer-close, #admin-emoji-drawer-close, #admin-log-drawer-close, #admin-report-drawer-close') || focusable(dialog)[0])?.focus();
      }
      return;
    }

    const previousFocus = returnFocus;
    main.inert = false;
    sidebar.inert = false;
    if (drawer) drawer.inert = false;
    if (sessionsDialog) sessionsDialog.inert = false;
    let focusTarget = previousFocus;
    // Directory rows and detail controls can be replaced during live updates.
    if (previousFocus && (!previousFocus.isConnected || !visible(previousFocus))) {
      if (previousFocus.dataset.userOpen || previousFocus.dataset.emojiOpen || previousFocus.dataset.logId || previousFocus.dataset.reportId) {
        focusTarget = [...document.querySelectorAll('[data-user-open], [data-emoji-open], [data-log-id], [data-report-id]')]
          .find(button => previousFocus.dataset.userOpen ? button.dataset.userOpen === previousFocus.dataset.userOpen
            : previousFocus.dataset.emojiOpen ? button.dataset.emojiOpen === previousFocus.dataset.emojiOpen
              : previousFocus.dataset.logId ? button.dataset.logId === previousFocus.dataset.logId
                : button.dataset.reportId === previousFocus.dataset.reportId)
          || document.querySelector('#admin-users-search, #admin-emoji-search, #admin-logs-search, #admin-reports-search');
      } else if (previousFocus.classList.contains('admin-sessions-btn')) {
        focusTarget = drawer?.querySelector('.admin-sessions-btn');
      } else {
        focusTarget = drawer?.open ? document.querySelector('#admin-user-drawer-close, #admin-emoji-drawer-close, #admin-log-drawer-close, #admin-report-drawer-close') : null;
      }
    }
    if (activeDialog && focusTarget?.isConnected && visible(focusTarget) && (!dialog || dialog.contains(focusTarget))) focusTarget.focus();
    // Preserve the session dialog's original trigger while its confirmation is open.
    if (activeDialog && (activeDialog.id === 'modal-box' || !activeDialog.isConnected || (activeDialog === drawer && !drawer.open))) {
      focusOrigins.delete(activeDialog);
    }
    activeDialog = dialog;
    returnFocus = null;
    if (!dialog) {
      lastActivation = null;
      return;
    }

    if (!focusOrigins.has(dialog)) {
      const origin = dialog === drawer
        ? lastActivation || document.querySelector('.admin-directory-row.selected [data-user-open], .admin-directory-row.selected [data-emoji-open], .admin-log-row.selected, .admin-report-row.selected') || document.querySelector('#admin-users-search, #admin-emoji-search, #admin-logs-search, #admin-reports-search')
        : lastActivation || document.activeElement;
      focusOrigins.set(dialog, origin);
    }
    returnFocus = focusOrigins.get(dialog);
    lastActivation = null;
    main.inert = true;
    sidebar.inert = true;
    if (drawer) drawer.inert = dialog !== drawer;
    if (sessionsDialog) sessionsDialog.inert = dialog !== sessionsDialog;
    const field = [...dialog.querySelectorAll('input, select')].find(visible);
    const cancel = dialog.querySelector('#modal-cancel, .admin-sessions-modal-close, #admin-user-drawer-close, #admin-emoji-drawer-close, #admin-log-drawer-close, #admin-report-drawer-close');
    if (!dialog.contains(document.activeElement)) (field || cancel || focusable(dialog)[0])?.focus();
  }

  document.addEventListener('keydown', event => {
    if (activeDialog) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        activeDialog.querySelector('#modal-cancel, .admin-sessions-modal-close, #admin-user-drawer-close, #admin-emoji-drawer-close, #admin-log-drawer-close, #admin-report-drawer-close')?.click();
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
      enhanceContent(list);
      enhance();
      list.querySelector('.selected')?.focus();
    }
  }, true);

  new MutationObserver(records => {
    const added = new Set();
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1 && node.isConnected) added.add(node);
    }));
    added.forEach(node => {
      let ancestor = node.parentElement;
      while (ancestor && !added.has(ancestor)) ancestor = ancestor.parentElement;
      if (!ancestor) enhanceContent(node);
    });
    enhance();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'open', 'hidden']
  });
  enhanceContent(document);
  enhance();
})();
