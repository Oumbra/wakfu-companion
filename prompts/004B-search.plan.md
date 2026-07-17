### Contexte

Session de correction du tracker de combat, en plusieurs itérations à partir de retours utilisateur successifs sur des vrais logs de jeu (`C:\Users\Oumbra\AppData\Roaming\zaap\gamesLogs\wakfu\logs\`). Voir `004A-search.prompt.md` pour les prompts bruts. Aucun commit git n'a encore été fait pour ce travail — tout est en modifications de working tree (voir section "Pour reprendre sur un autre PC").

### 1. Migration `wakfu_chat.log` → `wakfu.log` + cycle de vie du combat

**Diagnostic** : `wakfu_chat.log` (chat uniquement) ne contient pas de marqueur fiable de fin de combat pour les entraînements contre un mannequin ("Sac à patates") — la ligne `Combat terminé, cliquez ici...` n'apparaît que pour les vrais combats avec écran de fin. Résultat : un entraînement en boucle fusionnait tous les rounds dans un seul "combat en cours" sans jamais rien historiser.

**Solution** : basculer sur `wakfu.log`, le log technique du client Java, qui encapsule les mêmes lignes de chat/combat dans une enveloppe `LEVEL HH:MM:SS,mmm [thread] (classe:ligne) - contenu`, et contient en plus des marqueurs techniques fiables :
- `CREATION DU COMBAT` → début de combat.
- `[FIGHT] End fight with id N` → fin de combat, émis systématiquement (y compris pour l'entraînement).

- `log-parser.ts` : nouveau `LOG_LINE_RE` pour désenvelopper le format technique, `FIGHT_END_RE`/`COMBAT_START_MARKER` comme déclencheurs prioritaires de `combat-end`/`combat-start` (remplace l'ancienne dépendance à la seule ligne chat "Combat terminé").
- `log-entry.model.ts` : nouveau type `CombatStartEntry`.
- `stats-store.service.ts` : gère `combat-start` avec un filet de sécurité (si un combat précédent n'a jamais été conclu, on le clôture avant de repartir à zéro, plutôt que de fusionner ses dégâts avec le nouveau combat).
- `log-file-access.service.ts` : n'accepte plus que le fichier nommé exactement `wakfu.log` (rejet explicite sinon, y compris pour un handle mémorisé avant la bascule).
- `setup.component.html`, `README.md` : mentions mises à jour.

### 2. Attribution des dégâts de statuts/passifs/effets indirects

Plusieurs mécanismes de "dégâts indirects" (tag entre parenthèses en fin de ligne `Cible: -N PV (Élément) (Tag)`) étaient tous attribués à `lastCast` (dernier lanceur de sort **direct**), ce qui est faux dès que ce dernier lanceur n'a aucun rapport avec la source réelle des dégâts. Trois familles identifiées, avec une cascade de résolution dans `log-parser.ts` :

1. **Effet à stacks avec ligne de statut** (`Enflammé`, `Hachure`, `Force sage`...) : suivi via `effectOwners` (`Map<effetName, {carrier, applier}>`), alimenté par les lignes `Personnage: EffetNom (Niv. N)` / `(+N Niv.)`. Un effet porté par un tiers (Enflammé, sur l'attaquant) crédite le porteur ; un effet posé sur la cible elle-même (Hachure, Force sage) crédite l'applicateur.
2. **Glyphe/zone posé une fois** (`Canine`...) : aucune ligne de statut, mais un vrai `X lance le sort Canine` bien plus tôt. Suivi via `spellCasters` (`Map<sortNom, dernierLanceur>`), qui persiste indéfiniment (pas juste le tour courant) tant que le combat n'est pas terminé.
3. **Riposte pure sans statut ni sort** (`Contre-attaque`...) : aucune des deux infos ci-dessus. Heuristique : si la cible actuelle correspond à l'attaquant du dégât **précédent** (`lastDamage`), l'attaquant devient la victime de ce coup précédent. Généralise à toute riposte du même type sans avoir à la nommer.

Le tag "mécanique" retenu est le dernier tag qui n'est ni un élément (`Neutre/Terre/Feu/Eau/Air/Lumière/Stasis`) ni `Parade !` (toujours ignoré, jamais une source).

Tout cet état (`effectOwners`, `spellCasters`, `lastDamage`, `lastCast`, `combatLostFlag`) est réinitialisé à chaque `combat-start`/`combat-end` (`resetFightState()`).

### 3. Personnages KO sans dégât + butin correctement rattaché

- **KO sans dégât** : `stats-store.service.ts` garantit désormais une ligne à 0 dégât dans `attackerMap` pour tout personnage recevant un `enemy-defeated` (pattern `X est KO !`), même s'il n'apparaît jamais comme attaquant.
- **Butin** : diagnostic confirmé sur `wakfu.log` — les lignes `Vous avez ramassé Nx Objet .` arrivent **avant** `Combat terminé`/`[FIGHT] End fight...`, pas après. L'ancienne logique (`lootTarget` rattaché seulement après conclusion du combat, réinitialisé au sort suivant) ratait donc systématiquement tout le butin. Remplacé par une accumulation continue (`currentFightLoot`) depuis `combat-start`, flushée dans `FightRecord.loot` à la conclusion (`concludeFight`), et réinitialisée à chaque nouveau `combat-start` (pour ne pas hériter du butin ramassé hors combat).

### Fichiers modifiés

- `src/app/core/models/log-entry.model.ts` (+ `CombatStartEntry`)
- `src/app/core/services/log-parser.ts` (réécriture complète : enveloppe technique, cycle de vie, cascade d'attribution des dégâts indirects)
- `src/app/core/services/stats-store.service.ts` (`combat-start`, KO à 0 dégât, `currentFightLoot`)
- `src/app/core/services/log-file-access.service.ts` (validation du nom de fichier accepté)
- `src/app/features/setup/setup.component.html`, `README.md` (texte UI/doc)

### Vérification effectuée

Pas de suite de tests dans le repo (`ng test` configuré mais aucun `*.spec.ts`). Validation faite en bundlant `log-parser.ts` et `stats-store.service.ts` avec `esbuild` (déjà présent dans `node_modules/.bin`) et en les exécutant directement sous Node contre le vrai fichier `wakfu.log` de l'utilisateur (`StatsStoreService` instancié à la main avec des stubs pour `LogFileAccessService`/`PersistenceService`/`EntityClassifierService`, en contournant l'injection Angular) :
- Combats correctement séparés (plus de fusion des rounds d'entraînement).
- Dégâts d'Enflammé/Hachure/Force sage/Canine/Contre-attaque tous correctement crédités au bon personnage, avec le nom d'effet comme libellé de sort distinct.
- Personnages KO sans dégât visibles à 0.
- Butin correctement rattaché à chaque combat conclu (quantités vérifiées).

`npx tsc --noEmit -p tsconfig.app.json` propre après chaque étape.

### Suites possibles (non demandées, notées pour mémoire)

- La classification allié/ennemi (`EntityClassifierService.classify`) se base sur les sorts castés ; un personnage KO sans avoir jamais rien casté peut retomber par défaut sur "ennemi" même si c'est un allié. Non corrigé (hors périmètre demandé).
- `prompts/next.md` liste déjà "le butin des combats, dans l'historique, soit correctement référencé" comme amélioration à venir — c'est fait par ce travail, à retirer de la liste si toujours pertinent.
- Les échantillons `assets/wakfu_chat.log*` (obsolètes, plus lisibles par le parseur) ont été remplacés par l'utilisateur par `test-logs/wakfu.log` + `wakfu.log.1` (nouveau format) pendant la session — aucune action de mon côté.

### Pour reprendre sur un autre PC

- **Rien n'est commité** : `git status` montre toutes les modifications ci-dessus en working tree. Pour les récupérer sur une autre machine, il faut d'abord les committer (et pousser) depuis celle-ci, ou copier le dossier de travail directement.
- **Sélection du fichier de log** : `LogFileAccessService` mémorise le handle du fichier choisi via IndexedDB (File System Access API), qui est **local au navigateur et à la machine**. Sur le nouveau PC, il faudra rouvrir l'app et resélectionner `wakfu.log` (le nouveau nom accepté) via le sélecteur.
- **⚠️ Sécurité** : le remote `origin` de ce repo contient un token GitHub en clair dans l'URL (`git remote -v`). À révoquer/régénérer et à reconfigurer (SSH ou credential helper) avant de pousser quoi que ce soit.
