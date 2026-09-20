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

> **Mises à jour du 2026-09-19** (ce document est tenu à jour au fil des correctifs ; l'état de
> chaque écart est indiqué dans son titre) :
>
> - 4.3 (hébergeur du front non déclaré) **résolu** : GitHub Pages décommissionné, domaine canonique
>   `https://wakfu-companion.com`.
> - 4.5 (sessions jamais purgées) **résolu** par `433960a` (`purgeDeadSessions`, 30 jours après la
>   fin de session), politique §5 à jour.
> - 4.2 (export) : le volet **documentaire** est résolu par `168cd01` — la politique ne promet plus
>   que ce que le bouton fait réellement, le reste est fourni sur demande écrite sous un mois
>   (art. 12.3). L'endpoint d'export serveur reste souhaitable, plus obligatoire.
> - 4.4 (IP en clair) : le volet **déclaration** est résolu par `1651a41` (points 1, 1.2, 1.3 et 5) ;
>   le volet **minimisation** (hachage) par `efc004c` — résolu (voir 4.4).
> - 4.6 : les extractions de pacte sont désormais citées (`1651a41`) ; les deux autres omissions
>   restent ouvertes.
> - Le reliquat issu de l'analyse menée depuis l'overlay (`analyse-rgpd-site.md`, fusionné ici le
>   2026-09-19) est repris en **section 8**.

| Gravité                  | Nombre | Nature                                                                                                                                                                   |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔴 Critique              | 0      | — (fuite d'historique entre comptes, 4.1, résolue le 2026-09-19)                                                                                                         |
| 🟠 Majeur                | 0      | — (export 4.2 rétrogradé en amélioration, hébergeur 4.3 résolu)                                                                                                          |
| 🟡 Modéré                | 0      | — (IP en clair 4.4, omissions de la politique 4.6, point de collecte 4.7, en-têtes 4.8 — CSP bloquante depuis le 2026-09-20 —, rémanence locale 4.9 : tous résolus le 2026-09-19) |
| ⚪ Mineur / documentaire | 3      | DPA, procédure de violation, note d'absence d'AIPD (le registre art. 30 et la note de mise en balance sont rédigés, l'adresse de contact est confirmée — voir 4.10)      |

Aucun écart ne relevait d'une collecte abusive ou dissimulée : tous étaient soit des **omissions
d'information**, soit des **défauts de minimisation ou de rétention**, soit — pour le point
critique — un **bug de cloisonnement** dans la file de synchronisation. **Au 2026-09-19 (soir),
tous les écarts de code sont résolus** ; restent trois documents internes à rédiger (4.10), le
passage de la CSP en mode bloquant après validation sur la preview, et la mise en production.

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

| Table                                        | Données                                                                              | Base légale déclarée                                      | Durée réelle en base                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| `users`                                      | e-mail vérifié, nom affiché, serveur de jeu par défaut, `created_at`, `last_seen_at` | Contrat (art. 6.1.b)                                      | Vie du compte                              |
| `user_identities`                            | fournisseur, `provider_uid`, e-mail, `linked_at`                                     | Contrat                                                   | Vie du compte                              |
| `sessions`                                   | SHA-256 du jeton, `user_agent`, dates d'émission/usage/expiration/révocation         | Intérêt légitime (art. 6.1.f)                             | 30 j après expiration/révocation ✅ (§4.5) |
| `oauth_authorizations`                       | `state`, `code_verifier` PKCE, `redirect_to`                                         | Contrat / sécurité                                        | Purgée à chaque callback ✅                |
| `native_pairings`                            | `device_code`, `user_code`, jeton de session en transit                              | Contrat                                                   | Purgée à l'expiration ✅                   |
| `auth_rate_limits`                           | HMAC tronqué de l'adresse IP dans `bucket` (§4.4), fenêtre, compteur                 | Intérêt légitime                                          | Purge opportuniste (§4.4)                  |
| `user_settings`                              | 11 clés de configuration en `jsonb`                                                  | Contrat                                                   | Vie du compte                              |
| `fights`, `fight_participants`, `fight_loot` | combats, **noms des alliés (joueurs tiers)**, classe, dégâts, soins, sorts, butin    | Contrat (6.1.b) + intérêt légitime (6.1.f) pour les tiers | Vie du compte                              |
| `purchases`, `trades`, `trade_items`         | achats, échanges, **nom du partenaire d'échange**                                    | Idem                                                      | Vie du compte                              |
| `pact_extractions`, `pact_extraction_items`  | extractions de pacte                                                                 | Contrat                                                   | Vie du compte                              |

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

### 🟠 4.2 — L'export « RGPD » ne contient pas les données du compte — **volet documentaire résolu le 2026-09-19**

**Articles concernés** : 15 (droit d'accès), 20 (portabilité), 12 (transparence).

> **Résolution partielle (`168cd01`).** Le point 6 de la politique (4 locales) ne présente plus le
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
   catégorie. Reste à vérifier, dans le dépôt de l'overlay, si le point 1.4 (ce que l'overlay
   envoie) doit aussi les citer.
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
`isInitialLoad`.

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
> (`default-src 'self'`, images autorisées depuis `vertylo.github.io` et `static.ankama.com`,
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

| Obligation                                 | État           | Commentaire                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registre des traitements** (art. 30)     | ✅ Rédigé      | Rédigé le 2026-09-19 avec la note de mise en balance des intérêts (pseudonymes de tiers, point 1.3) — documents internes du responsable de traitement, conservés **hors dépôt** (voir §8). L'ébauche du §6 en reste la base.                                                                                                                         |
| **Contrats de sous-traitance** (art. 28.3) | Non documentés | Les DPA de Cloudflare, Neon/Databricks et GitHub existent et sont acceptés par défaut à l'usage ; il faut les archiver et les référencer.                                                                                                                                                                                                            |
| **Procédure de violation** (art. 33/34)    | Absente        | Notification à la CNIL sous 72 h. Pour un projet d'une personne, une demi-page suffit (détection, périmètre, notification, information des personnes).                                                                                                                                                                                               |
| **AIPD / DPIA** (art. 35)                  | Absente        | Vraisemblablement non requise : pas de données sensibles (art. 9), pas de profilage à grande échelle, pas de décision automatisée. Consigner ce raisonnement par écrit est la bonne pratique.                                                                                                                                                        |
| **Vérification de l'âge**                  | Absente        | Les CGU annoncent l'accord parental en deçà de 15 ans, sans aucun mécanisme. Acceptable en pratique pour ce type de service ; à assumer explicitement.                                                                                                                                                                                               |
| **Adresse de contact**                     | ✅ Confirmée   | `contact@wakfu-companion.com` est l'unique voie d'exercice des droits, y compris pour le **retrait d'un pseudonyme de tiers** promis au point 1.3. Depuis la bascule du 2026-09-19 (cf. 4.3), l'adresse est bien sur le domaine de production — boîte **confirmée relevée par le mainteneur** le 2026-09-19 (art. 12.2/12.3 : réponse sous un mois). |

---

## 5. Plan d'action proposé

Classé par rapport gain de conformité / coût de mise en œuvre.

### Priorité 1 — à traiter en premier

| #     | Action                                                                                                                                                             | Écart | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| ~~1~~ | ~~Vérifier que `contact@wakfu-companion.com` est réellement relevée~~ — **confirmé** par le mainteneur le 2026-09-19                                               | 4.10  | —      |
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

| #      | Action                                                                                                                                                   | Écart | Effort |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| ~~10~~ | ~~Rédiger le registre des traitements (art. 30)~~ — **fait** le 2026-09-19, hors dépôt (§8)                                                              | 4.10  | —      |
| 11     | Archiver les DPA des trois sous-traitants                                                                                                                | 4.10  | Minime |
| 12     | Écrire la procédure de violation de données                                                                                                              | 4.10  | Faible |
| 13     | Consigner l'analyse d'absence d'AIPD                                                                                                                     | 4.10  | Minime |
| ~~14~~ | ~~Proposer l'effacement local à la suppression de compte, comme le fait l'overlay~~ — **fait** le 2026-09-19 (+ bouton invité, politique §5/§6 corrigée) | 4.9   | —      |
| 15     | Inscrire dans `CLAUDE.md` la règle « nouvelle table `users` ou nouvelle clé synchronisée ⇒ relecture des textes légaux »                                 | 4.6   | Minime |
| ~~16~~ | ~~Auditer le dépôt `wakfu-companion-overlay` pour confirmer les affirmations du point 1.4~~ — **fait** le 2026-09-18 (§8)                                | —     | —      |
| 17     | Ajouter `GET /api/v1/auth/export` (identité, sessions, historique) et y brancher le bouton « Exporter » en mode connecté                                 | 4.2   | Moyen  |
| 18     | Décider et consigner : purge (ou non) de l'historique après N mois d'inactivité (§8)                                                                     | —     | Minime |
| ~~19~~ | ~~Passer la CSP de `Report-Only` en mode bloquant après validation du retour OAuth~~ — **fait le 2026-09-20** (validé en local, Chrome réel, OAuth Discord) | 4.8   | Minime |

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
- **Catégories de données** : condensé HMAC de l'adresse IP (cf. 4.4), user-agent, dates de session.
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
| ~~P1~~          | ✅ **CGU du site** réécrites (`a9587a9`, 2026-09-18) : l'overlay entre dans l'objet, la section 2 décrit ses deux fonctions optionnelles (frappe simulée, lecture de fenêtre) et reformule la position vis-à-vis des CGU d'Ankama en cohérence avec [`analyse-cgu.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-cgu.md) de l'overlay. Mentions légales complétées au passage (`8e3fdd8`) : éléments du jeu embarqués dans le binaire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | C2                       |
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
  Databricks, Inc. / Neon (PostgreSQL, serveurs dans l'UE), Discord et Google (connexion), GitHub
  (mises à jour de l'overlay).
- ✅ **Mentions légales** publiées, étendues à l'overlay (`8e3fdd8`).
- ⚠ **Durée de conservation de l'historique** : la politique annonce « tant que le compte
  existe, aucune suppression automatique après inactivité ». Conforme si c'est assumé ; une purge
  après N mois d'inactivité serait une décision du responsable de traitement, pas un correctif
  (plan d'action #18).
- ✅ **Registre des traitements (art. 30)** et note de mise en balance (C3) : rédigés le
  2026-09-19, documents internes du mainteneur conservés hors dépôt (voir
  [`analyse-rgpd-mainteneur.md`](https://github.com/Oumbra/wakfu-companion-overlay/blob/dev/docs/analyse-rgpd-mainteneur.md)).
