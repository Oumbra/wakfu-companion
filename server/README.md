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

| Secret                        | Description                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`        | Déjà en place (déploiement Pages). Permission _Cloudflare Pages: Edit_.                                                                                                                                                                                                                                                                                      |
| `CLOUDFLARE_ACCOUNT_ID`       | Déjà en place.                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL`                | Chaîne de connexion **poolée** (PgBouncer intégré Neon, host `...-pooler...`) de la branche **production**.                                                                                                                                                                                                                                                  |
| `DATABASE_URL_PREVIEW`        | Chaîne de connexion poolée d'une branche Neon **distincte**, dédiée à la preview (`claude/dev`) — jamais la branche production. Créer via _Neon → Branches → Create child branch_.                                                                                                                                                                           |
| `PRICE_SERVICE_TOKEN_PREVIEW` | Jeton de service statique (lot 4, prompt 4.2) protégeant `/prices/ingest`, `/prices/export`, `/prices/rollups` sur la preview — n'importe quelle chaîne aléatoire suffisamment longue (ex. `openssl rand -hex 32`), **sans rapport** avec une session utilisateur. Pas d'équivalent prod pour l'instant (prod reste sur GitHub Pages, sans Pages Functions). |

Secrets/variables supplémentaires du **lot 5** (authentification), tous
**optionnels** : tant qu'ils sont absents, `/api/v1/auth/{provider}/*` répond
`503 fournisseur non configuré` et l'application reste pleinement utilisable
en mode invité (§7 du plan). Le workflow de déploiement les pousse seulement
s'ils sont définis, jamais en échec sinon.

| Secret / variable                                                                                | Description                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DISCORD_CLIENT_ID_PREVIEW` / `DISCORD_CLIENT_SECRET_PREVIEW`                                     | Application Discord (_Developer Portal → Applications → OAuth2_). Redirect URI à déclarer : `<PUBLIC_BASE_URL>/api/v1/auth/discord/callback`.                                                                              |
| `GOOGLE_CLIENT_ID_PREVIEW` / `GOOGLE_CLIENT_SECRET_PREVIEW`                                       | Identifiants OAuth 2.0 Google (_Google Cloud Console → API et services → Identifiants_). Redirect URI : `<PUBLIC_BASE_URL>/api/v1/auth/google/callback`.                                                                   |
| `PUBLIC_BASE_URL_PREVIEW` (**variable** GitHub, pas un secret)                                     | Origine publique stable de la preview, ex. `https://wakfu-companion.pages.dev`. Indispensable : une preview Cloudflare a aussi une URL **par déploiement** (`<hash>.wakfu-companion.pages.dev`), qui ne peut pas être déclarée chez le fournisseur. |

`DATABASE_URL`/`DATABASE_URL_PREVIEW`/`PRICE_SERVICE_TOKEN_PREVIEW` sont
aussi transmis comme variable d'environnement chiffrée du projet Cloudflare
Pages (poussé à chaque déploiement via `wrangler pages secret put`, voir
`.github/workflows/deploy-preview.yml` — `deploy-main.yml`, encore sur
GitHub Pages, ne les utilise pas pour l'instant) : c'est ce qui les rend
disponibles dans `context.env.DATABASE_URL`/`context.env.PRICE_SERVICE_TOKEN`
côté Pages Functions.

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
- `GET /api/v1/catalog/` — index compact objets+monstres, gzip (surtout
  **pas** `/catalog/index` — voir gotcha ci-dessous).
- `GET /api/v1/catalog/search?q=&locale=fr|en|es|pt&kind=item|monster` —
  recherche serveur par sous-chaîne (ILIKE), 30 résultats max.
- `GET /api/v1/items/{id}` / `GET /api/v1/monsters/{id}` — détail complet
  (`id` = id Ankama).
- `GET /api/v1/dungeons` — liste complète (151 lignes, pas de format
  compact — volume négligeable), pour `findWakfuDungeonByBossMonsterId`
  côté client (lot 3.1).
- `GET /api/v1/prices/{itemId}?server=&range=` — série de prix d'un objet
  (public), voir plus bas.
- `GET /api/v1/prices/trends?server=&dir=up|down&limit=` — classement
  hausses/baisses (public), voir plus bas.
- `POST /api/v1/prices/ingest`, `GET /api/v1/prices/export`,
  `POST /api/v1/prices/rollups` — protégés par jeton de service, voir plus
  bas (lot 4, prompt 4.2).
- `GET /api/v1/auth/{discord|google}/start` — démarre le flux OAuth
  (redirection 302, `state` + PKCE), `?redirect_to=/chemin` optionnel.
- `GET /api/v1/auth/{discord|google}/callback` — retour du fournisseur,
  échange du code côté serveur, pose du cookie de session, redirection vers
  l'application (`?login=ok` / `?login=error&reason=…`).
- `GET /api/v1/auth/me` — utilisateur courant, **401 si non connecté (cas
  normal : mode invité)**.
- `POST /api/v1/auth/logout` — révoque la session courante.
- `GET /api/v1/auth/sessions` — sessions actives ;
  `DELETE /api/v1/auth/sessions[?id=…]` — révoque une session précise, ou
  toutes.
- `DELETE /api/v1/auth/account` — suppression du compte (RGPD, cascade).

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
logique en partie manuelle (voir le commentaire de `normalizeRarity` dans
`server/import/import-catalog.ts` sur l'identification des objets "old",
seule implémentation restante depuis la suppression des tables embarquées
côté client, lot 3.1 étape 8) — décision actée avec l'utilisateur.

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

**La compression gzip/brotli automatique de l'edge Cloudflare ramène le
transfert réel à ~348 Ko** — c'est ce qui est effectivement envoyé au
client, donc ce qui compte pour l'acceptation « index servi < 400 Ko » du
prompt 2.2. **PAS de compression manuelle côté Worker** (voir gotcha
ci-dessous) : l'endpoint renvoie le JSON brut, Cloudflare compresse
automatiquement à l'edge selon l'`Accept-Encoding` du client — seul
mécanisme dont la décompression côté navigateur est fiable via `fetch()`.
Chargé UNE FOIS au démarrage puis mis en cache IndexedDB côté client (lot
3.1, `core/api/catalog.service.ts`) : le poids réel supporté par
l'utilisateur au fil de la navigation est donc sans rapport avec la taille
brute de cette seule réponse.

`server/catalog/compact-index.ts` est **partagé** entre le script d'import
(calcule l'empreinte `indexHash` au moment de l'import) et l'endpoint
`GET /api/v1/catalog/` (sert le contenu réel) : les deux DOIVENT
produire des octets strictement identiques pour que `indexHash` reste une
empreinte fiable.

### ⚠️ Piège : `/api/v1/catalog/index` redirige (308) vers `/api/v1/catalog/`

Bug réel constaté en production (preview) après le premier import réussi du
catalogue : le fichier `functions/api/v1/catalog/index.ts` sert la racine de
son dossier (`/api/v1/catalog/`), convention standard de Cloudflare Pages
Functions — un fichier nommé `index.ts` n'est **jamais** adressable via un
segment littéral `/index` en fin d'URL, Cloudflare redirige automatiquement
(308) vers le chemin sans ce segment (même logique qu'un serveur statique
qui redirige `/foo/index.html` vers `/foo/`). `CatalogService` appelait au
départ `/catalog/index` : la redirection cassait silencieusement le
chargement (catalogue jamais peuplé côté client, malgré une base bien
remplie et un `GET /api/v1/catalog/version` fonctionnel). Corrigé en faisant
appeler au client le chemin réellement servi, `/catalog/` — **ne jamais**
faire terminer une route Pages Functions par le segment `index`, quel que
soit le nom du fichier qui la sert.

### ⚠️ Piège : ne jamais poser `Content-Encoding` à la main sur une Response Worker

Deuxième bug réel constaté juste après le précédent (même endpoint,
redirection corrigée mais toujours aucune donnée exploitable côté client) :
`functions/api/v1/catalog/index.ts` compressait la réponse à la main
(`Blob(...).stream().pipeThrough(new CompressionStream('gzip'))`) puis
posait `content-encoding: gzip` lui-même. Symptôme côté navigateur :
`fetch('/api/v1/catalog/').then(r => r.json())` échouait avec `SyntaxError:
Unexpected token '�'... is not valid JSON` — le corps recevait bien les
octets gzip bruts, mais `fetch()` ne les décompressait PAS automatiquement.
Contrairement à une compression négociée "normalement" par un vrai
CDN/proxy (où `Accept-Encoding` du client et `Content-Encoding` de la
réponse sont mis en correspondance au niveau protocole), un
`Content-Encoding` défini directement par le script d'un Worker n'est pas
fiablement décompressé côté navigateur. Corrigé en renvoyant le JSON brut
et en laissant l'edge Cloudflare appliquer sa propre compression
automatique (gzip/brotli selon `Accept-Encoding`) — **ne jamais** compresser
manuellement une `Response` de Pages Function/Worker destinée à un
navigateur ; laisser Cloudflare le faire.

### Bilan bundle client (lot 3.1, prompt 3.1 — étape 9/9)

Mesuré via `npm run build` (`ng build` production) :

|                                   | Avant (référentiels embarqués) | Après (catalogue distant) |
| --------------------------------- | ------------------------------ | ------------------------- |
| Bundle initial (brut)             | ~4,76 Mo                       | ~472 Ko                   |
| Bundle initial (transfert estimé) | ~466 Ko                        | ~117 Ko                   |

Réduction ≈ 4,29 Mo brut, cohérente avec l'estimation initiale du prompt
3.1 (« 4,25 Mo, 79,6 % du bundle »). Le budget `angular.json` (`type:
initial`) a été resserré en conséquence (4 Mo/8 Mo -> 700 Ko/1,5 Mo) pour
rester une protection utile contre une régression future, plutôt qu'un
seuil devenu 10× trop large.

Vérifié en navigateur (Chromium/playwright-core) : autocomplétion objet et
monstre (latence perçue nulle, recherche dans l'index local), résolution
de recette (async, cascade sur plusieurs niveaux), icônes d'objets et de
monstres, comptage de butin sur des lignes de log simulées, et **rechargement
hors-ligne après une première visite réussie** (catalogue pré-rempli en
IndexedDB + service worker actif : `CatalogService.status()` passe
directement à `ready` sans requête réseau, aucun badge « catalogue
indisponible » affiché).

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

## Prix (lot 4, prompt 4.2)

Voir `docs/plan-migration-serveur.md` §8 pour le contexte complet (source,
limites à énoncer côté UI, volumétrie). Cette section couvre l'architecture
serveur réellement retenue, qui diffère du plan initial sur un point
important — voir ci-dessous.

### Architecture : calcul délégué à un skill local, pas au serveur

Le plan initial prévoyait `price_trends` en vue matérialisée SQL et
`item_prices_monthly` consolidée par un Cloudflare Cron Trigger quotidien.
**Ni l'un ni l'autre n'a été retenu** : ce projet est déployé en **Cloudflare
Pages classique** (`cloudflare/pages-action`, voir `deploy-preview.yml`), qui
**ne supporte pas les Cron Triggers** — fonctionnalité réservée aux Workers
autonomes, découvert en préparant ce prompt.

Décision actée avec l'utilisateur : au lieu d'un cron serveur, un **second
skill local dédié** (calcul pur, indépendant du skill de scan vidéo du
prompt 4.1) lit les prix bruts via `GET /api/v1/prices/export`, calcule
`item_prices_monthly` (mois courant) et `price_trends` (30j vs 30j
précédents), puis pousse le résultat via `POST /api/v1/prices/rollups`. Même
philosophie que le catalogue (lot 2) : le calcul vit dans un skill externe,
le serveur ne fait qu'ingérer un résultat déjà prêt. Conséquence sur le
schéma (`server/db/schema.ts`) : `price_trends` est une vraie **table**
écrite par upsert, pas une vue matérialisée recalculée sur place.

Le prompt destiné à ce skill (à faire jouer dans le dépôt privé
`wakfu-companion-private-skills`, même précédent que
`wakfu-items-sync`/`wakfu-monsters-sync`) est fourni séparément par la
session ayant implémenté ce prompt 4.2 — pas committé ici.

### Jeton de service (`PRICE_SERVICE_TOKEN`)

`POST /prices/ingest`, `GET /prices/export` et `POST /prices/rollups` sont
protégés par un jeton de service **statique** (en-tête
`Authorization: Bearer <jeton>`, voir `functions/api/_price-auth.ts`) — PAS
une session utilisateur, sans rapport avec l'authentification du lot 5 (pas
encore implémentée). Seuls les deux skills locaux (vidéo, trends) l'utilisent
; le navigateur d'un joueur ne l'appelle jamais. `GET /prices/{itemId}` et
`GET /prices/trends` restent **publics**, sans jeton — ce sont les seuls
endpoints prix consommés par l'application elle-même (prompt 4.3).

### Rejet explicite des `itemId` inconnus du catalogue

`/prices/ingest` et `/prices/rollups` valident chaque `itemId` contre la
table `items` (`ankamaId`) avant upsert : un id absent du catalogue est
**exclu** (jamais silencieusement ignoré, voir prompt 4.2 point 5) — listé
dans la réponse JSON de l'appel ET, pour `/ingest`, dans
`price_scan_runs.notes` pour une trace persistée. Le reste du lot (les ids
connus) est tout de même upserté : un id ponctuellement invalide ne doit pas
faire échouer tout le lot du jour.

### Vérification effectuée / restant à faire

Vérifié dans cette session, sans connexion DB réelle (le sandbox ne peut
atteindre ni Neon ni `*.pages.dev`, voir gotchas plus haut) : compilation
`tsconfig.server.json` propre, et un script `tsx` ad hoc validant les
fonctions pures (`parseIngestBody`/`parseRollupsBody`/validation de forme,
bornage de dates `currentMonthStart`/`monthsAgo`/`defaultSince`,
`checkPriceServiceToken`) sur une vingtaine de cas — tous corrects.

**Restant à faire avant de considérer ce prompt pleinement vérifié** (comme
pour le catalogue, deux bugs réels n'avaient été détectables qu'en testant
le déploiement preview réel, voir gotchas ci-dessus) : un round-trip complet
contre la base preview une fois déployé — `POST /ingest` avec un petit lot
synthétique, vérifier l'upsert idempotent (ré-ingérer le même jour ne
duplique pas), `GET /export`, `POST /rollups`, puis `GET /prices/{itemId}`
et `GET /prices/trends`.

### `priceMax` sur `item_prices_daily` (scan mémoire HDV)

Ajouté a posteriori du prompt 4.2 : un second skill de scan, **par lecture
mémoire** du client Java plutôt que par vidéo/OCR
(`wakfu-hdv-memory-scan`, dépôt privé `wakfu-companion-private-skills`),
parcourt les pages de l'hôtel des ventes et peut fournir, pour un même
objet et un même jour, à la fois le prix le plus bas ET le plus haut
observés — contrairement au skill vidéo (prompt 4.1) qui ne voit qu'un
seul prix par jour.

- Migration `0003_add_price_max_to_daily.sql`, en 3 temps (colonne
  nullable → backfill `priceMax = price` sur les lignes existantes →
  `NOT NULL`) pour rester sûre sur une table déjà peuplée par le skill
  vidéo en production.
- `POST /ingest` : `priceMax` optionnel dans `items[]`, retombe sur
  `price` si absent — le skill vidéo continue de fonctionner sans
  modification, rétrocompatible.
- `GET /export` : `priceMax` désormais exposé dans la série brute.
- `compute-price-trends.mjs` (skill `wakfu-price-trends`, dépôt privé)
  utilise ce vrai maximum quand disponible au lieu de retomber sur `price`
  pour calculer `item_prices_monthly.priceMax` — tests du skill toujours au
  vert.

Préparé et committé côté `wakfu-companion` uniquement : migration **pas
encore appliquée** sur la base preview, et le skill mémoire HDV pas encore
déployé en scan quotidien (voir `wakfu-sync-skills:wakfu-hdv-memory-scan`).

## Authentification (lot 5, prompt 5.1)

Voir `docs/plan-migration-serveur.md` §7 pour le cadre (OAuth uniquement,
cookie opaque, mode invité intact). Cette section documente ce qui a été
réellement implémenté et les écarts assumés.

### Ce qui n'existe pas, volontairement

Aucun mot de passe : pas de `password_hash`, pas de réinitialisation, pas de
vérification d'e-mail à écrire. Motivé §7 par la limite de **10 ms de CPU par
requête** du plan gratuit Cloudflare, dans laquelle un hachage de mot de passe
correct ne tient pas — un hachage affaibli pour y tenir serait une sécurité de
façade.

### Organisation du code

| Fichier                                       | Rôle                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `server/auth/store.ts`                        | **Port** de persistance (interface). C'est lui qui rend la logique testable sans base.   |
| `server/auth/flow.ts`                         | Toute la logique : validation du `state`, usage unique du code, fusion de comptes, sessions, CSRF. Ne connaît ni Postgres ni Cloudflare. |
| `server/auth/db-store.ts`                     | Traduction SQL du port (drizzle/Neon). Aucune décision métier.                            |
| `server/auth/memory-store.ts`                 | Même port, en mémoire — **tests uniquement**, jamais importé par une route.                |
| `server/auth/providers.ts`                    | Discord/Google : URLs, scopes, échange de code, normalisation du profil.                   |
| `server/auth/cookies.ts`, `crypto.ts`, `rate-limit.ts` | Cookies, WebCrypto (aucune dépendance npm ajoutée), limitation de débit.        |
| `functions/api/_auth.ts`                      | Colle runtime : résolution de session, 401, contrôle CSRF, lecture des secrets.            |

Tests : `npm run test:server` (config `vitest.server.config.ts`, séparée de
`npm test` qui passe par le builder Angular et ne voit que `src/`). Couvrent
les quatre exigences du prompt — `state` invalide, code rejoué, session
révoquée, fusion sur e-mail — plus redirection ouverte, CSRF, rotation,
expiration glissante et limitation de débit.

### Trois écarts par rapport au schéma du §6 du plan

1. **`sessions.id` n'est pas le jeton, mais son SHA-256.** Le jeton opaque
   (256 bits) ne vit que dans le cookie `httpOnly`. Une fuite en lecture de la
   table ne permet donc pas d'usurper une session.
2. **`users.email` en `text` normalisé en minuscules**, pas en `citext` :
   évite un `CREATE EXTENSION` pour un gain nul dès lors que la normalisation
   se fait en un seul endroit (`resolveAccount`, `server/auth/flow.ts`).
3. **Deux tables non prévues au §6** : `oauth_authorizations` (le
   `code_verifier` PKCE ne doit jamais atteindre le navigateur, et
   `consumed_at` rend le `state`/`code` à usage unique) et `auth_rate_limits`
   (limitation de débit en base, faute de Cron Trigger et pour éviter un
   binding KV supplémentaire — même contrainte Cloudflare Pages que pour les
   rollups de prix).

### Fusion de comptes : rattachement automatique sur e-mail vérifié

Décision du §7, appliquée telle quelle : si l'e-mail **vérifié** renvoyé par
le fournisseur correspond déjà à un compte, la nouvelle identité y est
rattachée automatiquement (pas d'écran de liaison manuelle). Les deux
fournisseurs vérifient l'adresse, ce qui rend le rattachement sûr.

Corollaire important : **un profil sans e-mail vérifié ne participe jamais à
la fusion** (`providers.ts` normalise un e-mail non vérifié en `null`) — sans
quoi une adresse non validée permettrait de s'approprier le compte d'un tiers.
Un tel compte reste parfaitement utilisable, il est simplement isolé par
fournisseur.

### CSRF : jeton double-submit dérivé, non stocké

`SameSite=Lax` est la première barrière. La seconde est un jeton double-submit
(`X-CSRF-Token` sur les routes mutatives), **dérivé du jeton de session par
hachage** plutôt que stocké en base : le cookie `wc_csrf` est lisible en JS
par construction, mais un hachage n'est pas inversible. Aucune colonne, aucune
expiration séparée à gérer. Le contrôle ne retombe **jamais** sur le cookie en
l'absence d'en-tête — ce serait exactement ce que la protection empêche (le
cookie voyage seul, l'en-tête non).

### `PUBLIC_BASE_URL` : pourquoi l'origine de la requête ne suffit pas

L'URL de redirection OAuth doit être déclarée à l'identique chez le
fournisseur. Or Cloudflare Pages sert chaque déploiement de preview sous une
URL propre (`<hash>.wakfu-companion.pages.dev`) : déduire l'origine de la
requête ferait échouer l'échange sur ces URLs. `PUBLIC_BASE_URL` fixe donc
l'origine publique stable ; l'origine de la requête n'est qu'un repli pour le
développement local.

### Vérification effectuée / restant à faire

Vérifié dans cette session : `npm run test:server` (tous verts, aucune base ni
réseau requis) et `npx tsc -p tsconfig.server.json --noEmit`.

**Restant à faire** — comme pour le catalogue et les prix, seuls un
déploiement et une vraie application OAuth permettent de conclure :

1. appliquer la migration `0004_auth_tables.sql` sur la branche Neon preview ;
2. créer les applications Discord et Google, poser les secrets, déclarer les
   deux redirect URIs ;
3. dérouler un aller-retour réel de connexion sur la preview, vérifier le
   cookie (`httpOnly`, `Secure`, `SameSite=Lax`), `GET /auth/me`, la
   révocation d'une session depuis un autre appareil, et la suppression de
   compte.
