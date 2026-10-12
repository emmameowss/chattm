(() => {
  let clearBurst = null;

  window.burstVerificationConfetti = (type = 'success') => {
    if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearBurst?.();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3000';
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d');
    if (!context) { canvas.remove(); return; }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.scale(scale, scale);
    const palette = type === 'red-verification'
      ? ['#5a151c', '#9d3949', '#d5657a', '#f7bcc6']
      : ['#f5a9b8', '#bce1ff', '#86bfff', '#fff5d9', '#d7bfff'];
    const particles = Array.from({ length: 55 }, () => ({
      x: width - 16, y: height - 12,
      vx: -110 - Math.random() * 270, vy: -320 - Math.random() * 320,
      angle: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * 10,
      width: 4 + Math.random() * 5, height: 6 + Math.random() * 6,
      color: palette[Math.floor(Math.random() * palette.length)],
    }));
    let frame;
    let previousTime;
    let age = 0;
    function cleanup() {
      cancelAnimationFrame(frame);
      canvas.remove();
      window.removeEventListener('resize', cleanup);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (clearBurst === cleanup) clearBurst = null;
    }
    function onVisibilityChange() { if (document.hidden) cleanup(); }
    function animate(time) {
      const elapsed = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, .04);
      previousTime = time;
      age += elapsed;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.x += particle.vx * elapsed;
        particle.y += particle.vy * elapsed;
        particle.vy += 760 * elapsed;
        particle.angle += particle.spin * elapsed;
        context.save();
        context.globalAlpha = Math.min(1, Math.max(0, (1.9 - age) / .5));
        context.translate(particle.x, particle.y);
        context.rotate(particle.angle);
        context.fillStyle = particle.color;
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        context.restore();
      }
      if (age < 1.9) frame = requestAnimationFrame(animate);
      else cleanup();
    }
    clearBurst = cleanup;
    window.addEventListener('resize', cleanup);
    document.addEventListener('visibilitychange', onVisibilityChange);
    frame = requestAnimationFrame(animate);
  };
})();
