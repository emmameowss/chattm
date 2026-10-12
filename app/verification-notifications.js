(() => {
  window.bindVerificationNotifications = socket => {
    const notices = new Map();
    function remove(id) {
      notices.get(id)?.remove();
      notices.delete(id);
    }
    function show(notification, live = false) {
      if (!notification?.id || notices.has(notification.id)) return;
      const container = document.querySelector('#toast-container');
      if (!container) return;
      const type = notification.type === 'red-verification' ? 'red-verification' : 'success';
      const toast = document.createElement('div');
      toast.className = `toast verification-toast ${type}`;
      if (document.body.classList.contains("admin-page")) toast.classList.add("admin-toast");
      toast.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'verification-toast-text';
      text.textContent = notification.message;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'verification-toast-close';
      close.setAttribute('aria-label', 'dismiss verification notification');
      const icon = document.createElement('i');
      icon.className = 'ti ti-x';
      icon.setAttribute('aria-hidden', 'true');
      close.appendChild(icon);
      const errorText = document.createElement('span');
      errorText.className = 'verification-toast-error';
      errorText.hidden = true;
      errorText.setAttribute('role', 'alert');
      close.addEventListener('click', () => {
        if (close.disabled) return;
        close.disabled = true;
        errorText.hidden = true;
        socket.timeout(10000).emit('dismissVerificationNotification', notification.id, (error, result) => {
          if (error || !result?.success) {
            close.disabled = false;
            errorText.textContent = result?.error || 'could not dismiss; try again when connected.';
            errorText.hidden = false;
          } else remove(notification.id);
        });
      });
      toast.append(text, close, errorText);
      notices.set(notification.id, toast);
      container.appendChild(toast);
      if (live && notification.celebrate) window.burstVerificationConfetti?.(type);
    }
    socket.on('verificationNotifications', notifications => {
      const ids = new Set(notifications.map(notification => notification.id));
      for (const id of notices.keys()) if (!ids.has(id)) remove(id);
      notifications.forEach(notification => show(notification));
    });
    socket.on('verificationNotification', notification => show(notification, true));
    socket.on('verificationNotificationDismissed', remove);
  };
})();
