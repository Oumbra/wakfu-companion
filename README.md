# Wakfu Companion

Compagnon de jeu en temps réel pour le MMORPG [Wakfu](https://www.wakfu.com/) :
lit le fichier `wakfu.log` en direct dans le navigateur (Chrome/Edge — File
System Access API) et affiche kamas, XP, dégâts de combat, historique,
butin et chat par canal, sans jamais envoyer le contenu du fichier où que
ce soit. Design inspiré de
[wakfu-companion.nexuswow.workers.dev](https://wakfu-companion.nexuswow.workers.dev/).

Application Angular 21 (composants standalone, signals, `@if`/`@for`).

## Fonctionnalités

- **Combat en cours** : dégâts par allié/ennemi en temps réel, détail par
  sort et par élément, onglets pour les combats simultanés (multi-compte),
  reclassement allié/ennemi par glisser-déposer, réattribution manuelle
  d'une attaque mal classée, classe/sexe affiché modifiable au clic droit.
- **Suivi** : compteur (ramassage/victoires) pour tout objet ou ennemi
  ajouté, mode incrémental ou décompte avec alerte, création en un clic
  d'un décompte par ingrédient à partir d'une recette de métier.
- **Historique** : combats, achats (détection automatique marchand/Hôtel
  de Vente) et échanges avec d'autres joueurs, groupés par jour ; connecté
  à un compte, l'historique est conservé sans limite et rechargeable
  au-delà de la session en cours.
- **Chat** : messages classés par canal, filtres personnalisés (mot-clé +
  canal) qui mettent en évidence les messages correspondants et
  déclenchent une alerte sonore.
- **Profil** : avatar, mode daltonien (adapte les couleurs sensibles de
  l'app), alertes sonores configurables par objet, déclaration des
  personnages par compte (multi-compte, serveur de jeu par compte), et
  connexion optionnelle par Discord/Google pour synchroniser réglages,
  personnages et suivi entre appareils — sans compte, tout reste dans le
  navigateur.

## Développement

```
npm install
npm start          # ng serve + API locale (wrangler), http://localhost:4200
```

## Build

```
npm run build
```

Génère le build de production dans `dist/wakfu-companion/browser` — une
application web classique, à servir par un serveur HTTP (voir les
déploiements dans `.github/workflows/`).

## Tests

```
npm test            # tests front (Angular/Karma)
npm run test:server  # tests serveur (Vitest)
```

## Serveur / API

Une API optionnelle (Cloudflare Pages Functions + PostgreSQL/Neon) fournit
le catalogue d'objets/monstres/donjons, le suivi de prix d'Hôtel de Vente
et l'authentification Discord/Google permettant de synchroniser les
données entre appareils. L'application reste pleinement fonctionnelle sans
elle (mode invité, tout en local). Voir [`server/README.md`](server/README.md)
pour l'architecture, les endpoints et la mise en route.
