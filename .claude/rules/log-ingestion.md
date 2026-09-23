---
paths:
  - 'src/app/core/services/log-parser*.ts'
  - 'src/app/core/services/stats-store.service*.ts'
  - 'src/app/core/services/entity-classifier.service*.ts'
  - 'src/app/core/services/log-file-access.service*.ts'
  - 'src/app/core/models/fight.model.ts'
  - 'src/app/features/setup/**'
---

# log-ingestion

Portée : parsing du `wakfu.log` (`LogParser`), agrégation (`StatsStoreService`), classification allié/ennemi (`EntityClassifierService`) et accès au fichier (`LogFileAccessService`, écran de connexion). Pour vérifier un changement en navigateur (lignes synthétiques sur `newLines$`, fichiers ×N, profil CPU), voir le skill `verify-wakfu-companion`.

## Principe d'architecture : gating `isInitialLoad`

`LogFileAccessService.newLines$` émet `{ lines, isInitialLoad }` — `isInitialLoad` est vrai uniquement pour le tout premier lot d'une (re)connexion (contenu déjà présent dans le fichier avant l'ouverture). Toute (re)connexion — clic sur "Changer de fichier" puis resélection du même fichier y compris — relit **tout le fichier depuis le début** comme un nouveau `isInitialLoad`.

Deux catégories d'état dans `StatsStoreService`, à traiter différemment à chaque `isInitialLoad` :

1. **Suivi persistant** (`watchlist`, compteurs d'ennemis vaincus/objets ramassés) : ne JAMAIS incrémenter pendant `isInitialLoad` (sinon un contenu déjà compté dans une session précédente regonfle le compteur à chaque reconnexion) — géré dans `registerDefeat`/`registerLoot` via `currentBatchIsInitialLoad`.
2. **État dérivé du fichier** (historique de combats, kamas, xp, combats gagnés/perdus, chat...) : DOIT être réinitialisé (`resetSessionState()`) au début de chaque `isInitialLoad`, sinon une reconnexion ajoute une deuxième copie de tout l'historique déjà reconstruit au lieu de le remplacer (bug réel corrigé en session — vérifier ce point à chaque fois qu'un nouveau signal cumulatif est ajouté à `StatsStoreService`).

Si un nouveau champ cumulatif est ajouté au store, se demander explicitement : persistant (jamais reset) ou dérivé du fichier (reset à chaque `isInitialLoad`, dans `resetSessionState()`) ?

## Texte des autres joueurs : jamais évaluer une regex « technique » sur une ligne de chat

Corrigé le 2026-09-23 (audit de sécurité) : `CLIENT_BUILD_DATE_RE` n'était pas ancrée et était
évaluée AVANT l'aiguillage `[Catégorie]`. Un joueur écrivant `vends pano [2000-01-01 @ 00H00min00]`
dans un canal public déplaçait `logDateAnchor` chez tous les lecteurs du log — dates de combat
fausses, envoyées ensuite au serveur. Règles :

- Toute regex qui donne un sens « système » à une ligne (ancre de date, début de session, build...)
  est **ancrée `^…$` sur la forme exacte de la ligne technique** et n'est jamais évaluée sur une
  ligne `[Catégorie] …` (chat, commerce, guilde...), dont le texte est contrôlé par des tiers.
- Une valeur extraite d'une ligne est **bornée** (date : année ≥ 2012, calendrier valide, pas au-delà
  de maintenant + 1 jour) — voir `matchClientBuildDate()` dans `log-parser.ts`.
- Longueur de ligne plafonnée (`MAX_LOG_LINE_LENGTH = 4096`, traitée comme une ligne WARN au-delà) :
  défense en profondeur contre les regex à retour arrière. Plus longue ligne réelle constatée :
  ~1 000 caractères (liste OpenAL au démarrage). Pas de regex à quantificateurs imbriqués sur du
  texte libre (`TRADE_ITEM_RE` remplacée par un découpage linéaire `parseTradeItems`).

## Performance du chemin chaud d'ingestion : jamais de balayage O(catalogue) par ligne

Corrigé le 2026-08-30, remonté par l'utilisateur avec vidéo à l'appui : jusqu'à ~10s de gel total,
**sans le moindre spinner**, au premier chargement d'un fichier `wakfu.log` de taille réaliste
(~80 000 lignes) — l'utilisateur soupçonnait à raison une corrélation avec le nombre de combats.

**Méthode de diagnostic** (à réutiliser pour tout futur soupçon de lenteur du parsing) : le
chronométrage naïf (`performance.now()` autour de `ingest()`) sur un seul fichier ne suffit pas —
il faut tester la **scalabilité** (dupliquer artificiellement un vrai fichier ×2/×5/×10/×20 dans
`public/` — jamais commité, nettoyé après coup — et le charger via `fetch()` en navigateur plutôt
que de coller un texte de plusieurs Mo dans un appel `browser_evaluate`, un `ng serve` démarré APRÈS
l'ajout ne le sert pas tant qu'il n'a pas redémarré) pour distinguer une dérive linéaire normale
d'un vrai comportement pathologique (ici : un effondrement net entre ×2 et ×5, PAS une dérive
progressive). Une fois le palier identifié, un vrai **profil CPU** via CDP
(`page.context().newCDPSession(page)` + `Profiler.start()/stop()`, profil analysé par temps propre
("self time") cumulé par fonction) pointe directement la fonction coupable — bien plus fiable que
d'empiler des `performance.now()` à la main dans le code source.

**Cause identifiée** : `StatsStoreService.resolveLootConfidence` (appelée pour CHAQUE ligne "Vous
avez ramassé...", potentiellement des milliers de fois par fichier) appelait inconditionnellement
`CatalogService.findAllWakfuItemEntriesByName`, qui balayait alors TOUT `itemsById` (~16 000
objets, avec normalisation de 4 noms de locale chacun) — coût négligeable tant que le catalogue
distant n'est pas encore chargé (d'où un premier test "à froid" trompeur, très rapide), mais très
réel une fois chargé (le cas normal : le catalogue charge en tâche de fond dès le démarrage de
l'app, largement avant que l'utilisateur ait eu le temps de connecter son fichier). Plus de 60% des
objets du référentiel partagent leur nom normalisé avec au moins un autre id (variantes de rareté
d'un même équipement) : **ce n'était donc pas un cas rare** — c'est précisément la 2ᵉ fois que ce
même piège se produit sur cette fonction (voir la doc de `CatalogService.itemEntriesByName`, 1ʳᵉ
occurrence le même jour côté tooltips de butin, `[appTooltip]` réévalué à chaque cycle de détection
de changement).

**Leçon retenue** : corriger UN appelant en contournement (ex. vérifier `hasMultipleWakfuItemEntriesByName`
avant d'appeler la version O(n)) ne suffit pas à empêcher un 2ᵉ appelant de retomber dans le même
piège — surtout quand la doc de la fonction affirme "jamais un chemin chaud" alors que ce n'est plus
garanti. La correction durable est de rendre la fonction elle-même O(1) à la source
(`CatalogService.itemEntriesByName`, `Map<string, CatalogItemEntry[]>` précalculée une seule fois à
la construction de l'index catalogue), pour que TOUT appelant présent et futur en bénéficie
automatiquement, sans avoir à se souvenir d'un garde-fou à poser à chaque site d'appel.

**Spinner** (2ᵉ volet de la demande utilisateur, indépendant du fix de perf) : l'infrastructure
existait déjà et était correcte (`LogFileAccessService.initialReadPending` → `FightHistoryComponent.
historyLoading` → `.spinner-ring`), mais ne s'affichait jamais en pratique : rien ne garantissait un
créneau de PEINTURE navigateur entre `initialReadPending.set(true)` et le calcul synchrone bloquant
qui suit — les deux `await` déjà présents (`getFile()`/`arrayBuffer()`) peuvent se résoudre quasi
instantanément (fichier déjà en cache OS), sans offrir de fenêtre de rendu réelle. Corrigé en
ajoutant un yield **macrotâche** explicite (`await new Promise(r => setTimeout(r, 0))`, jamais une
microtâche type `Promise.resolve()` — le navigateur ne peint qu'entre deux tâches de la file, jamais
entre deux microtâches) juste avant `newLines$.next()` dans `LogFileAccessService.processFile()`,
uniquement pour `isInitialLoad` (les lots incrémentaux en cours de session sont déjà petits/rapides,
pas concernés). Vérifié en navigateur (Chromium réel via `playwright-core`, MCP figé sur Firefox ce
jour-là) via le VRAI chemin `connect()`/`poll()`/`processFile()` (handle `FileSystemFileHandle`
factice dont `getFile()` renvoie un vrai `File` avec le contenu d'un fichier de test réel, latence de
lecture simulée) : spinner visible dès ~90ms, historique peuplé et spinner disparu ensuite — plus de
gel silencieux.

## Durée de session (carte Récap) : dérivée du fichier, pas de l'horloge murale

Corrigé le 2026-08-26 : l'ancien calcul (`Date.now() - dateDeConnexion`, un simple chrono démarré à
la connexion) grandissait indéfiniment tant que l'onglet restait ouvert — y compris client Wakfu
fermé, PC en veille, ou fichier contenant plusieurs sessions de jeu distinctes (utilisateur
déconnecté puis reconnecté plus tard dans le MÊME `wakfu.log`). La durée affichée doit correspondre
au temps **réellement actif** d'après le contenu du fichier, pas au temps écoulé depuis l'ouverture
de l'app.

Architecture retenue (`StatsStoreService.accumulateSessionDuration`, appelée sur CHAQUE ligne brute
dans `ingest()`, avant même `LogParser.parseLine`) — **deux seuils distincts**, pas un seul partagé
(voir plus bas pourquoi la version initiale à un seul seuil a dû être corrigée) :

- `sessionActiveDurationMs` (signal, reset à 0 dans `resetSessionState()`, donc à chaque
  `isInitialLoad` — état DÉRIVÉ DU FICHIER, voir principe `isInitialLoad` ci-dessus) accumule
  l'écart entre deux lignes horodatées consécutives du fichier, **sauf** si cet écart atteint
  `SESSION_SEGMENT_GAP_THRESHOLD_MS` (5 min, privée à `stats-store.service.ts`) — auquel cas il est
  considéré comme une coupure (fermeture du client, crash, veille...) et n'est PAS ajouté au total.
  Basé sur `peekLineTime` (voir `log-parser.ts`, déjà utilisé par `primeLogDateAnchorFromBatch` pour
  l'ancrage de date) sur la ligne BRUTE, PAS sur `LogEntry`/`apply()` : une ligne purement technique
  sans `LogEntry` associé (ex. `"Stopping cFC..."`, arrêt du client) compte quand même comme une
  preuve d'activité — sinon une période sans combat/butin/chat (navigation de menus, par exemple)
  paraîtrait à tort "coupée".
- Ce seuil de segmentation (5 min) volontairement **générique** (écart entre lignes), pas basé sur la
  détection de la ligne `"Stopping cFC..."` elle-même malgré sa présence dans le fichier de
  calibration (voir ci-dessous) : cette ligne ne signale qu'une fermeture PROPRE, jamais un crash/une
  perte réseau/une mise en veille/un `wakfu.exe` tué depuis le gestionnaire de tâches. Un seuil
  générique couvre tous ces cas uniformément, sans dépendre d'une chaîne de log qu'Ankama pourrait
  faire évoluer.
- Calibré sur un vrai fichier fourni par l'utilisateur (deux sessions de jeu distinctes dans le même
  `wakfu.log`, fermeture complète du client puis reconnexion ~41 min plus tard) : le plus grand écart
  normal À L'INTÉRIEUR de chacune des deux sessions n'y dépassait jamais ~51s (mesuré), très en
  dessous des 5 min retenues pour CE seuil — et l'écart RÉEL entre les deux sessions (41 min 35s) y
  est très largement au-dessus. Résultat vérifié EXACT au diagnostic de l'utilisateur : segments
  `14:13:32,174 → 14:52:25,542` et `15:34:00,974 → 16:52:12,618`, total actif `1h57m05s`.
- `sessionLastIngestAtMs` (signal, horloge MURALE — `Date.now()`, PAS une valeur du fichier — posé à
  la fin de CHAQUE `ingest()`) sert uniquement à `SessionRecapComponent` pour prolonger l'affichage
  "en temps réel" entre deux lots de lignes tant qu'une partie semble en cours, plafonné à
  `SESSION_LIVE_TICK_GRACE_MS` (10s, exportée — voir juste en dessous pourquoi une valeur bien plus
  courte que le seuil de segmentation ci-dessus) : au-delà de ce plafond, la durée cesse d'augmenter
  automatiquement et ne repart QUE lorsque le fichier est de nouveau alimenté (prochain `ingest()`),
  jamais de lui-même — vérifié en navigateur (Chrome piloté directement via `playwright-core`, MCP
  playwright bloqué ce jour-là sur un Firefox qui ne se lançait plus, voir le skill `verify-wakfu-companion`) :
  figée à `activeMs + 10s` passé ce délai sans nouveau lot, immobile ensuite, puis reprise exacte dès
  qu'un nouveau lot arrive (le total bondit à la nouvelle valeur confirmée, le tick repart).
- Affichée = `sessionActiveDurationMs + min(max(Date.now() - sessionLastIngestAtMs, 0),
SESSION_LIVE_TICK_GRACE_MS)` (voir `SessionRecapComponent.updateDuration`).

**Pourquoi deux seuils et pas un seul** (régression corrigée le 2026-08-27, remontée par
l'utilisateur après un test réel sur le fichier de calibration) : la version initiale utilisait UNE
SEULE constante partagée (`SESSION_GAP_THRESHOLD_MS`, 5 min) pour les deux rôles. Ça fonctionnait
pour la segmentation historique (5 min, bien calibré) mais rendait l'affichage "en direct" visiblement
faux : après avoir lu un fichier déjà entièrement statique (plus aucune nouvelle ligne à venir), le
chronomètre continuait à grimper pendant 5 minutes avant de se figer — bien trop long pour un
affichage supposé refléter l'état RÉEL du fichier à chaque instant. Les deux seuils répondent à des
questions différentes : `SESSION_SEGMENT_GAP_THRESHOLD_MS` décide, une fois qu'une ligne confirme la
suite, si le temps DÉJÀ ÉCOULÉ comptait comme actif (large, un vrai écart de jeu normal peut
légitimement atteindre ~50s sans aucune ligne) ; `SESSION_LIVE_TICK_GRACE_MS` décide combien de temps
l'AFFICHAGE peut optimistement continuer à tourner AVANT qu'une telle ligne n'arrive, sans savoir
encore si elle viendra (doit rester court pour ne pas mentir visuellement).

## Invocations : traitées comme des sorts de leur invocateur, jamais comme des combattants à part

Deux bugs distincts, découverts et corrigés ensemble le 2026-08-24 sur un vrai `wakfu.log` fourni par
l'utilisateur (donjons variés, Sadida/Osamodas/Sram invoquant abondamment) :

1. **`obstacleId != -1` ne signale PAS du décor** — hypothèse fausse qui existait depuis un vieux fix
   ("Larme d'Ogrest"). Vérifié sur ce fichier réel : **jusqu'à 61% des lignes `[_FL_] ... join the
fight` de VRAIS monstres** (pas des invocations, pas du décor) ont un `obstacleId` non -1 — sans
   rapport avec leur nature de combattant (probablement leur position de départ sur une case
   elle-même praticable/obstacle). L'ancien filtre `if (join[6] !== '-1') return null;` dans
   `LogParser.parseFighterJoin` faisait donc disparaître silencieusement la MAJORITÉ des ennemis de
   nombreux combats — plus aucune image de combat (voir `resolveFightImageInfo`, `entries` vide car
   aucun ennemi connu du catalogue n'avait pu être enregistré), dégâts infligés/encaissés sous-comptés
   (`isRosterMember` rejette toute ligne dont l'attaquant ou la cible n'a jamais "rejoint" le combat).
   **Filtre retiré entièrement** — aucun signal fiable de substitution trouvé pour distinguer un vrai
   décor (rare, ex. "Rocher"/"Sac à patates" dans ce même fichier — mais ceux-ci avaient en réalité
   `obstacleId : -1`, contredisant encore l'hypothèse d'origine) : ces entités sans image ni monstre
   catalogué restent de toute façon neutralisées par le filtrage catalogue de `resolveFightImageInfo`
   et n'ont aucun autre effet néfaste observé.
2. **Une invocation (`isControlledByAI=true` systématiquement, y compris pour l'invocation d'un
   ALLIÉ) n'était donc pas non plus visible avant ce fix** (même filtre `obstacleId` que ci-dessus).
   Architecture retenue plutôt qu'une simple correction de classification allié/ennemi (demande
   explicite de l'utilisateur) : une invocation n'est **jamais** une ligne séparée du récap — ses
   dégâts/soins/armure DONNÉS sont réattribués à son invocateur, avec le nom de l'invocation comme
   libellé de "sort" (ex. l'Eniripsa "Anonyme-Eniripsa2" apparaît crédité d'un sort nommé "Supra Latino" plutôt
   que "Supra Latino" créditée d'un sort "Mot Ka..."). Les dégâts qu'une invocation ENCAISSE restent
   comptés normalement dans le total de l'ennemi qui les inflige.
   - Séquence log type : `"X lance le sort Y"` → `"X: Invoque un(e)/une créature du Z"` (`Z` **pas
     fiable** comme nom réel — le sort "Invocation" de l'Osamodas annonce une créature "du" thème
     invoqué, ex. "Invoque une créature du Gobgob", mais le combattant qui rejoint peut s'appeler
     "Chafer Elite") → ligne technique sans crochets `"(eXG:...) - Instanciation d'une nouvelle
invocation avec un id de N"` ou `"(eXM:...) - New summon with id N"` (comptage total DIFFÉRENT du
     nombre d'annonces "Invoque" sur ce fichier — glyphes/décor/transformations en produisent aussi —
     **volontairement pas exploitée** pour corréler, corrélation par id essayée puis abandonnée :
     l'écart entre les deux comptages cause de faux appariements) → `"[_FL_] ... Z ... join the
fight"`.
   - Corrélation retenue (`LogParser`, `FightParseState.pendingSummonCasters`/`summonOwners`, voir
     `SUMMON_ANNOUNCE_RE`) : chaque annonce "Invoque" empile son invocateur (+ horodatage) dans une
     file PAR COMBAT ; le PROCHAIN combattant au `fighterId` encore jamais vu de ce combat (voir
     `seenFighterIds` — crucial : une simple resynchronisation, très fréquente, ne doit jamais
     consommer la file) dépile cette file **à condition de survenir dans `SUMMON_JOIN_WINDOW_MS`
     (500ms) suivant l'annonce** — voir `SUMMON_JOIN_WINDOW_MS`. Hypothèse initiale FAUSSE, corrigée
     le 2026-08-24 après un 2ᵉ passage de bugs signalés par l'utilisateur : "un tout nouveau
     `fighterId` en cours de combat ne peut être qu'une invocation" ne tient pas — un combat long
     (boss à plusieurs phases type combat ultime, vague d'une brèche où des ennemis rejoignent au fil
     de l'eau, ou même un monstre qui invoque un autre monstre comme mécanique de jeu légitime) voit
     de VRAIS nouveaux combattants rejoindre en cours de combat sans rapport avec une invocation ;
     sans fenêtre, une annonce laissée en attente capturait à tort N'IMPORTE QUEL combattant suivant,
     même des dizaines de secondes/minutes plus tard (bug réel constaté : dans un combat ultime à
     plusieurs boss, TOUS les boss successifs finissaient classés comme des invocations d'un allié
     n'ayant invoqué qu'un simple familier des dizaines de secondes plus tôt — combat affiché avec 0
     ennemi). Fenêtre calibrée sur le fichier réel : les 186 annonces "Invoque" y sont TOUJOURS
     suivies de leur propre jointure en 0 à 8ms (log quasi synchrone), largement sous les 500ms
     retenus — et très en-dessous du moindre écart observé entre deux combattants réels distincts
     (secondes à minutes). Une annonce dont la fenêtre expire sans jointure est abandonnée (retirée de
     la file) plutôt que laissée bloquer indéfiniment toute jointure future sans rapport.
   - Une transformation (`"X: transformé(e) en Y !"`, ex. Poupée Lapino du Sadida qui évolue) ne
     réémet PAS d'annonce "Invoque" pour `Y` : `TRANSFORM_RE` propage directement `summonOwners.get(X)`
     vers `Y` avant que la ligne `_FL_` de `Y` n'arrive.
   - Une invocation homonyme d'un vrai ennemi PEUT coexister dans le MÊME combat (vérifié : donjon
     avec 2 "Chimère veilleuse" ennemies + 1 "Chimère veilleuse" invoquée par un Osamodas via le sort
     aléatoire "Invocation") — seule l'instance réellement invoquée (bon `fighterId`) porte
     `summonedBy`, les deux autres restent classées normalement. Limite acceptée (architecture
     name-only préexistante, voir `EntityClassifierService`) : l'affichage final (`classify(name)`)
     reste par NOM, pas par instance — un nom qui serait À LA FOIS invocation alliée dans un combat ET
     vrai ennemi dans un combat CONCURRENT (deux combats actifs en même temps, multi-compte) peut
     encore se tromper d'un côté ; non rencontré en pratique.
   - Réattribution effective dans `LogParser.resolveEffectTail` (dernière étape, commune
     dégâts/soins/armure) : si l'`attacker` résolu est un nom présent dans `state.summonOwners`,
     `spell = attacker` puis `attacker = summonOwners.get(attacker)`. Couvre tous les cas (sort propre
     de l'invocation, statut qu'elle porte/applique, riposte, passif auto) car c'est un unique point de
     sortie commun à `resolveEffectTail`.
   - Côté `StatsStoreService` (`FightWorking.summonNames`) : une invocation identifiée n'est jamais
     poussée dans `fight.enemies`/`fight.allies` ni dans `attackerMap` (`ensurePresent` s'y refuse
     explicitement) — sinon elle resterait une ligne fantôme à 0 dégât dans le récap malgré la
     réattribution. Reste dans `memberNames` (les dégâts qu'elle encaisse doivent compter pour
     l'ennemi qui frappe) et son camp est déterminé via `EntityClassifierService.registerSummonJoin`
     (`classify(casterName)`, PAS le flag `isControlledByAI` brut, toujours `true` pour une
     invocation). `registerFightDefeat` ignore aussi silencieusement les invocations (marqueurs
     "hors-combat" répétés d'une invocation qui meurt/se retransforme ne doivent jamais alimenter la
     watchlist "ennemis vaincus").

## Combats interrompus (client fermé en plein combat) et session HDV jamais refermée

Corrigé le 2026-09-16 (fichier utilisateur du 15/09 : « tous les combats d'hier sans butin » + un
entraînement sur mannequin affiché « en cours » depuis 12h). Deux causes indépendantes :

1. **`On annule l'occupation MARKET ... (fromServer=true, ...)`** — variante de fermeture de session
   HDV (interruption côté serveur : le joueur s'éloigne de la board/entre en combat) que
   `MARKET_OCCUPATION_END_RE` ne reconnaissait pas (seulement `On arrête`). `inMarketOccupation`
   restait armé 1h30, et TOUT le butin des 17 combats intermédiaires était rejeté comme achat HDV
   (`isPurchaseLoot`). L'utilisateur voyait « tous » ses combats sans butin parce que l'historique
   est plafonné à `MAX_FIGHT_HISTORY` (30) : les combats plus anciens, corrects, n'étaient plus
   affichés. Le flag est aussi remis à `false` sur tout `client-lifecycle` (voir ci-dessous) — un
   `Lancement de l'occupation MARKET` suivi d'une fermeture du jeu le laissait armé jusqu'au
   lendemain.
2. **Un combat actif à la fermeture du client n'a JAMAIS de `[FIGHT] End fight`** (`Stopping cFC...`,
   `Sending DisconnectionMessage ... {UI Closed}`) — cas typique du mannequin quitté en fermant le
   jeu (quitter par « abandonner » émet bien le `End fight`). Le combat fantôme restait le « seul
   combat actif » : `LogParser.resolveCurrentFightId` lui routait toute ligne sans nom, dont une
   vente HDV de 1 800 000 kamas le lendemain, créditée via `pendingFightKamas` au combat SUIVANT
   (Dark Wapin) et absente du total HDV (famille mannequin exclue des agrégats).
   - Architecture : `LogParser` émet `client-lifecycle` (`shutdown` = `Stopping cFC...`, `startup`
     = `Starting cFC...`, seul signal après un crash). `StatsStoreService` ne clôture RIEN sur le
     coup : les combats actifs deviennent `interruptionCandidates`, clôturés en résultat
     **`'interrupted'`** (`FightResult`, `fight.model.ts`) par la 1ʳᵉ de ces conditions — ligne du
     fichier ≥ 5 min après le marqueur (`INTERRUPTED_FIGHT_FILE_GRACE_MS` =
     `SESSION_SEGMENT_GAP_THRESHOLD_MS`, relecture d'historique), première jointure d'un NOUVEAU
     fightId, ou 2 min d'horloge murale après le dernier lot (`INTERRUPTED_FIGHT_LIVE_GRACE_MS`,
     direct : le client fermé n'écrit plus rien, aucune ligne « 5 min plus tard » ne viendra).
   - **Pourquoi différé et pas immédiat** : plusieurs clients (multi-compte) écrivent dans le MÊME
     `wakfu.log` (vérifié sur ce fichier : un client fermé à 22:07 pendant que l'autre continue ; on
     y voit même une ligne tronquée par l'entrelacement des écritures et des horodatages qui
     reculent de 10 min). Un candidat est **réhabilité** dès qu'une ligne prouve qu'il continue —
     UNIQUEMENT par identité (jointure `_FL_` de son fightId, ou dégât/soin/armure/sort/hors-combat
     d'un combattant de `memberNames`), JAMAIS par une ligne sans nom routée vers lui par le repli
     « seul combat actif » (butin, kamas, tour) : c'est ce repli qu'on cherche justement à
     neutraliser. Calibration : plus long silence intra-combat mesuré sur deux vrais fichiers = 60s.
   - `closeInterruptedFight` appelle `LogParser.closeFight(id)` (le parser doit oublier le combat en
     même temps que le store) et passe l'horodatage complet de fin (`endMs`, heure du marqueur) à
     `finalizeFight` plutôt qu'une heure `HH:MM:SS` : `buildFullTimestampMs` fait progresser la
     détection de passage de minuit, une heure « du passé » réinjectée hors ordre y déclencherait un
     faux passage de minuit décalant d'un jour tous les horodatages suivants.
   - Piège rencontré : `LogParser.parseLine` ne livre une ligne qu'à l'arrivée de la SUIVANTE
     (bufferisation multi-lignes) — le balayage par temps fichier doit donc tourner APRÈS `apply()`
     dans la boucle d'`ingest()`, sinon le marqueur d'arrêt n'est appliqué qu'après le balayage de
     la ligne qui aurait dû clôturer.
   - `'interrupted'` : jamais compté gagné/perdu, badge gris « Interrompu » avec tooltip
     (`damageMeter.interrupted*`), envoyé au compte avec `won: null` (colonne déjà nullable, aucune
     migration ; le serveur l'ignore des compteurs `won = true/false` et `HistoryArchiveService`
     le relit tel quel — plus jamais requalifié en victoire par défaut).
   - Vérifié en navigateur (Chrome réel via `playwright-core`, MCP figé sur Firefox) sur le fichier
     réel : plus aucun combat actif, mannequin clôturé à 22:07:02 (durée 2 min, bonne date),
     1 800 000 kamas dans les ventes HDV, combat Dark Wapin à 0 kama, compteurs gagnés/perdus
     inchangés (39/14), les 17 combats retrouvant 20 à 27 objets de butin chacun.
   - **Rattrapage en prod de l'historique du compte concerné** (même jour) : `fights` est immuable
     après insertion (`ON CONFLICT DO NOTHING`), une relecture du fichier par le client corrigé
     n'aurait jamais réparé les lignes existantes → rejeu manuel par un script de support
     (`replay-user-history.ts`, **retiré le 2026-09-21**, voir `docs/analyse-rgpd.md` §9 point 5 :
     il supposait de recevoir le `wakfu.log` complet de l'utilisateur, canal non décrit par la
     politique de confidentialité). Leçon à garder sans le script : un bug de parsing qui écrit
     des lignes fausses dans `fights` n'est PAS rattrapable par le client — d'où l'importance de
     la validation en navigateur sur fichier réel AVANT mise en production d'un changement du
     parseur ou du store.

## Ligne `[_FL_] ... join the fight` : signal de référence allié/ennemi

- Le log `[_FL_] fightId=... Nom breed : B [id] isControlledByAI=true/false obstacleId : O join the fight` (un par combattant, à chaque combat) est le signal le plus fiable pour classer allié/ennemi — plus fiable que l'heuristique par dégâts subis, dernier repli d'`EntityClassifierService` (la détection de classe par sorts lancés et la liste statique d'invocations alliées ont été retirées le 2026-09-21 : le `breed` de cette ligne suffit). **`obstacleId` ne dit RIEN sur la nature de l'entité** (voir la section Invocations ci-dessus : l'ancien filtre « `obstacleId != -1` = décor » était faux et supprimait la majorité des ennemis réels — ne jamais le réintroduire).

## Accès au fichier (File System Access) : gotchas navigateur

- **`File.size` est figé pour toujours** à la valeur captée au moment de la sélection (`<input type="file">` classique, aujourd'hui supprimé de l'app) — ne reflète JAMAIS la taille réelle sur le disque ensuite, et ne lève **aucune erreur** à la relecture (contrairement à `FileSystemFileHandle.getFile()` qui lève `NotReadableError` si le fichier a changé). C'est précisément pour cette raison que le sélecteur classique a été retiré entièrement : seule l'API File System Access (bouton = `showOpenFilePicker()`, glisser-déposer = `getAsFileSystemHandle()`) permet une vraie lecture continue.
- **`showOpenFilePicker()` (bouton/clic) est bloqué sous `%AppData%\Roaming`** (politique navigateur Chromium, `kBlockAllChildren` sur `DIR_ROAMING_APP_DATA`) — le dossier de logs Wakfu par défaut est dedans. **Mais le glisser-déposer (`DataTransfer.items[i].getAsFileSystemHandle()`) N'EST PAS bloqué** pour ce même dossier (confirmé par test réel de l'utilisateur, contredisant une hypothèse initiale plus large) — c'est la voie de secours à recommander quand le sélecteur échoue, pas un `<input type="file">` classique (supprimé, voir la puce précédente). Si `showOpenFilePicker` n'existe pas du tout sur le navigateur (`LogFileAccessService.isSupported()` → `false`), l'app affiche un message + la liste des navigateurs compatibles (`setup.component.html`, cas `'unsupported'`) plutôt qu'un fallback dégradé.
