# Plan de migration vers un serveur distant

Document d'analyse — état des lieux mesuré, ce qui peut (et ne peut pas) migrer
côté back, bénéfices/coûts réels, et reproduction du CI/CD actuel avec des
briques gratuites.

Mesures faites le 2026-08-05 sur `master` (commit `2a86044`), build
`npm run build:standalone` réel, pas d'estimation.

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

- `wakfu-companion.standalone.html` : **5 408 932 o** (5,4 Mo), gzip 1 163 848 o.
- Budget Angular `initial` : **dépassé de 1,35 Mo** à chaque build
  (`maximumWarning: 4MB`, erreur à 8 Mo — la marge restante est de 2,65 Mo).
- **837 311 o** du bundle (15,7 % !) ne sont que des URLs `static.ankama.com`
  répétées : le champ `pictureUrl` est stocké en clair pour chacun des
  **11 849** objets, alors qu'il est intégralement reconstructible depuis
  `gfxId` (`https://static.ankama.com/wakfu/portal/game/item/42/{gfxId}.w40h40.png`).

### Ce que ça implique

L'application n'est pas « lourde » : le code applicatif tient en ~500 Ko avec
Angular inclus, ce qui est sain pour 30 composants. **C'est un problème de
données, pas de code.** 90 % de ce que télécharge l'utilisateur est un
référentiel statique et des assets, dont il n'utilisera qu'une fraction infime
(quelques dizaines d'objets suivis sur 11 032).

Deuxième conséquence, moins visible mais plus gênante : le référentiel est figé
au moment du build. **Chaque mise à jour de gamedata Ankama impose aujourd'hui
un rebuild + un redéploiement complet de l'application.**

---

## 2. Ce qui ne peut PAS migrer (à cadrer d'emblée)

C'est le point structurant du dossier, et il vaut mieux le poser avant de
parler d'architecture :

**Le cœur de l'application est irréductiblement client.**

- `LogFileAccessService` lit `wakfu.log` **sur le disque du joueur** via la
  File System Access API. Aucun serveur distant ne peut accéder à ce fichier.
  Le seul moyen de déplacer cette lecture serait un agent local installé
  (Electron / Tauri / service Windows) — c'est un autre projet, pas une
  migration serveur.
- `LogParser` (570 lignes de regex) et `StatsStoreService` (1 192 lignes)
  *pourraient* techniquement tourner côté serveur, mais il faudrait téléverser
  le log en continu. Ce serait : plus lent (aller-retour réseau sur un flux
  sondé à 1 s), coûteux en bande passante, destructeur pour le mode hors-ligne,
  et surtout **problématique en vie privée** — `wakfu.log` contient les
  messages de chat privés d'autres joueurs, qui n'ont rien demandé.
  Le parsing n'est de toute façon pas un goulot d'étranglement mesurable.
- Les alertes sonores et les toasts sont temps réel : ils doivent rester client.

**Conclusion : le serveur envisagé n'est pas un serveur d'application, c'est un
serveur de données et de comptes.** L'application reste une application locale
qui va chercher du référentiel et sauvegarde son état. Cette distinction change
tout le dimensionnement (quelques requêtes par session, pas un flux continu) et
rend d'ailleurs le free tier largement suffisant.

---

## 3. Architecture cible proposée : offline-first, serveur optionnel

La contrainte n°1 du projet (`CLAUDE.md`) est le build standalone `file://`.
Un serveur obligatoire la tuerait. La cible doit donc être :

```
┌─────────────────────────────── Client (inchangé dans son rôle) ──────────┐
│  wakfu.log → LogFileAccessService → LogParser → StatsStoreService        │
│                                                        │                 │
│                                          CatalogRepository (interface)   │
│                                          ├── LocalCatalogRepository  ← standalone
│                                          └── RemoteCatalogRepository ← web
│                                          SyncService (optionnel)         │
└──────────────────────────────────────────────────────────────────────────┘
                                                         │ HTTPS (si activé)
┌─────────────────────────────── Serveur ──────────────────────────────────┐
│  /api/v1/catalog/*   référentiel objets/monstres/donjons + version       │
│  /api/v1/sync        profil, suivi, roster, filtres (= AppDataExport)    │
│  /api/v1/fights      historique long terme (optionnel)                   │
│  /img/*              proxy+cache d'icônes (optionnel)                    │
│  cron                rafraîchissement gamedata Ankama                    │
└──────────────────────────────────────────────────────────────────────────┘
```

Point de conception clé : **une seule interface, deux adaptateurs**. Le code
appelant est identique dans les deux cibles (toujours asynchrone), seul
l'adaptateur injecté change selon la configuration de build. On évite ainsi les
`if (serveurDisponible)` dispersés, qui sont le vrai coût de maintenance d'une
architecture à double cible.

Corollaire : **la cible standalone continue de peser 5,4 Mo.** Le gain de poids
ne bénéficie qu'à la version web. C'est acceptable (le fichier standalone est
téléchargé une fois, pas à chaque visite), mais il faut l'assumer explicitement
plutôt que de le découvrir après coup.

---

## 4. Ce qui gagne à passer côté back, par retour sur investissement

### 4.1 — Le référentiel objets/monstres/donjons ★★★ (le gros morceau)

**Gain : −4,25 Mo, soit −80 % du bundle web.** Le budget Angular repasse
largement sous la limite.

Endpoints : `/api/v1/catalog/version`, `/api/v1/catalog/search?q=&locale=`,
`/api/v1/items/{id}` (détail + recette), `/api/v1/monsters/{id}`.

Deux pièges à traiter, sans quoi c'est une régression :

1. **`findWakfuItemEntry` est dans le chemin chaud du parsing.**
   `stats-store.service.ts` l'appelle à chaque ramassage d'objet, de façon
   synchrone. Le transformer en appel réseau est impossible. **Solution : garder
   embarqué un index minimal** (nom FR normalisé → `{id, gfxId, rarity,
   hasRecipe}`, sans traductions, sans recettes, sans `pictureUrl`), estimé
   200–400 Ko, et ne charger à distance que les détails (recettes,
   traductions, images). L'essentiel du poids est dans les recettes et les
   quatre traductions par objet, pas dans l'index.
2. **L'autocomplétion devient asynchrone.** `WakfuSearchService.searchAll()`
   retourne aujourd'hui un tableau instantanément. Passer à un aller-retour
   réseau de 100–300 ms sur chaque frappe serait perçu comme une régression
   nette. Avec l'index local du point 1, la recherche par nom reste locale et
   instantanée — seul l'affichage du détail (recette) devient distant. C'est le
   bon découpage.

**Bénéfice fonctionnel qui vaut à lui seul le détour** : le référentiel
devient rafraîchissable sans redéployer l'application. Un cron serveur lit
`wakfu.cdn.ankama.com/gamedata/{version}/`, met à jour la base, et tous les
clients voient les nouveaux objets à leur prochaine visite. Aujourd'hui, chaque
patch Wakfu impose un cycle complet `npm run generate` + build + déploiement.

### 4.2 — Les URLs d'images ★★★ (à faire même sans serveur)

**Gain : −837 Ko immédiatement, sans aucun serveur, sans changement d'API.**

Remplacer le champ `pictureUrl` (URL complète stockée 11 849 fois) par un
booléen `wakfuAvailable` déjà présent, et reconstruire l'URL à l'affichage
depuis `gfxId`. Modification isolée : `tools/generate-wakfu-items-data.mjs` +
`shared/item-icon/item-icon.component.ts`.

C'est le meilleur rapport gain/risque de tout le dossier et il est totalement
indépendant de la décision serveur.

### 4.3 — Les assets binaires (sons, icônes) ★★

**Gain : −578 Ko sur la cible web.**

Aujourd'hui en base64 dans le JS — ce qui coûte +33 % par rapport au binaire
*et* bloque le parsing JS au démarrage (le navigateur doit lire 578 Ko de
chaînes avant de pouvoir exécuter quoi que ce soit). Servis en fichiers
statiques avec un cache long, ils sortent du chemin critique et sont chargés à
la demande (un son n'est utile que quand une alerte se déclenche).

C'est exactement ce que le principe d'architecture n°1 interdit — d'où la
nécessité de l'adaptateur double cible : la version standalone garde le base64,
la version web charge des fichiers.

### 4.4 — Synchronisation du profil et des données utilisateur ★★★

Ce n'est pas un gain de poids, c'est une correction de faiblesse.

**Aujourd'hui, toutes les données utilisateur vivent en `localStorage`** :
profil, watchlist et compteurs de suivi, roster de personnages, filtres de
chat, réattributions de dégâts, classes détectées. Un nettoyage de navigateur,
un changement de machine ou un simple passage de Chrome à Edge, et tout est
perdu. `AppDataExportService` propose un export/import JSON manuel — c'est un
pansement qui suppose que l'utilisateur y pense *avant* l'incident.

**Très bonne nouvelle pour la mise en œuvre** : le format de sync existe déjà.
`AppDataExport` (v1, versionné, avec `EXPORT_KEYS` comme liste blanche) est
littéralement le payload à envoyer, et `buildExport()` / `applyImport()` sont
les deux moitiés du client de sync déjà écrites et testées en usage réel. La
migration se réduit à : un compte, un endpoint `PUT/GET /api/v1/sync`, et une
stratégie de conflit (dernier écrivain gagne par clé, avec `updatedAt` —
amplement suffisant pour un usage mono-utilisateur multi-appareils).

Authentification : OAuth Discord (l'audience du jeu y est déjà) ou lien magique
par e-mail. Éviter de gérer des mots de passe soi-même.

### 4.5 — Historique de combats longue durée ★★

Aujourd'hui `MAX_FIGHT_HISTORY = 30`, en mémoire, reconstruit depuis le log à
chaque rechargement (et donc perdu dès que le fichier de log tourne). Côté
serveur : historique illimité, progression sur plusieurs semaines, comparaison
entre sessions, statistiques par personnage. C'est la vraie valeur ajoutée
fonctionnelle d'un back — le reste est de l'optimisation.

⚠️ **Piège n°1 de toute cette migration** : le gating `isInitialLoad`
(principe d'architecture n°2). Toute reconnexion relit le fichier depuis le
début et reconstruit l'historique. Si les combats sont envoyés au serveur sans
précaution, chaque reconnexion **dupliquera l'intégralité de l'historique
côté serveur** — exactement le bug déjà corrigé en local, mais cette fois sur
des données persistantes et donc non réparables par un simple F5.

Parade obligatoire : un identifiant de combat **déterministe** (hash de
`fightId` + horodatage complet + liste des participants) utilisé comme clé
d'idempotence côté serveur (`INSERT OR IGNORE`). À concevoir avant d'écrire la
première ligne de cette partie.

Vie privée : n'envoyer que des agrégats de combat. **Jamais le chat** — il
contient les messages d'autres joueurs.

### 4.6 — Proxy et cache d'images ★

`item-icon.component.ts` enchaîne aujourd'hui jusqu'à trois CDN tiers en
cascade sur événement `error` (wakassets → static.ankama → wakfuli), ce qui
provoque des icônes génériques transitoires et impose de stocker deux booléens
de disponibilité par objet. Un endpoint `/img/item/{gfxId}` qui essaie les
sources côté serveur, met en cache et sert une URL stable supprimerait la
cascade, les deux booléens, et la dépendance au `referrerpolicy` anti-hotlink.

**Mais** c'est le poste qui consomme le plus de quota gratuit, et il déplace un
problème de disponibilité tiers vers ton infrastructure. À ne faire qu'avec un
cache agressif (R2/Cache API, TTL long) et en **conservant la cascade client en
repli**. Priorité basse.

### 4.7 — Télémétrie d'erreurs de parsing ★★ (bénéfice sous-estimé)

Angle mort actuel : si un patch Wakfu change le format d'une ligne de log,
`LogParser` cesse silencieusement de reconnaître l'événement. **Aucune remontée
n'est possible** — l'application se casse chez tous les joueurs sans que
personne ne le sache, jusqu'à ce qu'un utilisateur le signale.

Un simple endpoint qui reçoit un compteur anonyme de lignes non reconnues (le
*motif*, jamais le contenu) transforme cette panne silencieuse en alerte. Coût
de mise en œuvre très faible, valeur de maintenance élevée.

### 4.8 — i18n ☆

64 Ko pour 4 locales, dont 3 inutiles pour un utilisateur donné (~48 Ko de
gain). Faisable par import dynamique **sans serveur**. Marginal, mentionné pour
complétude.

---

## 5. Bilan : points positifs / points négatifs

### Positifs

| Bénéfice | Impact |
| --- | --- |
| Bundle web 5,35 Mo → ~1,1 Mo (~0,5 Mo avec les assets sortis) | Démarrage nettement plus rapide, budget Angular respecté |
| Référentiel rafraîchi sans redéploiement | Supprime le cycle rebuild+déploiement à chaque patch Wakfu |
| Sauvegarde/sync des données utilisateur | Corrige le risque n°1 actuel : tout perdre en vidant son navigateur |
| Historique et statistiques longue durée | Fonctionnalité impossible aujourd'hui |
| Télémétrie de parsing | Rend visibles les casses silencieuses après patch |
| Fonctionnalités communautaires possibles | Classements, taux de drop agrégés, partage de récap par lien |

### Négatifs

| Coût / risque | Gravité | Atténuation |
| --- | --- | --- |
| **Le mode standalone `file://` ne bénéficie d'aucun gain** et impose de maintenir deux adaptateurs | Élevée | Interface unique + 2 implémentations, jamais de `if` dispersés |
| **Nouveau point de panne** : serveur indisponible = application dégradée | Élevée | Cache IndexedDB du dernier référentiel + Service Worker → reste utilisable hors-ligne |
| Charge de maintenance : base de données, migrations, secrets, sauvegardes, supervision | Moyenne | Choisir du managé (D1/Turso) plutôt qu'un serveur à administrer |
| **RGPD** dès qu'il y a des comptes : politique de confidentialité, droit à l'effacement | Moyenne | `legal-page.component` existe déjà — base à étendre. Ne jamais stocker le chat |
| Redistribuer le gamedata Ankama depuis son propre domaine est plus exposé que l'embarquer | Moyenne | Les JSON sont publics et documentés sur le forum officiel ; rester sur du référentiel, éviter le proxy d'images massif |
| Latence de l'autocomplétion (synchrone → réseau) | Moyenne | Index local minimal conservé (§4.1) — la recherche reste locale |
| Duplication d'historique via `isInitialLoad` | **Critique si ignorée** | Identifiant de combat déterministe + idempotence serveur (§4.5) |
| Deux artefacts à déployer en cohérence | Faible | Versionner l'API (`/api/v1`), le front doit tolérer une API plus ancienne |
| Quotas du free tier si l'audience grandit | Faible | Surveiller ; le proxy d'images est le seul poste réellement consommateur |

### Verdict

- **§4.2 (URLs d'images) : à faire immédiatement**, sans serveur, sans risque.
- **§4.1 (référentiel distant) : rentable**, c'est 80 % du gain — mais seulement
  si l'index local minimal est conservé.
- **§4.4 (comptes + sync) : rentable dès que l'application a des utilisateurs
  réguliers** ; c'est la faiblesse fonctionnelle la plus concrète aujourd'hui.
- **§4.5 à §4.7 : confort**, à faire après, dans cet ordre de valeur.
- **Ne jamais rendre le serveur obligatoire.** L'offline-first n'est pas ici une
  élégance d'architecte, c'est ce qui fait que l'application marche pendant une
  coupure ou après l'abandon du projet.

---

## 6. Modifications concrètes dans le code

| Fichier / zone | Modification |
| --- | --- |
| `tools/generate-wakfu-items-data.mjs` | Supprimer `pictureUrl` du fichier généré (−837 Ko) ; produire en plus un `wakfu-items-index.data.ts` allégé |
| `shared/item-icon/item-icon.component.ts` | Reconstruire l'URL Ankama depuis `gfxId` |
| **nouveau** `core/api/api-client.service.ts` | `fetch` centralisé : base URL, timeout, retry, gestion hors-ligne |
| **nouveau** `core/api/catalog.repository.ts` | Interface + `LocalCatalogRepository` / `RemoteCatalogRepository` |
| **nouveau** `src/environments/environment*.ts` | `apiBaseUrl: string \| null` — `null` = mode standalone |
| `angular.json` | Configuration `web` distincte de `standalone`, via `fileReplacements` |
| `core/services/wakfu-search.service.ts` | Recherche sur l'index local (synchrone), détails via le repository (async) |
| `core/services/stats-store.service.ts` | `findWakfuItemEntry` **reste synchrone** (chemin chaud) ; ajouter l'émission d'un combat terminé vers la file d'envoi |
| `core/services/persistence.service.ts` | Inchangé — reste la seule abstraction de persistance locale |
| **nouveau** `core/services/sync.service.ts` | Réutilise `AppDataExportService.buildExport/applyImport`, push/pull + résolution de conflit |
| **nouveau** `core/services/fight-upload.service.ts` | File d'attente + retry, non bloquante, **clé d'idempotence déterministe** |
| `core/services/alert-sound.service.ts` + `*.data.ts` d'assets | Chargement à la demande sur la cible web, base64 conservé en standalone |
| `shared/legal-page/` | Étendre avec la politique de confidentialité (obligatoire dès les comptes) |
| `core/i18n/translations.ts` | Import dynamique par locale (indépendant du serveur) |

---

## 7. Phasage proposé

| Lot | Contenu | Gain | Risque |
| --- | --- | --- | --- |
| **0** | Retrait de `pictureUrl`, i18n dynamique, `package-lock.json` committé, job de tests en CI | −885 Ko, CI fiabilisée | Nul |
| **1** | Squelette API + `/api/v1/health` + `/catalog/version` + CI/CD de l'API | Invisible pour l'utilisateur | Nul |
| **2** | Catalogue distant + index local minimal + adaptateurs | −4 Mo sur le web | Moyen (autocomplétion) |
| **3** | Assets sons/icônes en statique (cible web) | −578 Ko | Faible |
| **4** | Comptes + sync du profil | Fiabilité des données | Moyen (RGPD, auth) |
| **5** | Historique de combats serveur | Nouvelle fonctionnalité | **Élevé** (idempotence) |
| **6** | Proxy d'images, communautaire, télémétrie | Confort | Faible |

Les lots 0 et 1 sont sans regret : ils ont de la valeur même si la migration
s'arrête là.

---

## 8. CI/CD gratuit reproduisant le fonctionnement actuel

### Existant

Deux workflows, tous deux via `peaceiris/actions-gh-pages` :

- `deploy-main.yml` : push sur `master` → build standalone → GitHub Pages, racine.
- `deploy-preview.yml` : push sur `claude/dev` → même build → `preview/claude-dev`.

Simple et efficace. **Le front n'a aucune raison de bouger** : GitHub Pages
reste parfait pour du statique. Il suffit d'ajouter le déploiement de l'API à
côté.

Deux manques à corriger au passage, indépendants de la migration :

1. **Aucun workflow ne lance les tests** alors que Vitest est configuré et que
   4 fichiers `.spec` existent (dont `stats-store.service.spec.ts`, 570 lignes).
   Un déploiement peut aujourd'hui partir en production avec des tests rouges.
2. **`package-lock.json` est dans le `.gitignore`**, ce qui force `npm install`
   au lieu de `npm ci` : les builds ne sont pas reproductibles et une mise à
   jour transitive peut casser un déploiement sans aucun changement de code.

### Comparatif des hébergeurs gratuits

⚠️ Les quotas des offres gratuites évoluent régulièrement ; à revérifier au
moment de la décision.

| Option | Gratuit | Points forts | Points faibles |
| --- | --- | --- | --- |
| **Cloudflare Workers + D1 + R2** | Oui, généreux (~100 k req/jour, D1 5 Go, R2 10 Go sans frais de sortie) | **Pas de démarrage à froid** (isolats V8), environnements par branche natifs, cron intégré, domaine `*.workers.dev` en HTTPS | Runtime Node partiel, D1 encore jeune |
| Deno Deploy | Oui | Standards web, très simple | Quotas plus serrés, pas de base intégrée |
| Vercel Hobby + Neon/Turso | Oui | Excellente expérience de développement | **Usage non commercial uniquement**, base séparée |
| Netlify Functions | Oui | Proche du modèle Pages | ~125 k invocations/mois, base séparée |
| Render (service web gratuit) | Oui | Vrai Node/Docker | **Mise en veille après 15 min → démarrage à froid ~50 s** : rédhibitoire pour de l'autocomplétion |
| Fly.io | Plus vraiment | Vrai serveur, régions au choix | Offre gratuite supprimée/limitée |
| Supabase | Oui | Postgres + auth + stockage clé en main | **Projet mis en pause après ~1 semaine d'inactivité**, 500 Mo |

### Recommandation

**GitHub Pages (front, inchangé) + Cloudflare Workers + D1 + R2 (API).**

Raisons, dans l'ordre :

1. L'absence de démarrage à froid est déterminante ici : l'API sert de
   l'autocomplétion et du détail d'objet, c'est-à-dire de l'interactif. Les
   50 s de réveil de Render sont disqualifiants ; ceux de Supabase (projet en
   pause) le sont pour un projet à trafic irrégulier — précisément le profil
   d'une application de niche.
2. Les environnements par branche reproduisent exactement le schéma
   `master`/`claude/dev` déjà en place.
3. Les Cron Triggers intégrés couvrent le rafraîchissement du gamedata sans
   dépendre du planificateur GitHub Actions, qui **se désactive après 60 jours
   d'inactivité du dépôt** — piège classique sur un projet personnel.
4. R2 ne facture pas la sortie de données, ce qui est le bon choix si le proxy
   d'images (§4.6) est un jour activé.
5. Accessoirement, le site de référence Nexus-Hub tourne déjà sur
   `workers.dev` : la stack est éprouvée pour cet usage précis.

Alternative si l'on préfère du Node classique : **Deno Deploy + Turso**, même
absence de démarrage à froid, au prix de quotas plus serrés.

### Workflows à ajouter

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
          cache: npm            # nécessite package-lock.json committé
      - run: npm ci
      - run: npx prettier --check "src/**/*.{ts,html,css}"
      - run: npm test -- --run
      - run: npm run build:standalone   # garde-fou : le build standalone doit passer
```

**`.github/workflows/deploy-api.yml`** — déploiement de l'API, avec filtres de
chemins pour ne pas redéployer l'API quand seul le front change :

```yaml
name: Deploy API (Cloudflare Workers)
on:
  push:
    branches: [master, claude/dev]
    paths: ['server/**', '.github/workflows/deploy-api.yml']

jobs:
  deploy:
    runs-on: ubuntu-latest
    needs: []            # chaîner sur le job `test` si les workflows sont fusionnés
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
        working-directory: server
      - name: Migrations D1
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: server
          command: >
            d1 migrations apply wakfu-companion --remote
            --env ${{ github.ref_name == 'master' && 'production' || 'preview' }}
      - name: Déploiement
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: server
          command: >
            deploy
            --env ${{ github.ref_name == 'master' && 'production' || 'preview' }}
```

Secrets à créer dans le dépôt : `CLOUDFLARE_API_TOKEN` (portée « Edit Workers »
+ D1 + R2) et `CLOUDFLARE_ACCOUNT_ID`.

**Ajout aux workflows existants** : les deux workflows de déploiement Pages
gagnent un filtre `paths-ignore: ['server/**', 'docs/**']` pour ne pas
reconstruire 5 Mo de front à chaque changement d'API.

**Rafraîchissement du gamedata** : à mettre dans un Cron Trigger Cloudflare
(`wrangler.toml`, `crons = ["0 4 * * *"]`) plutôt que dans un `schedule:` GitHub
Actions, pour la raison de désactivation après 60 jours évoquée plus haut. Le
Worker lit `wakfu.cdn.ankama.com/gamedata/config.json`, compare la version à
celle en base, et ne recharge que si elle a changé.

### Coût total

**0 €** dans les offres gratuites, pour le volume attendu d'une application de
niche : le référentiel se sert depuis un cache, la sync représente quelques
requêtes par session, et l'historique de combats quelques écritures par heure de
jeu. Le seul poste capable de faire sortir des quotas est le proxy d'images
(§4.6) — raison supplémentaire de le garder en dernier.

---

## 9. Points de vigilance à relire avant de commencer

1. **Ne pas rendre `findWakfuItemEntry` asynchrone** — chemin chaud du parsing.
2. **Identifiant de combat déterministe** avant toute écriture serveur
   d'historique, sinon duplication à chaque `isInitialLoad`.
3. **Ne jamais transmettre le contenu du chat** au serveur.
4. **Conserver la cascade de repli des images côté client** même avec un proxy.
5. **Le build standalone doit rester vert** à chaque lot — c'est le garde-fou
   qui empêche l'architecture de dériver vers un serveur obligatoire ; d'où sa
   présence dans le workflow CI ci-dessus.
6. Vérifier chaque nouveau signal cumulatif au regard du principe n°2
   (persistant vs dérivé du fichier), la règle ne disparaît pas avec le serveur
   — elle devient juste plus coûteuse à enfreindre.
