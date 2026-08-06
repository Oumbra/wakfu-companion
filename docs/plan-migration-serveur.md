# Plan de migration vers un serveur distant

Document d'architecture — état des lieux mesuré, cible, coûts et bénéfices
réels, et reproduction du CI/CD actuel avec des briques gratuites.

Mesures faites le 2026-08-05 sur `master` (commit `2a86044`), builds réels, pas
d'estimation.

## Cadre acté

Six décisions structurantes encadrent ce plan :

1. **Le mode standalone `file://` est retiré.** L'application devient une
   application web servie, uniquement.
2. **Tous les SVG et base64 partent sur le serveur** (`public/assets/`).
3. **Stockage en base de données** relationnelle ou document.
4. **Gestion des utilisateurs sécurisée**, avec page de connexion.
5. **Tous les historiques** (combats, achats, échanges) et **les
   configurations utilisateur** sont stockés côté serveur, rattachés à l'uid,
   *si l'utilisateur est connecté*.
6. **Monitoring de l'évolution des prix par objet**, avec graphiques et mise en
   avant des plus fortes hausses/baisses. **Alimenté par un skill de scan vidéo
   de l'hôtel de ventes** (une capture quotidienne du prix affiché le plus bas
   par objet) — **indépendant des achats des utilisateurs et de leur compte**,
   voir §8. Volumétrie modeste et bornée (≈ 30 valeurs/mois/objet).
7. **Le serveur de jeu est choisi par l'utilisateur** (Pandora / Rubilax /
   Ogrest), rattaché au compte du roster — utile pour rattacher l'historique
   personnel (§11) à un serveur, **sans lien avec le monitoring de prix** (§8).
8. **Authentification par Discord ou Google** uniquement — pas de mot de passe
   géré en propre. **Optionnelle** : sans connexion, l'application reste
   pleinement fonctionnelle, exactement comme aujourd'hui, avec toutes les
   données conservées en `localStorage`.

Les points 1 et 6 sont les deux plus structurants : le premier lève la
contrainte d'architecture n°1 du projet, le second dimensionne le choix de base
de données. Le point 8 débloque la recommandation d'hébergement (§9). **Le
point 6 ne dépend ni du point 7 ni du point 8** : la source des prix (§8) est
un scan opéré côté serveur, sans utilisateur ni compte impliqué — ceci corrige
le phasage (§12) d'une version précédente de ce plan, qui liait à tort le
monitoring de prix aux achats des utilisateurs.

---

## 1. État des lieux chiffré

### Composition du bundle

| Bloc | Poids dans `main.js` | Part |
| --- | ---: | ---: |
| Référentiels Ankama (`wakfu-items` + `wakfu-monsters` + `wakfu-dungeons`) | **4 251 656 o** | **79,6 %** |
| Assets binaires en base64 (3 sons + icônes de classe/avatars/header/logo) | 577 668 o | 10,8 % |
| Code applicatif + framework Angular + i18n (4 locales) | ~513 000 o | 9,6 % |
| **Total `main.js`** | **5 342 751 o** | 100 % |

Vérification : un build avec les trois référentiels vidés (et rien d'autre de
changé) produit un `main.js` de **1 091 095 o** au lieu de 5 342 751 o.

Autres chiffres :

- `wakfu-companion.standalone.html` : **5 408 932 o**, gzip 1 163 848 o.
- Budget Angular `initial` : **dépassé de 1,35 Mo** à chaque build.
- **837 311 o** du bundle (15,7 %) ne sont que des URLs `static.ankama.com`
  répétées : le champ `pictureUrl` est stocké en clair pour chacun des
  **11 849** objets, alors qu'il est intégralement reconstructible depuis
  `gfxId`.

### Ce que ça implique

L'application n'est pas « lourde » : le code applicatif tient en ~500 Ko avec
Angular inclus, ce qui est sain pour 30 composants. **C'est un problème de
données, pas de code.** 90 % de ce que télécharge l'utilisateur est un
référentiel statique et des assets dont il n'utilisera qu'une fraction infime.

Deuxième conséquence, moins visible : le référentiel est figé au moment du
build. **Chaque mise à jour de gamedata Ankama impose aujourd'hui un rebuild +
un redéploiement complet.**

**Cible après migration : ~250–350 Ko de bundle initial** (code seul, référentiel
et assets chargés à la demande et mis en cache), soit un facteur ~15.

---

## 2. Ce qui ne peut PAS migrer

**Le cœur de l'application reste irréductiblement client.**

- `LogFileAccessService` lit `wakfu.log` **sur le disque du joueur** via la
  File System Access API. Aucun serveur ne peut y accéder. Le seul moyen de
  déplacer cette lecture serait un agent local installé (Electron/Tauri) —
  autre projet, pas une migration serveur.
- `LogParser` (570 lignes de regex) et `StatsStoreService` (1 192 lignes)
  *pourraient* tourner côté serveur, mais il faudrait téléverser le log en
  continu : plus lent (flux sondé à 1 s), coûteux en bande passante, et
  surtout **problématique en vie privée** — `wakfu.log` contient les messages
  de chat privés d'autres joueurs, qui n'ont rien demandé. Le parsing n'est de
  toute façon pas un goulot mesurable.
- Alertes sonores et toasts : temps réel, restent client.

**Le serveur est donc un serveur de données, de comptes et d'agrégation** — pas
un serveur d'application. Le dimensionnement s'en déduit : quelques requêtes par
session utilisateur, pas un flux continu.

---

## 3. Ce que le retrait du standalone débloque

C'est le changement le plus libérateur du lot, et il mérite d'être détaillé car
il supprime la moitié des contraintes documentées dans `CLAUDE.md`.

| Contrainte levée | Conséquence |
| --- | --- |
| **Principe d'architecture n°1** (rien d'externe ne doit fuiter dans le build) | Caduc. Images, polices, sons, CDN redeviennent utilisables normalement |
| **Chunk JS unique** (`build-standalone.mjs` échoue explicitement si un second chunk apparaît) | **Le lazy-loading redevient possible** : routing Angular + découpage par vue |
| **Pas de dépendance externe embarquable** | Une bibliothèque de graphiques devient envisageable (indispensable pour le point 6) |
| **Base64 obligatoire pour tout asset** | Fichiers binaires servis avec cache long, +33 % de surcoût base64 supprimé |
| **`anyComponentStyle` sous pression** | Les 3 warnings CSS actuels cessent d'être un sujet |
| **Gotcha `flag-icons` / `outputHashing: "media"`** | Caduc |

Fichiers et configurations à supprimer : `tools/build-standalone.mjs`, la
configuration `standalone` d'`angular.json`, les scripts npm
`build:standalone*`, et les sections correspondantes de `CLAUDE.md` et du
`README.md`.

**Le coût, réel, à assumer** : le fichier autonome fonctionnait *pour toujours*,
sans réseau, sans hébergeur, même si le projet était abandonné. Une application
servie meurt avec son hébergement. Deux atténuations, à prendre pour ce qu'elles
valent :

- **PWA + Service Worker** : après une première visite, l'application démarre
  hors-ligne, s'installe comme une application de bureau, et garde le
  référentiel en cache. Ce n'est pas équivalent (première visite en ligne
  obligatoire), mais couvre l'usage réel.
- L'impact pratique est faible : Wakfu est un MMO. Un joueur qui lit son
  `wakfu.log` en direct a nécessairement une connexion Internet active.

---

## 4. Architecture cible

```
┌───────────────────────────── Client (Angular, PWA) ─────────────────────────┐
│  wakfu.log → LogFileAccessService → LogParser → StatsStoreService           │
│                                          │                                  │
│  CatalogService ──── index objets/monstres (fetch au 1er lancement,         │
│       │                                    caché en IndexedDB + version)    │
│  UserDataRepository ─┬── LocalUserDataRepository   (invité → localStorage)  │
│                      └── RemoteUserDataRepository  (connecté → API)         │
│  SyncQueue ───────── file d'attente persistante, rejeu après coupure        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │ HTTPS, même origine, cookie de session
┌───────────────────────────── Serveur ───────────────────────────────────────┐
│  /                     front statique (SPA + assets)                        │
│  /assets/*             sons, icônes, sprite SVG — cache immuable            │
│  /api/v1/auth/*        connexion, déconnexion, session                      │
│  /api/v1/catalog/*     index + détail objets/monstres/donjons               │
│  /api/v1/settings      configuration utilisateur (uid)                      │
│  /api/v1/fights        historique de combats (uid)                          │
│  /api/v1/purchases     historique d'achats (uid)                            │
│  /api/v1/trades        historique d'échanges (uid)                          │
│  /api/v1/prices/*      séries de prix, tendances (public, lecture)          │
│  /api/v1/prices/ingest écriture — jeton de service, PAS l'auth utilisateur  │
│  cron                  gamedata ; rollup mensuel et tendances de prix       │
└─────────────────────────────────────────────────────────────────────────────┘
```

Deux décisions d'architecture méritent d'être explicitées :

**Même origine pour le front et l'API.** C'est imposé par le point 4 du cadre :
une authentification correcte repose sur un cookie `httpOnly` + `Secure` +
`SameSite=Lax`, et un cookie tiers (front sur `github.io`, API ailleurs) est
aujourd'hui bloqué ou restreint par tous les navigateurs. **Cela disqualifie
GitHub Pages pour le front** — voir §9.

**Un seul mode de fonctionnement du catalogue, mais deux modes de données
utilisateur.** Le retrait du standalone supprime le besoin d'adaptateurs pour le
catalogue (il est toujours distant). En revanche le point 5 du cadre — « si
l'utilisateur est connecté » — réintroduit une double implémentation côté
données utilisateur : mode invité (localStorage, comportement actuel) et mode
connecté (serveur). À encapsuler derrière une interface unique
`UserDataRepository`, avec deux implémentations, et **jamais** de
`if (connecté)` dispersés dans les composants.

**Le chemin chaud reste synchrone.** `findWakfuItemEntry` est appelé par
`StatsStoreService` à chaque ramassage d'objet. Il ne peut pas devenir un appel
réseau. L'index objets (nom FR normalisé → `{id, gfxId, rarity, hasRecipe}`,
estimé 200–400 Ko) est chargé une fois au démarrage, mis en cache IndexedDB avec
son numéro de version, et interrogé en mémoire. Seuls les détails (recettes,
traductions, images) sont distants et asynchrones. C'est aussi ce qui garde
l'autocomplétion instantanée.

**Le monitoring de prix est un pipeline à part, pas une fonctionnalité
utilisateur.** Contrairement aux historiques (§11) qui viennent du log de
chaque joueur connecté, les prix viennent d'un unique acteur : un skill qui lit
une vidéo de l'hôtel de ventes et pousse un lot quotidien via
`/api/v1/prices/ingest`, protégé par un jeton de service — jamais par une
session utilisateur (voir §8). Cette route ne dépend donc d'aucun des lots
d'authentification.

---

## 5. Migration des assets vers `public/assets/`

### Inventaire

| Source actuelle | Poids base64 | Destination |
| --- | ---: | --- |
| `countdown-alert-sound.data.ts` | 210 Ko | `assets/sounds/countdown.mp3` (~157 Ko) |
| `alert-sound.data.ts` | 69 Ko | `assets/sounds/alert.mp3` (~52 Ko) |
| `chat-filter-alert-sound.data.ts` | 44 Ko | `assets/sounds/chat-filter.mp3` (~33 Ko) |
| `class-icons.data.ts` | 122 Ko | `assets/classes/{class}-{gender}.png` |
| `class-breeds.data.ts` | 56 Ko | `assets/avatars/{id}.png` |
| `header-icons.data.ts` | 27 Ko | `assets/ui/*.png` |
| `app-logo.data.ts` | 27 Ko | `assets/ui/logo.png` |
| `session-recap-icon` / `recipe-icon` / `rarity-icon` | 11 Ko | `assets/ui/*.svg` |
| **Total** | **~578 Ko** | sorti du bundle |

### Les SVG dessinés à la main : attention au piège

Neuf composants contiennent des `<svg>` inline (`icon`, `flag-icon`, `ko-icon`,
`history-list-header`, `app-header`, `profile-page`…). Les sortir naïvement en
fichiers `.svg` séparés ferait perdre deux propriétés qui comptent :

- `fill="currentColor"` / `stroke="currentColor"` — les icônes suivent
  aujourd'hui la couleur du texte, y compris au survol et selon l'état. Un
  `<img src="…svg">` est opaque au CSS et perd cette capacité.
- Une requête HTTP par icône au lieu de zéro.

**Solution recommandée : un sprite SVG unique** (`assets/icons.svg`) référencé
par `<svg><use href="/assets/icons.svg#nom-icone"/></svg>`. Une seule requête,
mise en cache immuable, et `currentColor` continue de fonctionner. Le composant
`shared/icon` existe déjà et centralise la plupart des cas : il devient le point
d'entrée unique du sprite.

Les SVG minuscules et uniques (`ko-icon`, drapeaux de `flag-icon`) peuvent
rester inline sans dommage — ils pèsent quelques centaines d'octets et sont
lisibles là où ils servent. Sortir ce qui est volumineux ou répété, garder
inline ce qui est petit et contextuel.

### Cache

Tous les assets servis avec `Cache-Control: public, max-age=31536000, immutable`
et un hash dans le nom de fichier (Angular le fait déjà via
`outputHashing: "all"`). Le sprite et les sons doivent être hashés manuellement
s'ils sont ajoutés hors du pipeline Angular.

---

## 6. Modèle de données

### Relationnel ou document ?

**Relationnel (PostgreSQL)**, même si la révision du §8 a rendu la volumétrie
de prix bien plus modeste qu'envisagé initialement :

- Le modèle reste fortement relationnel : utilisateur → personnages → combats →
  participants ; objet → prix quotidien → agrégats mensuels.
- Les requêtes de prix restent **analytiques** : variations d'une période à
  l'autre, classements des plus fortes hausses/baisses. C'est ce pour quoi SQL
  existe, et ce qu'un store document fait mal.
- L'idempotence des historiques (§11) repose sur des contraintes `UNIQUE`
  composites — natif en SQL, à réimplémenter à la main en document.
- Les vues matérialisées couvrent les tendances de prix sans recalcul à la
  volée. Le partitionnement par date, envisagé initialement pour purger un
  grain fin volumineux, n'est plus nécessaire à l'échelle du §8 — mais reste un
  outil disponible si les historiques personnels (§11) grossissaient plus que
  prévu.
- Les configurations utilisateur, elles, sont hétérogènes et évolutives : elles
  vont dans une colonne `jsonb`. On obtient le meilleur des deux modèles sans
  changer de moteur.

SQLite/D1 conviendrait probablement à l'essentiel désormais (la volumétrie de
prix ne l'interdit plus, voir §8) ; PostgreSQL reste préférable pour les vues
matérialisées et la marge de manœuvre qu'il laisse si les historiques
personnels grossissent plus que prévu.

### Schéma

```sql
-- ── Utilisateurs ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE,             -- vérifié par le fournisseur OAuth
  display_name  text,
  default_game_server text,                -- repli ; le serveur réel vient du compte roster (§8)
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

-- Un utilisateur peut se connecter par Discord ET par Google : fusion sur
-- e-mail vérifié identique (voir §7).
CREATE TABLE user_identities (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,              -- 'discord' | 'google'
  provider_uid text NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_uid)
);

-- Configuration servie à l'application : liste des serveurs, jamais compilée
-- en dur côté client (§8) — la liste des serveurs Wakfu évolue (fusions...).
CREATE TABLE game_servers (
  code      text PRIMARY KEY,              -- 'pandora' | 'rubilax' | 'ogrest'
  label     text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,             -- identifiant opaque, 256 bits
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text,
  revoked_at timestamptz
);

-- ── Configuration utilisateur (remplace localStorage en mode connecté) ───
-- Une ligne par clé : reprend exactement EXPORT_KEYS d'AppDataExportService.
CREATE TABLE user_settings (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        text NOT NULL,                -- 'profile' | 'watchlist' | 'roster' | ...
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ── Historiques ─────────────────────────────────────────────────────────
CREATE TABLE fights (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_key    text NOT NULL,             -- clé déterministe, voir §8
  started_at    timestamptz NOT NULL,
  duration_ms   integer,
  won           boolean,
  total_damage  bigint,
  xp_gained     bigint,
  kamas_gained  bigint,
  UNIQUE (user_id, client_key)             -- ← idempotence
);

CREATE TABLE fight_participants (
  fight_id   bigint NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  name       text NOT NULL,
  side       text NOT NULL,                -- 'ally' | 'enemy'
  class_name text,
  damage     bigint NOT NULL DEFAULT 0,
  defeated   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (fight_id, name, side)
);

CREATE TABLE purchases (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_key  text NOT NULL,
  item_id     integer,                     -- NULL si objet inconnu du catalogue
  item_name   text NOT NULL,
  quantity    integer NOT NULL,
  total_cost  bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  game_server text REFERENCES game_servers(code),  -- résolu au moment de l'envoi
  UNIQUE (user_id, client_key)
);

CREATE TABLE trades (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_key     text NOT NULL,
  peer_name      text NOT NULL,
  self_name      text NOT NULL,
  occurred_at    timestamptz NOT NULL,
  kamas_acquired bigint NOT NULL DEFAULT 0,
  kamas_given    bigint NOT NULL DEFAULT 0,
  UNIQUE (user_id, client_key)
);

CREATE TABLE trade_items (
  trade_id  bigint NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  direction text NOT NULL,                 -- 'acquired' | 'given'
  item_id   integer,
  item_name text NOT NULL,
  quantity  integer NOT NULL
);

-- ── Prix (voir §8 — indépendant des utilisateurs, alimenté par le skill de
-- scan vidéo de l'hôtel de ventes, PAS par les achats des joueurs) ─────────

-- Une ligne par objet × serveur × jour scanné : le prix affiché le plus bas
-- observé ce jour-là. Écrite uniquement par le skill (jeton de service).
CREATE TABLE item_prices_daily (
  item_id     integer NOT NULL,
  game_server text NOT NULL REFERENCES game_servers(code),
  captured_on date NOT NULL,
  price       bigint NOT NULL,           -- prix affiché le plus bas ce jour-là
  PRIMARY KEY (item_id, game_server, captured_on)
);

-- Agrégat mensuel : jusqu'à ~30 lignes de item_prices_daily résumées en une
-- seule. C'est la table que lisent les graphiques et les classements.
CREATE TABLE item_prices_monthly (
  item_id       integer NOT NULL,
  game_server   text NOT NULL REFERENCES game_servers(code),
  month         date NOT NULL,           -- 1er jour du mois
  price_min     bigint NOT NULL,
  price_max     bigint NOT NULL,
  price_avg     bigint NOT NULL,
  samples_count integer NOT NULL,        -- jours réellement scannés ce mois-ci (≤ 31), voir §8
  PRIMARY KEY (item_id, game_server, month)
);

CREATE MATERIALIZED VIEW price_trends AS   -- rafraîchie une fois par jour, jamais à la volée
  SELECT item_id, game_server,
         /* moyenne des 30 derniers jours vs moyenne des 30 jours précédents → variation en % */
  FROM item_prices_daily GROUP BY item_id, game_server;

-- Traçabilité des scans (couverture parfois partielle, voir §8) : permet de
-- diagnostiquer un jour sans données ou incomplet plutôt que de deviner.
CREATE TABLE price_scan_runs (
  id               bigserial PRIMARY KEY,
  game_server      text NOT NULL REFERENCES game_servers(code),
  captured_on      date NOT NULL,
  items_captured   integer NOT NULL,
  items_unresolved integer NOT NULL DEFAULT 0,  -- noms OCR non reconnus, voir §8
  notes            text
);
```

---

## 7. Authentification et sécurité

### Le mode invité reste le mode par défaut

Sans connexion, l'application fonctionne **exactement comme aujourd'hui** :
aucun compte requis, toutes les données (profil, watchlist, roster,
historiques...) restent uniquement dans le `localStorage`/IndexedDB du
navigateur via `PersistenceService`, sans aucune requête vers le serveur
au-delà du catalogue public (§3). L'authentification est un service
**optionnel** superposé à ce fonctionnement, jamais un prérequis — voir « Pas
de garde de route bloquante » plus bas, qui en découle directement.

### Décision actée : OAuth Discord et Google, aucun mot de passe

Le point 8 du cadre tranche la question, et c'est le bon choix. Trois raisons,
dont une purement technique et décisive :

1. **Contrainte CPU du gratuit.** Un hachage de mot de passe correct (Argon2id
   avec des paramètres sérieux, ou bcrypt à coût suffisant) consomme 50–100 ms
   de CPU par connexion — *par construction*, c'est tout l'intérêt. Or l'offre
   gratuite de Cloudflare Workers plafonne à **10 ms de CPU par requête**.
   Autrement dit : **on ne peut pas faire de mot de passe correctement hashé sur
   le free tier de Workers.** Baisser les paramètres du hachage pour tenir dans
   le budget reviendrait à une sécurité de façade — pire que pas de mot de passe
   du tout. Ce point disqualifie silencieusement beaucoup d'architectures
   « gratuites » ; mieux vaut le savoir avant d'écrire la page de connexion.
2. Pas de mot de passe stocké = pas de fuite de mots de passe possible, pas de
   flux de réinitialisation à écrire et sécuriser, pas de vérification d'e-mail,
   pas de politique de complexité.
3. L'audience du jeu est massivement sur Discord : c'est aussi le parcours de
   connexion le plus fluide pour elle.

Conséquence directe : la colonne `password_hash` disparaît du schéma, aucune
route de réinitialisation ni de vérification d'e-mail n'est à écrire, et la
contrainte des 10 ms de CPU cesse d'être un sujet. **La recommandation
d'hébergement du §9 est donc définitivement Cloudflare.**

Ce qu'il reste à implémenter, et qui n'est pas gratuit pour autant : le flux
OAuth 2.0 avec `state` (anti-CSRF) et PKCE, l'échange de code côté serveur (le
`client_secret` ne doit jamais atteindre le navigateur), et la **fusion de
comptes** — un même utilisateur qui se connecte un jour par Discord et un autre
par Google avec la même adresse e-mail. Deux options : rattacher automatiquement
sur e-mail vérifié identique (simple, acceptable ici car les deux fournisseurs
vérifient l'adresse), ou exiger un rattachement explicite depuis la page compte.
Retenir la première, en la documentant.

### Gestion de session

- Cookie de session **opaque** (256 bits d'aléa), `httpOnly` + `Secure` +
  `SameSite=Lax`, jamais de JWT en `localStorage` (une XSS suffirait à voler le
  jeton, et l'application affiche du contenu issu du chat de jeu — donc du texte
  contrôlé par des tiers).
- Table `sessions` côté serveur : révocation immédiate possible (« déconnecter
  toutes mes sessions »), ce qu'un JWT autoporteur ne permet pas.
- Rotation à chaque connexion, expiration glissante (30 jours), révocation au
  changement de méthode d'authentification.
- CSRF : `SameSite=Lax` couvre l'essentiel ; ajouter un jeton double-submit sur
  les routes mutatives sensibles.
- Limitation de débit sur `/auth/*` (par IP et par compte) et sur les endpoints
  d'ingestion d'historiques personnels (combats/achats/échanges, §11).
  L'ingestion des prix (§8) n'utilise pas ce mécanisme : elle passe par un
  jeton de service dédié, sans rapport avec l'authentification utilisateur.

### Côté Angular

- Nouveau `features/auth/login-page` (connexion + retour OAuth) et
  `features/auth/account-page` (sessions actives, export, suppression du compte).
- Intercepteur HTTP : sur `401`, bascule en mode invité plutôt que de planter.
- **Pas de garde de route bloquante** : le point 5 du cadre dit « si
  l'utilisateur est connecté ». L'application doit rester pleinement utilisable
  sans compte — c'est aussi ce qui évite de perdre les utilisateurs actuels lors
  de la bascule.
- **Migration à la première connexion** : proposer explicitement de téléverser
  les données locales existantes vers le compte (`AppDataExportService.buildExport()`
  fournit déjà exactement le payload). Prévoir le cas « le compte a déjà des
  données » : demander à l'utilisateur laquelle des deux sources garder, ne
  jamais fusionner en silence.

### RGPD

Dès qu'il y a des comptes, un e-mail et un historique de jeu, il y a des données
personnelles :

- Politique de confidentialité — `shared/legal-page` existe déjà, à étendre.
- Export des données (déjà écrit : `AppDataExportService`) et **suppression du
  compte avec effet réel** (`ON DELETE CASCADE` est déjà posé dans le schéma).
- **Ne jamais transmettre le contenu du chat.** Il contient les messages
  d'autres joueurs, qui n'ont donné aucun consentement.
- Le monitoring de prix (§8) est **hors périmètre RGPD** : aucun `user_id`
  n'y est rattaché, la donnée provient d'un scan opéré côté serveur, pas des
  utilisateurs de l'application.

---

## 8. Le monitoring de prix

Ce point a changé de nature en cours de conception. **Une version précédente de
ce plan supposait une collecte communautaire à partir des achats des joueurs**
(`registerPurchase`) — ce n'est pas l'approche retenue. La source réelle est un
**skill de scan vidéo de l'hôtel de ventes**, exécuté une fois par jour,
totalement indépendant des comptes utilisateurs et des historiques (§11). Cette
section documente l'approche retenue.

### D'où viennent les prix ?

Un skill (à l'image des skills de synchronisation du référentiel déjà présents
dans l'historique de ce dépôt, retirés du dépôt public — voir le commit
« retirer les skills items/monsters-sync du repo public » — même précédent
probable ici) traite une vidéo de l'hôtel de ventes du jeu, déjà enregistrée
(l'enregistrement lui-même — parcourir les pages en jeu — reste manuel et hors
périmètre de ce plan) :

1. **Extraction d'images** à intervalle régulier depuis la vidéo. Ce projet a
   déjà une solution éprouvée pour ça sans dépendre de ffmpeg installé sur la
   machine (`imageio` + `imageio-ffmpeg`, voir CLAUDE.md, section sur l'analyse
   de vidéo fournie par l'utilisateur) — directement réutilisable ici.
2. **Lecture du nom d'objet et du prix affiché** sur chaque image. Deux
   approches à trancher au moment de l'implémentation : un moteur d'OCR
   classique (Tesseract — gratuit, rapide, mais sensible à la police et au
   contraste, demande un prétraitement d'image), ou une lecture par un modèle
   Claude en vision (plus robuste au bruit visuel, mais un coût et une
   volumétrie d'appels à surveiller sur potentiellement des centaines
   d'images/jour). Les prix suivent le même format que dans `wakfu.log`
   (séparateur de milliers en espace insécable, voir la regex `NUM` dans
   `log-parser.ts`) — la même logique de nettoyage est réutilisable telle
   quelle.
3. **Résolution du nom vers un `item_id`** du catalogue (§3), via
   `normalizeWakfuName` et une recherche sur l'index déjà exposé par
   `/api/v1/catalog/search`. Un nom non résolu ne doit **jamais être abandonné
   silencieusement** : il part dans une file de résolution manuelle
   (`price_scan_runs.items_unresolved`, voir schéma) plutôt que d'être perdu ou
   deviné.
4. **Déduplication** : la liste de l'hôtel de ventes est normalement triée par
   prix croissant, donc la première occurrence d'un objet dans le parcours est
   déjà son prix affiché le plus bas ce jour-là ; à défaut, prendre le minimum
   observé.
5. **Envoi** du lot du jour à `POST /api/v1/prices/ingest`, protégé par un
   jeton de service (secret déployé côté serveur) — **pas** une session
   utilisateur, sans rapport avec l'authentification du §7.

### Trois limites à énoncer clairement

**⚠ C'est un prix affiché (offre), pas une transaction réalisée.** On observe
ce qui est *en vente*, jamais ce qui a réellement été *acheté*. Aucune garantie
que l'objet se vende à ce prix, aucune information de volume. L'interface doit
dire « prix affiché le plus bas », jamais « prix de vente » ou « cote ». C'est
l'inverse du compromis qu'aurait eu une collecte par achats (un prix de
transaction réel, mais rare et peu représentatif) : celle-ci donne une vraie
photo instantanée du marché, au prix de ne jamais savoir si quelqu'un achète
réellement à ce niveau.

**⚠ Couverture potentiellement partielle.** Si le scan d'un jour ne couvre pas
toutes les catégories de l'hôtel de ventes (vidéo interrompue, catégorie
oubliée), certains objets n'ont simplement aucune donnée ce jour-là. C'est une
**absence de donnée**, pas un signal « aucune vente » : ne jamais combler un
jour manquant par une valeur inventée (zéro, répétition de la veille...).
`samples_count` dans l'agrégat mensuel expose cette complétude (15/30 jours
scannés doit s'afficher comme tel, pas comme un mois complet).

**⚠ Fiabilité de l'OCR et objets à caractéristiques variables.** Un texte mal
reconnu peut mal résoudre un objet, ou le rattacher au mauvais `item_id` parmi
des homonymes de raretés différentes (voir le référentiel objets, distingués
uniquement par leur `id`). Par ailleurs — **à valider avec les premières
données réelles**, je ne l'affirme pas comme un fait établi — si certains
objets ont des caractéristiques variables/aléatoires en jeu, le moins cher
affiché un jour donné pourrait refléter un exemplaire aux stats faibles plutôt
qu'une vraie baisse de marché ; à garder en tête si des sauts de prix
inexpliqués apparaissent dans les courbes.

### Volumétrie — bien plus modeste qu'envisagé dans une version précédente

Contrairement à une collecte alimentée par les achats des utilisateurs (dont le
volume croît avec le nombre d'utilisateurs), **cette source a un volume fixe et
prévisible dès la conception** : il ne dépend que du nombre d'objets et de
serveurs scannés, jamais du nombre d'utilisateurs de l'application — un
avantage structurel que la première version de ce plan n'avait pas.

| Objets scannés/jour (par serveur) | Serveurs scannés | Lignes brutes/an | `item_prices_daily` (~40 o/ligne) |
| ---: | ---: | ---: | ---: |
| 1 000 | 1 | 365 k | ~15 Mo |
| 3 000 | 1 | 1,1 M | ~44 Mo |
| 3 000 | 3 | 3,3 M | ~130 Mo |

⚠ Ces volumes d'objets réellement en vente un jour donné sont des hypothèses de
dimensionnement, **pas des mesures** — à corriger dès le premier scan réel.

Conséquence pratique : **le partitionnement et la purge agressive envisagés
dans une version précédente de ce plan ne sont plus nécessaires.** Le grain
quotidien (`item_prices_daily`) peut être conservé indéfiniment sans mettre en
péril l'offre gratuite Neon ; `item_prices_monthly` sert surtout à accélérer les
lectures (graphiques, classements), pas à limiter le volume.

### Côté interface

Le retrait du standalone (§3) autorise une bibliothèque de graphiques légère —
**uPlot** (~45 Ko, très rapide) de préférence à Chart.js (~200 Ko) — chargée en
lazy chunk sur la seule vue « prix ». Les courbes lisent `item_prices_daily`
(le mois courant, vue fine) et `item_prices_monthly` (historique long), jamais
un calcul d'agrégat à la volée. « Plus fortes hausses/baisses » se lit dans
`price_trends`, rafraîchie une fois par jour après l'ingestion — un rythme
largement suffisant puisque la donnée source elle-même n'arrive qu'une fois par
jour.

---

## 9. Hébergement et CI/CD

### Existant

Deux workflows via `peaceiris/actions-gh-pages` : `master` → GitHub Pages
racine, `claude/dev` → `preview/claude-dev`. Simple et efficace, mais **GitHub
Pages ne peut plus convenir** : le front et l'API doivent partager la même
origine pour que le cookie de session soit un cookie *first-party* (§4).

**Mise à jour du 2026-08-06** : `claude/dev` est passée sur Cloudflare Pages
(`deploy-preview.yml`) en avance sur le phasage ci-dessous — front statique
uniquement, sans Workers/Neon (ça reste le lot 2). Cause : le workflow système
GitHub `pages build and deployment` (déclenché automatiquement sur push
`gh-pages`) est devenu instable dès le passage au build multi-fichiers du lot
1 (commit `3ab11c78`), restant bloqué en `deployment_queued` jusqu'à son
timeout de 10 min — y compris en le remplaçant par le pipeline Actions natif
(`upload-pages-artifact`/`deploy-pages`). `master` (prod) reste sur GitHub
Pages pendant la migration, comme acté plus haut ; seule la preview est
avancée sur la cible finale.

Deux manques à corriger au passage, indépendants de la migration :

1. **Aucun workflow ne lance les tests**, alors que Vitest est configuré et que
   4 fichiers `.spec` existent (dont `stats-store.service.spec.ts`, 570 lignes).
   Un déploiement peut partir avec des tests rouges.
2. **`package-lock.json` est dans le `.gitignore`**, ce qui force `npm install`
   au lieu de `npm ci` : builds non reproductibles, une mise à jour transitive
   peut casser un déploiement sans le moindre changement de code.

### Comparatif

⚠ Les quotas des offres gratuites évoluent régulièrement ; à revérifier au
moment de la décision.

| Option | Gratuit | Points forts | Points faibles |
| --- | --- | --- | --- |
| **Cloudflare Pages + Workers + Neon** | Oui | **Pas de démarrage à froid**, front et API sur la même origine, cron intégré, Neon offre des **branches de base** (une base isolée par preview) | **10 ms CPU/requête** → pas de hachage de mot de passe (§7) ; Neon gratuit à 0,5 Go |
| **Supabase + front sur Cloudflare Pages** | Oui | **Auth sécurisée clé en main** (résout le problème CPU), Postgres + stockage inclus | Projet **mis en pause après ~1 semaine d'inactivité**, 500 Mo, jeton côté client par défaut, origine différente du front |
| Deno Deploy + Neon | Oui | Budget CPU confortable (mot de passe possible), standards web | Quotas plus serrés, écosystème plus restreint |
| Vercel Hobby + Neon | Oui | Excellente expérience de développement | **Usage non commercial uniquement** |
| Render | Oui | Vrai Node/Docker, pas de limite CPU | **Veille après 15 min → réveil ~50 s** : rédhibitoire pour de l'autocomplétion |
| Fly.io | Plus vraiment | Vrai serveur | Offre gratuite supprimée/limitée |

### Recommandation

**Cloudflare (Pages pour le front + Workers pour l'API, même domaine) + Neon
PostgreSQL, avec authentification OAuth.**

Cette combinaison coche tout le cadre : même origine pour le cookie de session,
pas de démarrage à froid (l'API sert de l'autocomplétion, donc de l'interactif),
Postgres pour la volumétrie de prix, cron intégré pour les rollups et le
gamedata, R2 disponible si un proxy d'images est ajouté plus tard, et une base
de preview isolée par branche grâce aux branches Neon.

La contrainte CPU est neutralisée par le choix OAuth. **Si le mot de passe
devient une exigence ferme, la recommandation bascule sur Supabase** (auth
managée) ou **Deno Deploy** — c'est le seul paramètre qui change la
recommandation, d'où l'importance de trancher tôt.

### Où tourne le skill de scan de prix ?

Nulle part sur Cloudflare Workers : décodage vidéo et OCR/vision dépassent de
loin son budget CPU (10 ms/requête, voir §7) et la vidéo elle-même n'a aucune
raison de transiter par l'infrastructure hébergée. Le skill tourne **là où la
vidéo a été enregistrée** (poste local), et ne pousse au serveur que le
résultat structuré du jour — une liste `{item, prix}` de quelques dizaines de
kilo-octets — via `POST /api/v1/prices/ingest`.

Deux façons de déclencher l'exécution quotidienne, aucune ne nécessitant
Cloudflare :
- **Une Routine Claude Code** (l'outillage disponible dans cet environnement le
  permet directement, déclenchement quotidien) qui invoque le skill.
- Une tâche planifiée locale classique (cron / Planificateur de tâches) si le
  skill est exécuté hors de Claude Code.

Le seul élément côté serveur est donc l'endpoint `/api/v1/prices/ingest`
(protégé par un jeton de service statique, secret Cloudflare, sans rapport avec
les sessions utilisateur) et les tables qu'il alimente.

### Workflows

**`.github/workflows/ci.yml`** — à faire en premier, indépendamment du reste :

```yaml
name: CI
on:
  push:
    branches: [master, claude/dev]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm                      # nécessite package-lock.json committé
      - run: npm ci
      - run: npx prettier --check "src/**/*.{ts,html,css}"
      - run: npm test -- --run
      - run: npm run build
```

**`.github/workflows/deploy.yml`** — remplace les deux workflows Pages actuels :

```yaml
name: Deploy
on:
  push:
    branches: [master, claude/dev]

concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name == 'master' && 'production' || 'preview' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci

      - name: Migrations base de données
        run: npx drizzle-kit migrate        # ou node-pg-migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Build front
        run: npm run build
        env:
          API_BASE_URL: /api/v1

      - name: Déploiement front + API
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: >
            deploy
            --env ${{ github.ref_name == 'master' && 'production' || 'preview' }}
```

Secrets à créer : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`DATABASE_URL`, plus les identifiants OAuth (`DISCORD_CLIENT_ID/SECRET`) et un
`SESSION_SECRET`. Utiliser les *environments* GitHub (`production` / `preview`)
pour que la preview pointe sur une **branche Neon distincte** — jamais sur la
base de production.

**Tâches planifiées** (Cron Triggers Cloudflare, dans `wrangler.toml`, plutôt
que `schedule:` GitHub Actions qui **se désactive après 60 jours d'inactivité du
dépôt**) :

| Fréquence | Tâche |
| --- | --- |
| `0 4 * * *` | Rafraîchissement du gamedata Ankama (comparer `config.json`, recharger si la version a changé) |
| `30 4 * * *` | Rafraîchissement de `price_trends` (après la fenêtre habituelle d'ingestion quotidienne du skill) |
| `0 5 1 * *` | Consolidation mensuelle `item_prices_daily` → `item_prices_monthly` du mois écoulé |

Ces trois tâches interrogent ou rafraîchissent la base via une simple requête
SQL — un temps de calcul Worker négligeable (l'essentiel du temps est passé à
attendre la base, ce qui ne compte pas dans le budget CPU) : rien à voir avec
le budget nécessaire au skill de scan lui-même (§8), qui tourne ailleurs.

### Coût

**0 €** tant que l'audience reste modérée. Le monitoring de prix (§8) ne pèse
plus sur ce budget : sa volumétrie est faible et bornée dès la conception. Le
seul poste réellement capable de faire sortir des quotas gratuits, s'il est un
jour ajouté, est un proxy d'images.

---

## 10. Bilan

### Positifs

| Bénéfice | Impact |
| --- | --- |
| Bundle 5,35 Mo → ~250–350 Ko | Démarrage ~15× plus léger ; budget Angular réglé |
| Retrait du standalone | Lazy-loading, bibliothèques externes, PWA, assets normaux : la moitié des contraintes de `CLAUDE.md` disparaît |
| Référentiel rafraîchi sans redéploiement | Supprime le cycle rebuild+déploiement à chaque patch Wakfu |
| Historiques et configuration rattachés à l'uid | Corrige le risque n°1 actuel : tout perdre en vidant son navigateur ; multi-appareils |
| Historique illimité | Aujourd'hui plafonné à 30 combats en mémoire, perdu au rechargement |
| Monitoring de prix | Source indépendante des comptes utilisateurs (skill de scan vidéo) : livrable tôt, sans attendre l'authentification (§8) |
| Prix hors périmètre RGPD | Aucun utilisateur associé aux données de prix — pas de consentement ni d'anonymisation à gérer pour cette fonctionnalité |
| Télémétrie de parsing possible | Rend visibles les casses silencieuses après un patch du jeu (angle mort total aujourd'hui) |

### Négatifs

| Coût / risque | Gravité | Atténuation |
| --- | --- | --- |
| **L'application ne survit plus à l'arrêt de l'hébergement** (le fichier standalone, si) | Élevée | PWA + Service Worker ; accepter que ce soit un vrai changement de nature |
| **Nouveau point de panne** : serveur indisponible = application dégradée | Élevée | Cache IndexedDB du catalogue + mode invité toujours fonctionnel |
| **Serveur de jeu absent du log applicatif** → l'historique personnel d'achats ne peut pas être rattaché à un serveur sans déclaration | Faible (n'affecte que l'affichage personnel, **pas** le monitoring de prix, voir §8) | Serveur porté par le compte du roster + déduction depuis le personnage observé |
| **`LogParser` est francophone uniquement** : un client en anglais ne produit aucune donnée | Élevée, **déjà vraie aujourd'hui**, indépendante de cette migration | Signaler la limite à l'utilisateur ; l'internationalisation du parseur est un chantier distinct |
| Dépendance à deux fournisseurs OAuth tiers (panne Discord/Google = connexions impossibles) | Faible | Deux fournisseurs plutôt qu'un ; le mode invité reste pleinement fonctionnel dans tous les cas |
| Duplication d'historique via `isInitialLoad` | **Critique si ignorée** | Clé déterministe + `UNIQUE(user_id, client_key)` (§11) |
| Fiabilité de l'OCR / résolution nom → objet, couverture de scan parfois incomplète | Moyenne | Résolution manuelle des noms non reconnus (`price_scan_runs`), `samples_count` affiché pour signaler un mois incomplet (§8) |
| RGPD : e-mail + historique de jeu = données personnelles (hors monitoring de prix, voir ligne dédiée en positifs) | Moyenne | Politique de confidentialité, export, suppression en cascade, chat jamais transmis |
| Deux modes de données utilisateur (invité / connecté) | Moyenne | Interface `UserDataRepository` unique, deux implémentations, aucun `if` dispersé |
| Charge de maintenance : base, migrations, secrets, sauvegardes, supervision | Moyenne | Tout managé (Neon, Cloudflare) ; migrations en CI |
| Redistribuer le gamedata depuis son domaine | Faible | JSON publics et documentés sur le forum officiel |

---

## 11. Modifications concrètes dans le code

| Fichier / zone | Modification |
| --- | --- |
| `tools/build-standalone.mjs`, config `standalone`, scripts npm | **Supprimés** |
| `CLAUDE.md`, `README.md` | Retirer le principe d'architecture n°1 et les gotchas devenus caducs |
| `tools/generate-wakfu-items-data.mjs` | Ne plus produire de `.data.ts` : alimenter la base (import serveur) et générer l'index léger servi par l'API |
| `src/app/core/data/*.data.ts` (assets base64) | **Supprimés** → `public/assets/` (§5) |
| `shared/icon/icon.component.ts` | Devient le point d'entrée du sprite SVG (`<use href="/assets/icons.svg#…">`) |
| `shared/item-icon` / `entity-icon` | URL reconstruite depuis `gfxId` ; cascade de repli conservée |
| **nouveau** `core/api/api-client.service.ts` | `fetch` centralisé : base URL, timeout, retry, `credentials: 'include'`, gestion du 401 |
| **nouveau** `core/api/catalog.service.ts` | Chargement de l'index au démarrage + cache IndexedDB versionné ; détails à la demande |
| **nouveau** `core/auth/auth.service.ts` + `features/auth/login-page` | Session, connexion Discord/Google, déconnexion, migration des données locales |
| **nouveau** `core/services/game-server.service.ts` | Serveur actif : déduit du personnage observé (compte roster), repli sur le sélecteur global |
| `core/services/character-roster.service.ts` | Ajouter `gameServer` à `RosterAccount` (+ migration des rosters existants) |
| **nouveau** `core/data-access/user-data.repository.ts` | Interface + `LocalUserDataRepository` (invité) / `RemoteUserDataRepository` (connecté) |
| `core/services/persistence.service.ts` | Reste la brique de stockage local, consommée par `LocalUserDataRepository` |
| `core/services/app-data-export.service.ts` | Réutilisé tel quel comme format de synchronisation et d'export RGPD |
| `core/services/stats-store.service.ts` | `findWakfuItemEntry` **reste synchrone** (index en mémoire) ; émettre combats/achats/échanges vers la file d'envoi avec **clé déterministe** |
| **nouveau** `core/sync/sync-queue.service.ts` | File persistante (IndexedDB), rejeu après coupure réseau, envois par lots |
| **nouveau** skill de scan de prix (hors dépôt public, même précédent que les skills items/monsters-sync déjà retirés) | Extraction vidéo → images → OCR/vision → résolution catalogue → `POST /api/v1/prices/ingest` |
| **nouveau** `server/…/routes/prices.ts` | `POST /api/v1/prices/ingest` (jeton de service) + `GET /api/v1/prices/*` (lecture publique) |
| **nouveau** `features/prices/` | Vue de suivi des prix + graphiques (lazy chunk, uPlot) |
| `core/services/navigation.service.ts` | Peut céder la place au Router Angular, désormais que le lazy-loading est possible |
| `core/i18n/translations.ts` | Import dynamique de la seule locale active (−48 Ko) |
| `shared/legal-page/` | Politique de confidentialité (obligatoire dès les comptes) |
| `angular.json` | Une seule configuration de build ; `outputHashing: "all"` |

### La clé déterministe, en détail

C'est le point technique le plus important de toute la migration.

Le principe d'architecture n°2 rappelle que **toute reconnexion relit le fichier
depuis le début** et reconstruit l'historique. Sans précaution, chaque
reconnexion réenverrait l'intégralité de l'historique au serveur — et
contrairement au bug déjà corrigé en local, il ne suffirait pas d'un F5 pour
réparer : les doublons seraient persistés.

La parade est de dériver la clé du **contenu** de l'événement, jamais d'un
compteur de session (`nextPurchaseId`, `nextTradeId`, `Fight.id` sont tous
réinitialisés à chaque reconstruction — inutilisables tels quels) :

```
client_key = sha256(uid + type + horodatage_complet_ms + signature_du_contenu)
```

où la signature est, par exemple, `item|quantité|coût` pour un achat, ou
`fightId|participants triés` pour un combat. Couplée à
`UNIQUE (user_id, client_key)` et à un `INSERT … ON CONFLICT DO NOTHING`, elle
rend l'ingestion **idempotente** : rejouer dix fois le même log ne crée qu'une
ligne.

À valider par un test dédié (`stats-store.service.spec.ts` fournit déjà le
harnais de simulation de lignes de log) : *rejouer deux fois le même lot doit
produire exactement le même nombre de lignes côté serveur.*

---

## 12. Phasage

| Lot | Contenu | Gain | Risque |
| --- | --- | --- | --- |
| **0** | `package-lock.json` committé, `ci.yml` avec tests, retrait de `pictureUrl`, i18n dynamique | −885 Ko, CI fiabilisée | Nul |
| **1** | Retrait du standalone, assets → `public/assets/`, sprite SVG, routing + lazy-loading, PWA | −578 Ko, contraintes levées | Faible |
| **2** | Squelette serveur : même origine, `/api/v1/health`, base Neon, migrations, CI/CD, import du catalogue | Invisible | Faible |
| **3** | Catalogue distant côté client + index chargé et caché | **−4,25 Mo** | Moyen |
| **4** | **Monitoring de prix** : skill de scan vidéo, ingestion, rollups mensuels, interface graphique | Fonctionnalité complète, **indépendante des comptes** | Moyen |
| **5** | Authentification Discord/Google + page de connexion + migration des données locales | Comptes | Moyen |
| **6** | Configuration utilisateur serveur (`user_settings`) | Sync multi-appareils | Faible |
| **7** | Sélecteur de serveur par compte roster (rattachement de l'historique personnel) | Historique tagué par serveur | Faible |
| **8** | Historiques serveur (combats, achats, échanges) | Historique illimité | **Élevé** (idempotence) |

Le lot 0 a de la valeur même si tout le reste est abandonné. Le lot 1 est
autonome : il divise le poids par deux et lève les contraintes, sans une seule
ligne de serveur.

**À partir du lot 3, la migration se scinde en deux chantiers indépendants :**

- **Monitoring de prix (lot 4)** — ne dépend que du catalogue serveur (lot 2)
  et d'un jeton de service ; aucun utilisateur, aucune authentification. Peut
  être livré et démontré avant même que la page de connexion existe.
- **Comptes et données personnelles (lots 5 à 8)** — authentification, puis
  synchronisation, puis rattachement au serveur, puis historiques.

Ces deux chantiers peuvent être menés dans n'importe quel ordre, y compris en
parallèle : ils ne partagent que l'infrastructure de base (lot 2) et le
catalogue (lot 3). Ceci corrige une version précédente de ce plan, qui plaçait
à tort le monitoring de prix comme dépendant des achats et donc des comptes
utilisateurs — ce n'est plus le cas.

---

## 13. Points de vigilance à relire avant de commencer

1. **OAuth Discord/Google acté** : aucune route de mot de passe à écrire, et la
   recommandation Cloudflare est confirmée (§7). Prévoir la fusion de comptes
   sur e-mail vérifié identique.
2. **Le monitoring de prix ne dépend d'aucun compte utilisateur** : sa source
   est un scan vidéo opéré côté serveur (lot 4), totalement indépendant de
   l'authentification (lot 5) et du sélecteur de serveur par compte (lot 7, qui
   ne sert qu'à taguer l'historique personnel).
3. **Ne jamais rendre `findWakfuItemEntry` asynchrone** — chemin chaud du parsing.
4. **Clé d'idempotence déterministe** avant la première écriture d'historique,
   avec le test de double rejeu.
5. **Ne jamais transmettre le contenu du chat** au serveur.
6. **Le mode invité doit rester pleinement fonctionnel** : pas de garde de route
   bloquante, aucune fonctionnalité de base réservée aux comptes, toutes les
   données restent en `localStorage` — exactement comme aujourd'hui — tant que
   l'utilisateur ne se connecte pas.
7. **Résoudre les noms OCR non reconnus dès le premier scan, jamais en
   silence** : journaliser (`price_scan_runs`) plutôt qu'abandonner, sous peine
   de trous de données invisibles dans les courbes.
8. Le principe d'architecture n°2 (persistant vs dérivé du fichier) ne disparaît
   pas avec le serveur — il devient simplement plus coûteux à enfreindre.
