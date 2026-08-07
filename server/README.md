# Serveur — Cloudflare Pages Functions + Neon

Voir `docs/plan-migration-serveur.md` (§4, §6, §9) pour le contexte complet.
Ce document couvre uniquement la mise en route pratique.

## Architecture

- **Front + API dans le même projet Cloudflare Pages** (pas de Worker
  séparé) : le front statique (`dist/wakfu-companion/browser`) et l'API
  (`functions/api/v1/*`, convention Pages Functions par chemin de fichier)
  sont servis depuis la **même origine** — indispensable pour que le futur
  cookie de session (lot 5) soit *first-party*.
- **Base** : PostgreSQL géré par [Neon](https://neon.tech), gratuit jusqu'à
  0,5 Go. Une **branche Neon par environnement** (production / preview) —
  jamais la même base pour les deux.

## Driver DB : `@neondatabase/serverless` (mode HTTP), pas Hyperdrive

Deux options existaient pour se connecter à Postgres depuis le runtime Pages
Functions (edge, pas de socket TCP classique) :

1. **`@neondatabase/serverless`** en mode `neon-http` (une requête = un
   `fetch` HTTP vers l'API Neon) — **retenu**. Fonctionne nativement dans le
   runtime Workers, sans aucune configuration Cloudflare supplémentaire (pas
   de binding `wrangler.toml`, pas de compte Hyperdrive à activer). Limite
   connue : pas de vraies transactions interactives multi-requêtes (chaque
   requête est indépendante). Suffisant pour ce lot (lectures simples +
   migrations) ; à reconsidérer avec `neon-serverless` (WebSocket) le jour où
   un besoin transactionnel réel apparaît (lot 8 : idempotence
   combats/achats/échanges).
2. Cloudflare Hyperdrive + driver SQL standard (`pg`/`postgres.js`) — écarté
   pour l'instant : ajoute une étape de configuration Cloudflare
   supplémentaire (créer le binding Hyperdrive, le référencer dans
   `wrangler.toml`) sans bénéfice net à ce stade du projet.

Voir `server/db/client.ts` pour l'implémentation.

## Secrets nécessaires

À ajouter comme **secrets GitHub Actions** (`Settings → Secrets and
variables → Actions`) sur `oumbra/wakfu-companion` :

| Secret | Description |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Déjà en place (déploiement Pages). Permission *Cloudflare Pages: Edit*. |
| `CLOUDFLARE_ACCOUNT_ID` | Déjà en place. |
| `DATABASE_URL` | Chaîne de connexion **poolée** (PgBouncer intégré Neon, host `...-pooler...`) de la branche **production**. |
| `DATABASE_URL_PREVIEW` | Chaîne de connexion poolée d'une branche Neon **distincte**, dédiée à la preview (`claude/dev`) — jamais la branche production. Créer via *Neon → Branches → Create child branch*. |

`DATABASE_URL`/`DATABASE_URL_PREVIEW` sont aussi transmis comme variable
d'environnement chiffrée du projet Cloudflare Pages (poussé à chaque déploiement
via `wrangler pages secret put`, voir `.github/workflows/deploy.yml`) : c'est
ce qui les rend disponibles dans `context.env.DATABASE_URL` côté Pages
Functions.

## Migrations

Outil : [drizzle-kit](https://orm.drizzle.team/kit-docs/overview). Schéma
dans `server/db/schema.ts`, migrations versionnées dans
`server/db/migrations/`.

```bash
# Après une modification de server/db/schema.ts : génère un nouveau fichier SQL
DATABASE_URL=... npm run db:generate

# Applique les migrations en attente (fait automatiquement en CI avant chaque déploiement)
DATABASE_URL=... npm run db:migrate
```

`DATABASE_URL` doit pointer vers la branche Neon de l'environnement ciblé
(jamais la production quand on teste en local).

## Endpoints actuels

- `GET /api/v1/health` — état du serveur + connectivité DB (`SELECT 1`).
- `GET /api/v1/game-servers` — liste des serveurs de jeu (table
  `game_servers`, jamais compilée en dur côté client).

## Piège PWA : le service worker interceptait `/api/**`

`navigationUrls` par défaut d'Angular (`/**` sauf les URLs comportant une
extension de fichier dans le dernier segment) traite toute URL de route API
sans extension — `/api/v1/health`, `/api/v1/game-servers` — comme une route
SPA : le service worker sert le shell `index.html` en cache au lieu de
laisser la requête atteindre la Pages Function. Bug réel constaté : une
navigation directe dans le navigateur vers `/api/v1/health` renvoyait le
shell app (assets cassés en 404/mauvais MIME) plutôt que la réponse JSON.
Corrigé en excluant explicitement `/api/**` dans `ngsw-config.json`
(`navigationUrls`). Un `fetch()` JS classique depuis le code applicatif
n'est PAS affecté (seule la navigation top-level du navigateur passe par ce
mécanisme) — le bug ne se voit qu'en testant une route API directement dans
la barre d'adresse, ce qui explique qu'il ne casse rien côté client une fois
l'app codée normalement, mais reste un piège pour tout futur endpoint sans
extension.
