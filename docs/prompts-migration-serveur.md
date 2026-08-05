# Migration serveur — plan d'exécution en prompts

Suite opérationnelle de [`plan-migration-serveur.md`](./plan-migration-serveur.md).
Chaque section ci-dessous est un prompt autonome, à coller tel quel dans une
session Claude Code, **dans l'ordre**. Un prompt = un lot = un commit (ou une
petite série de commits cohérents).

Les blocs entre ``` sont à copier ; le texte autour est destiné à toi, pas à
l'agent.

---

## Préambule commun

À coller **en tête de chaque prompt** (ou une seule fois en début de session si
tu enchaînes plusieurs lots) :

```
Contexte permanent pour toute cette série de tâches :
- Lis d'abord CLAUDE.md et docs/plan-migration-serveur.md, qui font autorité
  sur l'architecture cible et les contraintes du projet.
- Travaille sur la branche claude/dev, commits en Conventional Commits, sujet
  < 50 caractères, sans attribution IA.
- Toute modification à effet visuel ou comportemental doit être vérifiée dans un
  vrai navigateur (voir la section Playwright de CLAUDE.md), pas seulement
  relue.
- Toute nouvelle chaîne visible passe par I18nService et doit être ajoutée dans
  les 4 locales (fr/en/es/pt) de core/i18n/translations.ts.
- Le mode invité (sans connexion) doit rester pleinement fonctionnel à tout
  moment : aucune fonctionnalité de base ne devient réservée aux comptes, et
  toutes les données restent en localStorage tant que l'utilisateur ne se
  connecte pas — exactement comme aujourd'hui.
- Ne touche à aucun fichier sous prompts/.
- Si tu découvres qu'une hypothèse du plan est fausse, dis-le et propose une
  correction avant d'implémenter — ne contourne pas silencieusement.
```

---

# Lot 0 — Fondations (aucun serveur)

## Prompt 0.1 — Fiabiliser la CI

**Objectif** : builds reproductibles et tests exécutés avant tout déploiement.
**Prérequis** : aucun. **Risque** : nul.

```
Le dépôt n'a aujourd'hui aucun workflow qui exécute les tests, alors que Vitest
est configuré et que 4 fichiers *.spec existent (dont
stats-store.service.spec.ts, 570 lignes). Par ailleurs package-lock.json est
dans .gitignore, ce qui force `npm install` au lieu de `npm ci` : les builds ne
sont pas reproductibles et une mise à jour transitive peut casser un
déploiement sans aucun changement de code.

Tâches :
1. Retire /package-lock.json du .gitignore, génère-le et committe-le.
2. Crée .github/workflows/ci.yml qui, sur push vers master et claude/dev et sur
   pull_request : installe avec `npm ci` (cache npm activé), lance
   `npx prettier --check "src/**/*.{ts,html,css}"`, `npm test -- --run`, puis
   `npm run build`.
3. Dans les deux workflows de déploiement existants, remplace `npm install` par
   `npm ci`.

Vérifie que `npm ci && npm test -- --run && npm run build` passe localement
avant de committer. Si des tests échouent déjà sur master, ne les corrige pas
en silence : signale-le et demande.
```

**Acceptation** : `ci.yml` vert sur `claude/dev`, `package-lock.json` versionné.

---

## Prompt 0.2 — Alléger le bundle sans rien casser

**Objectif** : −885 Ko, sans serveur, sans changement d'architecture.
**Prérequis** : 0.1. **Risque** : faible.

```
Objectif : réduire le bundle initial (aujourd'hui 5,35 Mo, budget Angular
dépassé de 1,35 Mo) par deux changements indépendants du reste de la migration.

1. Champ `pictureUrl` (~837 Ko, 15,7 % du bundle)
   Le référentiel objets stocke l'URL complète de l'image pour chacun des
   11 849 objets, alors qu'elle est reconstructible depuis `gfxId` :
   https://static.ankama.com/wakfu/portal/game/item/42/{gfxId}.w40h40.png
   - Supprime `pictureUrl` du fichier généré par
     tools/generate-wakfu-items-data.mjs (garde `wakfuAvailable`).
   - Reconstruis l'URL à l'affichage dans
     shared/item-icon/item-icon.component.ts, en conservant EXACTEMENT la
     chaîne de repli actuelle (wakassets → ankama → wakfuli) et l'attribut
     referrerpolicy="no-referrer" (protection anti-hotlink, voir CLAUDE.md).
   - Vérifie que le format d'URL est bien uniforme sur tout le référentiel
     avant de généraliser : si des objets dérogent au motif, garde une
     exception explicite pour eux plutôt que de casser leur image.

2. i18n (~48 Ko)
   core/i18n/translations.ts embarque les 4 locales alors qu'une seule sert.
   Passe à un import dynamique de la seule locale active dans I18nService, en
   gardant le français en repli synchrone (évite un écran vide au démarrage).

Vérifie dans le navigateur que les icônes d'objets s'affichent toujours
(plusieurs raretés, un objet avec recette, un objet absent de wakassets) et que
le changement de langue fonctionne toujours dans les 4 locales. Donne la taille
du bundle avant/après dans ton compte rendu.
```

**Acceptation** : bundle ≈ 4,45 Mo, icônes et langues inchangées à l'écran.

---

# Lot 1 — Retrait du standalone

## Prompt 1.1 — Supprimer la cible standalone

**Objectif** : lever la contrainte d'architecture n°1 et débloquer le
lazy-loading. **Prérequis** : 0.2. **Risque** : faible mais irréversible en
pratique — c'est la décision structurante.

```
Décision actée (voir docs/plan-migration-serveur.md, cadre §1) : le mode
standalone `file://` est retiré. L'application devient une application web
servie uniquement.

Tâches :
1. Supprime tools/build-standalone.mjs, la configuration `standalone` de
   angular.json, et les scripts npm build:standalone / build:standalone:compile.
2. Mets à jour CLAUDE.md et README.md : le « Principe d'architecture n°1 »
   disparaît, ainsi que les gotchas devenus caducs (contrainte du chunk unique,
   outputHashing "media" lié à flag-icons, obligation du base64 pour les
   assets). Ne supprime PAS le principe n°2 (gating isInitialLoad), qui reste
   entièrement valable.
3. Une seule configuration de build reste, avec outputHashing: "all".
4. Retire le build standalone de tous les workflows GitHub Actions ; les
   workflows de déploiement publient désormais le contenu de
   dist/wakfu-companion/browser.

Ne fais rien d'autre dans ce commit : pas de routing, pas de migration
d'assets. Le but est que l'application reste strictement identique à l'écran,
avec une cible de build en moins.
```

**Acceptation** : `npm run build` OK, application identique, plus aucune
référence au standalone dans le dépôt.

---

## Prompt 1.2 — Sortir les assets binaires

**Objectif** : −578 Ko et fin du base64. **Prérequis** : 1.1.

```
Maintenant que la contrainte standalone est levée, sors du bundle les assets
embarqués en base64 (~578 Ko, 10,8 % du bundle) vers des fichiers servis.

À migrer, depuis src/app/core/data/ vers public/assets/ :
- countdown-alert-sound.data.ts (210 Ko) → assets/sounds/countdown.mp3
- alert-sound.data.ts (69 Ko)           → assets/sounds/alert.mp3
- chat-filter-alert-sound.data.ts (44 Ko) → assets/sounds/chat-filter.mp3
- class-icons.data.ts (122 Ko)          → assets/classes/{classe}-{sexe}.png
- class-breeds.data.ts (56 Ko)          → assets/avatars/{index}.png
- header-icons.data.ts (27 Ko)          → assets/ui/
- app-logo.data.ts (27 Ko)              → assets/ui/logo.png
- session-recap-icon / recipe-icon / rarity-icon (11 Ko) → assets/ui/

Écris un script de conversion jetable (dans le scratchpad, pas dans le dépôt)
qui décode les data URI vers les fichiers, plutôt que de le faire à la main.

Contraintes :
- Les sons ne doivent être chargés qu'au premier déclenchement d'alerte, pas au
  démarrage (AlertSoundService).
- Les images de classe/avatar sont aujourd'hui bindées via
  [style.background-image] ; garde ce mécanisme, change seulement la source.
- Attention au signal d'index nullable : avatarIndex peut légitimement valoir 0
  (voir CLAUDE.md), ne réintroduis pas de test truthy.
- Cache : les assets doivent être servis en immuable ; ajoute un hash au nom des
  fichiers ajoutés hors pipeline Angular (sons, sprite).

Vérifie dans le navigateur : les 3 sons se déclenchent (alerte butin, décompte
à zéro, filtre chat), les icônes de classe s'affichent dans le sélecteur, le
premier avatar de la liste (index 0) s'affiche, le logo du header est présent.
Donne la taille du bundle avant/après.
```

**Acceptation** : bundle ≈ 850 Ko, tous les sons et images fonctionnels.

---

## Prompt 1.3 — Sprite SVG, routing, PWA

**Objectif** : dernier palier d'allègement et bases modernes.
**Prérequis** : 1.2.

```
Trois chantiers rendus possibles par le retrait du standalone.

1. Sprite SVG
   Neuf composants contiennent des <svg> inline (icon, flag-icon, ko-icon,
   history-list-header, app-header, profile-page, recipe-quantity-modal...).
   Regroupe les icônes VOLUMINEUSES OU RÉPÉTÉES dans un sprite unique
   public/assets/icons.svg, référencé via <svg><use href="…#id"/></svg> à
   travers le composant shared/icon existant, qui devient le point d'entrée.
   IMPORTANT : n'utilise pas <img src="…svg">, qui casserait `currentColor` (les
   icônes suivent la couleur du texte au survol). Laisse inline les SVG petits
   et contextuels (ko-icon, drapeaux de flag-icon) : les sortir n'apporterait
   rien.

2. Routing et lazy-loading
   NavigationService gère aujourd'hui une pile de vues maison avec un slider CSS
   (le chunk unique imposé par le standalone interdisait le lazy-loading).
   Passe au Router Angular avec chargement différé par vue (main / profile /
   legal). ATTENTION : conserve l'animation directionnelle existante et la
   sémantique de pile décrite dans le commentaire de NavigationService — elle
   corrige un vrai bug d'enchaînement de navigations. Si le Router ne permet pas
   de la préserver proprement, garde NavigationService et fais du lazy-loading
   sans Router ; explique ton choix.

3. PWA
   Ajoute un manifest et un Service Worker (@angular/pwa) pour que
   l'application démarre hors-ligne après la première visite et soit
   installable. C'est ce qui remplace, imparfaitement, le fichier standalone.

Vérifie dans le navigateur : toutes les icônes s'affichent et réagissent au
survol comme avant, les transitions entre vues sont identiques (y compris le
cas main → profil → légal → retour → retour), l'application se recharge
hors-ligne après une première visite.
```

**Acceptation** : bundle initial ≈ 250–350 Ko, navigation et icônes
visuellement inchangées, application installable.

---

# Lot 2 — Squelette serveur

## Prompt 2.1 — Poser l'infrastructure

**Objectif** : serveur déployé, vide, avec base et CI/CD.
**Prérequis** : 1.3. **Risque** : faible (rien de visible côté utilisateur).

```
Pose l'infrastructure serveur décrite dans docs/plan-migration-serveur.md §4
et §9 : Cloudflare (front + API sur la MÊME origine, indispensable pour le
cookie de session) et PostgreSQL Neon.

Tâches :
1. Crée un dossier server/ : Worker (TypeScript), routage /api/v1/*, et service
   du front statique buildé sur /.
2. Base Neon + un outil de migrations versionnées (drizzle-kit ou
   node-pg-migrate). Première migration : la table game_servers du §6 du plan,
   remplie avec pandora / rubilax / ogrest.
   ⚠ Les locales attendues par serveur sont à confirmer : mets une valeur par
   défaut prudente et signale-le dans ton compte rendu, ne devine pas.
3. Endpoints : GET /api/v1/health (état + version) et GET /api/v1/game-servers
   (liste servie, jamais compilée en dur côté client).
4. Remplace les deux workflows de déploiement Pages par un workflow unique
   deploy.yml : master → environnement production, claude/dev → environnement
   preview, avec migrations jouées avant déploiement et une branche Neon
   DISTINCTE pour la preview (jamais la base de production).
5. Documente dans server/README.md les secrets nécessaires
   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DATABASE_URL) et la procédure
   de création de la base.

Ne migre aucune donnée applicative dans ce lot. Le front doit continuer à
fonctionner exactement comme avant, simplement servi depuis une nouvelle
origine.
```

**Acceptation** : `/api/v1/health` répond en production et en preview, front
servi à la même origine, migrations rejouables.

---

## Prompt 2.2 — Importer le catalogue côté serveur

**Objectif** : le référentiel vit en base, rafraîchi par cron.
**Prérequis** : 2.1.

```
Déplace le référentiel Ankama du bundle vers la base, et expose-le.

Tâches :
1. Migration : tables items, monsters, dungeons, item_recipes, avec les mêmes
   champs que les fichiers générés aujourd'hui par tools/generate-wakfu-*.mjs
   (id, gfxId, noms fr/en/es/pt, rareté, disponibilité des images, recettes,
   familles).
2. Script d'import serveur qui lit wakfu.cdn.ankama.com/gamedata/{version}/ et
   remplit ces tables, en réutilisant la logique de normalisation des scripts
   tools/ existants (normalizeWakfuName, exclusion de la rareté "old",
   gestion des 142 entrées sans id et des collisions — ne réinvente pas ces
   règles, elles encodent des cas réels).
3. Endpoints :
   - GET /api/v1/catalog/version → version gamedata + empreinte de l'index
   - GET /api/v1/catalog/index → index COMPACT pour le client : par objet
     {id, nom FR normalisé, nom FR affichable, gfxId, rareté, hasRecipe} et
     l'équivalent monstres. Vise < 400 Ko avant compression, sers-le en gzip.
   - GET /api/v1/items/{id} et /api/v1/monsters/{id} → détail complet
     (traductions, recette, images)
   - GET /api/v1/catalog/search?q=&locale=&kind= → recherche serveur
4. Cron Trigger quotidien : compare la version de gamedata/config.json à celle
   en base, ne réimporte que si elle a changé.

Ne touche pas encore au client : les fichiers *.data.ts restent en place, on
les retirera au lot 3. Fournis dans ton compte rendu la taille réelle de
l'index compact.
```

**Acceptation** : index servi < 400 Ko, détail et recherche corrects, cron
opérationnel.

---

# Lot 3 — Catalogue distant côté client

## Prompt 3.1 — Basculer le client sur le catalogue distant

**Objectif** : −4,25 Mo. **Prérequis** : 2.2. **Risque** : moyen — c'est le lot
où une erreur se voit immédiatement.

```
Bascule le client sur le catalogue servi par l'API, et supprime les
référentiels embarqués (4,25 Mo, 79,6 % du bundle).

Contrainte absolue : findWakfuItemEntry est dans le CHEMIN CHAUD du parsing
(StatsStoreService l'appelle à chaque ramassage d'objet). Il doit rester
SYNCHRONE. Ne le transforme pas en appel réseau.

Architecture attendue :
1. core/api/api-client.service.ts : fetch centralisé (base URL, timeout, retry,
   credentials: 'include', gestion du hors-ligne).
2. core/api/catalog.service.ts :
   - au démarrage, charge /catalog/index et le met en cache IndexedDB avec sa
     version ; aux lancements suivants, sert le cache immédiatement puis
     rafraîchit en arrière-plan si la version a changé ;
   - expose findWakfuItemEntry / findWakfuMonsterEntry en synchrone sur l'index
     en mémoire ;
   - expose le détail (recette, traductions, image) en asynchrone.
3. L'autocomplétion (WakfuSearchService, shared/wakfu-autocomplete) continue de
   chercher dans l'index LOCAL : elle doit rester instantanée, sans requête par
   frappe.
4. Démarrage : si l'index n'est ni en cache ni joignable, affiche un état
   explicite plutôt qu'une application qui semble fonctionner mais ne
   reconnaît plus aucun objet.
5. Supprime wakfu-items.data.ts / wakfu-monsters.data.ts / wakfu-dungeons.data.ts
   et les scripts tools/generate-* correspondants (l'import vit côté serveur
   depuis le lot 2), ainsi que le dossier referentiel/ s'il n'a plus d'usage.

Vérifie dans le navigateur : autocomplétion d'objet et de monstre (latence
perçue nulle), affichage d'une recette, icônes d'objets et de monstres,
comptage de butin sur des lignes de log simulées (voir la skill
verify-wakfu-companion), puis rechargement hors-ligne. Donne la taille du
bundle avant/après.
```

**Acceptation** : bundle ≈ 250–350 Ko, autocomplétion instantanée, parsing
inchangé, fonctionnement hors-ligne après première visite.

---

# Lot 4 — Serveur de jeu

## Prompt 4.1 — Modèle et sélecteur de serveur

**Objectif** : prérequis bloquant de toute la fonctionnalité prix.
**Prérequis** : 3.1 (mais totalement indépendant de l'authentification).

```
Le log Wakfu ne contient AUCUNE indication du serveur de jeu (vérifié sur
assets/logs/tests/fr/purchase_2.log). Sans cette dimension, les futures données
de prix sont inexploitables : il faut la déclarer. Voir
docs/plan-migration-serveur.md §8, section « Identification du serveur de jeu ».

Conception retenue — le serveur est porté par le COMPTE du roster, pas par
l'utilisateur : CharacterRosterService gère déjà des comptes (RosterAccount)
contenant des personnages, et StatsStoreService sait déjà reconnaître un
personnage du roster (roster.hasCharacter). Le serveur actif se déduit donc
automatiquement du personnage observé dans le log — factuel, et seule façon de
gérer un joueur multi-compte réparti sur plusieurs serveurs.

Tâches :
1. Ajoute `gameServer` à RosterAccount, avec migration des rosters existants
   (valeur non renseignée, pas de valeur inventée par défaut).
2. Page profil : sélecteur de serveur par compte, alimenté par
   GET /api/v1/game-servers (jamais une liste en dur côté client).
3. Préférence globale « serveur par défaut », utilisée tant qu'aucun personnage
   connu n'a été identifié dans la session.
4. Nouveau core/services/game-server.service.ts exposant un signal
   `activeServer` : serveur du compte du dernier personnage reconnu, sinon
   défaut global, sinon null.
5. Badge « serveur actif » permanent dans le header (avec tooltip indiquant
   d'où vient la déduction : personnage reconnu ou valeur par défaut). Respecte
   les conventions de tooltip de CLAUDE.md (.tooltip-below dans un header).
6. Si aucun serveur n'est renseigné nulle part, une invite discrète et non
   bloquante invite à le faire — sans interrompre l'usage actuel.

Ce lot ne doit RIEN envoyer au serveur : tout tient dans le localStorage
existant via PersistenceService. Les 4 locales doivent être mises à jour.

Vérifie dans le navigateur : sélection d'un serveur par compte, bascule
automatique du badge quand un personnage d'un autre compte joue (simule des
lignes de log), persistance après rechargement.
```

**Acceptation** : serveur actif correct dans tous les cas, badge visible,
aucune régression du roster existant.

---

# Lot 5 — Authentification Discord / Google

## Prompt 5.1 — OAuth côté serveur

**Objectif** : sessions sûres. **Prérequis** : 2.1.

```
Implémente l'authentification OAuth 2.0 Discord et Google côté serveur
(docs/plan-migration-serveur.md §7). Aucun mot de passe n'est géré en propre :
pas de password_hash, pas de réinitialisation, pas de vérification d'e-mail.

Migrations : tables users, user_identities, sessions telles que décrites au §6
du plan.

Routes :
- GET  /api/v1/auth/{provider}/start    → redirection, avec `state` (anti-CSRF)
                                          et PKCE
- GET  /api/v1/auth/{provider}/callback → échange du code CÔTÉ SERVEUR (le
                                          client_secret ne doit jamais atteindre
                                          le navigateur), création/liaison du
                                          compte, pose du cookie
- POST /api/v1/auth/logout              → révocation de la session courante
- GET  /api/v1/auth/me                  → utilisateur courant ou 401
- GET/DELETE /api/v1/auth/sessions      → lister / révoquer ses sessions

Exigences :
- Cookie de session OPAQUE (256 bits d'aléa), httpOnly + Secure + SameSite=Lax.
  Jamais de JWT en localStorage : l'application affiche du texte issu du chat de
  jeu, donc du contenu contrôlé par des tiers — une XSS suffirait à voler un
  jeton.
- Session stockée en base (révocation immédiate possible), rotation à la
  connexion, expiration glissante de 30 jours.
- Fusion de comptes : si l'e-mail vérifié existe déjà avec un autre
  fournisseur, rattache la nouvelle identité au compte existant (les deux
  fournisseurs vérifient l'adresse). Documente ce choix.
- Limitation de débit sur /auth/*, par IP et par compte.
- Route de suppression de compte avec effet réel (ON DELETE CASCADE), exigée
  par le RGPD.

Écris des tests sur : `state` invalide rejeté, code réutilisé rejeté, session
révoquée refusée, fusion sur e-mail identique.
```

**Acceptation** : connexion Discord et Google fonctionnelles, cookie conforme,
tests passants.

---

## Prompt 5.2 — Page de connexion côté client

**Objectif** : parcours utilisateur, sans jamais dégrader le mode invité.
**Prérequis** : 5.1.

```
Ajoute le parcours de connexion côté Angular.

Tâches :
1. core/auth/auth.service.ts : état de session en signal (invité / connecté /
   en cours), appel à /auth/me au démarrage, connexion, déconnexion.
2. features/auth/login-page : deux boutons (Discord, Google), gestion du retour
   OAuth, message d'erreur explicite en cas d'échec.
3. features/auth/account-page : identité, fournisseurs liés, sessions actives
   avec révocation, export des données, suppression du compte (avec
   confirmation via le composant confirm-delete existant).
4. Intercepteur HTTP : sur 401, bascule proprement en mode invité plutôt que de
   planter.
5. Migration à la première connexion : si des données locales existent, propose
   explicitement de les téléverser vers le compte
   (AppDataExportService.buildExport() fournit déjà exactement ce payload). Si
   le compte a DÉJÀ des données, demande laquelle des deux sources conserver —
   ne fusionne jamais en silence.

Contrainte impérative : PAS de garde de route bloquante. L'application doit
rester pleinement utilisable sans compte — c'est ce qui évite de perdre les
utilisateurs actuels lors de la bascule. La connexion est une option, pas une
étape obligatoire.

Les 4 locales doivent être mises à jour. Vérifie dans le navigateur : parcours
complet de connexion, déconnexion, mode invité intact, écran de migration des
données locales.
```

**Acceptation** : connexion et déconnexion fonctionnelles, application
inchangée pour un utilisateur non connecté.

---

# Lot 6 — Configuration utilisateur synchronisée

## Prompt 6.1 — `user_settings`

**Objectif** : ne plus perdre ses données en vidant son navigateur.
**Prérequis** : 5.2.

```
Synchronise la configuration utilisateur quand l'utilisateur est connecté.

Tâches :
1. Migration : table user_settings (user_id, key, value jsonb, updated_at),
   avec exactement les clés d'EXPORT_KEYS d'AppDataExportService : profile,
   watchlist, damageReassignments, roster, chatActiveChannels, chatFilters.
2. Endpoints GET et PUT /api/v1/settings (par clé et en lot).
3. core/data-access/user-data.repository.ts : une interface, deux
   implémentations — LocalUserDataRepository (localStorage, comportement
   actuel) et RemoteUserDataRepository (API). Les services existants
   (ProfileService, StatsStoreService, CharacterRosterService, ChatPanel)
   consomment l'interface. AUCUN `if (connecté)` dans les composants.
4. Conflit : dernier écrivain gagne par clé, en s'appuyant sur updated_at.
   Suffisant pour un usage mono-utilisateur multi-appareils.
5. Écriture décalée (debounce) pour ne pas émettre une requête à chaque
   incrément de compteur de suivi.

Piège à traiter : le mode connecté ne doit pas casser le gating isInitialLoad.
La watchlist et ses compteurs sont du SUIVI PERSISTANT (jamais réinitialisé,
jamais incrémenté pendant isInitialLoad) ; ne les traite pas comme de l'état
dérivé du fichier.

Vérifie : modification du profil sur un navigateur, retrouvée sur un autre après
connexion ; mode invité toujours en localStorage ; compteurs de suivi non
regonflés après reconnexion au fichier de log.
```

**Acceptation** : configuration synchronisée entre deux navigateurs, mode
invité intact, compteurs de suivi corrects après reconnexion.

---

# Lot 7 — Historiques serveur

## Prompt 7.1 — Combats, achats, échanges avec idempotence

**Objectif** : historique illimité, sans doublons.
**Prérequis** : 6.1. **Risque** : ÉLEVÉ — c'est le lot le plus piégeux.

```
Envoie les historiques au serveur quand l'utilisateur est connecté (combats,
achats, échanges). Aujourd'hui tout est en mémoire, plafonné à 30 combats
(MAX_FIGHT_HISTORY) et perdu au rechargement.

⚠ Le piège central — à traiter AVANT d'écrire le reste. Le principe
d'architecture n°2 rappelle que toute reconnexion relit le fichier depuis le
début et reconstruit l'historique. Sans précaution, chaque reconnexion
réenverrait TOUT l'historique et créerait des doublons persistants, qu'un
simple F5 ne réparerait pas.

Les identifiants actuels sont inutilisables comme clés : nextPurchaseId,
nextTradeId et Fight.id sont des compteurs de session, réinitialisés à chaque
reconstruction. La clé doit être dérivée du CONTENU :

  client_key = sha256(uid + type + horodatage_complet_ms + signature_contenu)

avec par exemple `item|quantité|coût` pour un achat, `fightId|participants
triés` pour un combat. Couplée à UNIQUE (user_id, client_key) et à un
INSERT ... ON CONFLICT DO NOTHING, l'ingestion devient idempotente.

Tâches :
1. Migrations : fights, fight_participants, purchases, trades, trade_items
   (schéma §6 du plan), avec les contraintes d'unicité.
2. Endpoints POST par lots + GET paginés pour l'affichage de l'historique.
3. core/sync/sync-queue.service.ts : file persistante (IndexedDB), envois par
   lots, rejeu après coupure réseau, jamais bloquante pour l'interface.
4. Purchases : joins le serveur de jeu résolu par GameServerService (lot 4) ;
   si aucun serveur n'est résolu, envoie quand même l'achat mais SANS serveur —
   il sera exclu des agrégats de prix, pas de l'historique personnel.
5. Ne transmets JAMAIS le contenu du chat.

Test obligatoire (dans stats-store.service.spec.ts) : rejouer deux fois le même
lot de lignes de log produit exactement le même nombre d'enregistrements côté
serveur. Un test qui ne couvre pas ce cas ne vaut rien ici.

Vérifie dans le navigateur : historique conservé après F5, reconnexion au
fichier de log ne créant aucun doublon, fonctionnement hors-ligne avec rejeu au
retour du réseau.
```

**Acceptation** : test de double rejeu vert, aucun doublon après reconnexion,
file d'attente qui survit à une coupure.

---

# Lot 8 — Prix

## Prompt 8.1 — Ingestion et agrégation

**Objectif** : transformer les achats individuels déjà collectés (lot 7) en
séries de prix par objet et par serveur — fiables (résistantes aux valeurs
aberrantes et aux abus) et bornées en volume (jamais des millions de lignes
brutes rendues telles quelles). C'est la donnée que consommera l'interface du
prompt 8.2 ; sans ce prompt, il n'y a rien à afficher.
**Prérequis** : 7.1, et lot 4 en production depuis assez longtemps pour que les
achats collectés portent un serveur.

```
Mets en place la collecte et l'agrégation des prix
(docs/plan-migration-serveur.md §8).

La collecte est déjà à moitié écrite : registerPurchase produit
{item, quantity, totalCost, fullTimestampMs}, et le prix unitaire vaut
totalCost / quantity.

Limites à assumer explicitement dans le produit :
- Ce sont des prix de TRANSACTION observés côté acheteur, pas des prix
  affichés en hôtel de ventes. L'interface doit dire « prix d'achat observés ».
- La détection d'achat est heuristique (perte de kamas suivie d'un ramassage
  dans les 2 s) : elle produit des faux positifs.
- wakfu.log est un fichier texte local, donc trivialement falsifiable.

Tâches :
1. Migrations :
   - price_observations, PARTITIONNÉE PAR MOIS sur observed_at (la purge se
     fera par DROP PARTITION, pas par DELETE massif) ;
   - price_daily (item × serveur × jour : min, max, médiane, p25, p75, volume,
     observation_count, contributor_count) ;
   - price_trends en vue matérialisée (variation médiane 7 j vs 30 j).
2. Ingestion : une observation n'est acceptée QUE si le serveur de jeu est
   résolu. Sans serveur, rejet — pas de rangement dans un « inconnu ».
3. Consolidation par cron : observations → price_daily (toutes les heures),
   rafraîchissement de price_trends, création de la partition du mois suivant,
   DROP des partitions de plus de 90 jours.
4. Anti-abus, à intégrer dès maintenant et pas après coup :
   - agrégats sur la MÉDIANE et les quartiles, jamais la moyenne ;
   - rejet des valeurs aberrantes (écart interquartile) avant consolidation ;
   - un point n'est exposé publiquement que s'il repose sur PLUSIEURS
     contributeurs distincts (contributor_count) ;
   - plafond de contributions par utilisateur et par jour.
5. Endpoints : GET /api/v1/prices/{itemId}?server=&range= (série bornée,
   pré-agrégée, au plus ~90 points) et GET /api/v1/prices/trends?server=&dir=
   (hausses / baisses, lu dans la vue matérialisée — JAMAIS calculé à la volée).

Rappel de dimensionnement : à 1 000 utilisateurs actifs, la table brute
atteindrait ~730 Mo/an sans rétention, au-delà de l'offre gratuite. La
rétention de 90 jours et les rollups ne sont pas une optimisation ultérieure,
ils font partie du lot.

Vérifie avec un jeu de données synthétique : consolidation correcte, purge de
partition effective, rejet des valeurs aberrantes, observation sans serveur
rejetée.
```

**Acceptation** : rollups corrects, purge fonctionnelle, endpoints bornés.

---

## Prompt 8.2 — Interface et graphiques

**Objectif** : la fonctionnalité visible. **Prérequis** : 8.1.

```
Ajoute la vue de suivi des prix.

Tâches :
1. features/prices/ en chargement différé (lazy chunk) : seule cette vue charge
   la bibliothèque de graphiques.
2. Bibliothèque : uPlot (~45 Ko, adapté aux séries temporelles) de préférence à
   Chart.js (~200 Ko). Justifie si tu choisis autrement.
3. Écrans :
   - détail d'un objet : courbe médiane + bande p25/p75, sélecteur de plage
     (7 j / 30 j / 90 j / 1 an), sélecteur de serveur ;
   - tableaux « plus fortes hausses » et « plus fortes baisses », lus depuis
     /prices/trends ;
   - accès depuis la watchlist et depuis l'autocomplétion d'objet.
4. Affiche systématiquement le nombre d'observations et de contributeurs
   derrière un point : c'est ce qui permet à l'utilisateur de juger de la
   fiabilité, et ça évite de présenter une donnée faible comme une cote de
   marché.
5. États vides explicites : objet jamais observé, serveur sans données,
   données trop peu nombreuses pour être publiées.
6. Respecte les conventions UI de CLAUDE.md : .tool-panel, .panel-header,
   tooltips globaux (jamais de ::after local), .icon-btn. Les 4 locales.

Vérifie dans le navigateur : rendu des courbes, changement de plage et de
serveur, états vides, absence de dépassement horizontal sur petite largeur.
```

**Acceptation** : graphiques fonctionnels, chunk chargé uniquement sur cette
vue, états vides couverts.

---

## Après chaque lot

```
Fais le point : ce qui a été livré, ce qui a dévié du plan et pourquoi, la
taille du bundle si elle a changé, et ce qui reste à vérifier manuellement.
Mets à jour docs/plan-migration-serveur.md si une décision d'architecture a
changé en cours de route.
```
