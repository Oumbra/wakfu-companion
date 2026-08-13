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

| Secret / variable                                              | Description                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_CLIENT_ID_PREVIEW` / `DISCORD_CLIENT_SECRET_PREVIEW`  | Application Discord (_Developer Portal → Applications → OAuth2_). Redirect URI à déclarer : `<PUBLIC_BASE_URL>/api/v1/auth/discord/callback`.                                                                                                       |
| `GOOGLE_CLIENT_ID_PREVIEW` / `GOOGLE_CLIENT_SECRET_PREVIEW`    | Identifiants OAuth 2.0 Google (_Google Cloud Console → API et services → Identifiants_). Redirect URI : `<PUBLIC_BASE_URL>/api/v1/auth/google/callback`.                                                                                            |
| `PUBLIC_BASE_URL_PREVIEW` (**variable** GitHub, pas un secret) | Origine publique stable de la preview, ex. `https://wakfu-companion.pages.dev`. Indispensable : une preview Cloudflare a aussi une URL **par déploiement** (`<hash>.wakfu-companion.pages.dev`), qui ne peut pas être déclarée chez le fournisseur. |

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

### D'où viennent les données : `repository/*.json`, pas un fetch direct

Contrairement à ce que le prompt 2.2 envisageait initialement, le script
d'import (`server/import/import-catalog.ts`) **ne lit pas**
`wakfu.cdn.ankama.com` directement : il lit les fichiers déjà committés dans
`repository/*.json`. Raison : la transformation brut Ankama → JSON curé
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
`repository/**` (+ `workflow_dispatch` pour un rejeu manuel) — l'import
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
humain modifiant `repository/*.json`, pas par du trafic utilisateur). À
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

| Fichier                                                | Rôle                                                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `server/auth/store.ts`                                 | **Port** de persistance (interface). C'est lui qui rend la logique testable sans base.                                                   |
| `server/auth/flow.ts`                                  | Toute la logique : validation du `state`, usage unique du code, fusion de comptes, sessions, CSRF. Ne connaît ni Postgres ni Cloudflare. |
| `server/auth/db-store.ts`                              | Traduction SQL du port (drizzle/Neon). Aucune décision métier.                                                                           |
| `server/auth/memory-store.ts`                          | Même port, en mémoire — **tests uniquement**, jamais importé par une route.                                                              |
| `server/auth/providers.ts`                             | Discord/Google : URLs, scopes, échange de code, normalisation du profil.                                                                 |
| `server/auth/cookies.ts`, `crypto.ts`, `rate-limit.ts` | Cookies, WebCrypto (aucune dépendance npm ajoutée), limitation de débit.                                                                 |
| `functions/api/_auth.ts`                               | Colle runtime : résolution de session, 401, contrôle CSRF, lecture des secrets.                                                          |

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

## Parcours client (lot 5, prompt 5.2)

| Fichier                                  | Rôle                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/app/core/auth/auth.service.ts`      | État de session en signaux, connexion/déconnexion, sessions, suppression de compte, décision de migration. |
| `src/app/features/auth/login-page/`      | Deux boutons (Discord, Google) + erreur explicite au retour d'un échec.                                    |
| `src/app/features/auth/account-page/`    | Identité, fournisseurs liés, appareils connectés (révocation), export, suppression, écran de migration.    |
| `src/app/core/api/api-client.service.ts` | `requestJson` (écritures + en-tête CSRF) et le point d'accroche global du `401`.                           |

Trois points valent d'être retenus :

**Le « 401 → mode invité » n'est pas un intercepteur Angular.** L'application
n'utilise pas `HttpClient` : tout passe par `ApiClientService`, où un seul
point d'accroche (`setUnauthorizedHandler`, enregistré par `AuthService`)
couvre donc l'intégralité des appels API. Un 401 est un cas normal, pas une
panne : la session a expiré ou a été révoquée depuis un autre appareil, et
l'application continue sans compte.

**Aucune garde de route.** `login` et `account` sont deux vues de plus dans
`NavigationService` (chargées en `@defer`, donc en lazy chunk), atteintes
uniquement par un clic sur le bouton compte de l'en-tête. Ce bouton est
volontairement visible **même avant qu'un fichier `wakfu.log` soit connecté**
(contrairement au bouton profil) : se connecter ne dépend d'aucun fichier, et
l'écran de configuration est justement là où un joueur arrivant sur un nouvel
appareil voudra récupérer ses données.

**La migration des données ne fusionne jamais.** Après une connexion réussie,
le client compare les données locales et celles du compte, puis pose une
question explicite selon les quatre cas possibles (rien / téléverser /
récupérer / conflit à trancher). Le remplacement est complet dans les deux
sens, et l'écran de conflit rappelle qu'un export fichier reste possible avant
de choisir.

### Politique de confidentialité mise à jour

`privacy.notice.body` (4 locales) affirmait « aucun serveur, aucune base de
données, aucun compte utilisateur » — faux dès ce lot. Réécrite pour couvrir
les deux modes d'utilisation, les données réellement conservées avec un
compte, le cookie de session, le fait que le chat n'est jamais transmis,
l'hébergement (Cloudflare + Neon) et les droits RGPD (export, suppression
réelle). Obligation annoncée au §7 du plan.

## Configuration utilisateur synchronisée (lot 6, prompt 6.1)

Objectif du lot : ne plus perdre ses données en vidant son navigateur, et les
retrouver d'un appareil à l'autre. Voir `docs/plan-migration-serveur.md` §4
(« deux modes de données utilisateur ») et §11.

### Aucune migration de base

`user_settings` existait déjà (`0005_user_settings.sql`, créée par
anticipation au lot 5) et convient telle quelle : `updated_at` par ligne EST
l'horodatage par clé dont l'arbitrage a besoin. Le lot 6 n'ajoute donc aucun
fichier de migration.

### Trois verbes, deux usages

| Verbe                    | Usage                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/settings`   | Valeurs **et** `updatedAtByKey` (nouveau) — c'est lui qui rend l'arbitrage possible côté client.                                                             |
| `PATCH /api/v1/settings` | Écriture par clé, « dernier écrivain gagne ». Chemin normal de la synchronisation au fil de l'eau.                                                           |
| `PUT /api/v1/settings`   | Remplacement complet, **sans arbitrage** — le « téléverser mes données locales » de l'écran de migration du lot 5, où l'utilisateur a explicitement tranché. |

**Écart assumé par rapport au prompt** (« endpoints GET et PUT (par clé et en
lot) ») : pas de route `/settings/{key}`. Un `PATCH` d'une seule entrée EST
l'écriture par clé, et faire coexister un fichier `settings.ts` et un dossier
`settings/` dans `functions/` est exactement le genre d'ambiguïté de routage
Pages Functions qui a déjà coûté un bug en production sur `/catalog/index`
(voir plus haut). Un verbe distinct est plus sûr qu'un chemin ambigu.

### Arbitrage : où il est décidé, et pourquoi deux fois

`server/settings/merge.ts` (pur, testé sans base — `merge.spec.ts`) tranche à
partir d'un `SELECT` des horodatages courants. L'`INSERT ... ON CONFLICT` porte
en plus un `setWhere (updated_at < excluded.updated_at)` : entre le `SELECT` et
l'écriture, un autre appareil a pu écrire, et sans cette condition SQL une
écriture plus ancienne pourrait écraser une plus récente — précisément ce que
l'arbitrage cherche à empêcher.

Les clés refusées repartent au client **avec la valeur conservée**, qui
s'aligne dessus sans second aller-retour.

### Liste blanche de clés

`server/settings/keys.ts` énumère les six clés acceptées, en miroir exact de
`src/app/core/data-access/user-data.keys.ts` côté client. Toute autre clé est
refusée en 400, sur `PATCH` comme sur `PUT` : `user_settings` n'a aucune autre
borne et son contenu est du `jsonb` opaque.

### Horloges clientes : deux garde-fous

L'horodatage vient du client, donc de son horloge. Deux protections, aux deux
bouts :

1. **Serveur** — un `updatedAt` à plus de 24 h dans le futur est refusé
   (`MAX_CLOCK_SKEW_MS`). Sans cette borne, une date lointaine rendrait la clé
   impossible à écraser depuis n'importe quel autre appareil.
2. **Client** — une écriture locale est horodatée au plus tard entre
   « maintenant » et « la version remplacée + 1 ms »
   (`LocalUserDataRepository.write`). Bug réel constaté en vérification
   navigateur : après avoir récupéré une valeur d'un appareil dont l'horloge
   avance, l'appareil local ne pouvait plus rien modifier — ses écritures
   étaient horodatées _avant_ ce qu'elles remplaçaient, donc rejetées.

### Côté client

| Fichier                                           | Rôle                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `core/data-access/user-data.keys.ts`              | Les six clés + la clé de métadonnées locale. N'importe rien (évite les cycles avec les services).    |
| `core/data-access/user-data.repository.ts`        | L'interface unique du §4 : `read`/`write` **synchrones**, `flush`.                                   |
| `core/data-access/local-user-data.repository.ts`  | Mode invité : `localStorage`, comportement d'avant le lot 6, + horodatage par clé.                   |
| `core/data-access/remote-user-data.repository.ts` | Mode connecté : `pull()` au démarrage, écriture décalée (1,5 s) groupée, réapplication des rejets.   |
| `core/data-access/user-data.service.ts`           | Façade consommée par les services applicatifs + registre d'abonnés aux changements venus d'ailleurs. |

**La lecture reste synchrone, et c'est structurant.** `ProfileService`,
`CharacterRosterService` et `StatsStoreService` lisent leur état dans leur
constructeur pour initialiser des signaux, et la watchlist est réécrite en
plein chemin chaud de parsing. La copie `localStorage` reste donc la source de
vérité immédiate dans les deux modes ; le compte est une **réplication**, pas
un chemin de lecture. Même raisonnement que pour `findWakfuItemEntry` (§4,
point de vigilance n°3 du plan).

**Le seul `if (connecté)` vit dans `AuthService`**, qui déclenche
`activateRemote()` / `deactivateRemote()`. Aucun composant ne connaît l'état de
connexion (exigence du §4).

**Changements venus d'un autre appareil** : `UserDataService.onExternalChange`
laisse `ProfileService`, `CharacterRosterService`, `StatsStoreService`
(watchlist) et le panneau de chat recharger leurs signaux — pas de
`location.reload()`. Deux exceptions volontaires :

- `damageReassignments` n'est **pas** rechargé à chaud : le journal des
  réattributions est rejoué au fil de l'ingestion des combats, le remplacer en
  pleine session appliquerait des corrections à des combats déjà affichés. La
  valeur est bien écrite sur le disque, elle prendra effet au prochain
  démarrage.
- L'écran de migration du lot 5 (`download`) recharge toujours la page : il
  remplace tout d'un coup, y compris ce qui n'est pas rechargeable à chaud.

**La synchronisation n'est jamais lancée tant qu'une décision de migration est
en attente** (`AuthService.handleStartup`) : arbitrer clé par clé pendant qu'on
demande encore à l'utilisateur quelle source garder reviendrait à fusionner en
silence, ce que le prompt 5.2 interdit.

### Gating `isInitialLoad` : rien ne change

La watchlist et ses compteurs restent du **suivi persistant** (principe
d'architecture n°2 de `CLAUDE.md`) : jamais incrémentés pendant
`isInitialLoad`, jamais réinitialisés. Une version venue d'un autre appareil la
remplace intégralement, compteurs compris — c'est la sémantique voulue, sans
rapport avec le gating, qui ne concerne que les incréments issus du fichier de
log. Vérifié en navigateur (voir ci-dessous).

### Bouton « Synchroniser maintenant » : correction d'un bouton mort

Le bouton de la page compte appelait `chooseMigration('upload')`, or
`resolveMigration()` sort immédiatement quand aucune décision de migration
n'est en attente — c'est-à-dire dans la quasi-totalité des cas. Il ne faisait
donc rien depuis le lot 5. Il appelle désormais `AuthService.syncNow()` (envoi
de ce qui est en attente, puis réalignement sur le compte), accompagné d'un
état de synchronisation visible (pastille + libellé + heure de dernière
synchronisation).

### Vérification effectuée / restant à faire

Vérifié dans cette session : `npm test` (89 tests, dont 15 nouveaux sur
`UserDataService`), `npm run test:server` (40 tests, dont 15 sur
`server/settings/merge.ts`), `npm run build`, et **une vérification navigateur
réelle** (Chromium/playwright-core, `ng serve`) avec un faux backend injecté
via `fetch` — les Pages Functions n'existent pas sous `ng serve`. 15/15 points
vérifiés : mode invité sans aucune requête `/settings`, récupération d'une
valeur de compte plus récente (et rechargement des signaux sans F5),
téléversement d'une valeur locale plus récente, trois écritures groupées en un
seul `PATCH` après le délai, compteur de suivi non regonflé par un
rechargement initial, incrément réel bien répliqué, retour propre au mode
invité.

**Restant à faire**, comme pour les lots précédents — seul un déploiement réel
permet de conclure : dérouler la synchronisation entre deux vrais navigateurs
connectés au même compte sur la preview (le round-trip `PATCH`/arbitrage n'a
jamais touché Neon depuis ce sandbox, qui ne peut atteindre ni la base ni
`*.pages.dev`).

## Serveur de jeu (lot 7, prompt 7.1)

Objectif : pouvoir taguer l'historique personnel du lot 8 (combats, achats,
échanges) par serveur de jeu. **Sans aucun lien avec le monitoring de prix**
(lot 4), dont la source est un scan opéré côté serveur.

### Rien de nouveau côté serveur

Ce lot n'ajoute ni endpoint, ni table, ni migration. `GET /api/v1/game-servers`
(lot 2) fournit déjà la liste, et c'est le seul appel réseau du lot — la liste
n'est **jamais** compilée en dur côté client (les serveurs Wakfu fusionnent et
changent de nom).

### Le log ne dit jamais sur quel serveur on joue

Vérifié sur `assets/logs/tests/fr/purchase_2.log` : aucune trace du serveur. Il
doit donc être **déclaré**. La conception le rattache au **compte du roster**
(`RosterAccount.gameServer`) et non à l'utilisateur : un joueur multi-compte
peut être réparti sur plusieurs serveurs, et c'est la seule façon de le gérer
sans lui demander de basculer un sélecteur à la main.

`GameServerService.activeServer` (`core/services/game-server.service.ts`) tient
en une seule règle, sans repli : le serveur est celui du compte auquel
appartient le **dernier personnage du roster reconnu dans le log**
(`noticeCharacter`, alimenté par `StatsStoreService` sur `fighter-joined`
non-IA et sur les échanges). Tant qu'aucun ne l'a été, `activeServer` vaut
`null` et le badge devient une invite cliquable vers l'onglet Personnages —
non bloquante, tout le reste de l'application fonctionne.

**Pas de « serveur par défaut » global.** Le prompt 7.1 en prévoyait un ; il a
été implémenté puis retiré à la demande de l'utilisateur. Un repli global
n'aurait affiché qu'une valeur plausible mais non vérifiée, alors que tout
l'intérêt de cette déduction est d'être factuelle — et il aurait fini par
taguer l'historique du lot 8 avec une donnée que personne n'a confirmée. Même
raison pour les deux règles suivantes :

- **Aucune valeur inventée.** Un compte sans serveur reste « non renseigné » ;
  deviner « Pandora » parce que c'est le plus peuplé serait une donnée
  fabriquée.
- **Un personnage reconnu dont le compte n'a pas de serveur ne prend pas celui
  d'un autre compte** : rien n'est affiché.

Conséquence côté schéma : `users.default_game_server` (posée au lot 5 « pour
éviter une migration supplémentaire ») **reste inutilisée**. Colonne nullable
sans lecteur, elle ne coûte rien ; à supprimer si le lot 8 confirme qu'elle ne
sert à rien.

### Où vit la donnée

`RosterAccount.gameServer` part avec la clé `roster`, donc **synchronisé avec
le compte** via le lot 6 (écrit après ce prompt, qui disait « tout tient dans
le localStorage via `PersistenceService` ») : ça n'ajoute aucun appel serveur,
la valeur voyage dans une charge utile déjà synchronisée.

La liste des serveurs, elle, est mise en cache dans une clé locale **hors**
`USER_DATA_KEYS` : ce n'est pas une donnée utilisateur mais une copie d'une
table serveur, elle n'a rien à faire dans le compte ni dans l'export RGPD.

### Hors ligne

Si la liste ne peut être chargée (ni réseau ni cache), un serveur déjà choisi
reste affiché à partir de son seul code (`resolveServer`) : afficher « non
renseigné » alors que l'utilisateur l'a renseigné serait un mensonge. Ce repli
ne sert jamais à _proposer_ un choix — les sélecteurs ne lisent que la liste
réelle.

### État dérivé du fichier, pas du suivi persistant

Le dernier personnage reconnu n'est pas persisté : il se reconstruit à chaque
lecture du log. Le mettre à jour pendant `isInitialLoad` est donc ici le
comportement **correct** (une reconnexion relit tout le fichier et retrouve
naturellement le dernier personnage vu), contrairement aux compteurs de suivi —
principe d'architecture n°2 de `CLAUDE.md`, appliqué dans l'autre sens.

### Où s'affiche le badge

- **Desktop** : dans l'en-tête, à droite du titre (`.game-server-badge-desktop`).
- **Mobile (≤ 640 px)** : masqué de l'en-tête — il n'y a plus la place à côté du
  logo, du titre et du fichier connecté — et affiché **en tête du menu burger**,
  au-dessus de Session recap / Langue / Profil. Présenté comme une ligne
  d'information (pas le fond des `.mobile-menu-item`, réservés aux actions),
  sauf quand rien n'est déductible : la ligne devient alors l'invite cliquable.

### Vérification effectuée

`npm test` (97 tests, dont 8 sur `GameServerService`), `npm run build`, et une
vérification navigateur réelle (Chromium/playwright-core, `ng serve`,
`/game-servers` simulé — les Pages Functions n'existent pas en local) :
l'invite cliquable menant au bon onglet, le sélecteur alimenté par l'API
(serveur inactif exclu), la bascule du badge sur des lignes `[_FL_]` réelles
entre deux comptes, un joueur hors roster sans effet, et la persistance après
rechargement. Rendu vérifié en desktop (1280 px) et mobile (390 px) : badge dans
l'en-tête d'un côté, en tête du burger de l'autre, jamais les deux à la fois,
sans débordement horizontal.

## Historiques serveur (lot 8, prompt 8.1)

Objectif : un historique **illimité** de combats, achats et échanges, rattaché
au compte, **sans doublons**. Aujourd'hui tout vivait en mémoire, plafonné à 30
combats (`MAX_FIGHT_HISTORY`) et perdu au rechargement.

### Le piège central : la clé déterministe

Le principe d'architecture n°2 de `CLAUDE.md` veut que toute (re)connexion au
fichier de log le relise **depuis le début** et reconstruise l'historique
complet. Sans précaution, chaque reconnexion réenverrait tout et créerait des
doublons **persistés** — qu'un simple F5 ne réparerait pas, contrairement au bug
déjà corrigé en local.

Les identifiants côté client (`nextPurchaseId`, `nextTradeId`) sont des
compteurs de session, remis à zéro à chaque reconstruction : inutilisables comme
clés. D'où :

```
client_key = sha256(uid | type | signature de contenu)
```

couplée à `UNIQUE (user_id, client_key)` et à `INSERT ... ON CONFLICT DO
NOTHING`. Rejouer dix fois le même log n'écrit qu'une ligne.

Deux décisions de composition de la signature méritent d'être retenues (détail
dans `src/app/core/sync/history-event.model.ts`) :

1. **L'heure du log, jamais la date système.** Wakfu n'écrit que
   `HH:MM:SS,mmm` ; `StatsStoreService` y recolle la date du jour de **lecture**.
   Inclure cette date rendrait la clé différente pour le même événement relu le
   lendemain — donc un doublon par jour et par événement, exactement le
   problème que ce lot combat. Limite assumée en contrepartie : deux événements
   réellement distincts, à la même milliseconde de la journée et au contenu
   strictement identique, seraient fusionnés. Invraisemblable en pratique ; le
   risque inverse, lui, serait quotidien.
2. **Aucune valeur révisable dans la signature.** Les dégâts n'entrent pas dans
   celle d'un combat : une réattribution manuelle (`reassignSpell`) les modifie
   après coup, ce qui changerait la clé et créerait une seconde ligne. Ce n'est
   pas pour autant un journal figé : la clé identifie le **combat**, son détail
   se rafraîchit (voir « Ce qui est immuable, ce qui se rafraîchit » plus bas).

### Six écarts par rapport au schéma du §6 du plan

1. **`game_server` sur les trois tables**, pas seulement `purchases` : c'est ce
   pour quoi le lot 7 existe (« taguer l'historique personnel — combats, achats,
   échanges — par serveur »). Toujours nullable : un événement sans serveur
   résolu part quand même, le champ reste vide (prompt 8.1 point 4).
2. **`fight_participants` porte un `instance_index`** dans sa clé primaire. La
   PK `(fight_id, name, side)` du plan entre en collision dès que deux
   combattants du même camp partagent un nom — courant, et tout un mécanisme
   client y est consacré (`InitiativeSeat`, `countNameInstances`). Sans lui, un
   combat contre trois Bouftous perdrait deux lignes sur trois.
3. **`trade_items` porte un `line_index`** et une vraie clé primaire : c'est ce
   qui permet de réinsérer les lignes filles en `ON CONFLICT DO NOTHING` sans
   les dupliquer (voir ci-dessous).
4. **`fight_participants.spells` (jsonb)** — ventilation des dégâts par sort et
   par élément, absente du §6. Sans elle, un combat archivé se réduisait à des
   totaux : l'essentiel de ce que l'application sait d'un combat était perdu dès
   qu'on quittait la session.
5. **`fight_loot` (table)** — butin du combat, absent du §6, pour la même
   raison.
6. **`fight_participants.xp_gained`** — XP **par personnage**, là où le §6 n'en
   gardait que le total au niveau du combat. Rattachée au participant plutôt
   qu'à une table `fight_xp` : le log nomme le bénéficiaire exactement comme le
   combattant qui a rejoint le combat (`Caliburnus : +7 374 187 points d'XP.`),
   c'est donc un attribut du participant — zéro table et zéro requête de plus,
   et `SUM(xp_gained) GROUP BY name` reste immédiat. Un test parcourt tous les
   jeux de test de combat pour vérifier que cette correspondance de noms tient
   (`stats-store.service.spec.ts`) ; `fights.xp_gained` conserve de toute façon
   le total, qui reste exact même si un bénéficiaire n'était pas rattachable.

### Sorts en `jsonb`, butin en table : pourquoi pas la même forme

Ce n'est pas une inconséquence, les deux données n'ont pas le même cycle de vie.

Les **sorts** sont la seule partie de l'historique que l'utilisateur peut
**réviser après l'envoi** : une réattribution déplace une attaque d'une instance
vers une autre. Dans une table `fight_spells`, le sort déplacé s'ajouterait chez
sa nouvelle instance **sans disparaître de l'ancienne** — il faudrait un `DELETE`
préalable, donc une requête de plus et une fenêtre sans détail (pas de
transaction, voir ci-dessous). Un tableau `jsonb` remplacé en bloc à chaque
upsert n'a pas ce problème, et ne coûte aucune requête supplémentaire.

Le **butin**, lui, ne bouge jamais une fois le combat terminé, et c'est
typiquement ce qu'on voudra agréger en SQL plus tard (« combien de Laine de
Bouftou ce mois-ci », « quels combats font tomber tel ingrédient »). Une table
indexée par `item_id` est exactement le bon outil ; un tableau `jsonb` rendrait
ces requêtes pénibles pour rien.

### Ce qui est immuable, ce qui se rafraîchit

`fight_participants` est la **seule** table écrite en `ON CONFLICT DO UPDATE`
(dégâts, classe, statut KO, ventilation par sort). Tout le reste — combats,
achats, échanges, butin — est en `DO NOTHING`.

Concrètement : après une réattribution manuelle, `StatsStoreService` remet le
combat concerné en file (`applyReassign`). Même clé déterministe, donc pas de
seconde ligne ; seul le détail des participants est réécrit, et la correction
remonte au compte. Si l'entrée est encore dans la file d'envoi au moment de la
correction, c'est la version corrigée qui part (`SyncQueueService.enqueue`
remplace la charge utile d'un identifiant déjà présent au lieu de l'ignorer).

Risque résiduel accepté : une reconstruction partielle du même combat écraserait
un détail complet par un détail incomplet. En pratique un combat n'est envoyé
qu'à sa clôture (ligne de fin présente dans le log), donc avec tout ce que le
fichier contient à son sujet.

### Pourquoi trois requêtes SQL et non deux

Le driver `neon-http` n'offre pas de transaction interactive : un combat et ses
participants ne peuvent pas être écrits « tout ou rien ». La séquence naïve
(insérer les parents en récupérant les `id` des seules lignes nouvelles via
`RETURNING`, puis insérer les filles) laisse, si la seconde requête échoue, un
combat **sans** participants — et un rejeu ne le réparerait jamais, son
`clientKey` étant désormais en conflit.

D'où la séquence retenue (`functions/api/v1/history/fights.ts`, idem pour les
échanges) : `INSERT ... ON CONFLICT DO NOTHING` → `SELECT id, client_key` sur
**tout** le lot → `INSERT ... ON CONFLICT DO NOTHING` sur les filles. Une
requête de plus, mais un rejeu répare alors n'importe quel état intermédiaire —
ce qui est précisément la propriété recherchée. C'est aussi ce qui évite d'avoir
à passer à `neon-serverless` (WebSocket), envisagé plus haut dans ce document
pour ce lot.

### Endpoints

- `POST /api/v1/history/{fights,purchases,trades}` — ingestion par lots
  (`{ entries: [...] }`, 100 max), session + CSRF requis. Réponse :
  `{ accepted, inserted }` — `inserted: 0` signifie « tout était déjà là »,
  c'est le cas normal d'un rejeu.
- `GET /api/v1/history/{fights,purchases,trades}?limit=&before=` — lecture
  paginée par **curseur de date** (pas `OFFSET` : un historique s'écrit pendant
  qu'on le feuillette). `nextBefore: null` = fin de l'historique.

Validation dans `server/history/parse.ts` (pure, testée sans base —
`parse.spec.ts`). Un lot contenant une entrée invalide est refusé **en entier**,
contrairement à `/prices/ingest` : ces charges utiles viennent d'un seul
émetteur (la file cliente), une entrée mal formée y signale un bug, pas une
saisie à rattraper.

### Côté client

| Fichier                                | Rôle                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `core/sync/history-event.model.ts`     | Types des charges utiles et **signatures de contenu** (synchrones, sans hachage).                       |
| `core/sync/client-key.util.ts`         | `sha256(uid\|type\|signature)` — asynchrone, calculé à l'envoi, jamais dans le chemin chaud de parsing. |
| `core/sync/sync-queue.service.ts`      | File persistante (IndexedDB), envois par lots, rejeu au retour du réseau, jamais bloquante.             |
| `core/sync/history-sync.service.ts`    | Traduit les enregistrements du store en événements ; no-op complet en mode invité.                      |
| `core/sync/history-archive.service.ts` | Lecture paginée de l'archive du compte pour l'affichage.                                                |

Points structurants :

- **`StatsStoreService` appelle la synchronisation inconditionnellement**, y
  compris pendant `isInitialLoad` — et c'est voulu : le gating protège les
  compteurs persistants d'un regonflage, alors qu'ici c'est justement
  l'historique reconstruit qu'il faut pouvoir envoyer (sinon un historique
  retrouvé après un F5 ne partirait jamais). L'idempotence est ce qui rend cet
  envoi systématique sans danger. Aucun `if (connecté)` ne remonte jusqu'au
  store : `SyncQueueService.isActive()` décide, et `AuthService` seul l'active.
- **Le combat est envoyé avant le plafonnement** à `MAX_FIGHT_HISTORY` : cette
  borne limite ce que l'appareil garde affiché, pas ce que le compte archive.
- **Une connexion en cours de session rejoue l'historique déjà en mémoire**
  (`setReplaySource`, appelé par `enable()`) — un rappel explicite plutôt qu'un
  `effect()` sur un signal, pour que le rejeu parte immédiatement et non au
  prochain cycle de détection de changement.
- **Le chat n'est jamais transmis** (prompt 8.1 point 5) : aucune table ne le
  référence, aucun type d'événement ne le couvre.

### Affichage : une bascule, pas une fusion

La section Historique propose « Session / Compte » (visible seulement une fois
connecté). La liste de session vient du fichier de log courant et est plafonnée ;
l'archive du compte contient tout, y compris ce que la session vient d'envoyer.
Fusionner les deux demanderait de reconnaître localement qu'un événement de
session est déjà archivé — ce que seule la clé SHA-256 permet vraiment, au prix
d'un calcul asynchrone par ligne affichée et par rendu. La bascule est plus
honnête (on sait d'où viennent les lignes) et l'archive étant un sur-ensemble,
l'utilisateur n'a rien à recouper.

Un combat archivé porte tout ce que la vue de session en montre : participants,
dégâts, ventilation par sort et par élément, butin, et XP par personnage. Une
seule différence subsiste, et elle ne vient pas du schéma : les kamas ne sont pas
rattachés au combat, parce que le log ne les y relie jamais (voir
`KamaGainEntry`, sans `fightId`).

### Vérification effectuée / restant à faire

Vérifié dans cette session :

- `npm test` (106 tests, dont 9 nouveaux : le test de double rejeu exigé par le
  prompt, un rechargement complet de l'application, une relecture **un autre
  jour** (horloge système avancée), le mode invité muet, la connexion en cours
  de session, l'envoi effectif de la ventilation par sort et du butin, l'XP
  nominative dont la somme redonne le total du combat, la correspondance
  bénéficiaire d'XP / participant sur tous les jeux de test, et une
  réattribution qui corrige le combat archivé sans le dupliquer) ;
- `npm run test:server` (74 tests, dont 34 sur `server/history/parse.ts`) ;
- `npm run build` ;
- une **vérification navigateur réelle** (Chromium/playwright-core, `ng serve`,
  backend simulé par interception de `fetch` — les Pages Functions n'existent
  pas sous `ng serve`) : premier envoi (1 combat + 1 achat insérés), reconnexion
  complète du fichier de log (envoi bien effectué, `inserted: 0`, aucun
  doublon), coupure réseau (3 entrées en attente **et** écrites en IndexedDB),
  retour du réseau (file vidée, entrées manquantes arrivées), puis la bascule
  Session/Compte alimentée par les `GET` paginés. Second passage après l'ajout
  du détail : ventilation par sort et par élément (`Frappe=250 {Terre}`,
  `Brûlure=80 {Feu}`) et butin (`Laine de Bouftou ×3`) bien transmis puis relus
  depuis l'archive, et une réattribution manuelle après envoi déplaçant le sort
  d'une instance à l'autre — toujours un seul combat archivé. Troisième passage
  après l'ajout de l'XP nominative : les 4 bénéficiaires d'un combat
  multi-compte réel partent nommés (somme ventilée = total du combat, aucun
  ennemi crédité) et reviennent de l'archive ligne pour ligne identiques à la
  vue de session.

**Restant à faire**, comme pour tous les lots précédents — seul un déploiement
réel permet de conclure : appliquer `0006_history_tables.sql` et
`0007_fight_loot_and_spells.sql`/`0008_participant_xp.sql` sur la branche Neon
preview (automatique via `deploy-preview.yml`), puis dérouler un aller-retour
complet contre la vraie base — ingestion, rejeu du même log (vérifier que
`inserted` retombe à 0), pagination sur plus d'une page, et suppression de compte
(cascade sur les cinq tables).
