// Pose `data-theme` sur <html> AVANT le premier rendu — voir le commentaire qui référence ce fichier
// dans src/index.html, et ThemeService (même clé `wakfu-theme`, même logique de détection : ne pas
// faire diverger les deux). Fichier externe et non script inline à cause de la CSP (public/_headers).
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem('wakfu-theme') || 'null');
    var theme =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* localStorage indisponible (mode privé strict...) : reste sur le thème sombre par défaut. */
  }
})();
