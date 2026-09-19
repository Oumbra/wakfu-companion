# Analyse de conformité RGPD — Wakfu Companion

> **Version analysée** : 1.137.0 (commit `c2f3fdb`, 2026-09-19) · **Date de l'analyse** : 19 septembre 2026
> **Périmètre** : `src/` (client Angular), `functions/api/v1/` (Pages Functions), `server/` (schéma,
> auth, historique, scripts), `public/`, `.github/workflows/`.
> **Hors périmètre** : le code de l'**overlay de bureau** vit dans un dépôt distinct
> (`Oumbra/wakfu-companion-overlay`) et n'a pas été audité ici. Seules ont été vérifiées sa surface
> serveur (`native_pairings`, `/api/v1/auth/native/*`) et la description qu'en donne la politique de
> confidentialité — les affirmations de celle-ci sur le comportement local de l'overlay (journal de
> 14 jours, captures d'écran non transmises, effacement à la déconnexion) restent à confirmer dans
> ce dépôt-là.
> **Nature** : audit de code — écarts entre ce que le code fait réellement et ce que les documents
> légaux de l'application (`legal.notice.body`, `privacy.notice.body`, `terms.notice.body` dans
> `core/i18n/translations.ts`, mis à jour le 19 septembre 2026) déclarent. Ce document est une
> analyse technique, pas un avis juridique.

---

## 1. Synthèse

Le projet part d'un socle **nettement au-dessus de la moyenne** pour une application de ce type :
mode invité local par défaut, aucun traceur, aucun cookie publicitaire, contenu du chat jamais
transmis, suppression de compte réellement effective en cascade, et des documents légaux rédigés
dans les 4 langues, avec bases légales distinguées, durées de conservation, transferts hors UE et
voies de recours. La mise à jour du 19 septembre 2026 traite d'ailleurs par avance deux sujets
qu'une analyse antérieure aurait signalés : le volet overlay de bureau et, surtout, la **base légale
des pseudonymes de tiers** dans l'historique (point 1.3), avec mise en balance des intérêts et droit
de retrait explicite — c'est le point le plus délicat du dossier, et il est correctement traité.

La conformité n'est donc pas à construire. Ce qui reste tient en un défaut technique de
cloisonnement, une fonction réglementaire incomplète, et quelques omissions ponctuelles où le code a
devancé la documentation.

> **Mise à jour du 2026-09-19** — l'écart 4.3 (hébergeur du front de production non déclaré) est
> **résolu** : l'ancien déploiement GitHub Pages, qui ne servait plus que de portail vers la version
> Cloudflare, a été décommissionné et le domaine canonique est passé à `https://wakfu-companion.com`.
> Le tableau ci-dessous reflète cet état.

| Gravité                  | Nombre | Nature                                                                                                                                                                                 |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critique              | 1      | Fuite d'historique entre comptes sur un même navigateur                                                                                                                                |
| 🟠 Majeur                | 1      | Export RGPD incomplet (l'hébergeur non déclaré, 4.3, est résolu depuis le 2026-09-19)                                                                                                  |
| 🟡 Modéré                | 6      | IP en clair en base · sessions jamais purgées · information au point de collecte · en-têtes de sécurité · rémanence locale après suppression · omissions résiduelles dans la politique |
| ⚪ Mineur / documentaire | 6      | Registre art. 30, DPA, procédure de violation, DPIA, âge, adresse de contact                                                                                                           |

Aucun écart ne relève d'une collecte abusive ou dissimulée : tous sont soit des **omissions
d'information**, soit des **défauts de minimisation ou de rétention**, soit — pour le point
critique — un **bug de cloisonnement** dans la file de synchronisation.

---

## 2. Cartographie des traitements

### 2.1 Mode invité (par défaut, aucun compte)

Aucune donnée ne quitte l'appareil. Le fichier `wakfu.log` est lu localement via l'API File System
Access, jamais téléversé. Stockage local :

| Support                     | Contenu                                                                                              | Données personnelles ?                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `localStorage`              | 11 clés `USER_DATA_KEYS` (profil, watchlist, roster, réattributions, filtres de chat, mise en page…) | Oui — pseudos du joueur, et pseudos de **tiers** dans les filtres de chat et les réattributions |
| IndexedDB `wakfu-companion` | Handle du fichier de log, cache catalogue, file de synchronisation, archive d'historique             | Oui — noms de personnages, alliés de combat compris                                             |

Les données restent sous le seul contrôle de l'utilisateur ; l'éditeur n'en détient aucune copie.
Conforme, et correctement décrit au point 1.1 de la politique.

### 2.2 Mode connecté (compte optionnel, OAuth Discord/Google)

| Table                                        | Données                                                                              | Base légale déclarée                                      | Durée réelle en base                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------ |
| `users`                                      | e-mail vérifié, nom affiché, serveur de jeu par défaut, `created_at`, `last_seen_at` | Contrat (art. 6.1.b)                                      | Vie du compte                        |
| `user_identities`                            | fournisseur, `provider_uid`, e-mail, `linked_at`                                     | Contrat                                                   | Vie du compte                        |
| `sessions`                                   | SHA-256 du jeton, `user_agent`, dates d'émission/usage/expiration/révocation         | Intérêt légitime (art. 6.1.f)                             | **Illimitée** — jamais purgée (§4.5) |
| `oauth_authorizations`                       | `state`, `code_verifier` PKCE, `redirect_to`                                         | Contrat / sécurité                                        | Purgée à chaque callback ✅          |
| `native_pairings`                            | `device_code`, `user_code`, jeton de session en transit                              | Contrat                                                   | Purgée à l'expiration ✅             |
| `auth_rate_limits`                           | **adresse IP en clair** dans `bucket`, fenêtre, compteur                             | Intérêt légitime                                          | Purge opportuniste (§4.4)            |
| `user_settings`                              | 11 clés de configuration en `jsonb`                                                  | Contrat                                                   | Vie du compte                        |
| `fights`, `fight_participants`, `fight_loot` | combats, **noms des alliés (joueurs tiers)**, classe, dégâts, soins, sorts, butin    | Contrat (6.1.b) + intérêt légitime (6.1.f) pour les tiers | Vie du compte                        |
| `purchases`, `trades`, `trade_items`         | achats, échanges, **nom du partenaire d'échange**                                    | Idem                                                      | Vie du compte                        |
| `pact_extractions`, `pact_extraction_items`  | extractions de pacte                                                                 | Contrat                                                   | Vie du compte                        |

Toutes les tables rattachées à `users` portent `ON DELETE CASCADE` : la suppression de compte
(`functions/api/v1/auth/account.ts`) est **réellement effective**, sans marquage logique ni
conservation « au cas où ».

Le compte est alimenté par **deux clients** : le site, et l'overlay de bureau appairé par code à
usage unique (`native_pairings`). Les deux écrivent dans les mêmes tables, via les mêmes endpoints
authentifiés ; l'overlay apparaît dans la liste des sessions actives et y est révocable.

### 2.3 Cookies

Trois cookies, tous **strictement nécessaires** au sens de l'article 82 de la loi Informatique et
Libertés — aucun bandeau de consentement n'est requis, et c'est bien le choix fait :

| Cookie           | Rôle                                    | Attributs                                              | Durée          |
| ---------------- | --------------------------------------- | ------------------------------------------------------ | -------------- |
| `wc_session`     | jeton opaque 256 bits                   | `HttpOnly` `Secure` `SameSite=Lax`                     | 30 j glissants |
| `wc_csrf`        | double-submit anti-CSRF                 | `Secure` `SameSite=Lax` (lisible en JS par conception) | 30 j           |
| `wc_oauth_state` | liaison du callback OAuth au navigateur | `HttpOnly` `Secure`, portée `/api/v1/auth`             | 10 min         |

Aucun cookie de mesure d'audience, de publicité ou de traçage. Vérifié par recherche exhaustive :
aucune occurrence de `gtag`, `analytics`, `plausible`, `matomo`, `sentry`, `googletagmanager` ou
`fonts.googleapis` dans `src/`, `public/` ou `functions/`.

---

## 3. Points conformes (à préserver)

1. **Privacy by design réelle** (art. 25) — le mode par défaut ne transmet rien. La connexion est une
   décision explicite, et l'application reste « pleinement utilisable en mode invité » (contrainte
   architecturale inscrite dans `server/README.md`).
2. **Contenu du chat jamais transmis** — décision tenue et vérifiable : aucune table du schéma ne le
   référence, `SYNCED_SETTING_KEYS` ne contient que `chatActiveChannels` et `chatFilters` (les
   _filtres_, pas les messages). La justification retenue est exactement la bonne (« ils
   appartiennent à des tiers qui n'ont rien demandé »).
3. **Fichier `wakfu.log` jamais téléversé** — lecture locale seule.
4. **Traitement des pseudonymes de tiers correctement fondé** (art. 6.1.f) — le point 1.3 de la
   politique énonce la finalité, la mise en balance des intérêts (pseudonymes déjà visibles de tous
   les joueurs présents, sans message de chat, accessibles au seul titulaire du compte, jamais
   publics) et un droit de retrait par courriel. C'est le traitement le plus exposé du dossier, et il
   est traité comme il doit l'être.
5. **Minimisation des scopes OAuth** — `identify email` (Discord), `openid email profile` (Google) :
   le strict nécessaire. Aucun mot de passe géré, reçu ou stocké.
6. **Jeton de session haché** (SHA-256) en base : une fuite en lecture de `sessions` ne permet pas
   d'usurper une session.
7. **Droit à l'effacement effectif** (art. 17) — suppression réelle de la ligne `users`, cascade sur
   tout le reste, sans délai ni conservation résiduelle.
8. **Cloisonnement par utilisateur systématique** — tous les endpoints vérifiés (`history/fights`,
   `history/trades`, `settings`…) filtrent sur `auth.user.id` ; les écritures exigent en plus un
   jeton CSRF (`requireCsrf`).
9. **Aucune journalisation applicative de données personnelles** — aucun `console.log` dans
   `functions/` (seulement dans les scripts d'import hors ligne) : rien ne part dans les logs
   Cloudflare.
10. **Service worker sans cache d'API** — `ngsw-config.json` n'a aucun `dataGroup` et exclut
    `/api/**` : aucune réponse contenant des données personnelles ne subsiste dans le cache.
11. **Redirection OAuth verrouillée** — `sanitizeRedirectTo` rejette `//evil.example`,
    `https://evil.example` et les chemins relatifs ; couvert par des tests.
12. **Rate limiting** sur toutes les routes `/auth/*`, par IP et par compte.
13. **Révocation de session** individuelle et globale depuis « Mon compte », overlay appairé compris.
14. **Pas d'injection HTML sur du contenu tiers** — `[innerHTML]` n'est utilisé que sur le
    dictionnaire de traductions interne ; le chat est rendu par interpolation échappée.
15. **Le relais d'icônes de l'overlay améliore la situation** — les icônes passent par les serveurs
    du projet plutôt que par le CDN communautaire, qui ne voit donc « ni votre adresse IP ni la liste
    des icônes que vous demandez ». C'est un gain net de minimisation vis-à-vis d'un tiers.

---

## 4. Écarts constatés

### 🔴 4.1 — Fuite d'historique entre comptes via la file de synchronisation locale

**Articles concernés** : 5.1.f (intégrité et confidentialité), 32 (sécurité), 5.1.d (exactitude).

La file d'envoi persistante n'est **pas cloisonnée par utilisateur**, à aucun étage :

- `src/app/core/services/persistence.service.ts:107` — `getSyncQueue()` fait un `getAll()` sur le
  magasin IndexedDB, sans aucun filtre.
- `src/app/core/sync/sync-queue.service.ts:110` — `deactivate()` (déconnexion **et** suppression de
  compte) vide la mémoire mais laisse le contenu sur le disque, ce que le commentaire assume
  explicitement : « son contenu reste sur le disque, prêt à repartir à la prochaine connexion au même
  compte ».
- `src/app/core/sync/sync-queue.service.ts:96` — `activate(uid)` recharge **tout** le magasin, sans
  vérifier à quel compte les entrées se rapportaient.
- `src/app/core/sync/sync-queue.service.ts:226` — la `clientKey` est recalculée à l'envoi avec l'`uid`
  **courant**, pas celui d'origine : les entrées héritées deviennent indistinguables d'entrées
  légitimes et sont acceptées sans conflit par le serveur.

**Scénario de défaillance** : sur un navigateur partagé, ou simplement au changement de compte, A se
déconnecte avec des événements encore en file — batch en attente, coupure réseau, onglet fermé
pendant le délai de regroupement. B se connecte : `activate()` recharge les entrées de A, les
re-signe avec l'`uid` de B, et l'historique de combats, achats et échanges de A atterrit
silencieusement sur le compte de B.

**Second effet, sur le droit à l'effacement** (art. 17) : `deleteAccount()` appelle `becomeGuest()`,
donc `deactivate()` — la file locale survit à la suppression du compte. Une reconnexion réenvoie
l'historique que l'utilisateur venait de faire effacer.

**Correctif proposé** : stocker l'`uid` sur chaque entrée de file, filtrer au rechargement
(`getSyncQueue(uid)`), et purger le magasin dans `deactivate()` — ou au minimum lors d'une suppression
de compte.

### 🟠 4.2 — L'export « RGPD » ne contient pas les données du compte

**Articles concernés** : 15 (droit d'accès), 20 (portabilité), 12 (transparence).

`src/app/features/auth/account-page/account-page.component.ts:92` appelle
`AppDataExportService.buildExport()`, qui (`app-data-export.service.ts:40`) se contente de relire les
11 clés `USER_DATA_KEY_LIST` **depuis le stockage local**. Aucun endpoint d'export n'existe côté
serveur (`functions/api/v1/auth/` : `account`, `logout`, `me`, `sessions`, `native`, `[provider]`).

Sont donc absents de l'export :

- l'identité : e-mail, nom affiché, fournisseurs liés, `created_at`, `last_seen_at` ;
- les sessions : dates, `user_agent`, appareils appairés ;
- **l'intégralité de l'historique serveur** : `fights`, `fight_participants`, `fight_loot`,
  `purchases`, `trades`, `trade_items`, `pact_extractions`, `pact_extraction_items`.

C'est précisément la part que l'utilisateur ne peut pas reconstituer lui-même — et l'historique en
mode connecté est conservé « sans limite, contrairement au mode invité » selon la politique.
Aggravant : sur un appareil fraîchement connecté, l'export est quasi vide tant que la synchronisation
n'a rien rapatrié.

La politique (point 6) promet pourtant : « obtenir une copie des données vous concernant — le bouton
« Exporter » de la page « Mon compte » le fait en un clic », et présente le même bouton comme réponse
au droit à la portabilité. L'écart entre la promesse et le code est direct.

**Correctif proposé** : ajouter un `GET /api/v1/auth/export` renvoyant `users`, `user_identities`,
`sessions`, `user_settings` et les six tables d'historique pour `auth.user.id`, et y brancher le
bouton lorsque l'utilisateur est connecté (en fusionnant avec l'export local). Le format JSON existant
satisfait l'article 20 (« structuré, couramment utilisé et lisible par machine »).

### ✅ 4.3 — L'hébergeur du front de production n'est pas déclaré — **résolu le 2026-09-19**

**Articles concernés** : 13.1.e/f (destinataires et transferts), 28 (sous-traitants).

**Constat d'origine.** La section « Hébergement » déclarait deux prestataires — **Cloudflare, Inc.**
et **Databricks, Inc.** (Neon) — alors que la production publique était servie par **GitHub Pages**
(`deploy-master.yml`, branche `master`, `https://oumbra.github.io/wakfu-companion`, valeur reprise
dans `seo.service.ts`, `src/index.html`, `robots.txt`, `sitemap.xml` et `llms.txt`). GitHub, Inc.
(groupe Microsoft, États-Unis) recevait donc l'adresse IP et le user-agent de **tout** visiteur du
site, y compris en mode invité, sans être cité comme hébergeur — la mise à jour du 19 septembre ne
mentionnait GitHub qu'au titre de la vérification de mise à jour de l'overlay.

**Résolution.** Des deux correctifs proposés, c'est le second qui a été retenu : l'ancien
déploiement GitHub Pages a été **décommissionné**. Il ne servait plus que de portail vers la version
Cloudflare. Le workflow `deploy-master.yml` et les branches `master`/`gh-pages` ont été supprimés, et
le domaine canonique est passé à `https://wakfu-companion.com` dans les cinq emplacements.

La production comme la preview sont désormais servies **uniquement par Cloudflare Pages**, qui est
bien déclaré dans la section « Hébergement ». Le seul flux résiduel vers GitHub est la vérification
de mise à jour de l'overlay de bureau — exactement ce que décrit le point 4 de la politique, dont la
formulation devient donc exacte sans retouche.

### 🟡 4.4 — Adresse IP stockée en clair en base

**Articles concernés** : 5.1.c (minimisation), 13 (information), 32 (sécurité).

`server/auth/rate-limit.ts:66` lit `cf-connecting-ip`, et cinq endpoints la concatènent telle quelle
dans la clé primaire de `auth_rate_limits` : `auth:start:ip:1.2.3.4`
(`functions/api/v1/auth/[provider]/start.ts:31`, `callback.ts:60`, `sessions.ts:51`, `logout.ts:24`,
`native/claim.ts:21`).

L'adresse IP est une donnée à caractère personnel (CJUE, _Breyer_, C-582/14). Il s'agit ici d'un
traitement **propre à l'application**, distinct de la journalisation par les hébergeurs — seule
mentionnée dans la politique. Deux conséquences : le traitement n'est pas déclaré, et la donnée est
conservée en clair alors que sa fonction (compter des requêtes) n'exige aucune réversibilité.

La purge est par ailleurs seulement opportuniste : `checkRateLimit` ne nettoie la fenêtre précédente
qu'au **premier** appel d'une nouvelle fenêtre. Sans trafic, les lignes subsistent indéfiniment.

**Correctif proposé** : remplacer l'IP par un `HMAC-SHA256(IP, sel serveur)` tronqué dans le
`bucket` — le comptage fonctionne à l'identique, la donnée devient pseudonymisée ; et ajouter une
ligne au point 1.2 (finalité anti-abus, intérêt légitime, fenêtre de 10 minutes).

### 🟡 4.5 — Les sessions expirées ne sont jamais supprimées

**Article concerné** : 5.1.e (limitation de la conservation).

`server/auth/store.ts` déclare `purgeExpiredAuthorizations`, `purgeRateLimits` et
`purgeExpiredPairings` — mais **aucune purge de `sessions`**. Les lignes expirées ou révoquées, qui
portent le `user_agent` et l'historique des dates de connexion, s'accumulent jusqu'à la suppression du
compte.

La politique indique que le cookie du site et le jeton de l'overlay « expirent tous deux
automatiquement au bout de 30 jours glissants » ; l'enregistrement correspondant, lui, reste. Pour un
utilisateur ancien connecté depuis plusieurs appareils, cela constitue un historique de connexion
complet, conservé sans finalité active.

**Correctif proposé** : ajouter `purgeExpiredSessions(before)` à `AuthStore`, supprimant les sessions
expirées ou révoquées depuis plus de 30 jours, appelée selon le même schéma opportuniste que les
autres purges (Cloudflare Pages n'offrant pas de Cron Trigger).

### 🟡 4.6 — Omissions résiduelles dans la politique

**Articles concernés** : 12, 13 (information à jour et complète).

Le texte du 19 septembre 2026 couvre désormais l'overlay et les pseudonymes de tiers. Trois écarts
subsistent, tous de complétude :

1. **Extractions de pacte** — les tables `pact_extractions` / `pact_extraction_items` existent depuis
   le 5 septembre. La politique énumère « votre historique de combats, achats et échanges » : les
   extractions forment une quatrième catégorie, absente du texte (recherche sur « pacte » et
   « extraction » : aucune occurrence).
2. **Données de configuration synchronisées** — le point 1.2 cite « profil, personnages, liste de
   suivi, filtres de recherche du chat », soit 4 des **11 clés** réellement envoyées
   (`server/settings/keys.ts`). Manquent notamment `damageReassignments` et `itemReassignments`, qui
   contiennent des **noms de personnages**, ainsi que `watchlistAddMode`, `chatActiveChannels`,
   `combatPanelCollapsed`, `chatPanelCollapsed` et `dashboardLayout` (voir annexe 7.2).
3. **Asymétrie site / overlay sur les participants de combat** — le point 1.4 décrit précisément ce
   que l'overlay envoie (« avec le nom, la classe et les dégâts, soins et sorts de chaque participant,
   alliés compris, donc potentiellement d'autres joueurs »), tandis que le point 1.2, qui décrit le
   même envoi par le site, ne mentionne que l'historique « de combats » sans ce détail. Le point 1.3
   rattrape en partie la chose (« participants à un combat »), mais un lecteur du seul point 1.2 ne
   peut pas deviner l'étendue de ce qui part. Aligner 1.2 sur la formulation de 1.4 suffit.

**Correctif proposé** : synchroniser le texte avec `SYNCED_SETTING_KEYS` et le schéma, et adopter la
règle « toute nouvelle table rattachée à `users` ou toute nouvelle clé synchronisée implique une
relecture des documents légaux » — à inscrire dans `CLAUDE.md` au même titre que le gating
`isInitialLoad`.

### 🟡 4.7 — Aucune information au point de collecte

**Article concerné** : 13.1 (information au moment de la collecte).

L'écran de connexion (`auth.login.intro`, `auth.login.guestNote`,
`shared/auth-provider-buttons/`) explique le bénéfice de la connexion et rappelle qu'elle est
facultative, mais ne renvoie **ni à la politique de confidentialité, ni aux CGU**. Ces liens
n'existent que dans le pied de page (`shared/app-footer/app-footer.component.html`). C'est pourtant le
moment exact où l'utilisateur déclenche la transmission de son e-mail à l'éditeur.

**Correctif proposé** : une ligne sous les boutons Discord/Google, du type « En vous connectant, vous
acceptez les [CGU] et la [politique de confidentialité] », branchée sur deux
`LegalPageService.open(...)`. Faible coût, et cela rend les CGU réellement opposables (elles affirment
déjà « En utilisant l'application, vous acceptez les présentes CGU »).

### 🟡 4.8 — Aucun en-tête de sécurité HTTP

**Article concerné** : 32 (sécurité du traitement).

`public/` contient `_redirects` mais **pas de `_headers`** : le déploiement Cloudflare Pages ne pose
donc ni `Content-Security-Policy`, ni `X-Content-Type-Options`, ni `Referrer-Policy`, ni
`X-Frame-Options`, ni `Strict-Transport-Security`.

Le contexte rend ce manque plus sensible qu'ailleurs : l'application affiche du texte issu du chat de
jeu, c'est-à-dire du contenu contrôlé par des tiers — un risque que le code identifie lui-même pour
justifier le cookie `HttpOnly`. Le cookie `wc_csrf`, lui, est lisible en JS par conception. Un
`Referrer-Policy: no-referrer` apporterait en outre un gain direct côté vie privée, les icônes du site
étant toujours chargées depuis des CDN tiers.

**Correctif proposé** : ajouter `public/_headers` avec au minimum `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` et une CSP, d'abord en
`Content-Security-Policy-Report-Only` le temps de valider qu'elle ne casse ni les CDN d'images ni le
service worker.

### 🟡 4.9 — Rémanence des données locales après déconnexion ou suppression de compte

**Articles concernés** : 17 (effacement), 5.1.f.

`AuthService.becomeGuest()` remet l'application en mode local sans rien effacer : les données
rapatriées depuis le compte (profil, roster, watchlist, filtres de chat, et donc pseudos de tiers)
restent dans `localStorage` et IndexedDB. Le choix est défendable en déconnexion volontaire —
l'utilisateur garde ses données localement, conformément au mode invité — mais discutable sur un poste
partagé, et franchement contestable **après une suppression de compte**, où l'intention est sans
ambiguïté.

À noter que l'overlay, lui, fait déjà mieux : la politique décrit une déconnexion qui « efface le
jeton […], les combats en cours, les compteurs de suivi, l'image des noms et le contenu du journal »,
plus un bouton « Supprimer les données locales ». Le site gagnerait à s'aligner.

**Correctif proposé** : à la suppression du compte, proposer une case « effacer aussi les données de
cet appareil » (le bouton « Réinitialiser » existe déjà côté profil, la mécanique est disponible).

### ⚪ 4.10 — Obligations documentaires absentes

| Obligation                                 | État           | Commentaire                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registre des traitements** (art. 30)     | Absent         | L'exemption des organismes de moins de 250 personnes ne s'applique pas : le traitement n'est ni occasionnel, ni limité. Une page suffit — ébauche au §6.                                                                                                                                                                                                                                                                                  |
| **Contrats de sous-traitance** (art. 28.3) | Non documentés | Les DPA de Cloudflare, Neon/Databricks et GitHub existent et sont acceptés par défaut à l'usage ; il faut les archiver et les référencer.                                                                                                                                                                                                                                                                                                 |
| **Procédure de violation** (art. 33/34)    | Absente        | Notification à la CNIL sous 72 h. Pour un projet d'une personne, une demi-page suffit (détection, périmètre, notification, information des personnes).                                                                                                                                                                                                                                                                                    |
| **AIPD / DPIA** (art. 35)                  | Absente        | Vraisemblablement non requise : pas de données sensibles (art. 9), pas de profilage à grande échelle, pas de décision automatisée. Consigner ce raisonnement par écrit est la bonne pratique.                                                                                                                                                                                                                                             |
| **Vérification de l'âge**                  | Absente        | Les CGU annoncent l'accord parental en deçà de 15 ans, sans aucun mécanisme. Acceptable en pratique pour ce type de service ; à assumer explicitement.                                                                                                                                                                                                                                                                                    |
| **Adresse de contact**                     | À vérifier     | `contact@wakfu-companion.com` est l'unique voie d'exercice des droits, y compris pour le **retrait d'un pseudonyme de tiers** promis au point 1.3. Depuis la bascule du 2026-09-19 (cf. 4.3), l'adresse est bien sur le domaine de production — reste à confirmer que la boîte est **réellement relevée** : sans cela, aucun droit n'est exerçable (art. 12.2/12.3 : réponse sous un mois). **À confirmer avant tout correctif de code.** |

---

## 5. Plan d'action proposé

Classé par rapport gain de conformité / coût de mise en œuvre.

### Priorité 1 — à traiter en premier

| #     | Action                                                                                                                                        | Écart | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| 1     | Vérifier que `contact@wakfu-companion.com` est réellement relevée ; sinon la remplacer partout                                                | 4.10  | Minime |
| 2     | Cloisonner la file de synchronisation par `uid` et la purger à la suppression de compte                                                       | 4.1   | Moyen  |
| 3     | Ajouter `GET /api/v1/auth/export` et y brancher le bouton « Exporter »                                                                        | 4.2   | Moyen  |
| ~~4~~ | ~~Déclarer GitHub, Inc. comme hébergeur du site (ou finaliser la bascule Cloudflare)~~ — **fait** : GitHub Pages décommissionné le 2026-09-19 | 4.3   | —      |

### Priorité 2 — à planifier

| #   | Action                                                                                       | Écart | Effort |
| --- | -------------------------------------------------------------------------------------------- | ----- | ------ |
| 5   | Compléter la politique : extractions de pacte, 11 clés synchronisées, alignement 1.2 sur 1.4 | 4.6   | Faible |
| 6   | Hacher l'IP dans `auth_rate_limits` + déclarer le traitement anti-abus                       | 4.4   | Faible |
| 7   | Ajouter `purgeExpiredSessions()`                                                             | 4.5   | Faible |
| 8   | Lien vers CGU + politique sous les boutons de connexion                                      | 4.7   | Minime |
| 9   | Ajouter `public/_headers` (CSP en report-only d'abord)                                       | 4.8   | Faible |

### Priorité 3 — documentaire et amélioration continue

| #   | Action                                                                                                                   | Écart | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| 10  | Rédiger le registre des traitements (art. 30)                                                                            | 4.10  | Faible |
| 11  | Archiver les DPA des trois sous-traitants                                                                                | 4.10  | Minime |
| 12  | Écrire la procédure de violation de données                                                                              | 4.10  | Faible |
| 13  | Consigner l'analyse d'absence d'AIPD                                                                                     | 4.10  | Minime |
| 14  | Proposer l'effacement local à la suppression de compte, comme le fait l'overlay                                          | 4.9   | Faible |
| 15  | Inscrire dans `CLAUDE.md` la règle « nouvelle table `users` ou nouvelle clé synchronisée ⇒ relecture des textes légaux » | 4.6   | Minime |
| 16  | Auditer le dépôt `wakfu-companion-overlay` pour confirmer les affirmations du point 1.4                                  | —     | Moyen  |

---

## 6. Ébauche de registre des traitements (art. 30)

À compléter et à conserver hors du dépôt public si l'adresse du responsable de traitement y figure.

**Responsable de traitement** : Oumbra, développeur indépendant — projet personnel non lucratif.
**Contact** : `contact@wakfu-companion.com` (à confirmer, cf. 4.10).
**Délégué à la protection des données** : non désigné (non requis, art. 37).

### Traitement n°1 — Compte utilisateur et synchronisation

- **Finalité** : permettre à l'utilisateur de retrouver ses réglages, son roster et son historique de
  jeu sur plusieurs appareils et depuis deux clients (site et overlay de bureau).
- **Base légale** : exécution du contrat (art. 6.1.b), formé à la création du compte ; intérêt
  légitime (art. 6.1.f) pour les pseudonymes de tiers figurant dans l'historique.
- **Personnes concernées** : utilisateurs inscrits ; **tiers** (coéquipiers de combat, partenaires
  d'échange, joueurs suivis via les filtres de chat).
- **Catégories de données** : e-mail vérifié, nom affiché, identifiant du fournisseur OAuth, réglages
  applicatifs, historique de combats/achats/échanges/extractions, noms de personnages (utilisateur et
  tiers).
- **Destinataires** : Cloudflare, Inc. (hébergement du site **et** de l'API) ; Databricks, Inc. /
  Neon (base, serveurs UE).
- **Transferts hors UE** : États-Unis — Data Privacy Framework (Cloudflare, Google, Discord),
  clauses contractuelles types (Databricks).
- **Durée** : vie du compte ; effacement immédiat et en cascade à la suppression.
- **Mesures de sécurité** : OAuth sans mot de passe, jeton de session haché SHA-256, cookies
  `HttpOnly`/`Secure`/`SameSite`, CSRF double-submit, cloisonnement par `user_id` sur tous les
  endpoints, TLS de bout en bout, chiffrement au repos (Neon).

### Traitement n°2 — Sécurité des accès

- **Finalité** : prévenir les abus des routes d'authentification, permettre la reconnaissance et la
  révocation des appareils connectés (navigateurs et overlays appairés).
- **Base légale** : intérêt légitime (art. 6.1.f).
- **Catégories de données** : adresse IP (cf. 4.4), user-agent, dates de session.
- **Durée** : 10 minutes pour les compteurs anti-abus ; **à borner** pour les sessions (cf. 4.5).

### Hors registre — mode invité

Aucun traitement au sens du RGPD n'est opéré par l'éditeur : les données restent sur l'appareil de
l'utilisateur, qui en conserve le contrôle exclusif.

---

## 7. Annexes

### 7.1 Sous-traitants et destinataires

| Entité                             | Rôle                                                                                                                      | Localisation            | Encadrement du transfert          | Déclaré ? |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------- | --------- |
| Cloudflare, Inc.                   | Hébergement API + preview (et bascule du front à venir)                                                                   | US / edge mondial       | Data Privacy Framework            | ✅        |
| Databricks, Inc. (Neon)            | Base PostgreSQL                                                                                                           | Serveurs UE, société US | Clauses contractuelles types      | ✅        |
| GitHub, Inc. (Microsoft)           | Vérification de mise à jour de l'overlay de bureau (l'hébergement du front est passé à Cloudflare le 2026-09-19, cf. 4.3) | US                      | DPF (via Microsoft)               | ✅        |
| Discord, Inc.                      | Fournisseur OAuth                                                                                                         | US                      | Data Privacy Framework            | ✅        |
| Google LLC                         | Fournisseur OAuth                                                                                                         | US                      | Data Privacy Framework            | ✅        |
| `static.ankama.com` (Ankama Games) | Icônes d'objets (site uniquement)                                                                                         | FR                      | — (requête directe du navigateur) | ✅        |
| `vertylo.github.io` (wakassets)    | Icônes (site : direct ; overlay : relayé par nos serveurs)                                                                | US (GitHub Pages)       | —                                 | ✅        |

Les deux derniers ne sont pas des sous-traitants pour le site : le navigateur les contacte
directement, ils reçoivent l'IP du visiteur comme pour n'importe quelle image chargée sur le web. La
politique le dit correctement (point 2).

### 7.2 Clés de données synchronisées avec le compte

Source de vérité : `src/app/core/data-access/user-data.keys.ts` ↔ `server/settings/keys.ts`
(liste blanche fermée côté serveur).

| Clé                    | Contenu                         | Pseudo d'un tiers possible ? | Citée dans la politique ? |
| ---------------------- | ------------------------------- | ---------------------------- | ------------------------- |
| `profile`              | Profil du joueur                | Non                          | ✅                        |
| `watchlist`            | Liste de suivi (objets/ennemis) | Non                          | ✅                        |
| `watchlistAddMode`     | Préférence d'ajout              | Non                          | ❌                        |
| `damageReassignments`  | Réattributions de dégâts        | **Oui**                      | ❌                        |
| `itemReassignments`    | Réattributions d'objets         | **Oui**                      | ❌                        |
| `roster`               | Comptes et personnages déclarés | Non                          | ✅                        |
| `chatActiveChannels`   | Canaux de chat actifs           | Non                          | ❌                        |
| `chatFilters`          | Filtres de recherche du chat    | **Oui**                      | ✅                        |
| `combatPanelCollapsed` | Préférence d'affichage          | Non                          | ❌                        |
| `chatPanelCollapsed`   | Préférence d'affichage          | Non                          | ❌                        |
| `dashboardLayout`      | Disposition du tableau de bord  | Non                          | ❌                        |

Cf. 4.6 : deux des trois clés pouvant contenir un pseudonyme de tiers ne sont pas citées.

### 7.3 Méthode de vérification

Analyse statique du dépôt à la révision `c2f3fdb`. Éléments vérifiés par lecture directe du code :
schéma complet (`server/db/schema.ts`, 23 tables), les 27 modules de `functions/api/v1/`, la chaîne
d'authentification (`server/auth/`), la synchronisation client (`src/app/core/sync/`), la persistance
locale (`persistence.service.ts`, `user-data.keys.ts`), la configuration du service worker, les
workflows de déploiement et les textes légaux des 4 locales.

Recherches exhaustives menées : traceurs et scripts tiers (aucun), `console.*` dans les endpoints
(aucun), `innerHTML` (3 occurrences, toutes sur des traductions internes), captation d'IP
(1 occurrence), purges en base (3 des 4 tables concernées).

**Non vérifié** (hors portée d'une analyse de code) : le code de l'overlay de bureau (dépôt distinct),
le comportement réel en production, la configuration effective du projet Cloudflare Pages et de la
base Neon, les DPA signés, et l'existence effective de la boîte de contact.
