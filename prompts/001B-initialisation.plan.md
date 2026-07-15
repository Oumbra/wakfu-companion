# Wakfu Companion — Application Angular locale de suivi de log

## Contexte

Le dépôt ne contient pour l'instant que le brief ([initialisation.prompt.md](assets/initialisation.prompt.md)) et un exemple réel de log ([wakfu_chat.log](assets/wakfu_chat.log), ~11 000 lignes). Le `.gitignore` est déjà pré-rempli avec des motifs Angular au niveau racine (`/dist/`, `/node_modules/`, `/.angular/`...), ce qui indique que le workspace Angular doit être généré **à la racine du dépôt**, pas dans un sous-dossier.

Objectif : une appli Angular 21 qui lit `wakfu_chat.log` en direct (glisser-déposer + reconnexion automatique) et affiche kamas, XP, dégâts, combats et chat, avec la charte graphique de https://wakfu-companion.nexuswow.workers.dev/. Livrable final : **un unique fichier HTML autonome** ouvrable en double-clic (`file://`), sans serveur.

### Décisions validées avec l'utilisateur
- **Lecture temps réel** : File System Access API (Chrome/Edge uniquement), avec mémorisation du handle et bouton "Reconnecter" — comme le site de référence. Pas de repli multi-navigateur.
- **Répartition des dégâts** : pas de classement allié/ennemi manuel. Vue "Par personnage" = groupé par lanceur du sort (attaquant, déduit de la ligne `X lance le sort Y` précédente). Vue "Par ennemi" = groupé par la cible qui perd des PV.
- **Filtre du chat** : masque les messages qui ne correspondent pas à la saisie (filtre classique, pas juste une mise en évidence).

## Format du log (analysé sur l'échantillon réel)

Chaque ligne : `HH:MM:SS,mmm - [Catégorie] Reste`

- **Canaux de chat** (affichés dans le panneau Chat) : `Proximité`, `Guilde`, `Commerce`, `Recrutement (FR)` → « Recrutement », `Communauté (FR)` → « Communauté », `Groupe` (non observé dans l'échantillon mais prévu). Contenu : `Auteur : message`.
- **`Information (jeu)`** :
  - `Vous avez gagné N kamas.` → kamas gagnés
  - `Vous avez perdu N kamas.` → kamas perdus/dépensés (le log ne distingue pas "perdu" de "dépensé" : un seul compteur cumulé)
  - `Vous avez perdu NxNomObjet .` → perte d'objet, **hors périmètre** (pas des kamas)
- **`Information (combat)`** :
  - `Nom : +N points d'XP.  Prochain niveau dans : ...` → XP gagnée par personnage
  - `X lance le sort Y` (éventuellement suivi de `(Critiques)`) → ouvre le contexte "attaquant courant" utilisé pour attribuer les dégâts suivants
  - `Nom: -N PV (Élément) (...)` → dégâts subis par `Nom` ; le 1er mot d'élément reconnu entre parenthèses (`Neutre, Terre, Feu, Eau, Air, Lumière, Stasis`) est retenu
  - `Nom est KO !` → mort d'une entité, utilisé pour le compteur d'ennemis suivis
  - `Vous avez été vaincu(e) !` → marque le combat courant comme perdu
  - `Combat terminé, cliquez ici pour rouvrir l'écran de fin de combat.` → clôture un combat : incrémente **gagné** ou **perdu** selon la marque ci-dessus, puis réinitialise le drapeau

Ces règles couvrent exactement les 9 fonctionnalités demandées, sans complexité additionnelle (pas de méters soin/armure, pas de classification allié/ennemi manuelle).

## Charte graphique extraite du site de référence

Variables CSS relevées (`assets/css/style.css` du site) à reprendre à l'identique :
```
--bg-color:#121212; --panel-bg:#1e1e1e; --text-color:#e0e0e0; --accent:#00d2ff;
--border:#333; --btn-active-green:#2ecc71; --btn-active-red:#e74c3c;
--ally-header-bg:#1a3a4a; --enemy-header-bg:#4a1a1a;
```
Police `"Segoe UI", Tahoma, Geneva, Verdana, sans-serif`. Panneaux = cartes arrondies (`border-radius:8px`) avec header `#2a2a2a`. Boutons `height:28px; border-radius:4px; font-weight:600`, variante `.toggle-btn.active` (fond cyan 15%, bordure cyan). Messages de chat : fond `#252525`, `border-left:3px solid #444`, kamas en or `rgb(255,215,0)`, XP/loot en rouge `#ff4d4d`. Couleurs d'éléments de dégâts : feu `#e9782d`, air `#d69dfc`, terre `#1b8045`, eau `#00e1ff`, lumière `#ffd700`, stasis `#cf9fff`. Ces valeurs seront reprises telles quelles dans `styles.css` global de l'app.

## Architecture Angular

Scaffold à la racine (`ng new` dans un dossier temporaire puis fusion avec les fichiers existants — `assets/`, `prompts/`, `README.md`, `.gitignore` fusionné). Angular 21.2.x, standalone (par défaut), signals, **zoneless**, sans routing (une seule vue), sans SSR, style CSS brut.

```
src/app/
  core/
    models/log-entry.model.ts        // types des événements parsés
    services/
      log-file-access.service.ts     // File System Access API + IndexedDB handle + polling tail
      log-parser.ts                  // classe stateful: parseLine(raw) -> LogEntry | null
      stats-store.service.ts         // signals: kamas, xp, dégâts, combats, chat, watchlist
      persistence.service.ts         // localStorage (watchlist, préférences) + IndexedDB (handle)
  features/
    setup/                           // écran glisser-déposer / reconnexion
    dashboard/                       // grille de panneaux principale
    stats-summary/                   // kamas, xp, combats gagnés/perdus
    damage-meter/                    // tabs "Par personnage" / "Par ennemi", lignes dépliables par sort
    enemy-tracker/                   // champ d'ajout de nom + compteurs
    chat-panel/                      // toggles de canaux + filtre + liste colorée
  app.ts / app.config.ts
styles.css                           // variables + composants partagés (panel, button, chat-msg...)
```

### Points techniques clés
- **`log-file-access.service.ts`** : `showOpenFilePicker` (ou `DataTransferItem.getAsFileSystemHandle()` pour le drag&drop), handle stocké en IndexedDB (structured clone natif), `queryPermission`/`requestPermission` au démarrage → si non accordé, écran "Reconnecter" (bouton, geste utilisateur requis). Poll toutes les ~1s : `handle.getFile()`, lecture incrémentale via `file.slice(lastOffset)` + `TextDecoder('utf-8')`, découpage en lignes complètes (on garde la ligne partielle en tampon), gestion de la troncature (taille < offset ⇒ relecture depuis 0, cas de rotation du log). Au premier branchement : lecture complète du fichier existant pour initialiser les statistiques, puis relais en direct.
- **`log-parser.ts`** : instance à état (dernier sort lancé, drapeau combat perdu) alimentée ligne par ligne, retourne des `LogEntry` typés consommés par le store.
- **`stats-store.service.ts`** : agrège en signals ; watchlist d'ennemis et préférences persistées en `localStorage`.
- **Build fichier unique** : configuration Angular dédiée (`outputHashing: none`), script Node (`tools/build-standalone.mjs`) qui prend `dist/browser/index.html` + `main.js`/`polyfills.js`/`styles.css` et les inline directement dans le HTML (`<style>`, `<script type="module">`), écrit un fichier unique `wakfu-companion.standalone.html` à la racine. Comme l'app n'a ni routing ni lazy-loading, un seul bundle JS est attendu ; à vérifier après le premier build (si plusieurs chunks apparaissent, adapter le script pour tous les inliner dans l'ordre).

## Étapes d'implémentation
1. Scaffold Angular 21 (root), configuration zoneless/standalone/no-routing/CSS, fusion avec les fichiers existants, mise à jour du `.gitignore` si besoin.
2. Modèles + `log-parser.ts` (logique pure, la plus facile à valider directement contre `assets/wakfu_chat.log`).
3. `log-file-access.service.ts` (File System Access API + IndexedDB + polling).
4. `stats-store.service.ts` + `persistence.service.ts`.
5. UI : écran setup (drop zone + reconnexion), dashboard, les 4 panneaux (résumé stats, dégâts, chat, suivi d'ennemis), styles globaux fidèles à la charte.
6. Script de build standalone + test d'ouverture directe du fichier HTML généré en `file://`.
7. Vérification bout en bout (voir ci-dessous).

## Vérification
- `ng serve` : glisser `assets/wakfu_chat.log` (copié dans un dossier de test), vérifier that les stats initiales se remplissent (kamas, XP, dégâts, combats gagnés/perdus comptés correctement sur l'échantillon connu), et que le chat s'affiche par canal avec filtre fonctionnel.
- Simuler l'ajout de lignes en direct (script qui `>>` de nouvelles lignes dans une copie du log pendant que l'app tourne) pour valider la lecture incrémentale et le compteur d'ennemis vaincus.
- `npm run build:standalone`, puis ouvrir le HTML généré directement dans Chrome via `file://` : reprendre le même scénario de bout en bout (glisser-déposer, reconnexion après rechargement de la page).