### Contexte
Six améliorations demandées après retour utilisateur sur l'itération 2 : renommage/icône du panneau Dommage, réordonnancement du dashboard, passage du résumé de session en modal déplaçable (masqué par défaut), extension du suivi aux ressources/objets, ajout d'un historique des combats consultable, et icônes (classe pour les alliés, monstre pour les ennemis) devant chaque ligne.

### Décision sur les images d'ennemis (confirmée avec l'utilisateur)
La vraie base d'images de monstres du site de référence pèse 43 Mo (1494 fichiers) — impossible à embarquer dans le fichier standalone. L'utilisateur a demandé de récupérer l'ensemble des images avec le même système d'identification (par `imgId`) et de les charger de façon "semi-standalone".
**Approche retenue** : construire une table `nom FR → imgId` (légère, texte seulement, comme la base de noms de monstres). Au rendu, l'image d'un ennemi reconnu est chargée en direct depuis `https://raw.githubusercontent.com/Nexus-Hub/Wakfu-Companion/master/public/assets/img/monsters/{imgId}` via une balise `<img>` avec repli automatique (`(error)`) sur une icône générique embarquée en base64 (`not_found.png`, ~15 Ko) si le monstre est inconnu ou hors-ligne. Les icônes de classe pour les alliés (18 classes, ~88 Ko au total) sont en revanche embarquées directement en base64 dans le bundle (toujours disponibles hors-ligne, poids raisonnable). Le fichier reste donc **standalone pour tout son fonctionnement** ; seule l'illustration précise d'un ennemi reconnu nécessite une connexion (repli propre sinon) — c'est le sens du "semi-standalone" demandé, obtenu via `<img>` + repli plutôt qu'un système SVG dédié (fonctionnellement équivalent, plus simple et plus robuste que du texte SVG fait main).

### 1. Renommage + icône "Dommage"
Panneau `damage-meter` : le libellé "Dégâts infligés" devient "Dommage", précédé de l'icône épée (`headers/damage.png`, 824 o, embarquée en base64).

### 2. Réordonnancement du dashboard
`dashboard.component.html` : ordre `<app-damage-meter /> <app-tracker /> <app-chat-panel />` (Chat passe en dernier, à droite).

### 3. Résumé de session → modal "Session Recap"
- Nouveau composant `features/session-recap/session-recap.component.ts` : fenêtre flottante (`position: fixed`), **sans overlay de fond**, déplaçable via son en-tête (mousedown/mousemove/mouseup sur le handle, même mécanique que `makeDraggable` du site de référence — pas besoin d'Angular CDK, quelques lignes suffisent). Masquée par défaut (`visible = signal(false)`), ouverte via un bouton "Session recap" ajouté dans l'en-tête de l'app (`app.html`, à côté de "Réinitialiser"), accessible via une variable de référence de template (`#sessionRecap` + `(click)="sessionRecap.open()"`).
- Contenu : durée de la session (chrono qui tourne uniquement pendant que la modal est ouverte, `setInterval` local au composant), kamas nets en évidence avec le détail gagné/dépensé affiché **au survol** (`:hover`, pas de JS nécessaire), XP par personnage (reprend l'affichage actuel de `stats-summary`), nombre de combats gagnés/perdus.
- Suppression de `features/stats-summary/` (entièrement remplacé par cette modal, plus affiché en permanence dans le dashboard).
- `StatsStoreService` : ajout de `sessionStartedAt = signal<number | null>(null)`, initialisé au premier lot de lignes ingéré ; remis à `Date.now()` par `resetStats()`.

### 4. "Suivi d'ennemis" → "Suivi" (ennemis + ressources)
- Renommage du dossier `features/enemy-tracker/` → `features/tracker/`. Le panneau affiche désormais deux listes empilées dans la même carte : "Ennemis vaincus" (mécanique existante inchangée) et "Ressources obtenues" (même mécanique : champ + bouton Ajouter + liste + compteur, mais alimentée par les objets ramassés).
- Nouveau : le log contient bien une ligne dédiée au butin — `Vous avez ramassé Nx NomObjet .` dans `[Information (jeu)]` (confirmé dans `assets/wakfu_chat.log`, ligne 793 et suivantes). Ajout d'un type `LootEntry` dans `log-entry.model.ts` et d'un pattern `RAMASSE_RE` dans `log-parser.ts` (même famille que `KAMA_GAIN_RE`).
- `StatsStoreService` : renommage de l'interface `WatchedEnemy` → `WatchlistEntry` (réutilisée pour les deux listes), ajout de `itemWatchlist` + `addWatchedItem`/`removeWatchedItem` + `registerLoot(item, qty)` (même schéma que `registerDefeat`).

### 5. Onglet "Historique" dans "Dommage" + réinitialisation par combat
Actuellement, le méter de dégâts accumule pour toute la session jusqu'au clic sur "Réinitialiser". Pour qu'un "Historique" ait un sens (un combat = une entrée séparée), le méter **doit se figer et se réinitialiser automatiquement à chaque `combat-end`** : c'est le comportement le plus cohérent avec la demande ("l'ensemble des combats... séparés les uns des autres") et c'est ce que fait le site de référence par défaut (Auto Reset). Les stats de session (kamas/xp/combats, dans la modal) restent elles cumulatives sur toute la session.
- `StatsStoreService` : à chaque `combat-end`, construire les `EntityDamageRow[]` du combat qui vient de se terminer (déjà calculable via `buildEntityDamageRows`), les pousser dans un nouvel historique `fightHistory` (signal, plafonné à 30 entrées, le plus récent en premier), puis vider la map de dégâts courante. Le butin (`loot`) est attaché après-coup : les lignes "ramassé" arrivent juste APRÈS la ligne de fin de combat dans le log (confirmé sur l'échantillon) ; elles sont donc accumulées dans le combat qui vient de se terminer tant qu'aucun nouveau sort n'a encore été lancé (uniquement si victoire, sinon `loot: []`).
- Nouveau composant partagé `entity-damage-list.component.ts` (dans `features/damage-meter/`) : factorise le rendu d'une liste d'entités dépliables avec détail par sort (utilisé pour Alliés ET Ennemis, à la fois pour le combat en cours ET pour chaque entrée d'historique — 4+ usages, la factorisation est justifiée). Prend `rows`, `side`, et un flag `interactive` (glisser-déposer actif uniquement pour le combat en cours, pas pour l'historique en lecture seule).
- `damage-meter.component.ts/.html` : deux onglets "Combat en cours" / "Historique" (réutilise le style `.tab-header`/`.meter-tab`). L'onglet Historique liste les combats (badge Victoire/Défaite coloré + heure), chaque ligne cliquable se déplie pour révéler les deux `<app-entity-damage-list>` (Personnages/Ennemis) + une section "Butin" (uniquement si victoire).
- `resetStats()` vide aussi `fightHistory`.

### 6. Icônes par ligne (alliés = classe, ennemis = monstre + repli)
- Nouvelles données : `src/app/core/data/class-icons.data.ts` (18 icônes de classe + icône générique `not_found.png`, base64), `src/app/core/data/wakfu-monster-images.data.ts` (`Record<nom FR, imgId>`, ré-extrait de `wakfu_monsters.js` en gardant `imgId` cette fois).
- `EntityClassifierService` : exposer `getDetectedClass(name): string | undefined` (déjà stocké en interne, juste besoin d'un accesseur public).
- Nouveau composant `shared/entity-icon/entity-icon.component.ts` : `input()` `name`/`side` ; si allié → icône de la classe détectée (repli générique si classe inconnue) ; si ennemi → `<img>` externe via `imgId` si le nom correspond exactement à la base, avec `(error)` de repli sur l'icône générique (voir décision ci-dessus). Utilisé dans `entity-damage-list.component.ts` devant chaque nom.

### Fichiers principaux à créer/modifier
- **Modèles** : `log-entry.model.ts` (+ `LootEntry`)
- **Services** : `log-parser.ts` (+ `RAMASSE_RE`), `stats-store.service.ts` (fight history, item watchlist, session start), `entity-classifier.service.ts` (+ `getDetectedClass`)
- **Données** : `class-icons.data.ts`, `wakfu-monster-images.data.ts` (nouveaux)
- **Composants nouveaux** : `features/session-recap/`, `features/damage-meter/entity-damage-list.component.ts`, `shared/entity-icon/`
- **Composants renommés/réécrits** : `features/enemy-tracker/` → `features/tracker/`, `damage-meter.component.*` (onglets + icônes), `dashboard.component.html` (ordre), `app.html`/`app.ts` (bouton Session recap)
- **Supprimé** : `features/stats-summary/`

### Vérification
- `ng serve` + injection de lignes synthétiques couvrant : plusieurs combats successifs (victoire puis défaite), avec lignes "ramassé" après la victoire → vérifier que l'Historique affiche bien 2 entrées séparées avec le bon statut, que le butin n'apparaît que sur la victoire, et que le combat en cours repart à zéro après chaque fin de combat.
- Vérifier l'icône de classe sur un allié détecté (Ouginak via "Brise'Os", comme à l'itération 2) et le repli générique sur un ennemi fictif (Cendragon, absent de la vraie base).
- Ouvrir "Session recap", vérifier le chrono qui tourne, le survol des kamas nets, et le glisser de la fenêtre (sans overlay, reste déplaçable par-dessus le dashboard).
- Rebuild `npm run build:standalone`, vérifier la taille finale (~400-450 Ko attendus) et que les icônes de classe s'affichent bien hors-ligne (fichier ouvert sans serveur).