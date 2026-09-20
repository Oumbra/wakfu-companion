---
paths:
  - "src/app/features/session-recap/**"
  - "src/app/shared/period-picker/**"
  - "src/app/core/sync/history-stats.service*.ts"
  - "src/app/core/utils/local-period.util*.ts"
  - "src/app/core/utils/period-group-merge.util*.ts"
  - "src/app/core/services/period-picker.service.ts"
  - "src/app/core/services/recap-period-badge.service.ts"
  - "src/app/core/services/dashboard-body-slot-label.ts"
  - "functions/api/v1/history/stats.ts"
  - "server/history/stats-query.ts"
---

# session-recap

Portée : la carte Récap du dashboard (`SessionRecapComponent`), ses périodes Session/Jour/Mois/Année, le mini-calendrier (`PeriodPicker*`) et l'endpoint d'agrégation `GET /api/v1/history/stats`.

## Switch Session/Jour/Mois/Année (carte Récap) : agrégation SQL serveur, bornes calculées côté client

Ajouté le 2026-08-26 : la carte Récap propose, pour un compte connecté uniquement (aucune donnée
persistante au-delà de la session de fichier courante en mode invité — voir `AuthService`), un
switch qui agrège XP par personnage, kamas détaillés, combats/défis et butin sur une période
calendaire (jour/mois/année **civils**, jamais glissants).

- **`GET /api/v1/history/stats?since=&until=`** (`functions/api/v1/history/stats.ts`) — 5 `SELECT`
  indépendants en parallèle sur `fights`/`fightParticipants`/`fightLoot`/`purchases`/`trades`
  (`GROUP BY`/`SUM`/`count(*) filter (where ...)`), filtrés par `userId` + la plage. Aucune écriture,
  aucune transaction requise (driver `neon-http`, déjà sans transaction interactive).
- **`since`/`until` sont calculés côté CLIENT** (`core/utils/local-period.util.ts` —
  `localDayStart`/`localMonthStart`/`localYearStart`, calendrier LOCAL du navigateur) et envoyés en
  instants ISO explicites — jamais un paramètre `granularity` interprété côté serveur, qui ne connaît
  pas le fuseau horaire de l'utilisateur. Toujours la période EN COURS dans cette itération (pas de
  navigation vers une période passée).
- **Kamas : ventilation détaillée**, volontairement plus riche que la vue Session (`kamasEarned`/
  `kamasLost` simples, inchangée) : combat (`fights.kamas_gained`), ventes HDV vs achats classiques
  (même table `purchases`, distingués par le sentinel `HDV_KAMAS_SALE_ITEM` =
  `'__hdv_kamas_sale__'` — dupliqué côté serveur avec renvoi croisé en commentaire,
  `server/history/stats-query.ts`, `server/` ne dépend jamais de `src/`, même principe que
  `server/settings/keys.ts`), et échanges (`kamasAcquired`/`kamasGiven` + nombre d'échanges).
- Butin de la période : `{itemId, itemName, quantity}` par ligne (mutuellement exclusifs, comme
  partout dans l'historique) — résolu en nom affichable via `resolveItemName` (exportée de
  `history-archive.service.ts`, déjà utilisée pour l'archive de combats), pas recalculé côté
  composant.
- Pas de cache multi-période côté client (`HistoryStatsService` ne garde qu'un seul résultat en
  mémoire, rechargé à chaque changement de switch) : décision délibérée, la requête serveur étant
  déjà agrégée et rapide — une mise en cache multi-clé aurait été une optimisation prématurée.
- **Regroupement par donjon** (ajouté le 2026-08-26, suite logique demandée par l'utilisateur) : 6ᵉ
  requête SQL (`GROUP BY fights.dungeon_id`) — AUCUNE migration requise, `fights.dungeon_id`
  existait déjà (lot 8). Le serveur renvoie l'id Ankama brut (`null` = hors donjon) sans rejoindre
  `dungeons` : le nom localisé est résolu côté client via `CatalogService.findWakfuDungeonEntryById`
  (nouvelle méthode, miroir de `findWakfuItemEntryById` — même raison que pour `itemId`/`itemName`
  du butin : le serveur ne connaît pas la locale d'affichage). "Type de combat" (mentionné dans la
  demande d'origine) volontairement PAS traité comme un axe de regroupement séparé de `dungeonId` —
  chaque donjon a de toute façon un `type` (`WakfuDungeonType`) qui lui est propre, un second niveau
  de regroupement n'apportait pas de valeur claire supplémentaire pour cette itération.
- **Navigation vers une période passée** (même date) : stepper `‹ label ›` (réutilise `app-stepper`,
  déjà existant — voir `.claude/rules/ui-conventions.md`, pas de nouveau composant) au-dessus du
  contenu de période, piloté par un `periodOffset` (0 = période EN COURS, négatif = passé, jamais
  positif — `[max]="0"` sur le stepper). Bornes calculées par `periodBounds`
  (`core/utils/local-period.util.ts`, avec `addLocalDays`/`addLocalMonths`/`addLocalYears` — passage
  par le constructeur `Date(année, mois, jour)`, qui normalise nativement un débordement de
  composant, jamais une arithmétique en millisecondes qui casserait autour du changement d'heure
  été/hiver). **Simplification notable par rapport à l'itération précédente** : `until` est
  maintenant TOUJOURS le début de la période suivante (jamais un "now + marge") — y compris pour la
  période EN COURS, ce qui revient à demander "jusqu'à demain minuit" alors qu'on est encore
  aujourd'hui : aucun combat ne peut avoir un horodatage futur, donc ça ne change rien au résultat
  tout en unifiant la formule pour tous les offsets (plus besoin de `PERIOD_UNTIL_BUFFER_MS`,
  supprimée). Changer de granularité (switch) réinitialise toujours `periodOffset` à `0` — naviguer
  et changer de granularité restent deux gestes distincts, ne jamais hériter d'un offset d'une
  granularité précédente sur une autre.
- **Cache multi-période** (même date, revient sur la décision "pas de cache" de l'itération
  précédente à la demande explicite de l'utilisateur) : `HistoryStatsService` garde désormais un
  `Map<string, PeriodStats>` clé `"{granularité}:{offset}"`, alimenté uniquement pour les périodes
  PASSÉES (`offset !== 0`) — la période EN COURS n'est JAMAIS mise en cache ni servie depuis le
  cache, elle reste par nature susceptible de changer tant qu'elle n'est pas terminée. Un passé déjà
  écoulé, lui, ne change plus (hors correction manuelle d'objet a posteriori, cas limite ignoré).
  Navigation rapide dans le stepper protégée par un compteur de requête (`requestSeq`) : une réponse
  réseau arrivée après une plus récente est silencieusement ignorée plutôt que d'écraser l'affichage
  avec un résultat périmé.
- Vérifié en navigateur (Chromium réel via `playwright-core`, MCP playwright resté figé sur Firefox
  cette session — voir le skill `verify-wakfu-companion`) avec un id de donjon RÉEL du référentiel (65 =
  "Larventura") : résolution de nom correcte, `null` → "Hors donjon". Navigation testée sur 3 pas
  (0 → -1 → -2 → -1 → 0) : bornes `since`/`until` exactes à chaque pas, AUCUN appel réseau
  supplémentaire en revenant sur un offset déjà visité (cache), UN appel en revenant sur l'offset 0
  (jamais servi depuis le cache), bouton "suivant" désactivé à l'offset 0 (jamais de période
  future), libellés corrects dans les 3 granularités ("Aujourd'hui"/"Hier" pour jour, "août 2026"
  pour mois, "2026" pour année).
- Comme pour tous les lots serveur précédents (voir `server/README.md`) : seul un déploiement réel
  avec la vraie base Neon permet de valider les requêtes SQL contre de vraies données — ce sandbox ne
  peut atteindre ni Neon ni `*.pages.dev`. Vérifié ici en navigateur (Chromium/playwright-core,
  `ng serve`) avec `/api/v1/history/stats` simulé par interception de `fetch` (les Pages Functions
  n'existent pas sous `ng serve`, même méthode déjà établie pour les lots précédents) : switch masqué
  en invité, apparition une fois authentifié simulé, bornes `since`/`until` correctes pour les 3
  granularités (vérifiées avec le changement d'heure d'été/hiver, `localYearStart` au 1er janvier
  donnant `+1` UTC en hiver contre `+2` en été pour les autres cas testés — cohérent, JS `Date`
  applique le bon décalage pour CHAQUE date, pas un décalage fixe), positions du fond glissant à 4
  arrêts, ventilation kamas/combats/défis/butin (résolution de nom par catalogue incluse) affichée
  correctement, état de chargement et d'erreur réseau.

## Carte Récap : titre dynamique, largeur, regroupement Donjon & Famille/Type, mini calendrier

Ajouté/corrigé le 2026-08-27, suite à 4 retours utilisateur après test réel de la carte Récap :

- **Titre dynamique** — `sessionRecap.title` ("Recap. de la session") en invité,
  `sessionRecap.titleGeneric` ("Récap") une fois connecté, le nom "session" n'ayant plus de sens
  une fois le switch Jour/Mois/Année en place. Propagé aux DEUX autres endroits qui affichent le
  même libellé (`dashboardBodySlotLabel`, `core/services/dashboard-body-slot-label.ts` — fonction
  pure partagée par `DashboardRailComponent` ET `DashboardLayoutPickerComponent`) via un nouveau
  paramètre `isAuthenticated: boolean` passé explicitement (même principe que `historyGroup`, voir
  sa doc de tête) plutôt que lu depuis `AuthService` à l'intérieur de la fonction — les deux
  appelants injectent `AuthService` et lui passent `auth.isAuthenticated()`.
- **Bug de largeur** — `SessionRecapComponent` avait `:host { display: contents }` (copié à tort du
  pattern d'`HistoryComponent`, qui gère lui-même son placement grid) alors que cette carte est un
  panneau UNIQUE placé par `DashboardComponent` via des styles inline (`grid-column`/`grid-row`/
  `order` posés sur le host, voir `dashboard.component.html`) — un host `display: contents` n'a pas
  de boîte propre, ces styles étaient silencieusement ignorés. Passé à `display: flex; height: 100%`
  (même principe que `ChatPanelComponent`) — vérifié : la carte prend maintenant toute la largeur
  disponible quand elle est seule visible (les autres cartes repliées).
- **Regroupement Donjon & Famille/Type** — nouveau switch 3 positions (`detailMode`, réinitialisé à
  `'cumulative'` par `setGranularity`) affiché uniquement hors vue Session : `'cumulative'`
  reproduit exactement l'ancien affichage (XP/Kamas/Combats/Butin globaux, INCHANGÉ) ; `'byGroup'`/
  `'byType'` le REMPLACENT par un accordéon (une section par ligne, repliée par défaut, détail
  XP/butin propre à la ligne).
  - `'byGroup'` ("Donjon & Famille") : une ligne par donjon précis + une ligne par famille de
    monstre représentative pour les combats hors donjon (avant, tous fourrus dans un seul "Hors
    donjon" plat sans détail propre). Deux tableaux distincts côté serveur (`PeriodStats.dungeons`/
    `families`, jamais le même id des deux côtés), simplement concaténés puis triés par nombre de
    combats décroissant côté client.
  - `'byType'` : les 8 `WakfuDungeonType` fusionnés chacun en une seule ligne (peu importe le
    donjon précis) + une ligne "Autres" fusionnant TOUTE `period.families` — calculé côté CLIENT
    (`mergeGroupTotals`, `core/utils/period-group-merge.util.ts`) à partir des mêmes données que
    "Donjon & Famille", aucune requête serveur supplémentaire. Un donjon dont l'id n'est pas
    résolu par `CatalogService.findWakfuDungeonEntryById` (référentiel pas à jour) est simplement
    ignoré ici plutôt que de faire échouer tout le regroupement — vérifié en navigateur en
    patchant temporairement `CatalogService` (le référentiel réel n'est pas accessible dans ce
    sandbox sans base Neon, voir plus bas).
  - Backend (`functions/api/v1/history/stats.ts`) : la requête `dungeons` existante gagne un filtre
    `dungeonId IS NOT NULL` (le hors-donjon part désormais dans `families`, plus dans une ligne
    `dungeonId: null` de cette même requête) et deux nouvelles requêtes (`dungeonLoot`/`dungeonXp`,
    même filtre) rejointes en JS par `dungeonId` (jamais en SQL — une jointure directe aurait
    multiplié les lignes de totaux par le nombre de lignes de butin/XP, faussant les sommes).
    "Famille représentative d'un combat hors donjon" : sous-requête dérivée (`familyPerFight`,
    fragment `sql` interpolé, jamais matérialisé seul) reproduisant la même priorité que
    `resolveFightTypeClassification` (client, `fight-image.util.ts`) : boss > archimonstre >
    dominant > plus gros dégât, via `DISTINCT ON (fight_id)` — pas de support `selectDistinctOn`
    dans la version de drizzle-orm utilisée ici (pg-core), d'où un `db.execute(sql\`...\`)` brut
    (comme `functions/api/v1/health.ts`) plutôt qu'un enchaînement de query builder Drizzle pour
    les 3 requêtes qui en dépendent (`families`/`familyLoot`/`familyXp`). Approximation acceptée
    (voir demande utilisateur) : le repli générique "horde hétérogène >3 familles" de la version
    client n'est pas reproduit côté SQL, ces combats tombent simplement dans la famille du
    participant le mieux classé.
- **Mini calendrier de navigation** (icône 📅, `PeriodPickerService`/`PeriodPickerComponent`,
  `shared/period-picker/`) — complète le stepper `‹ label ›` existant (qui reste en place pour les
  petits pas) : ouvre une grille selon la granularité active (jour → mois de 7 colonnes, mois → 12
  cases d'une année, année → 10 cases d'une décennie), prev/next navigue par page (mois/année/
  décennie) sans changer la sélection tant qu'aucune cellule n'est cliquée. Cellule hors bornes
  `[OFFSET_MIN[g], 0]` désactivée (jamais masquée). Même pattern que `ClassPickerService` (rendu
  une seule fois au niveau racine, `app.html`, hors de tout ancêtre `transform` — voir
  `.claude/rules/ui-conventions.md`) plutôt que niché localement dans `SessionRecapComponent`.
  - `offsetForPeriodStart` (`core/utils/local-period.util.ts`) : inverse de `periodBounds`, convertit
    une date cliquée en pas de stepper. `day` : différence de JOURS CALENDAIRES via `Date.UTC(y,m,d)`
    sur les deux dates plutôt qu'une division de ms directe (casserait autour d'un changement
    d'heure été/hiver, un jour local pouvant durer 23h/25h à ce moment) ; `month`/`year` : simple
    arithmétique sur les composants.
  - Noms de mois/jours de semaine : deux nouvelles méthodes `I18nService.formatMonthShort`/
    `formatWeekdayShort` (`Intl.DateTimeFormat` avec la locale courante), plutôt qu'une locale de
    calendrier maison — `formatWeekdayShort` calculée sur une semaine de référence FIXE (5-11
    janvier 2026, un lundi-dimanche confirmé) puisque le nom d'un jour de semaine ne dépend pas de
    l'année.
- Vérifié en navigateur (Chromium réel, `playwright-core` — pas de serveur MCP `playwright`
  disponible dans CET environnement d'exécution distant/cloud, contrairement au poste local décrit
  plus loin dans ce fichier) avec un compte connecté simulé et `/api/v1/history/stats` intercepté
  (fixture avec 2 donjons + 2 familles) : titre "Récap" une fois authentifié (carte ET rail replié
  ET Profil › Personnalisation), carte prenant toute la largeur seule visible, switch Cumulé/
  Donjon & Famille/Type masqué en session, mode Cumulé visuellement identique à avant, mode Donjon
  & Famille listant les 4 groupes triés par nombre de combats (labels de repli "Hors donjon"/
  "Famille inconnue" tant que `CatalogService` n'a pas résolu les ids — confirmé en patchant
  temporairement le service pour simuler une résolution réussie, seule façon de tester ce chemin
  sans base Neon réelle dans ce sandbox), ligne dépliée montrant XP/butin propres au groupe, mode
  Type fusionnant correctement en 3 buckets ("4 salles"/"2 salles"/"Autres") avec des totaux
  recalculés exacts, calendrier affichant août 2026 en surbrillance avec septembre-décembre
  désactivés (bornes correctes), clic sur "mars" déclenchant bien `since=2026-03-01T00:00:00.000Z&
  until=2026-04-01T00:00:00.000Z`.

## Durée de session affichée

La durée affichée par `SessionRecapComponent.updateDuration` vaut `sessionActiveDurationMs + min(max(Date.now() - sessionLastIngestAtMs, 0), SESSION_LIVE_TICK_GRACE_MS)` — l'accumulation (`accumulateSessionDuration`, seuil de segmentation 5 min) et la raison des DEUX seuils distincts (segmentation vs prolongation « en direct » plafonnée à 10 s) sont documentées dans `.claude/rules/log-ingestion.md` (section « Durée de session »). Ne jamais réintroduire un chrono `Date.now() - dateDeConnexion`.
