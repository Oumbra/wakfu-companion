---
name: verify-wakfu-companion
description: Vérifier un changement dans Wakfu Companion (Angular) dans un vrai Chrome piloté par Playwright — état applicatif simulé via les signaux Angular (lignes de log synthétiques sur `newLines$`, import du jeu de données profil, données factices), inspection DOM/CSSOM réelle. À utiliser AVANT de déclarer terminée toute tâche à effet visuel ou comportemental (CSS, layout, interaction, nouveau composant, tooltip, scroll, parsing de log, store de stats, tracker, profil, alertes sonores) — jamais se contenter d'une relecture du code.
---

# Vérifier un changement dans Wakfu Companion via le navigateur

Cette app n'a pas de tests automatisés significatifs sur le parsing de log : la vérification passe systématiquement par le navigateur de prévisualisation, en simulant la sélection du fichier `wakfu.log` (pas besoin d'un vrai fichier sur disque, ni de lancer le jeu). La confiance « ça devrait marcher d'après le CSS » a produit plusieurs faux positifs dans l'historique du projet (z-index du header, clipping de grille CSS, tooltip natif invisible) : inspecter le DOM/CSSOM réel (`getComputedStyle`, `getBoundingClientRect`, `elementFromPoint`, `scrollWidth`/`clientWidth`) plutôt que deviner, surtout pour tout ce qui touche au _stacking context_ ou au débordement.

Écrire les scripts de vérification dans le dossier scratchpad de la session (jamais dans le repo), et les supprimer une fois la vérification terminée.

## Démarrer

```
preview_start { name: "wakfu-companion-dev" }
navigate { url: "http://localhost:4200" }
```

Si le port 4200 est déjà occupé par un `node.exe` non suivi par l'outil (arrive après une session longue), vérifier la commande du process (`Get-CimInstance Win32_Process -Filter "ProcessId=X"`) puis le tuer si c'est bien un `ng serve` du même projet, avant de relancer `preview_start`.

## ⚠️ Vérifier le navigateur RÉELLEMENT piloté avant toute conclusion

**Consigne permanente de l'utilisateur : n'utiliser QUE le serveur MCP Playwright, avec Chrome.**
Dans le terminal de l'utilisateur, c'est SON Chrome réel (`C:\Program Files\Google\Chrome\Application\chrome.exe`)
qui doit être piloté — jamais un autre navigateur ni un repli `playwright-core` par confort. Ce repli
(voir plus bas) ne se justifie que lorsque le processus MCP de la session est démontrablement figé sur
un autre navigateur (vérifié via `navigator.userAgent`, jamais supposé) ; dans ce cas il pointe lui
aussi sur le même Chrome réel, donc reste conforme à la consigne.

L'app dépend de l'API File System Access (voir plus bas), absente de Firefox — tout ce qui touche
réellement `LogFileAccessService`/le sélecteur de fichier n'a de sens QUE sous Chrome/Chromium.
Piège vécu deux fois (2026-08-25 et 2026-08-26, la seconde fois découvert par l'utilisateur via des
captures d'écran montrant une fenêtre Firefox Nightly après qu'une session a affirmé à tort
« Chrome confirmé ») : **`claude mcp get playwright` ne prouve RIEN sur le navigateur réellement en
cours d'exécution.** Cette commande lit la config déclarée, pas le processus MCP déjà lancé pour
CETTE session — le choix de navigateur est figé au démarrage du processus et ne se recharge jamais
à chaud (`claude mcp remove`/`add` avec un autre `--browser` ne prend effet qu'à la **prochaine**
session), donc `Args: ... --browser chrome` peut s'afficher pendant qu'un Firefox tourne réellement
depuis le début.

**Seule vérification fiable, à faire systématiquement juste après `navigate`, avant tout test FSA :**
```js
navigator.userAgent // doit contenir "Chrome", jamais "Firefox"/"Gecko"
```
Si ça renvoie Firefox alors que Chrome est nécessaire MAINTENANT (pas seulement à la prochaine
session) : ne pas insister via l'outil MCP, lancer un vrai Chrome indépendant avec `playwright-core`
(déjà présent après un premier `npm install playwright-core` dans le répertoire scratchpad) :
```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
});
```
### Chrome absent (repli uniquement, ex. un sandbox Linux sans Chrome installé)

si `mcp__playwright__browser_navigate` échoue avec `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`, et que `npx playwright install chrome` échoue aussi (sudo indisponible), une vraie installation Chrome n'est pas récupérable dans cet environnement précis — mais ça reste une exception d'environnement, pas la référence : sur une machine où Chrome est installé (ex. ce dépôt cloné sous Windows, `C:\Program Files\Google\Chrome\Application\chrome.exe`), toujours reconfigurer le serveur MCP sur `--browser chrome` plutôt que de rester sur Firefox par défaut. Solution de repli qui fonctionne sans sudo quand Chrome est vraiment absent : installer Firefox via Playwright (`npx playwright install firefox`, ne nécessite pas de droits root) puis piloter le navigateur directement avec le paquet `playwright-core` (déjà présent après un premier `npm install playwright-core` dans le répertoire scratchpad) en pointant l'exécutable :

```js
const { firefox } = require('playwright-core');
const browser = await firefox.launch({
  executablePath: '/home/deck/.cache/ms-playwright/firefox-XXXX/firefox/firefox', // adapter le numéro de version présent sous ~/.cache/ms-playwright
});
```

## Simuler une connexion au fichier de log

Le sélecteur classique (`<input type="file">`) a été supprimé : l'app n'utilise plus que l'API File System Access (bouton/clic sur la zone de dépôt = `showOpenFilePicker()`, bloqué sous `%AppData%\Roaming` ; glisser-déposer = `getAsFileSystemHandle()`, non bloqué — voir `.claude/rules/log-ingestion.md`, section « Accès au fichier »). Aucune des deux ne s'injecte facilement depuis la console : un vrai `FileSystemFileHandle`/`File` lié au disque ne peut pas être reproduit par un objet créé en mémoire (impossible à automatiser via CDP) — pour tester un comportement de péremption/permission FSA, s'appuyer sur le comportement documenté du navigateur plutôt que sur un test automatisé.

Le plus simple pour tester le pipeline de parsing/store sans passer par le File System Access API : récupérer l'instance de `LogFileAccessService` déjà injectée dans `app-root` (`protected readonly logFileAccess`, lisible en JS runtime via `ng.getComponent` malgré `protected`/`private` — TypeScript n'efface pas ces propriétés à l'exécution) et pousser directement des lignes synthétiques sur son `newLines$` — c'est exactement ce que `processFile()` fait en interne après lecture du fichier, donc ça déclenche le même pipeline (`StatsStoreService` y est abonné) :

```js
(function(){
  const root = ng.getComponent(document.querySelector('app-root'));
  root.logFileAccess.newLines$.next({
    lines: ['INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez gagné 42 kamas.'],
    isInitialLoad: true,
  });
  return 'dispatched';
})();
```

Vérifié (2026-07-18) : après ce dispatch, `root.stats.kamasEarned()` vaut bien `42` (`stats` est le `StatsStoreService` injecté dans `app-root`, accessible pour la même raison). Ceci ne fait PAS passer `logFileAccess.status()` à `'connected'` (l'écran affiché reste celui piloté par le statut réel), donc pour vérifier un rendu visuel dans le dashboard il faut aussi `root.logFileAccess.status.set('connected')`.

**Format des lignes de log** (`LOG_LINE_RE` dans `log-parser.ts`) :
```
INFO HH:MM:SS,mmm [thread] (classe:ligne) - contenu
```
Contenus utiles pour construire un scénario de test :
- Combat : `CREATION DU COMBAT` (démarrage) puis `[FIGHT] End fight with id N` (fin, id quelconque)
- KO : `[Information (combat)] Nom est KO !`
- Dégâts : `[Information (combat)] Cible: -1234 PV (Élément)`
- Butin : `[Information (jeu)] Vous avez ramassé 3x Nom de l'objet.`
- Kamas : `[Information (jeu)] Vous avez gagné 10 kamas.`
- Rejointe combattant (allié/ennemi) : `[_FL_] fightId=1 Nom breed : 9 [12345] isControlledByAI=false obstacleId : -1 join the fight at {Point3 : (0,0,0)}` — `isControlledByAI=false` = joueur réel, `=true` = IA/monstre (y compris l'invocation d'un allié). `obstacleId` ne dit RIEN sur la nature de l'entité (l'ancien filtre « `!= -1` = décor » était faux, voir `.claude/rules/log-ingestion.md`).

## Jeu de données réaliste pour la page profil (comptes/personnages/watchlist...)

`tests/wakfu-companion-export.json` (fourni par l'utilisateur, à conserver) — un export réel de l'app (profil, watchlist, roster de comptes/personnages...). À utiliser via le vrai système d'import de l'app plutôt qu'en reconstituant des données à la main, dès qu'un test touche à la page profil/roster :

```js
// 1. Se placer sur la page profil (le rail "Personnages" n'existe qu'une fois `fileConnectedGuard`
//    satisfait — voir app.routes.ts — donc simuler `status: 'connected'` avant de naviguer) :
const root = ng.getComponent(document.querySelector('app-root'));
root.logFileAccess.status.set('connected');
root.nav.openProfile();
// 2. Basculer sur l'onglet "Personnages" (bouton du rail, texte traduit selon la langue) :
document.querySelectorAll('.profile-rail-btn')
  .find(b => b.textContent.toLowerCase().includes('personnage'))?.click();
// 3. Importer via le VRAI <input type="file"> (accept="application/json", voir
//    profile-page.component.html) — fonctionne même sans FSA, Playwright peut lui assigner un
//    fichier directement :
// (côté Playwright, pas dans la page) await page.locator('input[type="file"]').setInputFiles(
//   '/chemin/vers/wakfu-companion-export.json'
// );
```

⚠️ **`onImportFileSelected` fait `window.location.reload()` après un import réussi** (réinitialise proprement tout l'état applicatif depuis les nouvelles données, voir le composant) — attendre `page.waitForLoadState('load')` puis **refaire les étapes 1-2** (le rechargement repart de zéro, `status`/`nav` ne sont plus `'connected'`/sur la page profil).

Pour tester un cas de débordement (ex. très nombreux comptes/personnages, qu'aucun jeu de données réel n'atteint confortablement) plutôt que de gonfler le JSON à la main, injecter directement dans `CharacterRosterService` après import (mêmes services accessibles via `ng.getComponent(document.querySelector('app-profile-page'))`) :
```js
const comp = ng.getComponent(document.querySelector('app-profile-page'));
comp.roster.accounts.set([{ id: 'fake', label: 'Compte test', gameServer: null, characters: [...] }]);
```

⚠️ **Piège : plusieurs `.app-page-body`/`.profile-rail` coexistent dans le DOM** (un jeu par vue `AppPageComponent`, la vue `main`/dashboard ET la vue `profile` sont toutes deux montées via `@defer` dans `app.html`) — `document.querySelector('.app-page-body')` peut renvoyer celui de la MAUVAISE vue (silencieusement, sans erreur : juste un élément qui ne scrolle jamais quand on agit dessus). Toujours scoper la recherche à la vue active, ex. `document.querySelector('app-profile-page .app-page-body')` ou `[...document.querySelectorAll(...)].find(el => el.closest('app-profile-page'))`.

⚠️ **Piège CSS proche, à ne pas confondre avec le précédent** : `Element.closest()` cherche parmi les ANCÊTRES (et l'élément lui-même), jamais les descendants. Un composant dont le template englobe entièrement un autre composant partagé (ex. `<app-profile-page>` qui contient `<app-page>`, lequel rend `.app-page-body` plus bas dans SON PROPRE template) a cet élément comme **descendant**, pas ancêtre, dans le DOM final — `hostEl.nativeElement.closest('.app-page-body')` échoue toujours (retourne `null`) dans ce sens-là ; c'est `querySelector('.app-page-body')` (recherche descendante) qu'il faut utiliser depuis le composant hôte. Confondu une fois en session (`ProfilePageComponent` cherchant son propre `.app-page-body` pour y poser un `ResizeObserver` — voir le piège « mesurer dans un `effect()` » dans `.claude/rules/ui-conventions.md`).

## ⚠️ Piège n°1 : lectures incrémentales (simuler un nouveau lot de lignes)

`LogFileAccessService` compare `file.size` à un `lastOffset` interne. Pour simuler "de nouvelles lignes arrivent" sur une connexion déjà active, il faut renvoyer un fichier contenant **tout le contenu déjà envoyé + les nouvelles lignes** (pas juste les nouvelles) :

```js
// 2e dispatch : reprend les lignes du 1er dispatch, en ajoute une nouvelle
const lines = [
  'INFO 12:00:00,000 [thread] (a:1) - [Information (jeu)] Vous avez gagné 1 kamas.', // déjà envoyée
  "INFO 12:00:05,000 [thread] (a:1) - [Information (jeu)] Vous avez ramassé 1x Pierre d'aventure.", // nouvelle
  '',
].join('\n');
```

Si le nouveau fichier est **plus court** que le précédent, le service croit à une troncature/rotation de log et repart de zéro (relit tout comme `isInitialLoad`) — utile pour tester exprès ce cas, gênant sinon.

## ⚠️ Piège n°2 : tester une VRAIE nouvelle connexion (isInitialLoad)

Pour tester le comportement "premier chargement" (gating watchlist, reset de l'historique, etc.), il faut repartir d'une connexion fraîche, pas juste renvoyer un gros fichier. Cliquer d'abord sur "Changer de fichier" (icône ⇄, chercher le bouton par son `title` car il est traduit dans 4 langues) :

```js
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => b.title && (b.title.includes('Changer') || b.title.includes('Trocar') || b.title.toLowerCase().includes('change') || b.title.includes('Cambiar')));
if (btn) btn.click();
await new Promise(r => setTimeout(r, 200)); // laisser l'UI revenir à l'écran de sélection
// puis dispatcher le fichier complet comme un premier chargement
```

## ⚠️ Piège n°3 : lecture juste après une mutation, dans le même appel

Un `click()`/`.set()` suivi d'une lecture (`getComputedStyle`, signal, `textContent`) **dans le même appel `javascript_tool`** peut renvoyer un état périmé (Angular pas encore flush). Deux solutions :
- `ng.applyChanges(element)` juste après la mutation (marche pour la plupart des composants, pas pour `app-root` — throw `ASSERTION ERROR`, cibler un composant enfant à la place) ;
- ou séparer mutation et lecture en deux appels `javascript_tool` distincts (le plus fiable).

Pour accéder à un composant/service depuis la console :
```js
const comp = ng.getComponent(document.querySelector('app-tracker')); // ou app-root, app-profile-page...
comp.stats.fightHistory(); // signaux exposés en `protected` restent lisibles en JS runtime
```

## ⚠️ Piège n°4 : limites de l'outil `computer` (screenshot)

`computer { action: "screenshot" }` et `zoom` **timeout systématiquement** dans cet environnement, quelle que soit la page. Ne pas insister — tout vérifier via `javascript_tool`/`read_page`/`getComputedStyle`/`elementFromPoint`. Si un changement CSS structurellement correct (règle bien présente et bien spécifique dans le CSSOM) ne se reflète pas dans `getComputedStyle()` après un `:hover`/`:focus`/changement de classe dynamique, c'est probablement cet environnement de test qui est en cause, pas le code — ne pas re-déboguer en boucle, vérifier plutôt la règle CSS elle-même (sélecteur, spécificité, ordre) par lecture du CSSOM :

```js
[...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
  .filter(r => r.selectorText?.includes('ma-classe'))
  .map(r => r.cssText);
```

## Analyser une vidéo fournie par l'utilisateur

Pas de `ffmpeg` ni de lecteur vidéo disponible directement. Extraire des frames par intervalles avec Python (`imageio` + `imageio-ffmpeg`, s'installent via pip sans besoin d'un binaire ffmpeg séparé) :

```bash
/c/Python312/python.exe -m pip install --quiet imageio imageio-ffmpeg
/c/Python312/python.exe -c "
import imageio.v3 as iio
path = r'C:\chemin\vers\video.mp4'
print(iio.immeta(path, plugin='FFMPEG'))  # fps, duration, size
"
```
Puis itérer les frames avec `iio.imiter(path, plugin='FFMPEG')` et sauvegarder celles dont l'index correspond aux timestamps voulus (`idx = round(t * fps)`) via `iio.imwrite(...)`, avant de les regarder avec l'outil Read. Toujours copier fichiers/vidéos vers le dossier scratchpad (chemin Windows natif) avant de les traiter avec Python — les chemins `/tmp/...` de Git Bash ne sont pas résolus par le Python Windows.

## Avant de conclure "corrigé"

Toujours valider les 2 builds (`npm start`/dev et `npm run build`) après le test navigateur, et nettoyer tout fichier de test temporaire copié dans `public/` (jamais commité).
