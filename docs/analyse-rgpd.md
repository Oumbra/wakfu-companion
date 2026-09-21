# Analyse de conformité RGPD — Wakfu Companion

> **Version analysée** : 1.137.0 (commit `c2f3fdb`, 2026-09-19) · **Date de l'analyse** : 19 septembre 2026
> · **Audits de suivi** : 21 septembre 2026 (§9, points 1 à 7) et 21 septembre 2026 au soir (§9.1, points 8 à 13)
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

> **Mises à jour du 2026-09-19** (ce document est tenu à jour au fil des correctifs ; l'état de
> chaque écart est indiqué dans son titre) :
>
> - 4.3 (hébergeur du front non déclaré) **résolu** : GitHub Pages décommissionné, domaine canonique
>   `https://wakfu-companion.com`.
> - 4.5 (sessions jamais purgées) **résolu** par `433960a` (`purgeDeadSessions`, 30 jours après la
>   fin de session), politique §5 à jour.
> - 4.2 (export) : le volet **documentaire** est résolu par `168cd01` — la politique ne promet plus
>   que ce que le bouton fait réellement, le reste est fourni sur demande écrite sous un mois
>   (art. 12.3). **Résolu entièrement le 2026-09-20** : `GET /api/v1/auth/export` +
>   `AccountExportService`, le bouton produit la copie complète (voir 4.2).
> - 4.4 (IP en clair) : le volet **déclaration** est résolu par `1651a41` (points 1, 1.2, 1.3 et 5) ;
>   le volet **minimisation** (hachage) par `efc004c` — résolu (voir 4.4).
> - 4.6 : les extractions de pacte sont désormais citées (`1651a41`) ; les deux autres omissions
>   sont comblées le 2026-09-19, et la règle de relecture est inscrite dans `CLAUDE.md` le
>   2026-09-20 (#15).
> - Le reliquat issu de l'analyse menée depuis l'overlay (`analyse-rgpd-site.md`, fusionné ici le
>   2026-09-19) est repris en **section 8**.
> - **2026-09-20 — localisation de la base corrigée** : la politique (§3, §4) et les mentions
>   légales (§2) affirmaient « serveurs situés au sein de l'Union européenne » ; la région réelle
>   du projet Neon est `aws-eu-west-2` (**Londres, Royaume-Uni** — hors UE). Le transfert est licite
>   par décision d'adéquation de la Commission (renouvelée le 21 décembre 2025, valable jusqu'en
>   2031, art. 45), mais l'information était inexacte (art. 13.1.f) : textes corrigés dans les 4
>   locales. Alternative si l'on veut retrouver « UE » : recréer le projet Neon dans une région
>   européenne (Francfort) et migrer la base — **décision du 2026-09-20 (après-midi) : la base reste à
>   Londres** sous adéquation, échéance 2031 surveillée (registre §7).
> - **2026-09-20 (après-midi) — trois décisions du responsable consignées** (registre §7) : purge des
>   comptes inactifs depuis 12 mois (#18, code + migration `0030` + politique §5), base maintenue au
>   Royaume-Uni, âge minimum assumé sans mécanisme de vérification (4.10).
> - **2026-09-20 (soir) — améliorations facultatives faites** : export RGPD complet en un clic (#17,
>   4.2, politique §6 et CGU §5 dans les 4 locales) ; règle de relecture des textes légaux inscrite
>   dans `CLAUDE.md` (#15). Le périmètre de ce document est le seul dépôt du site : ce qui relève
>   du dépôt de l'overlay y est suivi séparément.
> - **2026-09-20 (soir) — entretien annuel planifié** (#20) : le workflow
>   `.github/workflows/rgpd-revision-annuelle.yml` ouvre chaque 1er septembre une issue assignée au
>   responsable avec la liste de contrôle (`sous-traitants-dpa.md` §5 + relecture des documents
>   du 19 septembre 2026, alerte adéquation Royaume-Uni à partir de 2030) ; doublon calendrier
>   `revision-rgpd.ics` hors dépôt. Le `schedule` ne tourne que depuis `main` : effectif après la
>   fusion.

| Gravité                  | Nombre | Nature                                                                                                                                                                            |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critique              | 0      | — (fuite d'historique entre comptes, 4.1, résolue le 2026-09-19)                                                                                                                  |
| 🟠 Majeur                | 0      | — (export 4.2 résolu le 2026-09-20, hébergeur 4.3 résolu)                                                                                                                         |
| 🟡 Modéré                | 0      | — (IP en clair 4.4, omissions de la politique 4.6, point de collecte 4.7, en-têtes 4.8 — CSP bloquante depuis le 2026-09-20 —, rémanence locale 4.9 : tous résolus le 2026-09-19) |
| ⚪ Mineur / documentaire | 0      | — (registre, note de mise en balance, DPA archivés, procédure de violation, note d'absence d'AIPD : tous rédigés les 2026-09-19/20, hors dépôt — voir 4.10)                       |

Aucun écart ne relevait d'une collecte abusive ou dissimulée : tous étaient soit des **omissions
d'information**, soit des **défauts de minimisation ou de rétention**, soit — pour le point
critique — un **bug de cloisonnement** dans la file de synchronisation. **Au 2026-09-19 (soir),
tous les écarts de code sont résolus** ; les documents internes (4.10) sont rédigés le 2026-09-19 et
complétés le 2026-09-20 ; la CSP est bloquante depuis le 2026-09-20. Il ne reste que la mise en
production (fusion `claude/dev` → `main`) — les améliorations facultatives (#15, #17) sont faites
le 2026-09-20.

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

| Table                                        | Données                                                                                                                                                   | Base légale déclarée                                      | Durée réelle en base                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `users`                                      | e-mail vérifié, nom affiché, `created_at`, `last_seen_at` (colonne `default_game_server`, jamais utilisée, retirée par la migration `0031` le 2026-09-21) | Contrat (art. 6.1.b)                                      | Vie du compte                              |
| `user_identities`                            | fournisseur, `provider_uid`, e-mail, `linked_at`                                                                                                          | Contrat                                                   | Vie du compte                              |
| `sessions`                                   | SHA-256 du jeton, `user_agent`, dates d'émission/usage/expiration/révocation                                                                              | Intérêt légitime (art. 6.1.f)                             | 30 j après expiration/révocation ✅ (§4.5) |
| `oauth_authorizations`                       | `state`, `code_verifier` PKCE, `redirect_to`                                                                                                              | Contrat / sécurité                                        | Purgée à chaque callback ✅                |
| `native_pairings`                            | `device_code`, `user_code`, jeton de session en transit                                                                                                   | Contrat                                                   | Purgée à l'expiration ✅                   |
| `auth_rate_limits`                           | HMAC tronqué de l'adresse IP dans `bucket` (§4.4), fenêtre, compteur                                                                                      | Intérêt légitime                                          | Purge opportuniste (§4.4)                  |
| `user_settings`                              | 11 clés de configuration en `jsonb`                                                                                                                       | Contrat                                                   | Vie du compte                              |
| `fights`, `fight_participants`, `fight_loot` | combats, **noms des alliés (joueurs tiers)**, classe, dégâts, soins, sorts, butin                                                                         | Contrat (6.1.b) + intérêt légitime (6.1.f) pour les tiers | Vie du compte                              |
| `purchases`, `trades`, `trade_items`         | achats, échanges, **nom du partenaire d'échange**                                                                                                         | Idem                                                      | Vie du compte                              |
| `pact_extractions`, `pact_extraction_items`  | extractions de pacte                                                                                                                                      | Contrat                                                   | Vie du compte                              |

Toutes les tables rattachées à `users` portent `ON DELETE CASCADE` : la suppression de compte
(`functions/api/v1/auth/account.ts`) est **réellement effective**, sans marquage logique ni
conservation « au cas où ».

Le compte est alimenté par **deux clients** : le site, et l'overlay de bureau appairé par code à
usage unique (`native_pairings`). Les deux écrivent dans les mêmes tables, via les mêmes endpoints
authentifiés ; l'overlay apparaît dans la liste des sessions actives et y est révocable.

### 2.3 Cookies

Quatre cookies (trois depuis l'audit initial, plus `wc_app` le 2026-09-21), tous **strictement
nécessaires** au sens de l'article 82 de la loi Informatique et Libertés — aucun bandeau de
consentement n'est requis, et c'est bien le choix fait. Inventaire regroupé au point 2.1 de la
politique depuis le 2026-09-21 (audit §9, point 4) :

| Cookie           | Rôle                                                                  | Attributs                                               | Durée          |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------- | -------------- |
| `wc_app`         | jeton d'application HMAC, preuve de passage Turnstile (tout visiteur) | `HttpOnly` `Secure` `SameSite=Strict`, portée `/api/v1` | 12 h           |
| `wc_session`     | jeton opaque 256 bits                                                 | `HttpOnly` `Secure` `SameSite=Lax`                      | 30 j glissants |
| `wc_csrf`        | double-submit anti-CSRF                                               | `Secure` `SameSite=Lax` (lisible en JS par conception)  | 30 j           |
| `wc_oauth_state` | liaison du callback OAuth au navigateur                               | `HttpOnly` `Secure`, portée `/api/v1/auth`              | 10 min         |

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

### ✅ 4.1 — Fuite d'historique entre comptes via la file de synchronisation locale — **résolu le 2026-09-19**

**Articles concernés** : 5.1.f (intégrité et confidentialité), 32 (sécurité), 5.1.d (exactitude).

> **Résolution.** Chaque entrée de la file porte désormais l'`uid` du compte auquel elle est
> destinée (`HistoryEvent.uid`, estampillé par `SyncQueueService.enqueue`). `activate(uid)` ne
> recharge que les entrées de ce compte et **efface du disque** toutes les autres — y compris les
> entrées antérieures à ce champ, dont le propriétaire est inconnu (sans perte : l'historique local
> est intact et sera remis en file à la prochaine lecture du fichier). Une déconnexion volontaire
> laisse toujours la file sur le disque (elle repart à la reconnexion du même compte) ; la
> suppression de compte appelle `HistorySyncService.purge()` → `SyncQueueService.purge()`, qui
> efface du disque tout ce qui était destiné au compte supprimé avant le retour en mode invité.
> Couvert par `sync-queue.service.spec.ts` (5 cas : entrée héritée d'un autre compte jamais
> envoyée et effacée, entrée sans `uid` effacée, reconnexion du même compte, estampille, purge
> ciblée). Constat d'origine ci-dessous, conservé pour mémoire.

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

### ✅ 4.2 — L'export « RGPD » ne contient pas les données du compte — **résolu le 2026-09-20**

**Articles concernés** : 15 (droit d'accès), 20 (portabilité), 12 (transparence).

> **Résolution complète (2026-09-20, #17).** `GET /api/v1/auth/export`
> (`functions/api/v1/auth/export.ts`) renvoie la ligne `users` avec ses dates, les identités OAuth
> (identifiant chez le fournisseur compris), **toutes** les sessions encore en base (révoquées,
> remplacées ou expirées incluses tant que la purge de 30 jours ne les a pas effacées — une trace
> détenue est une donnée à restituer, même si `GET /auth/sessions` ne la liste plus) et la
> configuration synchronisée avec son horodatage par clé. L'historique n'y est pas servi d'un
> bloc : `AccountExportService` enchaîne les quatre `GET /api/v1/history/*` paginés (`limit=200`)
> jusqu'à épuisement — sérialiser des milliers de combats dans une seule réponse sortirait du
> budget CPU d'une Pages Function, alors que la pagination existante est bornée et testée ; le
> fichier final est le même. Le bouton « Exporter » de la page « Mon compte » produit
> `{ data: <configuration de l'appareil>, account: <réponse + history> }` (en invité : `data`
> seul, il n'existe rien d'autre), sans rien écrire si une requête échoue (un fichier partiel
> passerait pour complet). Le fichier reste importable (`applyImport` ne lit que `data`).
> Politique §6 (droit d'accès, portabilité) et CGU §5 réécrites dans les 4 locales : la promesse
> « en un clic » est rétablie, la demande écrite reste possible. Registre version 5.
>
> **Résolution partielle antérieure (`168cd01`).** Le point 6 de la politique (4 locales) ne présente plus le
> bouton « Exporter » que pour ce qu'il fait réellement (données de configuration) et renvoie, pour
> l'identité, les sessions et l'historique serveur, à une demande écrite à
> `contact@wakfu-companion.com`, honorée « dans le délai d'un mois prévu par le RGPD ». L'écart
> entre promesse et code est clos ; l'endpoint d'export décrit ci-dessous reste une amélioration
> souhaitable (elle rend le droit exerçable en un clic et évite une extraction manuelle), plus une
> obligation. Tant qu'il n'existe pas, il faut être en mesure de produire cet export à la main
> (requêtes SQL par `user_id` sur les tables listées) dans le mois.
>
> Constat d'origine ci-dessous, conservé pour mémoire.

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

### ✅ 4.4 — Adresse IP stockée en clair en base — **résolu le 2026-09-19**

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

> **Résolution.** Volet _déclaration_ par `1651a41` : le comptage par IP est décrit aux points 1,
> 1.2 (traitement, fenêtre de 10 minutes, « jamais rattachée à votre compte »), 1.3 (intérêt
> légitime) et 5 (durée). Volet _minimisation_ le même jour (`efc004c`) : `clientIpKey`
> (`server/auth/rate-limit.ts`) remplace `clientIp` sur les 7 routes concernées et n'écrit dans
> `auth_rate_limits.bucket` qu'un `HMAC-SHA256(ip, secret)` tronqué à 64 bits — jamais l'adresse.
> Secret : `RATE_LIMIT_SALT` (nouveau secret optionnel, poussé par les deux workflows de
> déploiement, documenté dans `server/README.md`) ; à défaut, `DATABASE_URL` sert de matière à
> clé pour que le repli ne soit jamais un SHA-256 non salé, inversible en secondes sur l'espace
> IPv4. Couvert par `flow.spec.ts` (`clientIpKey` : stable, sans l'IP, dépendant du secret). La
> purge reste opportuniste (première requête d'une nouvelle fenêtre) : acceptable maintenant que
> la ligne résiduelle ne porte plus de donnée personnelle. Constat d'origine ci-dessous.

### ✅ 4.5 — Les sessions expirées ne sont jamais supprimées — **résolu le 2026-09-19**

**Article concerné** : 5.1.e (limitation de la conservation).

> **Résolution (`433960a`).** `AuthStore.purgeDeadSessions(before)` efface toute session expirée
> ou révoquée **30 jours après sa fin** (`DEAD_SESSION_RETENTION_MS`, `server/auth/flow.ts`), sans
> cron : appelée à la connexion OAuth, à l'appairage et à la rotation natifs, sur `GET`/`DELETE
/api/v1/auth/sessions`, sur `DELETE /api/v1/auth/native/session` et au rafraîchissement
> quotidien de l'expiration glissante (seul déclencheur pour un compte dont seul l'overlay tourne).
> Politique §5 mise à jour (4 langues). Constat d'origine ci-dessous, conservé pour mémoire.

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

### ✅ 4.6 — Omissions résiduelles dans la politique — **résolu le 2026-09-19**

**Articles concernés** : 12, 13 (information à jour et complète).

> **Résolution.** Les trois omissions sont comblées (4 locales) : extractions de pacte
> (`1651a41`) ; réattributions de dégâts/objets — citées au point 1.2 dans l'énumération des
> données de configuration, avec la mention explicite qu'elles portent le nom du personnage
> concerné (« qui peut être celui d'un autre joueur »), ajoutées au point 1.3 (base légale des
> pseudonymes de tiers) et à la liste de l'export au point 6 ; participants de combat — le point
> 1.2 reprend désormais la formulation du point 1.4 (« nom, classe, dégâts, soins et sorts de
> chaque participant, alliés compris »). Constat d'origine ci-dessous.

Le texte du 19 septembre 2026 couvre désormais l'overlay et les pseudonymes de tiers. Trois écarts
subsistaient, tous de complétude ; le premier est résolu :

1. ✅ **Extractions de pacte** — résolu par `1651a41` (points 1.2 et 6). Constat d'origine : les
   tables `pact_extractions` / `pact_extraction_items` existent depuis le 5 septembre, et la
   politique énumérait « votre historique de combats, achats et échanges » sans cette quatrième
   catégorie.
2. **Données de configuration synchronisées** — le point 1.2 cite « profil, personnages, liste de
   suivi, filtres de recherche du chat, préférences d'affichage » (« préférences d'affichage »
   ajouté par `1651a41`, ce qui couvre `combatPanelCollapsed`, `chatPanelCollapsed`,
   `dashboardLayout`, `watchlistAddMode` et `chatActiveChannels`). Manquent toujours
   `damageReassignments` et `itemReassignments`, qui contiennent des **noms de personnages** (voir
   annexe 7.2) — c'est le point qui compte, les préférences d'affichage n'ayant aucune portée
   personnelle.
3. **Asymétrie site / overlay sur les participants de combat** — le point 1.4 décrit précisément ce
   que l'overlay envoie (« avec le nom, la classe et les dégâts, soins et sorts de chaque participant,
   alliés compris, donc potentiellement d'autres joueurs »), tandis que le point 1.2, qui décrit le
   même envoi par le site, ne mentionne que l'historique « de combats » sans ce détail. Le point 1.3
   rattrape en partie la chose (« participants à un combat »), mais un lecteur du seul point 1.2 ne
   peut pas deviner l'étendue de ce qui part. Aligner 1.2 sur la formulation de 1.4 suffit.

**Correctif proposé** : synchroniser le texte avec `SYNCED_SETTING_KEYS` et le schéma, et adopter la
règle « toute nouvelle table rattachée à `users` ou toute nouvelle clé synchronisée implique une
relecture des documents légaux » — à inscrire dans `CLAUDE.md` au même titre que le gating
`isInitialLoad`. **Fait le 2026-09-20** (#15) : règle inscrite dans `CLAUDE.md` (« Autres
conventions », déplacée le même jour dans `.claude/rules/user-data-legal.md`), avec la liste des déclencheurs (table/colonne référençant `users`, clé
synchronisée, champ envoyé par un client, durée, service tiers) et des textes à relire.

### ✅ 4.7 — Aucune information au point de collecte — **résolu le 2026-09-19**

**Article concerné** : 13.1 (information au moment de la collecte).

> **Résolution.** `AuthProviderButtonsComponent` (`shared/auth-provider-buttons/`) porte désormais,
> sous les boutons Discord/Google, la mention « En vous connectant, vous acceptez les
> [conditions d'utilisation] et la [politique de confidentialité] » (clés `auth.login.consent*`,
> 4 locales), dont les deux liens ouvrent `LegalPageService.open('terms' | 'privacy')`. Placée
> dans le composant partagé plutôt que chez chaque appelant, elle couvre les **trois** écrans de
> connexion (page profil, « passer cette étape » mobile de la page setup, appairage de l'overlay)
> sans qu'aucun puisse l'omettre. Vérifié en Chrome (`playwright-core`) sur les trois écrans, dans
> les 4 langues, clic sur le lien → `/fr/privacy-policy`. Constat d'origine ci-dessous.

L'écran de connexion (`auth.login.intro`, `auth.login.guestNote`,
`shared/auth-provider-buttons/`) explique le bénéfice de la connexion et rappelle qu'elle est
facultative, mais ne renvoie **ni à la politique de confidentialité, ni aux CGU**. Ces liens
n'existent que dans le pied de page (`shared/app-footer/app-footer.component.html`). C'est pourtant le
moment exact où l'utilisateur déclenche la transmission de son e-mail à l'éditeur.

**Correctif proposé** : une ligne sous les boutons Discord/Google, du type « En vous connectant, vous
acceptez les [CGU] et la [politique de confidentialité] », branchée sur deux
`LegalPageService.open(...)`. Faible coût, et cela rend les CGU réellement opposables (elles affirment
déjà « En utilisant l'application, vous acceptez les présentes CGU »).

### ✅ 4.8 — Aucun en-tête de sécurité HTTP — **résolu le 2026-09-19**, CSP bloquante le 2026-09-20

**Article concerné** : 32 (sécurité du traitement).

> **Résolution.** `public/_headers` pose `X-Content-Type-Options: nosniff`, `X-Frame-Options:
DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
> `Strict-Transport-Security` (1 an) et une CSP **bloquante** (`Content-Security-Policy`, posée en
> `Report-Only` le 2026-09-19 puis activée le 2026-09-20 après validation en conditions réelles —
> connexion OAuth Discord, CDN d'images, sons, service worker, appairage — sans aucune violation)
> (`default-src 'self'`, images autorisées depuis `static.ankama.com` — `vertylo.github.io` retiré le
> 2026-09-20, les icônes wakassets passant désormais par `/api/v1/icons` —,
> `style-src 'unsafe-inline'` imposé par Angular, `frame-ancestors 'none'`, `object-src 'none'`).
> Deux incompatibilités levées pour que la CSP soit tenable : le script inline anti-flash du thème
> déplacé dans `public/theme-init.js`, et `inlineCritical` désactivé dans `angular.json` (le CLI
> injectait un `onload=` inline). Vérifié en Chrome sur le build servi par `wrangler pages dev`
> (seul moyen d'appliquer `_headers` en local, méthode dans `server/README.md`) : en-têtes
> présents, **zéro violation** sur dashboard, appairage, pages légales, icônes tierces, son
> d'alerte, service worker et API. Reste à faire, hors sandbox : valider le retour OAuth sur la
> preview puis passer la CSP en mode bloquant (même valeur, en-tête renommé). Constat d'origine
> ci-dessous.

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

### ✅ 4.9 — Rémanence des données locales après déconnexion ou suppression de compte — **résolu le 2026-09-19**

**Articles concernés** : 17 (effacement), 5.1.f.

> **Résolution.** `PersistenceService.wipeLocalData()` efface `localStorage` et supprime la base
> IndexedDB entière (handle du fichier, cache, file), suivi d'un `location.reload()`. Exposé à
> deux endroits de la page « Mon compte » : (1) connecté, un interrupteur « Effacer aussi les
> données de cet appareil » à côté de « Supprimer mon compte », **décoché par défaut** (le mode
> invité reste utilisable après la suppression ; effacer d'office serait une destruction
> surprise) ; (2) invité, un bouton « Supprimer les données de cet appareil », confirmé par la
> popover habituelle. Le constat d'origine supposait que le « Réinitialiser » de l'en-tête
> suffisait : faux, `resetStats()` ne remet à zéro que la session de statistiques, jamais le
> profil, le roster ni les filtres de chat — la politique (§5 et §6, 4 locales) le présentait
> pourtant comme le moyen d'effacer les données locales, formulation **corrigée** au profit du
> nouveau bouton. Vérifié en Chrome (`DELETE /auth/account` intercepté) : suppression avec
> l'option → profil, filtres de chat et entrées IndexedDB disparus après rechargement ; sans
> l'option → tout conservé ; bouton invité → même effacement. La déconnexion volontaire, elle,
> laisse toujours les données locales intactes (choix assumé, c'est le mode invité). Constat
> d'origine ci-dessous.

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

| Obligation                                 | État         | Commentaire                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Contrats de sous-traitance** (art. 28.3) | ✅ Archivés  | `sous-traitants-dpa.md` + copies datées (Cloudflare DPA v6.4, Neon schedule 5/8/2026 → Databricks MCSA 20/2/2026 → Databricks DPA, GitHub DPA), 2026-09-19 ; identifiants de compte/projet consignés le 2026-09-20. Hors dépôt (§8).                                                                                                                                                                                                                         |
| **Procédure de violation** (art. 33/34)    | ✅ Rédigée   | `procedure-violation-de-donnees.md` (2026-09-19) : six scénarios de confinement, qualification sous 24 h, grille de notification CNIL/personnes, modèle de courriel, aide-mémoire des leviers. Hors dépôt.                                                                                                                                                                                                                                                   |
| **AIPD / DPIA** (art. 35)                  | ✅ Consignée | `note-absence-aipd.md` (2026-09-19) : art. 35.3 et neuf critères WP248 passés en revue, aucun rempli ; liste des changements qui imposeraient d'y revenir. Hors dépôt.                                                                                                                                                                                                                                                                                       |
| **AIPD / DPIA** (art. 35)                  | Absente      | Vraisemblablement non requise : pas de données sensibles (art. 9), pas de profilage à grande échelle, pas de décision automatisée. Consigner ce raisonnement par écrit est la bonne pratique.                                                                                                                                                                                                                                                                |
| **Vérification de l'âge**                  | ✅ Assumée   | Les CGU et la politique §6 annoncent 15 ans avec accord parental en deçà, sans mécanisme — **décision motivée le 2026-09-20** (registre §7) : une date de naissance ou une case à cocher serait une donnée de plus sans valeur probante ; les fournisseurs OAuth appliquent leur propre âge minimum ; le mode invité, sans donnée transmise, est libre d'âge. À reconsidérer si le service ajoutait une interaction entre utilisateurs ou un contenu public. |
| **Adresse de contact**                     | ✅ Confirmée | `contact@wakfu-companion.com` est l'unique voie d'exercice des droits, y compris pour le **retrait d'un pseudonyme de tiers** promis au point 1.3. Depuis la bascule du 2026-09-19 (cf. 4.3), l'adresse est bien sur le domaine de production — boîte **confirmée relevée par le mainteneur** le 2026-09-19 (art. 12.2/12.3 : réponse sous un mois).                                                                                                         |

---

### 🟠 4.11 — Fixtures de test réelles, non pseudonymisées, dans un dépôt public — **pseudonymisées le 2026-09-20**

**Articles concernés** : 5.1.b (limitation des finalités), 5.1.c (minimisation), 5.1.f (intégrité et
confidentialité), 32 (sécurité).

**Faits.** Constat remonté par le mainteneur le 2026-09-20, par analogie avec le C1 du dépôt de
l'overlay : ce dépôt — public depuis sa création (`f3135d0`, 2026-07-15) — versionnait
`tests/wakfu.log` (le MÊME journal réel du 2026-08-04 que la fixture de l'overlay : jeton de
session, IP locale, nom de compte Windows, 6 personnages avec identifiants, 119 pseudonymes de
joueurs tiers et l'intégralité de leurs messages, 12 identifiants de compte Ankama de la liste
d'amis), 36 extraits réels dans `tests/logs/fr/` (7 personnages du mainteneur avec identifiants,
2 partenaires d'échange, 23 auteurs de chat avec leurs messages, un ami avec son identifiant de
compte, une trentaine d'identifiants de joueurs tiers dans les lignes `[NATION]`) et
`tests/wakfu-companion-export.json` (60 noms de personnages du mainteneur). Arrivés par `git add`
ordinaire (`2f70d5f` 2026-07-30, `1ea4234`/`bb66df6` 2026-08-16), sans qu'aucun garde-fou n'alerte.
Des noms réels étaient aussi recopiés dans `log-parser.spec.ts`, `stats-store.service.spec.ts`,
`server/history/parse.spec.ts`.

**Ce qui a été fait (2026-09-20, `db72a3c`).**

1. `tests/wakfu.log` remplacé octet pour octet par la fixture pseudonymisée de l'overlay ; les 36
   journaux de `tests/logs/fr/` et l'export pseudonymisés avec le **même schéma et la même table**
   (déduite en comparant les deux versions du journal commun, prolongée pour les noms nouveaux) :
   personnages `Anonyme-<Classe><N>` / ids `9000000N`, tiers `90001NNN`, auteurs de chat
   `Anonyme-NNN` (numérotation reprise après celle de l'overlay) avec messages en lorem ipsum de
   longueur voisine — un message répété reste répété —, compte Ankama `anonymeNN#NNNN`. Structure
   des fichiers intacte (fins de ligne, retours chariot isolés). Le pseudonyme du mainteneur est
   traité comme les autres dans les fixtures (`Anonyme-Sram1`, décision du mainteneur) ; il reste
   le nom générique des tests synthétiques et du code. Les trois specs sont alignées ; 292 + 159
   tests passent.
2. `tools/check-fixtures.mjs` (8 règles, une par catégorie trouvée — jeton, `C:\Users`, IP privée,
   auteur de chat, combattant humain, compte Ankama, échange, roster de l'export), en hook
   `pre-commit` (`.husky/pre-commit`) **et** en étape de `ci.yml` ; `.gitignore` sur `wakfu.log`
   hors la fixture.

**Reste ouvert — décision du mainteneur.** Les fichiers réels restent dans l'historique Git public
(662 commits) et dans le cache de GitHub : comme pour le C1 de l'overlay, seule une réécriture
d'historique suivie d'une demande de purge à GitHub Support les retire réellement. La note
d'incident hors dépôt (`note-incident-2026-09-15.md`) couvre l'overlay ; ce volet reste à y ajouter
si la même qualification est retenue.

**Réécriture préparée (2026-09-20, soir).** Dossier hors dépôt (`reecriture-site/`, à côté des
documents RGPD) : `git filter-repo` vérifié dans un clone miroir, **non poussé**. Périmètre plus
large que les seules fixtures, à la demande du mainteneur : (1) les 35 blobs réels remplacés par
leur version pseudonymisée sous tous leurs chemins ; (2) purge des journaux réels que l'historique
gardait sous d'anciens chemins (`test-logs/`, `assets/wakfu_chat.log`, `tests/logs/{en,es,pt}/`,
captures `.playwright-mcp/`), des fichiers aujourd'hui ignorés par git mais committés un temps
(référentiel JSON, tables générées, builds) et de l'outillage qui les produisait ; (3) valeurs
réelles recopiées dans specs, code et doc → mêmes pseudonymes ; (4) suppression, sur tout
l'historique, des commentaires qui nomment ces fichiers ou l'origine des données (le nettoyage
équivalent à HEAD : `e897c8d`, `4783f91`, `bdf2d46`). Contrôle exhaustif de tous les blobs texte
avant/après : 0 donnée réelle, 0 chemin purgé, 0 commentaire résiduel ; 662 commits → 635 (les
27 élagués ne touchaient que des fichiers purgés), auteurs/dates/sujets identiques. Reste : le
force-push par le mainteneur, puis le ticket GitHub Support (28 `refs/pull/*` retiennent
l'ancien historique) — décisions et procédure dans le `README.md` du dossier.

**`claude/dev` réécrite et poussée le 2026-09-20 (soir)** par le mainteneur (`b1bb423` → `14a8134`,
665 → 637 commits ; l'analyse CGU sort du dépôt au passage), puis **`main`** le même soir
(`7408c4f` → `8aff03f`, 609 → 586 commits, même arbre hors commentaires et fixtures). Reste le
ticket GitHub Support (texte prêt hors dépôt ; les anciens SHA sont encore servis) et le volet 2
de la note d'incident, rédigé le même soir.

## 5. Plan d'action proposé

Classé par rapport gain de conformité / coût de mise en œuvre.

### Priorité 1 — à traiter en premier

| #     | Action                                                                                                                                                             | Écart | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| ~~2~~ | ~~Cloisonner la file de synchronisation par `uid` et la purger à la suppression de compte~~ — **fait** le 2026-09-19 (voir 4.1)                                    | 4.1   | —      |
| 2     | Cloisonner la file de synchronisation par `uid` et la purger à la suppression de compte                                                                            | 4.1   | Moyen  |
| ~~3~~ | ~~Ajouter `GET /api/v1/auth/export` et y brancher le bouton « Exporter »~~ — rétrogradé en #17 : la politique ne promet plus que ce que le bouton fait (`168cd01`) | 4.2   | —      |
| ~~4~~ | ~~Déclarer GitHub, Inc. comme hébergeur du site (ou finaliser la bascule Cloudflare)~~ — **fait** : GitHub Pages décommissionné le 2026-09-19                      | 4.3   | —      |

### Priorité 2 — à planifier

| #     | Action                                                                                                                                                        | Écart | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| ~~5~~ | ~~Compléter la politique : extractions de pacte, réattributions de dégâts/objets, alignement 1.2 sur 1.4~~ — **fait** le 2026-09-19                           | 4.6   | —      |
| ~~6~~ | ~~Hacher l'IP dans `auth_rate_limits` + déclarer le traitement anti-abus~~ — **fait** (`1651a41` puis `efc004c`, 2026-09-19)                                  | 4.4   | —      |
| ~~7~~ | ~~Ajouter `purgeExpiredSessions()`~~ — **fait** : `purgeDeadSessions`, `433960a`                                                                              | 4.5   | —      |
| ~~8~~ | ~~Lien vers CGU + politique sous les boutons de connexion~~ — **fait** le 2026-09-19                                                                          | 4.7   | —      |
| ~~9~~ | ~~Ajouter `public/_headers` (CSP en report-only d'abord)~~ — **fait** le 2026-09-19 ; reste le passage en mode bloquant après validation sur la preview (#19) | 4.8   | —      |

### Priorité 3 — documentaire et amélioration continue

| #      | Action                                                                                                                                                                                                                                                                                                      | Écart | Effort |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| ~~11~~ | ~~Archiver les DPA des trois sous-traitants~~ — **fait** le 2026-09-19, complété le 2026-09-20 (hors dépôt)                                                                                                                                                                                                 | 4.10  | —      |
| ~~12~~ | ~~Écrire la procédure de violation de données~~ — **fait** le 2026-09-19 (hors dépôt)                                                                                                                                                                                                                       | 4.10  | —      |
| ~~13~~ | ~~Consigner l'analyse d'absence d'AIPD~~ — **fait** le 2026-09-19 (hors dépôt)                                                                                                                                                                                                                              | 4.10  | —      |
| 13     | Consigner l'analyse d'absence d'AIPD                                                                                                                                                                                                                                                                        | 4.10  | Minime |
| ~~14~~ | ~~Proposer l'effacement local à la suppression de compte, comme le fait l'overlay~~ — **fait** le 2026-09-19 (+ bouton invité, politique §5/§6 corrigée)                                                                                                                                                    | 4.9   | —      |
| ~~15~~ | ~~Inscrire dans `CLAUDE.md` la règle « nouvelle table `users` ou nouvelle clé synchronisée ⇒ relecture des textes légaux »~~ — **fait le 2026-09-20**                                                                                                                                                       | 4.6   | —      |
| ~~16~~ | ~~Auditer le dépôt `wakfu-companion-overlay` pour confirmer les affirmations du point 1.4~~ — **fait** le 2026-09-18 (§8)                                                                                                                                                                                   | —     | —      |
| ~~17~~ | ~~Ajouter `GET /api/v1/auth/export` (identité, sessions, historique) et y brancher le bouton « Exporter » en mode connecté~~ — **fait le 2026-09-20** (voir 4.2)                                                                                                                                            | 4.2   | —      |
| ~~18~~ | ~~Décider et consigner : purge (ou non) de l'historique après N mois d'inactivité (§8)~~ — **décidé et fait le 2026-09-20** : purge des comptes inactifs depuis 12 mois (`purgeInactiveAccounts`, migration `0030`, politique §5)                                                                           | —     | —      |
| ~~19~~ | ~~Passer la CSP de `Report-Only` en mode bloquant après validation du retour OAuth~~ — **fait le 2026-09-20** (validé en local, Chrome réel, OAuth Discord)                                                                                                                                                 | 4.8   | Minime |
| ~~20~~ | ~~Planifier l'entretien annuel (DPA, DPF, adéquation Royaume-Uni, relecture des documents du 19 septembre)~~ — **fait le 2026-09-20** : workflow `rgpd-revision-annuelle.yml` (issue chaque 1er septembre, actif après fusion sur `main`) + `revision-rgpd.ics` hors dépôt                                  | 4.10  | Minime |
| 21     | Réécrire l'historique Git (fixtures réelles, journaux sous d'anciens chemins, fichiers ignorés, commentaires sur les sources) et demander la purge du cache à GitHub Support — **préparée et vérifiée le 2026-09-20** (dossier `reecriture-site/` hors dépôt), force-push et ticket à la main du mainteneur | 4.11  | Moyen  |

### Préalable à toute mise en production

**Fusionner `claude/dev` → `main`** (§8, P0) : tant que ce n'est pas fait, la production sert une
politique datée du 26 août sans un mot sur l'overlay, et un binaire de Release ≥ 0.70 de l'overlay
ne fonctionne pas contre elle (icônes, écriture partielle du profil, déconnexion). Les points 2, 6,
8, 9 et 14 sont traités (2026-09-19) : plus rien côté code ne s'oppose à la mise en production ;
le point 1 (boîte de contact) est confirmé par le mainteneur le 2026-09-19 et le point 5 est fait le
même jour.

---

## 6. Ébauche de registre des traitements (art. 30)

À compléter et à conserver hors du dépôt public si l'adresse du responsable de traitement y figure.

**Responsable de traitement** : Oumbra, développeur indépendant — projet personnel non lucratif.
**Contact** : `contact@wakfu-companion.com` (boîte relevée par le mainteneur, confirmé le 2026-09-19).
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
  Neon (base, serveurs au Royaume-Uni — décision d'adéquation).
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
- **Catégories de données** : condensé HMAC de l'adresse IP (cf. 4.4), user-agent, dates de session.
- **Durée** : 10 minutes pour les compteurs anti-abus ; **à borner** pour les sessions (cf. 4.5).

### Hors registre — mode invité

Aucun traitement au sens du RGPD n'est opéré par l'éditeur : les données restent sur l'appareil de
l'utilisateur, qui en conserve le contrôle exclusif.

---

## 7. Annexes

### 7.1 Sous-traitants et destinataires

| Entité                             | Rôle                                                                                                                                | Localisation                      | Encadrement du transfert                        | Déclaré ? |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------- | --------- |
| Cloudflare, Inc.                   | Hébergement API + preview (et bascule du front à venir)                                                                             | US / edge mondial                 | Data Privacy Framework                          | ✅        |
| Databricks, Inc. (Neon)            | Base PostgreSQL                                                                                                                     | Royaume-Uni (Londres), société US | Adéquation RU (21/12/2025, jusqu'en 2031) + CCT | ✅        |
| GitHub, Inc. (Microsoft)           | Vérification de mise à jour de l'overlay de bureau (l'hébergement du front est passé à Cloudflare le 2026-09-19, cf. 4.3)           | US                                | DPF (via Microsoft)                             | ✅        |
| Discord, Inc.                      | Fournisseur OAuth                                                                                                                   | US                                | Data Privacy Framework                          | ✅        |
| Google LLC                         | Fournisseur OAuth                                                                                                                   | US                                | Data Privacy Framework                          | ✅        |
| `static.ankama.com` (Ankama Games) | Icônes d'objets (site uniquement)                                                                                                   | FR                                | — (requête directe du navigateur)               | ✅        |
| `vertylo.github.io` (wakassets)    | Icônes — relayées par nos serveurs pour le site (depuis le 2026-09-20) comme pour l'overlay ; GitHub ne voit que l'IP de Cloudflare | US (GitHub Pages)                 | —                                               | ✅        |

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
| `damageReassignments`  | Réattributions de dégâts        | **Oui**                      | ✅ (2026-09-19)           |
| `itemReassignments`    | Réattributions d'objets         | **Oui**                      | ✅ (2026-09-19)           |
| `roster`               | Comptes et personnages déclarés | Non                          | ✅                        |
| `chatActiveChannels`   | Canaux de chat actifs           | Non                          | ❌                        |
| `chatFilters`          | Filtres de recherche du chat    | **Oui**                      | ✅                        |
| `combatPanelCollapsed` | Préférence d'affichage          | Non                          | ❌                        |
| `chatPanelCollapsed`   | Préférence d'affichage          | Non                          | ❌                        |
| `dashboardLayout`      | Disposition du tableau de bord  | Non                          | ❌                        |

Les préférences d'affichage (`watchlistAddMode`, `chatActiveChannels`, `*PanelCollapsed`, `dashboardLayout`) sont couvertes par la mention « préférences d'affichage » ; les trois clés pouvant contenir un pseudonyme de tiers sont citées nommément (cf. 4.6).

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

---

## 8. Reliquat côté site et API issu de l'analyse menée depuis l'overlay

Reliquat de l'analyse RGPD menée depuis l'overlay ([`analyse-rgpd.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-rgpd.md)
du dépôt `Oumbra/wakfu-companion-overlay`) pour ce dépôt (site web et API Cloudflare Pages),
établi le 2026-09-18, déplacé ici le 2026-09-19 (`docs/analyse-rgpd-site.md`) puis fusionné dans
ce document le même jour. Les autres volets, restés là-bas :
[`analyse-rgpd-overlay.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-rgpd-overlay.md) et
[`analyse-rgpd-mainteneur.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-rgpd-mainteneur.md).
Les références `C2`…`C11` renvoient aux constats de l'analyse overlay.

L'overlay ne peut être conforme seul : plusieurs de ses corrections supposent un pendant côté
service, d'où ce reliquat.

| Prio            | Tâche                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Constat                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **P0**          | **Fusionner `claude/dev` → `main`** : c'est la seule tâche qui bloque encore. Au 2026-09-19 (soir), `claude/dev` a une trentaine de commits d'avance sur `origin/main` (fusion vérifiée sans conflit), dont `DELETE /api/v1/auth/native/session` (`58988ff`), les textes juridiques (`3ba4684`, `a9587a9`, `8e3fdd8`, `50adcf8`, `a5204e1`, `acf4a20`, `168cd01`, `1651a41`), la réparation du déploiement (`80d38fe`, `wrangler-action`), le **relais d'icônes** `GET /api/v1/icons/{folder}/{gfxId}.png` (`a51ee02`, constat C10), l'**écriture partielle** de `PATCH /api/v1/settings` (`c2f3fdb`, constat C9), l'**effacement des sessions mortes** et la **rotation du jeton natif** (`433960a`, voir ci-dessous), le décommissionnement de GitHub Pages (`b6476bd`) et l'analyse RGPD du code du site (`60ccfaa`, ce document) — sans lui, un binaire de Release à partir de 0.70 n'affiche plus aucune icône d'objet, de monstre ni de sort (repli sur l'icône générique). Tant que ce n'est pas fusionné, la prod sert une politique datée du 26 août sans un mot sur l'overlay, et un binaire de Release reçoit un 404 à la déconnexion — la purge locale aboutit (best-effort), mais la ligne de session reste en base                                                                                                                                                                                                                                                                                                                                                                            | C4, C5                   |
| ~~P1~~          | ✅ **Politique de confidentialité** — section « 1.4 Overlay de bureau » dans les quatre langues, datée du 18 septembre 2026 (`3ba4684` sur `claude/dev`, 2026-09-18), avec renvois depuis les sections 1, 1.3, 2, 4, 5 et 6. Contenu demandé : lecture de `wakfu.log` seul ; envoi au compte des combats **avec le nom des participants**, achats, échanges, personnages, alertes, recherches ; lecture optionnelle de la fenêtre de jeu (bande basse, jamais conservée, décochée par défaut) ; entrées synthétiques limitées à deux commandes de chat ; journal local 14 j / 16 Mio ; destinataires tiers **GitHub** (vérification de mise à jour) et **`vertylo.github.io`** (icônes — plus d'actualité depuis le relais de l'API, politique réécrite le 2026-09-19, `a5204e1`) ; données locales et bouton d'effacement ; session native supprimée à la déconnexion. Relue contre le code de l'overlay le 2026-09-18 : combats en cours effacés à la fin du combat ou au-delà de 24 h (`fight_store::MAX_FIGHT_AGE`), périmètre de la déconnexion (`local_data::Scope::OnDisconnect` : combats, compteurs, gabarits, journaux), bouton « Supprimer les données locales » aussi sur l'écran de connexion (`panels/login.rs`), vérification GitHub sans identifiant ni version (`update/manifest.rs`, agent `ureq` sans en-tête maison) — tout concorde. Seule imprécision, sans enjeu : le plafond de 16 Mio/jour du journal n'est pas cité. **Point restant** : le point 1.4 ne cite pas les extractions de pacte — à vérifier dans le dépôt de l'overlay si celui-ci les envoie (`POST /history/pacts`) | C2, C3, C4, C6, C10, C11 |
| ~~P1~~          | ✅ **Tiers rencontrés en combat / échange** (option A du 2026-09-18, noms conservés en clair) : la politique dit désormais que les combats partent avec le nom de chaque participant et les échanges avec celui du partenaire (1.4), la durée (« tant que le compte existe », §5) et l'adresse d'opposition (§6) y étaient déjà. ✅ Base _intérêt légitime_ (art. 6.1.f) et mise en balance énoncées en section 1.3, avec l'adresse de retrait d'un pseudonyme (`50adcf8`, 2026-09-18). ✅ Note interne de mise en balance rédigée le 2026-09-19 (document du responsable de traitement, hors dépôt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | C3                       |
| ~~P1~~          | ✅ **CGU du site** réécrites (`a9587a9`, 2026-09-18) : l'overlay entre dans l'objet, la section 2 décrit ses deux fonctions optionnelles (frappe simulée, lecture de fenêtre) et reformule la position vis-à-vis des CGU d'Ankama en cohérence avec [`analyse-cgu.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-cgu-2026-09-21.md) de l'overlay. Mentions légales complétées au passage (`8e3fdd8`) : éléments du jeu embarqués dans le binaire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | C2                       |
| ~~P2~~ → ~~P3~~ | ✅ **Jeton natif** : vérifié dans le code le 2026-09-18 — même durée que le cookie web, 30 jours glissants (`server/auth/pairing.ts:70` crée la session avec `SESSION_TTL_MS`, et `flow.ts::resolveSession` prolonge le porteur `Bearer` exactement comme le cookie). Dit dans la politique depuis le 2026-09-19 (`acf4a20` sur `claude/dev`, quatre langues) : la section 5 attribue désormais les « 30 jours glissants, prolongés à chaque utilisation » au cookie du site ET au jeton de l'overlay, et la section 1.4 renvoie au point 5 pour la durée du jeton                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | C5                       |
| ~~P3~~          | ✅ **Fusion côté serveur** (`c2f3fdb` sur `claude/dev`, 2026-09-19) : une entrée de `PATCH /api/v1/settings` peut porter `patch` à la place de `value` pour `profile` (fusion superficielle champ par champ) et `roster` (`{ accounts: [{ id, …champs }], removedIds }`, fusion par `id`, champs inconnus préservés — voir `server/settings/patch.ts` et `server/README.md`, lot 6). Compare-and-set sur l'horodatage lu, course perdue renvoyée en rejet. Le site web n'envoie plus que l'écart avec la version connue du compte (`RemoteUserDataRepository.acked`). ✅ **Côté overlay aussi** (2026-09-19) : `profile_patch_entry` envoie `patch: { soundItems, alertDurationSeconds, alertManualClose }` et le roster part en correctif (comptes modifiés ou créés + `removedIds`, `Roster::patch_against`) ; `extra` (`flatten`) et `profile_raw` retirés. **Conséquence pour la fusion** : un overlay livré avec ce changement contre une prod sans `c2f3fdb` reçoit 400 « valeur manquante » à chaque validation d'alertes ou de personnages — la fusion `claude/dev` → `main` précède la prochaine Release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | C9                       |
| ~~P2~~          | ✅ **Sessions mortes effacées** (`433960a` sur `claude/dev`, 2026-09-19, limitation de la conservation art. 5.1.e) : une ligne de `sessions` expirée ou révoquée restait en base pour toujours (`user_id`, `user_agent`, horodatages) alors qu'elle n'ouvrait plus rien et n'était plus listée. `AuthStore.purgeDeadSessions` l'efface **30 jours après sa fin** (`DEAD_SESSION_RETENTION_MS`, `server/auth/flow.ts`), sans cron : à la connexion OAuth, à l'appairage et à la rotation natifs, sur `GET`/`DELETE /api/v1/auth/sessions`, sur `DELETE /api/v1/auth/native/session` et au rafraîchissement quotidien de l'expiration glissante (seul déclencheur pour un compte dont seul l'overlay tourne). Politique §5 mise à jour (quatre langues). Même constat que 4.5 ci-dessus, trouvé indépendamment en relisant `server/auth/db-store.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | §7 (sessions)            |
| ~~P3~~          | ✅ **Rotation du jeton natif, côté serveur** (`433960a`, 2026-09-19) : `POST /api/v1/auth/native/session` (porteur `Bearer`, corps vide) répond `{ token, issuedAt, expiresAt, previousTokenValidUntil }` — jeton neuf de 30 jours glissants pour le même compte et le même appareil ; l'ancienne session est **remplacée** (`sessions.superseded_at`, migration `0029`) et son expiration ramenée à **5 min** : encore acceptée le temps que l'overlay persiste le nouveau jeton et que ses requêtes en vol aboutissent (un 401 côté overlay vaut « jeton refusé », donc déconnexion et purge — à ne jamais provoquer pour une course), plus jamais prolongée, plus listée dans « Mon compte », emportée par « déconnecter tous mes appareils ». Une rotation depuis un jeton déjà remplacé mais en grâce est admise (plantage entre la réponse et l'écriture au trousseau). Politique §1.4 : « l'overlay peut le renouveler de lui-même ». ✅ **Côté overlay aussi** (2026-09-19, `background::rotate_token_if_due`) : appelée au démarrage quand le jeton a plus de 7 jours (ou date inconnue), avant l'activation de la file d'envoi ; nouveau jeton au trousseau avant bascule ; un échec conserve l'ancien jeton, jamais une déconnexion. Contre une prod sans `433960a`, la route répond 404/405 et l'overlay garde simplement son jeton                                                                                                                                                                                                                                                             | C5                       |

### 8.1 Hors périmètre de l'analyse overlay, listé pour ne pas l'oublier

État vérifié dans le code et la politique du site le 2026-09-19 :

- ✅ **Suppression de compte** : `DELETE /api/v1/auth/account`, suppression réelle en cascade
  (identités, sessions, configuration, historique).
- ✅ **Sessions actives et révocation** : `GET`/`DELETE /api/v1/auth/sessions`, page « Mon compte » ;
  sessions mortes effacées 30 jours après leur fin (voir le tableau) ; rotation du jeton natif
  côté serveur et appelée par l'overlay (2026-09-19).
- ✅ **Sous-traitants** nommés (mentions légales §2, politique §4) : Cloudflare, Inc. (hébergement),
  Databricks, Inc. / Neon (PostgreSQL, serveurs au Royaume-Uni, décision d'adéquation), Discord et Google (connexion), GitHub
  (mises à jour de l'overlay).
- ✅ **Mentions légales** publiées, étendues à l'overlay (`8e3fdd8`).
- ✅ **Durée de conservation de l'historique** : décision du responsable du 2026-09-20 — un
  compte sans activité authentifiée pendant **12 mois** est effacé en cascade
  (`server/auth/flow.ts::purgeInactiveAccounts`, `users.last_seen_at` tenu à jour par la connexion
  OAuth et le rafraîchissement quotidien des sessions web/overlay ; migration `0030` remettant tous
  les comptes existants à `now()` pour que le délai coure à partir de la mise en production de la
  règle). Politique §5 mise à jour dans les 4 langues. Pas de courriel d'avertissement : le service
  n'envoie aucun courriel — en ajouter un supposerait un prestataire d'envoi (nouveau
  sous-traitant), choix écarté et consigné au registre §7.
- ✅ **Registre des traitements (art. 30)** et note de mise en balance (C3) : rédigés le
  2026-09-19, documents internes du mainteneur conservés hors dépôt (voir
  [`analyse-rgpd-mainteneur.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-rgpd-mainteneur.md)).

---

## 9. Audit de suivi du 2026-09-21 (v1.146.1, commit `a12aae3`)

Périmètre : les seuls fichiers suivis par git (628, `git ls-files` ; `repository/`, `.dev.vars` et
dossiers privés exclus). Tous les écarts 4.1–4.11 ont été re-vérifiés dans le code courant : ils
restent résolus (`node tools/check-fixtures.mjs` → « pseudonymisées », purges de conservation,
export, hachage d'IP, CSP, cloisonnement par `user_id`). L'audit a porté sur ce qui a changé depuis
le 20 septembre : jeton d'application + Turnstile (`2410cc1`, `254d527`), relais d'icônes du site,
réécriture d'historique. Aucun écart critique ni majeur. **Bilan au soir du 2026-09-21** : les sept points sont traités — 1, 3, 4, 6, 7 corrigés dans le dépôt, 5 supprimé (canal retiré), 2 vérifié sans donnée de tiers. Hors dépôt restent : le registre (portée « tout visiteur » du comptage IP), l'effacement du `wakfu.log` reçu le 16/09, et le `DELETE` facultatif du compte de test sur la branche `Dev`.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | État                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟡      | Le comptage anti-abus par empreinte d'IP (`auth_rate_limits`) s'applique désormais aussi en **mode invité** : `POST /api/v1/app/token` (bucket `app:token:ip:…`, ~1×/12 h par navigateur). La politique §1/§1.2 le restreint aux tentatives de connexion (art. 13). C'est une mesure de sécurité légitime (anti-extraction du référentiel par des automates, intérêt légitime 6.1.f) : seul le **texte** est en retard sur le code. La politique dit aussi « adresse IP enregistrée » alors que seul un HMAC tronqué l'est (surdéclaration, sans conséquence). | ✅ Corrigé le 2026-09-21 : §1 (« concerne tout visiteur », empreinte pseudonymisée) et §1.2 (pages de connexion + émission du jeton d'application, condensé à clé secrète non réversible) dans les 4 locales. Reste : registre (hors dépôt).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | 🟡      | Base de preview : `server/README.md` prescrit une _child branch_ Neon pour `DATABASE_URL_PREVIEW`. Une branche enfant créée depuis `production` **copie ses données** au moment de la création — copie de données réelles dans un environnement de test public, hors portée de l'effacement (une suppression de compte en prod ne s'y propage pas), non déclarée (art. 5.1.b/c, 17, 32). Non vérifiable depuis le dépôt.                                                                                                                                       | ✅ **Vérifié le 2026-09-21** dans la console Neon (captures du mainteneur) : branche `Dev`, parent `production`, créée le 2026-08-10 15:40:03, avec données (bouton _Reset from parent_ présent, jamais utilisé selon le mainteneur). Contenu : **1 compte** (648 combats) contre 16 en production — le même UUID `e7ca6cfe-…` et le même `created_at` à la microseconde (`2026-08-10 22:25:30.637502`) que le plus ancien compte de prod, donc une copie et non une recréation ; c'est le **compte de test du mainteneur**, et personne d'autre n'a jamais accédé à cet environnement. **Aucune donnée d'un tiers** en preview (hors pseudonymes d'alliés de ses propres combats, déjà traités sous son compte). Risque résiduel structurel : un _Reset from parent_ recopierait les 16 comptes — interdit désormais dans `server/README.md` (branche _schema-only_, ou `TRUNCATE` immédiat après tout branchement). **Suite le 2026-09-21 (soir)** : le mainteneur a créé une branche Neon `preview` **schema-only** ; son contenu a été reconstitué depuis `Dev` par un script de copie (référentiel intégral, compte de test, historique) en **pseudonymisant tout nom de joueur hors roster** (61 joueurs → `Anonyme-Joueur<N>`, participants, partenaires d'échange et clés de réattribution compris ; contrôle final : 0 nom hors roster restant), journal `drizzle.__drizzle_migrations` recopié pour que `db:migrate` reste idempotent. Il reste à pointer `DATABASE_URL_PREVIEW` (secret GitHub) sur cette branche et à supprimer `Dev`. |
| 3   | ⚪      | Politique §2 périmée sur `static.ankama.com` (« portraits de monstres, images de recours ») : depuis le 20 septembre seules les galeries d'avatars de la page profil y sont chargées, avec `referrerpolicy="no-referrer"`.                                                                                                                                                                                                                                                                                                                                     | ✅ Corrigé le 2026-09-21 (4 locales).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | ⚪      | Inventaire des cookies éclaté entre §1.2 (« trois ») et §2 (`wc_app`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ Corrigé le 2026-09-21 : nouveau point 2.1 « Cookies » listant les quatre, §1.2 y renvoie (4 locales).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | ⚪      | Flux de support manuel (`server/import/replay-user-history.ts`) : un utilisateur peut envoyer son `wakfu.log` au mainteneur pour un rejeu d'historique. Le fichier contient des messages de tiers, des identifiants de compte, un jeton de session. Ni la politique ni (à confirmer) le registre ne décrivent ce traitement (finalité, conservation du fichier reçu, effacement).                                                                                                                                                                              | ✅ Décision du mainteneur le 2026-09-21 : **script supprimé** (`git rm`, scripts npm `main:replay:user-history`/`dev:replay:user-history` retirés, références de `ingest.ts`, `server/README.md` et `.claude/rules/log-ingestion.md` réécrites). Le canal n'existe plus, rien à déclarer. Reliquat hors dépôt : le fichier `wakfu.log` reçu lors du seul usage réel (16/09) est à effacer du poste du mainteneur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | ⚪      | Turnstile chargé au démarrage pour tout visiteur, y compris sur les pages légales. **Sans objet côté code** : `App.ngOnInit` lance `catalog.initialize()` sur toutes les routes, dont `GET /catalog/version`, route référentiel qui exige `wc_app` — différer `ensure()` ne ferait que déplacer le chargement du script d'une centaine de millisecondes. Défendable en « strictement nécessaire » (sécurité, hébergeur sous DPA).                                                                                                                              | Constat consigné ; à réévaluer seulement si le catalogue cesse d'être chargé sur les pages légales. **Constaté en Chrome réel** (preview, `/fr/privacy`, 2026-09-21) : `challenges.cloudflare.com` ne pose **aucun cookie** ; une seule entrée `localStorage` (`cf.turnstile.u`, jeton opaque horodaté) dans l'origine de son iframe. Politique §2 précisée en conséquence (« sans cookie », stockage local propre) dans les 4 locales.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | ⚪      | Colonne `users.default_game_server` jamais lue ni écrite (repli abandonné au lot 7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ Retirée le 2026-09-21 (migration `0031_drop_users_default_game_server`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 9.1 Seconde passe du 2026-09-21 (soir) — promesses des textes sans moyen d'exécution

Revue conduite indépendamment de la précédente, sur la même version, en partant cette fois des
**promesses faites par les textes légaux** plutôt que du code modifié depuis le 20 septembre :
pour chaque droit annoncé dans la politique, existe-t-il de quoi l'honorer ? Complétée par une
relecture des chemins de données (cascades `ON DELETE`, cloisonnement par `user_id`, portée de
l'export, en-têtes et cookies, origines externes, journalisation serveur, stockage local).

Les six points du tableau §9 restent valables ; rien ici ne les recoupe, sauf le point 2 (branche
Neon de preview), déjà traité le même jour par le mainteneur.

| #   | Gravité | Constat | État |
| --- | ------- | ------- | ---- |
| 8   | 🟠 | **Le retrait d'un pseudonyme de tiers, promis au §1.3, n'avait aucun moyen d'exécution** (art. 21, 17.1.c, 12.3). C'est la promesse qui rend tenable la mise en balance du §1.3 — et le seul endroit du dossier où un texte engage une action qu'aucun code ne savait faire. Un pseudonyme de tiers vit à quatre endroits, dont un `jsonb` opaque : `fight_participants.name`, `trades.peer_name`, et les clés `chatFilters` / `damageReassignments` de `user_settings`. Servir une demande aurait supposé du SQL écrit à la main sur la production, sans inventaire ni trace, dans le délai d'un mois. | ✅ Corrigé le 2026-09-21 : `server/import/erase-third-party-name.ts` (dry-run, `--apply`) — inventaire par compte, **renommage** et non suppression dans l'historique (la ligne porte les dégâts du combat, qui appartiennent au titulaire ; « Joueur retiré » rend le tiers non identifiable sans fausser ses totaux, collision de clé primaire `(fight_id, side, name, instance_index)` gérée ligne à ligne), retrait des entrées de configuration qui le nomment, et signalement à part de ce qui désigne le **titulaire** (`trades.self_name`, `users.display_name`), qui relève de sa propre demande. Le nettoyage du `jsonb` est isolé dans `server/settings/redact-name.ts`, pur et testé (7 tests) : grain le plus fin, égalité exacte insensible à la casse (jamais un « contient », qui retirerait « Bobby » pour « Bob »), et remontée à l'opérateur de ce qu'il ne peut pas retirer seul. Reste : consigner chaque demande dans le registre (hors dépôt). |
| 9   | 🟡 | **Les durées de conservation du §5 n'étaient tenues que tant qu'il y avait du trafic** (art. 5.1.e). Cloudflare Pages n'ayant pas de Cron Trigger, *toutes* les purges sont opportunistes : `runRetentionPurges` sur les routes d'auth, `purgeExpiredAuthorizations` au callback, `purgeExpiredPairings` à l'appairage, `purgeRateLimits` à la première requête d'une fenêtre. Sans connexion — période creuse, ou service à l'arrêt, précisément quand les délais courent seuls — un compte inactif depuis plus de 12 mois survit jusqu'à ce que quelqu'un d'autre se connecte, et la dernière fenêtre de comptage anti-abus reste en base indéfiniment. | ✅ Corrigé le 2026-09-21 : `runFullPurge` (`server/auth/flow.ts`) réunit les cinq purges, y compris celles qu'aucune route ne déclencherait ; `server/import/run-retention-purges.ts` l'exécute hors requête ; `.github/workflows/rgpd-purges.yml` l'appelle chaque jour à 03:20 UTC sur la production. Les délais restent définis dans `flow.ts` et `rate-limit.ts` (`MAX_RATE_LIMIT_WINDOW_MS`, nouvelle constante) ; 4 tests. Mêmes limites que le workflow de révision annuelle : actif après fusion sur `main`, et désactivé par GitHub après 60 jours sans commit — un run manqué n'a aucune conséquence irréversible, la passe suivante rattrape. |
| 10  | ⚪ | **Rémanence locale après déconnexion** (art. 13.2.a) — prolongement du 4.9, qui ne traitait que la suppression de compte. `AuthService.logout()` repasse en invité et laisse intacte la copie locale des données rapatriées du compte (profil, roster, filtres de chat, corrections d'attribution — qui peuvent porter le pseudonyme d'autres joueurs). L'overlay, lui, efface les siennes à la déconnexion et le dit au §1.4 ; côté site, rien ne le disait, alors que le cas d'usage visé — le poste partagé — est le même. Le bouton « Supprimer les données de cet appareil » existe bien, et redevient visible dès la déconnexion. | ✅ Corrigé le 2026-09-21 : politique §5 complétée dans les 4 locales (la déconnexion n'efface pas, l'asymétrie est nommée, le bouton est indiqué). **Non retenu** : effacer d'office à la déconnexion — destruction surprise pour qui se déconnecte pour changer de compte, même raisonnement que la case décochée par défaut du 4.9. Proposer l'effacement dans le flux de déconnexion reste une amélioration possible. |
| 11  | ⚪ | **Le garde-fou anti-données-réelles ne couvrait que `tests/`** (art. 5.1.c, 5.1.f, 32). `tools/check-fixtures.mjs` ne scannait que les journaux de fixtures et l'export de référence — or les données réelles n'étaient pas arrivées que par là : trois fichiers de specs recopiaient noms et messages du journal (4.11), et rien n'empêchait que cela recommence par le même chemin. | ✅ Corrigé le 2026-09-21 : seconde passe sur `src/`, `server/`, `functions/`, `tools/` et le reste de `tests/` (434 fichiers) avec les quatre règles indépendantes du format — jeton de session, chemin `C:\Users\<nom>` (forme brute **et** forme échappée d'un littéral de code : la première version ratait `"C:\\Users\\…"`, cas le plus probable en TypeScript), IP privée, identifiant de compte Ankama. Pas de règle « auteur de chat » dans cette passe : une spec invente légitimement « Bob » ou « Alice », qu'aucun motif ne distingue d'un pseudonyme réel — ce garde-fou attrape ce qui a une forme, jamais tout. |
| 12  | 🟡 | **Le runtime Angular servi en production porte un avis de sécurité ouvert** (art. 32). `npm audit --omit=dev` : 7 vulnérabilités modérées, toutes dérivées de **GHSA-hh8m-fm6v-7cvg** — *sanitization bypass via directive host bindings*, `@angular/core` et `@angular/compiler` `21.0.0 → 21.2.19`. Le lockfile fige `21.2.19`, dernière version vulnérable ; le correctif existe depuis `21.2.20`, **dans la plage `^21.2.0` déjà déclarée**. L'application affichant du texte contrôlé par des tiers (chat de jeu, noms lus dans le journal), c'est exactement le scénario à éviter — le cookie de session `httpOnly` limite la casse sans rendre l'avis sans objet. | ✅ Corrigé le 2026-09-21 : `npx ng update @angular/core@21.2.23 @angular/cli@21.2.23` (les dix paquets `@angular/*` alignés sur `21.2.23`), puis `npm run install:ci` pour que le lockfile soit produit par la version npm de la CI (`npm@10.9.8`) — une première tentative d'`npm install` ciblé avait échoué en `ERESOLVE` sur l'arbre existant, dont les peers étaient stricts sur `21.2.19`. `npm audit --omit=dev` : **0 vulnérabilité**, contre 7 modérées avant. Les 10 restantes tous périmètres confondus sont des dépendances de **développement** (vitest, esbuild, nanoid, sharp), jamais servies aux utilisateurs — hors du traitement, à suivre pour elles-mêmes. Validé : 293 tests client, 184 serveur, les deux builds, les deux typechecks, prettier, et une **vérification du mode connecté en navigateur** (Chromium headless de l'environnement, API simulée en mode connecté : identité, fournisseur lié, appareils connectés avec leurs user-agents, synchronisation de la configuration, export RGPD téléchargé et contrôlé — `account` avec identité, identités OAuth, sessions, configuration et les quatre historiques —, déconnexion qui repasse en invité en laissant les 8 clés de `localStorage` en place, ce qui confirme le point 10 ; zéro erreur JS). Réserve : Chromium headless, pas le Chrome réel du mainteneur — l'API File System Access n'est pas testable ainsi. |
| 13  | ⚪ | **Deux points documentaires** : (a) l'**art. 14** impose en principe d'informer les personnes dont les données n'ont pas été collectées auprès d'elles — ici les joueurs tiers. L'exception d'effort disproportionné (art. 14.5.b) s'applique manifestement (aucun moyen de joindre un joueur à partir de son seul pseudonyme de jeu ; la politique publique tient lieu de mesure compensatoire), mais le raisonnement doit être **écrit**, comme l'a été l'absence d'AIPD. (b) `RATE_LIMIT_SALT` n'est jamais tourné et, à défaut, `clientIpKey` se replie sur `DATABASE_URL` : la pseudonymisation des IP tient tant que ce secret ne fuit pas. | ⏳ **Ouvert, hors dépôt** : note art. 14 d'une page à joindre à la note de mise en balance du §1.3 ; vérifier que `RATE_LIMIT_SALT` est posé sur les deux environnements et le tourner à l'occasion (effet de bord : compteurs remis à zéro sur la fenêtre en cours). |

**Vérifié sans écart** lors de cette passe : cascades `ON DELETE` complètes depuis `users` (identités,
sessions, configuration, quatre historiques et leurs lignes filles) ; cloisonnement par `user_id` de
toutes les routes d'historique et de `GET /history/stats` ; export couvrant les quatre historiques
(`HISTORY_ENDPOINTS`) en plus de l'identité, des sessions et de la configuration ; `cache-control:
no-store` sur toutes les réponses authentifiées ; aucune donnée personnelle journalisée par les Pages
Functions ; aucun traceur ni outil d'analytique ; aucune origine externe hors `static.ankama.com`
(galeries d'avatars) et `challenges.cloudflare.com` (Turnstile) ; service worker sans `dataGroups`,
donc aucune réponse d'API en cache ; CSRF exigé sur toutes les mutations ; quatre locales alignées sur
le même contenu.
