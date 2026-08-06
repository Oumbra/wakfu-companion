# wakfu-companion
Mise en forme de log Wakfu

Application Angular 21 qui lit `wakfu.log` en direct (Chrome/Edge — File
System Access API) et affiche kamas, XP, dégâts, combats et chat par canal.
Design repris de https://wakfu-companion.nexuswow.workers.dev/.

## Développement

```
npm install
npm start          # ng serve sur http://localhost:4200
```

## Build

```
npm run build
```

Génère le build de production dans `dist/wakfu-companion/browser` — une
application web classique, à servir par un serveur HTTP (voir le déploiement
GitHub Pages dans `.github/workflows/`).
