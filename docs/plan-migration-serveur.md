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
6. **À terme** : monitoring de l'évolution des prix par objet, avec graphiques
   et mise en avant des plus fortes hausses/baisses — volumétrie potentiellement
   importante.

Les points 1 et 6 sont les deux plus structurants : le premier lève la
contrainte d'architecture n°1 du projet, le second dimensionne le choix de base
de données.

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
│  /api/v1/prices/*      séries de prix, tendances (public, agrégé)           │
│  cron                  gamedata, rollups de prix, purges                    │
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

**Relationnel (PostgreSQL).** Le point 6 du cadre tranche la question à lui
seul :

- Le modèle est fortement relationnel : utilisateur → personnages → combats →
  participants ; objet → observations de prix → agrégats.
- Les requêtes de prix sont **analytiques** : percentiles, fenêtres glissantes,
  variations sur périodes, classements. C'est exactement ce pour quoi SQL
  existe, et exactement ce qu'un store document fait mal.
- L'idempotence des historiques (§8) repose sur des contraintes `UNIQUE`
  composites — natif en SQL, à réimplémenter à la main en document.
- PostgreSQL apporte en plus `PERCENTILE_CONT`, les vues matérialisées (pour
  les tendances de prix) et le **partitionnement par plage de dates**, qui
  permet de purger les observations à grain fin par `DROP PARTITION` (instantané)
  au lieu d'un `DELETE` massif.
- Les configurations utilisateur, elles, sont hétérogènes et évolutives : elles
  vont dans une colonne `jsonb`. On obtient le meilleur des deux modèles sans
  changer de moteur.

SQLite/D1 conviendrait au reste, mais pas à la volumétrie de prix (§7). Un store
document conviendrait au profil et aux historiques, mais pas aux séries
temporelles.

### Schéma

```sql
-- ── Utilisateurs ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE,
  auth_provider text NOT NULL,             -- 'discord' | 'google' | 'password'
  provider_uid  text,
  password_hash text,                      -- NULL si OAuth (voir §7)
  display_name  text,
  game_server   text,                      -- ⚠ indispensable pour les prix, voir §8
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  UNIQUE (auth_provider, provider_uid)
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

-- ── Prix (voir §7 pour la stratégie de rétention) ───────────────────────
CREATE TABLE price_observations (
  item_id     integer NOT NULL,
  game_server text NOT NULL,
  unit_price  bigint NOT NULL,
  quantity    integer NOT NULL,
  observed_at timestamptz NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL
) PARTITION BY RANGE (observed_at);        -- partitions mensuelles, purge par DROP

CREATE TABLE price_daily (
  item_id           integer NOT NULL,
  game_server       text NOT NULL,
  day               date NOT NULL,
  price_min         bigint NOT NULL,
  price_max         bigint NOT NULL,
  price_median      bigint NOT NULL,
  price_p25         bigint NOT NULL,
  price_p75         bigint NOT NULL,
  volume            bigint NOT NULL,
  observation_count integer NOT NULL,
  contributor_count integer NOT NULL,      -- anti-abus, voir §7
  PRIMARY KEY (item_id, game_server, day)
);

CREATE MATERIALIZED VIEW price_trends AS   -- rafraîchie par cron, jamais à la volée
  SELECT item_id, game_server,
         /* médiane 7 j vs médiane des 30 j précédents → variation en % */
  FROM price_daily GROUP BY item_id, game_server;
```

---

## 7. Authentification et sécurité

### Le choix qui conditionne tout : OAuth ou mot de passe

**Recommandation forte : OAuth (Discord en priorité, Google en second), et pas
de mot de passe géré en propre.** Trois raisons, dont une purement technique et
décisive :

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

Si le mot de passe est malgré tout exigé, trois voies restent ouvertes, par
ordre de préférence : **une authentification managée gratuite** (Supabase Auth,
Clerk, Auth0 — le hachage se fait chez eux) ; **une plateforme au budget CPU
plus large** (Deno Deploy) ; **le plan payant Workers** (5 $/mois, 30 s CPU).

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
  d'ingestion.

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
- Les contributions de prix doivent pouvoir être anonymisées : le
  `ON DELETE SET NULL` sur `price_observations.user_id` permet de supprimer un
  compte sans détruire l'agrégat communautaire.

---

## 8. Le monitoring de prix

C'est la fonctionnalité la plus ambitieuse du lot, et celle qui comporte le plus
de pièges. Trois d'entre eux sont bloquants s'ils ne sont pas traités en amont.

### D'où viennent les prix ?

Bonne nouvelle : **la collecte est déjà à moitié écrite.** `registerPurchase`
détecte un achat quand une perte de kamas est suivie d'un ramassage d'objet dans
les 2 secondes, et produit déjà `{item, quantity, totalCost, fullTimestampMs}`.
Le prix unitaire est `totalCost / quantity`.

Trois limites à énoncer clairement, parce qu'elles déterminent ce que la
fonctionnalité pourra honnêtement afficher :

**⚠ Piège n°1 — le serveur de jeu est absent du log.** Vérifié sur les logs
d'exemple du dépôt : une ligne d'achat ressemble à
`[Information (jeu)] Vous avez perdu 29 999 kamas.` puis
`Vous avez ramassé 1x Aura des Bottes Cérémoniales du Seigneur des Rats .` —
aucune mention du serveur (Pandora, Rubilax, Ogrest…). Or les écarts de prix
entre serveurs sont considérables : agréger sans cette dimension produirait des
courbes dénuées de sens. **Le serveur de jeu doit donc être déclaré par
l'utilisateur dans son profil** (d'où la colonne `users.game_server`), et une
observation sans serveur déclaré doit être rejetée, pas rangée dans un
« inconnu ». C'est un prérequis bloquant.

**⚠ Piège n°2 — ce sont des prix de transaction, pas des prix de marché.** On
observe ce que l'utilisateur a *payé*, jamais ce qui est *affiché* en hôtel de
ventes. Pas de prix de vente, pas de profondeur de marché, pas d'objet jamais
acheté. L'interface doit dire « prix d'achat observés », pas « cote de l'HDV ».

**⚠ Piège n°3 — la détection d'achat est heuristique.** La fenêtre de 2 s entre
perte de kamas et ramassage produit des faux positifs. Et `wakfu.log` est un
fichier texte local, trivialement éditable : la donnée est falsifiable par
construction.

Parades, à intégrer dès la conception de l'agrégation :

- Agréger sur la **médiane** et les quartiles, jamais sur la moyenne.
- Rejeter les valeurs aberrantes (écart interquartile) avant consolidation.
- **N'exposer un point que s'il repose sur plusieurs contributeurs distincts**
  (d'où `contributor_count`) — un utilisateur seul ne peut pas déplacer une
  courbe.
- Plafonner les contributions par utilisateur et par jour.

### Volumétrie

C'est le point qui justifie PostgreSQL plutôt que SQLite.

Hypothèses : ~20 achats par session, 1 session par jour et par utilisateur ;
~1 500 à 3 000 objets réellement échangés ; ~6 serveurs de jeu.

| Utilisateurs actifs | Observations/jour | Sur 1 an | Table brute (~100 o/ligne avec index) |
| ---: | ---: | ---: | ---: |
| 100 | 2 000 | 730 k | ~73 Mo |
| 1 000 | 20 000 | 7,3 M | **~730 Mo** |
| 5 000 | 100 000 | 36,5 M | ~3,6 Go |

À 1 000 utilisateurs, la table brute dépasse à elle seule l'offre gratuite de
Neon (0,5 Go). **Le grain fin ne doit donc jamais être conservé indéfiniment** :

| Niveau | Contenu | Rétention | Volume à 1 000 utilisateurs |
| --- | --- | --- | --- |
| `price_observations` | chaque observation | **90 jours glissants**, partitions mensuelles purgées par `DROP PARTITION` | ~180 Mo stable |
| `price_daily` | min/max/médiane/p25/p75/volume par objet × serveur × jour | plusieurs années | ~40 Mo/an |
| `price_weekly` | idem, hebdomadaire | au-delà de 2 ans | négligeable |
| `price_trends` | vue matérialisée des variations | rafraîchie toutes les heures | quelques milliers de lignes |

**Les graphiques lisent `price_daily`, jamais le grain fin.** Et « les objets
les plus en hausse/baisse » se lit dans `price_trends`, calculée par cron — un
classement sur variation glissante calculé à la volée sur des millions de lignes
serait le premier endroit où l'application s'effondrerait.

### Côté interface

Le retrait du standalone autorise enfin une bibliothèque de graphiques. Pour des
séries temporelles, **uPlot** (~45 Ko, très rapide) est le meilleur compromis
poids/capacité ; Chart.js (~200 Ko) si l'ergonomie prime sur le poids. À charger
en lazy chunk : seule la vue « prix » en a besoin.

Les endpoints renvoient des séries **pré-agrégées et bornées**
(`/api/v1/prices/{itemId}?server=X&range=90d` → au plus 90 points), jamais des
points bruts à agréger côté client.

---

## 9. Hébergement et CI/CD

### Existant

Deux workflows via `peaceiris/actions-gh-pages` : `master` → GitHub Pages
racine, `claude/dev` → `preview/claude-dev`. Simple et efficace, mais **GitHub
Pages ne peut plus convenir** : le front et l'API doivent partager la même
origine pour que le cookie de session soit un cookie *first-party* (§4).

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
| `10 * * * *` | Consolidation `price_observations` → `price_daily` |
| `20 * * * *` | Rafraîchissement de `price_trends` |
| `0 5 * * 0` | Création de la partition du mois suivant + `DROP` des partitions de plus de 90 jours |

### Coût

**0 €** tant que l'audience reste modérée. Les deux postes capables de faire
sortir des quotas sont le stockage des prix (maîtrisé par la stratégie de
rétention du §8) et, s'il est un jour ajouté, un proxy d'images. À 1 000
utilisateurs actifs, la base tient dans l'offre gratuite Neon **grâce aux
rollups** ; sans eux, elle la dépasse en moins d'un an.

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
| Monitoring de prix | Fonctionnalité impossible sans back — et collecte déjà à moitié écrite |
| Télémétrie de parsing possible | Rend visibles les casses silencieuses après un patch du jeu (angle mort total aujourd'hui) |

### Négatifs

| Coût / risque | Gravité | Atténuation |
| --- | --- | --- |
| **L'application ne survit plus à l'arrêt de l'hébergement** (le fichier standalone, si) | Élevée | PWA + Service Worker ; accepter que ce soit un vrai changement de nature |
| **Nouveau point de panne** : serveur indisponible = application dégradée | Élevée | Cache IndexedDB du catalogue + mode invité toujours fonctionnel |
| **Le free tier de Workers interdit le mot de passe correctement hashé** | Élevée | OAuth, ou auth managée, ou plateforme au CPU plus large — à trancher **avant** d'écrire la page de connexion |
| **Serveur de jeu absent du log** → prix inexploitables sans déclaration utilisateur | **Bloquante** pour §8 | Champ obligatoire au profil ; rejeter les observations sans serveur |
| Duplication d'historique via `isInitialLoad` | **Critique si ignorée** | Clé déterministe + `UNIQUE(user_id, client_key)` (§11) |
| Volumétrie des prix | Élevée sans traitement | Rétention 90 j du grain fin + rollups (§8) |
| Données de prix falsifiables et biaisées | Moyenne | Médiane, rejet des valeurs aberrantes, plusieurs contributeurs requis |
| RGPD : e-mail + historique de jeu = données personnelles | Moyenne | Politique de confidentialité, export, suppression en cascade, chat jamais transmis |
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
| **nouveau** `core/auth/auth.service.ts` + `features/auth/login-page` | Session, connexion OAuth, déconnexion, migration des données locales |
| **nouveau** `core/data-access/user-data.repository.ts` | Interface + `LocalUserDataRepository` (invité) / `RemoteUserDataRepository` (connecté) |
| `core/services/persistence.service.ts` | Reste la brique de stockage local, consommée par `LocalUserDataRepository` |
| `core/services/app-data-export.service.ts` | Réutilisé tel quel comme format de synchronisation et d'export RGPD |
| `core/services/stats-store.service.ts` | `findWakfuItemEntry` **reste synchrone** (index en mémoire) ; émettre combats/achats/échanges vers la file d'envoi avec **clé déterministe** |
| **nouveau** `core/sync/sync-queue.service.ts` | File persistante (IndexedDB), rejeu après coupure réseau, envois par lots |
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
| **2** | Squelette serveur : même origine, `/api/v1/health`, base Neon, migrations, CI/CD | Invisible | Faible |
| **3** | Catalogue distant + index chargé et caché | **−4,25 Mo** | Moyen |
| **4** | Authentification OAuth + page de connexion + migration des données locales | Comptes | Moyen |
| **5** | Configuration utilisateur serveur (`user_settings`) | Sync multi-appareils | Faible |
| **6** | Historiques serveur (combats, achats, échanges) | Historique illimité | **Élevé** (idempotence) |
| **7** | Collecte de prix (serveur de jeu déclaré, ingestion, rollups) | Fondations du point 6 du cadre | Moyen |
| **8** | Vues de prix, graphiques, tendances | Fonctionnalité complète | Moyen |

Le lot 0 a de la valeur même si tout le reste est abandonné. Le lot 1 est
autonome : il divise le poids par deux et lève les contraintes, sans une seule
ligne de serveur. Le lot 7 ne doit pas démarrer avant que le champ « serveur de
jeu » soit en production depuis assez longtemps pour que les données collectées
soient exploitables.

---

## 13. Points de vigilance à relire avant de commencer

1. **Trancher OAuth vs mot de passe en premier** : c'est le seul paramètre qui
   change la recommandation d'hébergement (§7).
2. **Le champ « serveur de jeu » conditionne toute la fonctionnalité prix** — à
   livrer très tôt, bien avant le lot 7.
3. **Ne jamais rendre `findWakfuItemEntry` asynchrone** — chemin chaud du parsing.
4. **Clé d'idempotence déterministe** avant la première écriture d'historique,
   avec le test de double rejeu.
5. **Ne jamais transmettre le contenu du chat** au serveur.
6. **Le mode invité doit rester pleinement fonctionnel** : pas de garde de route
   bloquante, pas de fonctionnalité de base réservée aux comptes.
7. **Rétention et rollups des prix dès le premier jour** : rattraper une table
   d'observations de plusieurs centaines de millions de lignes coûte bien plus
   cher que de la partitionner d'emblée.
8. Le principe d'architecture n°2 (persistant vs dérivé du fichier) ne disparaît
   pas avec le serveur — il devient simplement plus coûteux à enfreindre.
