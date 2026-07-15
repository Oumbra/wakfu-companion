### Contexte

Ma première implémentation du méter de dégâts groupait par "attaquant" et par "cible", faute de savoir distinguer alliés et ennemis dans le log (qui ne le précise jamais explicitement). L'utilisateur a demandé d'analyser le code source du site de référence ([Nexus-Hub/Wakfu-Companion](https://github.com/Nexus-Hub/Wakfu-Companion), `public/assets/js/modules/combat.js` + `public/assets/js/data/database.js` + `wakfu_monsters.js`) pour en extraire la vraie logique, et a fourni deux nouveaux logs d'exemple ([wakfu_chat.log.1](assets/wakfu_chat.log.1), [wakfu_chat.log.2](assets/wakfu_chat.log.2)) qui confirment que le split attaquant/cible ne suffit pas (un même personnage comme "Canis Furiosus" est tantôt attaquant, tantôt cible, selon le combat).

### Logique trouvée dans le site de référence (`isPlayerAlly`, `combat.js:494`)

Cascade de règles, dans cet ordre :
1. **Override manuel** (glisser-déposer utilisateur, `localStorage`) — priorité absolue
2. **Base de monstres officielle** (`wakfu_monsters.js`, nom exact) → Ennemi
3. **Familles d'ennemis génériques** (`wakfuEnemies`, sous-chaîne, ex. "Tofu", "Wabbit") → Ennemi
4. **Classe détectée** : dès qu'un nom lance un sort présent dans `classSpells` (base de sorts par classe) → Allié
5. **Invocations connues** (`allySummons`) → Allié
6. **Sinon** → Ennemi (repli par défaut)

Le glisser-déposer entre les listes ALLIÉS/ENNEMIS écrit directement dans `manualOverrides[nom] = 'ally'|'enemy'` (persisté), et déclenche un nouveau rendu.

J'ai vérifié avec les nouveaux logs que ça fonctionne : "Canis Furiosus" lance "Brise-os" et gagne des buffs "Art Canin" — tous deux réellement présents dans la base de sorts Ouginak extraite → classé Allié à raison. La base de monstres/sorts officielle ne connaît en revanche aucun des noms fictifs des logs de test (Cendragon, Troolk Hoogan, Zoroark Shiny...), donc pour CES logs de test précis, la plupart des ennemis retomberont sur le repli "Ennemi par défaut" plutôt que sur une correspondance exacte — attendu et accepté par l'utilisateur, qui a choisi la réplique complète pour que ça marche sur ses vraies parties.

### Décisions validées avec l'utilisateur
- **Détection auto** : réplique complète (vraie base de monstres + vraie base de sorts par classe), pas juste une détection par sorts allégée, pas de classification 100% manuelle.
- **Correction manuelle** : glisser-déposer entre deux colonnes Alliés/Ennemis (fidèle au site de référence), pas un simple bouton bascule.

### Données à extraire (déjà fait en sandbox, à committer sous forme de fichiers TS)
Seul le français nous intéresse (nos logs sont en FR) : extraction via un script Node (`vm` + capture des `const`) qui charge `database.js`/`wakfu_monsters.js` tels quels et n'en garde que le sous-ensemble FR utile — beaucoup plus léger que les fichiers sources (qui embarquent EN/ES/PT + icônes) :
- `WAKFU_MONSTER_NAMES_FR` : 828 noms de monstres FR uniques (~15-18 Ko)
- `WAKFU_CLASS_SPELLS_FR` : 18 classes → liste de sorts FR (~600 sorts, ~10 Ko)
- `WAKFU_ENEMY_FAMILIES` : 95 familles génériques (liste anglaise du site source, portée telle quelle — ne matchera qu'occasionnellement en FR, à documenter en commentaire comme limitation connue plutôt que de faire semblant que c'est fiable)
- `WAKFU_ALLY_SUMMONS` : 24 noms d'invocations alliées (idem, anglais, best-effort)

### Fichiers à créer/modifier
- **Nouveaux** `src/app/core/data/wakfu-monster-names.data.ts`, `wakfu-class-spells.data.ts`, `wakfu-enemy-families.data.ts`, `wakfu-ally-summons.data.ts` : les 4 constantes ci-dessus.
- **Nouveau** `src/app/core/services/entity-classifier.service.ts` : réplique `isPlayerAlly` en signals.
  - `registerSpellCast(caster, spell)` : ignore si `caster` est un nom de monstre connu (comme `detectClass` côté référence) ; sinon, si `spell` (normalisé : minuscule, sans apostrophe/tiret, pour tolérer "Brise'Os" vs "Brise-os") correspond à une classe → mémorise `detectedClasses.set(caster, classe)`. Map mutable interne, pas un signal (appelé potentiellement des milliers de fois lors de la lecture initiale du fichier).
  - `commit()` : à appeler une fois par lot de lignes traité (incrémente un signal `version` pour notifier les `computed()` consommateurs — mirroring le `publish()` par lot déjà en place dans `StatsStoreService`).
  - `classify(name): 'ally' | 'enemy'` : lit `version()` (dépendance réactive), puis applique la cascade ci-dessus (overrides → monstre exact → famille → classe détectée → invocation alliée → ennemi par défaut).
  - `setOverride(name, side)` : met à jour la Map d'overrides, persiste via `PersistenceService.setJson('wakfu-entity-overrides', ...)`, incrémente `version`.
  - Pas de `resetSession()` : comme la référence (`performReset()` ne vide pas `playerClasses`), les classes détectées et les overrides survivent à un `resetStats()` — seuls les compteurs de dégâts/kamas/xp sont remis à zéro.
- **`stats-store.service.ts`** : injecter `EntityClassifierService` ; dans `apply()`, `case 'spell-cast'` appelle désormais `this.classifier.registerSpellCast(entry.caster, entry.spell)` (au lieu d'un no-op) ; dans `ingest()`, appeler `this.classifier.commit()` après la boucle. Supprimer `targetMap`/`damageByTarget` (le split par cible n'est plus affiché — remplacé par le split Alliés/Ennemis, qui réutilise `damageByAttacker` déjà existant en le filtrant par `classify()`).
- **`damage-meter.component.ts` / `.html` / `.css`** : remplacer les onglets "Par personnage"/"Par ennemi" par deux sections empilées ALLIÉS/ENNEMIS (comme la capture d'écran fournie), chacune avec son total et sa barre de progression relative à son propre maximum. Chaque ligne `draggable="true"` ; chaque liste accepte le drop (`dragover`/`drop`) et appelle `classifier.setOverride(name, 'ally' | 'enemy')`. Réutilise les tokens CSS `--ally-header-bg` / `--enemy-header-bg` déjà présents dans `styles.css` (prévus dès la première itération mais jamais utilisés jusqu'ici).

### Vérification
- Ré-exécuter le test déjà utilisé pour l'itération 1 (injection de lignes via `window.ng.getComponent(...).logFileAccess.newLines$.next([...])` en `ng serve`) avec les nouveaux logs `.1`/`.2`, et vérifier que "Canis Furiosus" apparaît bien côté Alliés (grâce à "Brise-os"/"Art Canin" → Ouginak).
- Tester le glisser-déposer d'une ligne entre les deux colonnes et vérifier la persistance après un rechargement de page (localStorage `wakfu-entity-overrides`).
- Rebuild `npm run build:standalone` et vérifier que la taille du fichier reste raisonnable (~+30 Ko de données FR, pas +230 Ko).