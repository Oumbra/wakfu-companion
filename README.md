# wakfu-companion
Mise en forme de log Wakfu

Application Angular 21 qui lit `wakfu_chat.log` en direct (Chrome/Edge — File
System Access API) et affiche kamas, XP, dégâts, combats et chat par canal.
Design repris de https://wakfu-companion.nexuswow.workers.dev/.

## Développement

```
npm install
npm start          # ng serve sur http://localhost:4200
```

## Build

```
npm run build:standalone
```

Génère `wakfu-companion.standalone.html` à la racine du dépôt : un fichier
HTML unique (JS/CSS/favicon inlinés) ouvrable directement en double-clic,
sans serveur.
