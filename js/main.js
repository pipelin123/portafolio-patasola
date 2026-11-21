// Lightbox de la bitácora, un solo video a la vez y aparición suave al hacer scroll.
(function () {
  const dialog = document.querySelector('.lightbox');
  if (dialog) {
    const img = dialog.querySelector('img');
    const caption = dialog.querySelector('.lightbox-caption');
    document.querySelectorAll('button.polaroid, button.swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const thumb = btn.querySelector('img');
        img.src = btn.dataset.full || thumb.src;
        img.alt = thumb.alt;
        caption.textContent = btn.querySelector('span')?.textContent || thumb.alt;
        dialog.showModal();
      });
    });
    dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  const videos = document.querySelectorAll('video');
  videos.forEach((v) => v.addEventListener('play', () => {
    videos.forEach((o) => { if (o !== v) o.pause(); });
  }));

  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-in'));
  }
})();
