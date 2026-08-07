# Serveur — Cloudflare Pages Functions + Neon

Voir `docs/plan-migration-serveur.md` (§4, §6, §9) pour le contexte complet.
Ce document couvre uniquement la mise en route pratique.

## Architecture

- **Front + API dans le même projet Cloudflare Pages** (pas de Worker
  séparé) : le front statique (`dist/wakfu-companion/browser`) et l'API
  (`functions/api/v1/*`, convention Pages Functions par chemin de fichier)
  sont servis depuis la **même origine** — indispensable pour que le futur
  cookie de session (lot 5) soit _first-party_.
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

| Secret                  | Description                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Déjà en place (déploiement Pages). Permission _Cloudflare Pages: Edit_.                                                                                                            |
| `CLOUDFLARE_ACCOUNT_ID` | Déjà en place.                                                                                                                                                                     |
| `DATABASE_URL`          | Chaîne de connexion **poolée** (PgBouncer intégré Neon, host `...-pooler...`) de la branche **production**.                                                                        |
| `DATABASE_URL_PREVIEW`  | Chaîne de connexion poolée d'une branche Neon **distincte**, dédiée à la preview (`claude/dev`) — jamais la branche production. Créer via _Neon → Branches → Create child branch_. |

`DATABASE_URL`/`DATABASE_URL_PREVIEW` sont aussi transmis comme variable
d'environnement chiffrée du projet Cloudflare Pages (poussé à chaque déploiement
via `wrangler pages secret put`, voir `.github/workflows/deploy-preview.yml` —
`deploy-main.yml`, encore sur GitHub Pages, ne les utilise pas pour l'instant)
: c'est ce qui les rend disponibles dans `context.env.DATABASE_URL` côté
Pages Functions.

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
- `GET /api/v1/catalog/version` — métadonnées du dernier import catalogue
  (voir plus bas).
- `GET /api/v1/catalog/index` — index compact objets+monstres, gzip.
- `GET /api/v1/catalog/search?q=&locale=fr|en|es|pt&kind=item|monster` —
  recherche serveur par sous-chaîne (ILIKE), 30 résultats max.
- `GET /api/v1/items/{id}` / `GET /api/v1/monsters/{id}` — détail complet
  (`id` = id Ankama).
- `GET /api/v1/dungeons` — liste complète (151 lignes, pas de format
  compact — volume négligeable), pour `findWakfuDungeonByBossMonsterId`
  côté client (lot 3.1).

## Catalogue Ankama (objets/monstres/donjons/recettes)

### D'où viennent les données : `referentiel/*.json`, pas un fetch direct

Contrairement à ce que le prompt 2.2 envisageait initialement, le script
d'import (`server/import/import-catalog.ts`) **ne lit pas**
`wakfu.cdn.ankama.com` directement : il lit les fichiers déjà committés dans
`referentiel/*.json`. Raison : la transformation brut Ankama → JSON curé
(fusion `items.json`/`jobsItems.json`, résolution des noms, vérification de
disponibilité d'image sur les CDN tiers, identification de la rareté "old")
ne fait partie d'aucun script de ce dépôt — elle vit dans deux **skills
externes** (`wakfu-items-sync`, `wakfu-monsters-sync`), publiés dans un
dépôt privé séparé (`wakfu-companion-private-skills`, plugin Claude),
exécutés **manuellement** par le mainteneur (le référentiel Ankama change
très rarement). Réimplémenter cette transformation ici aurait dupliqué une
logique en partie manuelle (voir le commentaire de
`tools/generate-wakfu-items-data.mjs` sur l'identification des objets
"old") — décision actée avec l'utilisateur.

Conséquence sur le déclenchement : **pas de cron quotidien** interrogeant
une version gamedata (il n'y a plus de fetch live à comparer). À la place,
`.github/workflows/import-catalog.yml` se déclenche sur tout push modifiant
`referentiel/**` (+ `workflow_dispatch` pour un rejeu manuel) — l'import
suit donc directement les mises à jour du référentiel committé, sans
polling.

### Script d'import

`npm run catalog:import` (= `tsx server/import/import-catalog.ts`) :
remplacement complet des tables `items`/`monsters`/`dungeons`/`item_recipes`
à chaque exécution (DELETE puis INSERT par lots de 1000 lignes), pas de
diff incrémental. Réutilise scrupuleusement les règles déjà établies côté
client (exclusion des objets de rareté "old", pas de déduplication par id
pour les objets — voir le commentaire de `server/db/schema.ts` sur la clé
primaire synthétique `items.pk`).

Réutilise `server/db/client.ts` (driver `neon-http`, voir plus haut) : pas
de vraies transactions inter-requêtes ici non plus. Un échec en cours
d'exécution peut laisser une table partiellement vidée — risque jugé
acceptable vu la fréquence d'exécution très faible (import déclenché par un
humain modifiant `referentiel/*.json`, pas par du trafic utilisateur). À
revoir avec `neon-serverless` si ce script doit un jour tourner sans
supervision.

### Index compact : la cible de 400 Ko s'entend gzip, pas en JSON brut

Mesures réelles sur le référentiel actuel (11 032 objets hors "old", 851
monstres) :

|      | v1 (lot 2.2, FR seul) | v2 (lot 3.1, 4 langues) | v3 (+ family/isBoss/isArchi/isDominant) |
| ---- | --------------------- | ----------------------- | --------------------------------------- |
| Brut | ~463 Ko               | ~1,14 Mo                | ~1,15 Mo (+7,4 Ko)                      |
| Gzip | ~149 Ko               | ~348 Ko                 | ~349 Ko (+1,3 Ko)                       |

Le format `{id, nom normalisé, nom affichable, gfxId, rareté, hasRecipe}`
par objet suggéré par le prompt 2.2 pèserait plus de 1 Mo en JSON brut rien
que pour le nom FR (~11 700 entrées, mesuré). Choix faits pour rester
compact :

1. **Tuples plutôt qu'objets** — évite de répéter les clés `"id":`,
   `"gfxId":`... ~11 700 fois. Voir `server/catalog/compact-index.ts`.
2. **Pas de version "normalisée" séparée** : le client applique
   `normalizeWakfuName()` (déjà disponible,
   `src/app/core/utils/wakfu-name.util.ts`) à la volée — inutile de doubler
   la charge utile pour ça.
3. **4 langues quand même nécessaires** (v2, lot 3.1) : découvert en
   démarrant ce lot — `findWakfuItemEntry`/`findWakfuMonsterEntry` côté
   client doivent reconnaître un objet quel que soit son nom dans
   `wakfu.log`, qui dépend de la langue du client Wakfu de l'utilisateur
   (pas nécessairement le français). Le v1 (FR seul) du lot 2.2 ne le
   permettait pas — corrigé ici plutôt que découvert en aval.
4. **`wakassetsAvailable`/`pictureUrl`/`wakfuAvailable` volontairement
   absents** de l'index : `pictureUrl` n'est pas déductible du `gfxId` et
   alourdirait significativement l'index. Mesuré : seuls 1 objet sur
   10 890 et 9 monstres sur 851 n'ont PAS wakassets comme source d'image
   valide — le client (lot 3.1) essaie wakassets puis un CDN de repli
   inconditionnellement plutôt que de dépendre d'un flag, régression
   acceptée et quantifiée sur ces ~10 entrées (icône générique à la place).
5. **`family`/`isBoss`/`isArchi`/`isDominant` ajoutés côté monstres (v3,
   lot 3.1 étape 4)**, contrairement au point précédent : nécessaires à
   `resolveFightImageInfo` (illustration de l'historique de combat, voir
   `src/app/core/utils/fight-image.util.ts`) pour rester synchrone, et non
   déductibles du `gfxId` — impact mesuré négligeable (+7,4 Ko brut / +1,3 Ko
   gzip pour 851 monstres, voir tableau ci-dessus). En revanche PAS de
   `pictureUrl` monstre dans l'index : contrairement aux objets, cette URL
   EST intégralement déductible du `gfxId`
   (`https://static.ankama.com/wakfu/portal/game/monster/42/{gfxId}.png`,
   vérifié strictement 851/851 sur le référentiel actuel) — même principe que
   les URLs d'icônes wakassets/CDN, déjà construites côté client à partir du
   seul `gfxId`.

**Le gzip (`Content-Encoding: gzip`, `CompressionStream` natif au runtime
Workers) ramène le transfert réel à ~348 Ko** — c'est ce qui est
effectivement envoyé au client, donc ce qui compte pour l'acceptation
« index servi < 400 Ko » du prompt 2.2. Chargé UNE FOIS au démarrage puis
mis en cache IndexedDB côté client (lot 3.1, `core/api/catalog.service.ts`)
: le poids réel supporté par l'utilisateur au fil de la navigation est donc
sans rapport avec la taille brute de cette seule réponse.

`server/catalog/compact-index.ts` est **partagé** entre le script d'import
(calcule l'empreinte `indexHash` au moment de l'import) et l'endpoint
`GET /api/v1/catalog/index` (sert le contenu réel) : les deux DOIVENT
produire des octets strictement identiques pour que `indexHash` reste une
empreinte fiable.

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
