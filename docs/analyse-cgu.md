# Analyse de conformité aux CGU Ankama / WAKFU — Wakfu Companion

> **Version analysée** : 1.138.0 (commit `ab869c0`, 2026-09-19) · **Date de l'analyse** : 19 septembre 2026
> (seconde passe, même jour : l'analyse ne retient que ce qui est **suivi par git et poussé** —
> aucun constat ne repose sur un outil externe ni sur un fichier ignoré du dépôt).
> **Textes de référence** (récupérés le jour même sur les sites officiels, Chrome piloté) :
>
> - **CGU Ankama** — <https://www.wakfu.com/fr/cgu>, « Dernière mise à jour : Août 2025 » ;
> - **Règles de conduite WAKFU** — <https://www.wakfu.com/fr/mmorpg/communaute/regles-jeu>
>   (incorporées par l'art. 5.3 des CGU, et qui *prévalent* sur celles-ci en cas de conflit) ;
> - **Licence d'utilisation de données WAKFU v1 (2019-03-11)** — PDF lié depuis le fil officiel
>   « Donnée JSON » (<https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json>), qui régit
>   les fichiers `wakfu.cdn.ankama.com/gamedata/{version}/{type}.json` à l'origine de
>   `repository/items.json` / `recipes.json`.
>
> **Périmètre** : `src/` (client Angular), `functions/api/v1/` (Pages Functions), `server/`
> (schéma, import, relais d'icônes), `public/` (assets, SEO), textes légaux embarqués
> (`legal.notice.body`, `terms.notice.body`, `footer.copyright` dans `core/i18n/translations.ts`).
> **Exclus** : tout ce que `.gitignore` écarte — en particulier le dossier `repository/`
> (`/repository`, l. 56) et son contenu, qui ne sont donc **ni lus ni comptés** ici ; ce que le
> dépôt en dit se limite aux types attendus par `server/import/import-catalog.ts` et aux
> commentaires du code.
> **Hors périmètre, mais cités car ils alimentent ce dépôt** : l'**overlay de bureau**
> (`Oumbra/wakfu-companion-overlay`), le projet **prix HDV** (`wakfu-companion-price`, tables
> déplacées le 2026-08-18) et l'outillage de constitution des référentiels `repository/*.json`,
> qui vit hors de ce dépôt et **n'est pas auditable d'ici**.
> **Nature** : audit de code, article par article — ce document n'est pas un avis juridique.

---

## 1. Synthèse

L'application web, prise isolément, est **exactement le type d'outil que les CGU n'interdisent
pas** : elle lit un fichier texte que le client officiel écrit déjà sur le disque, en lecture seule
(`{ mode: 'read' }`), sans jamais se connecter aux serveurs de jeu, sans modifier un fichier du
client, sans intercepter de protocole, sans simuler la moindre action de jeu, et sans monétisation.
Les CGU embarquées de l'app (`terms.notice.body`, § 2) exposent d'ailleurs cette position avec une
honnêteté rare, y compris ses limites. Sur le cœur de l'outil, **aucun écart n'a été trouvé**.

Les écarts sont ailleurs, et de trois natures :

1. **Marques et référencement** — l'art. 13.3 interdit *explicitement* les « meta-tags ou autres
   textes cachés utilisant les noms et marques d'Ankama sans autorisation écrite ». Le `<head>`
   de `src/index.html` contient précisément une balise `meta name="keywords"` composée de 14
   variantes de « wakfu ». C'est le seul point où le code contredit **littéralement** une clause.
   *Corrigé le 19 septembre 2026 (recommandation 1) : balise supprimée, `llms.txt` reformulé.*
2. **Provenance des données et images** — le dépôt ne documente pas l'origine du référentiel de
   monstres/familles/donjons, mais attend des champs — tables de butin par monstre, drapeaux
   boss/archimonstre/dominant — qu'aucun export officiel ne fournit et dont la seule source
   publique est l'encyclopédie du site officiel ; l'art. 13.5 couvre cette collecte par son
   opposition TDM (« TDM-RESERVATION: 1 »).
   L'outil de collecte et les fichiers produits ne sont pas dans le dépôt ; le dépôt en importe,
   stocke et sert le résultat. Par ailleurs des illustrations Ankama
   sont copiées dans `public/assets/`, et des images `static.ankama.com` sont chargées en
   contournant délibérément la protection anti-hotlink (`referrerpolicy="no-referrer"`). Le
   catalogue dérivé des JSON officiels (licence 2019 : « personnelle, non cessible, pas de
   sous-licence ») est servi par une API publique, sans authentification ni restriction
   d'origine.
3. **Périphérie de l'écosystème** — l'overlay (frappe clavier simulée dans le chat du jeu, lecture
   de l'image de la fenêtre, assets du jeu embarqués) touche directement l'art. 5.2.5 et la règle
   « programme tiers » (bannissement définitif dans la grille des sanctions). Il est hors de ce
   dépôt, mais ce dépôt lui sert de backend et les CGU de l'app le décrivent — il fait partie de
   ce qu'un utilisateur ou Ankama jugerait.

| Gravité | Nb | Points |
| --- | --- | --- |
| 🔴 Contradiction littérale | 1 | Meta-tags « wakfu » (art. 13.3) |
| 🟠 Risque réel, tolérance à obtenir | 4 | Référentiel monstres/butin issu de l'encyclopédie (13.5) · assets Ankama copiés/relayés (13.1-13.2) · contournement anti-hotlink (5.2.5) · frappe simulée et assets embarqués de l'overlay (5.2.5, 13.1) |
| 🟡 Modéré / à cadrer | 4 | API catalogue publique vs licence JSON non cessible · mention légale JSON inexacte (« Ankama Games » ≠ « Ankama Studio ») · nom « Wakfu Companion » + domaine `wakfu-companion.com` (13.3) · données de partie stockées côté serveur (13.1) |
| ⚪ Mineur / documentaire | 3 | Avatars fan-art hotlinkés · réutilisation de données du site Nexus-Hub · absence de demande d'autorisation « site de fans » (5.3.3) |

Rien de tout cela ne relève de la triche, du bot ou de l'atteinte aux serveurs : les sanctions
« bannissement définitif » de la grille WAKFU visent des pratiques que ce code ne met pas en œuvre.
Le risque concret est de nature **propriété intellectuelle** (demande de retrait, art. 13.4
« toute utilisation non conforme met fin à la licence »), pas de nature « compte de jeu ».

---

## 2. Ce que le code fait réellement vis-à-vis du jeu

Établi avant toute lecture des CGU, pour ne juger que des faits.

| Comportement | Où | Constat |
| --- | --- | --- |
| Lecture de `wakfu.log` | `core/services/log-file-access.service.ts` | File System Access API, `queryPermission({ mode: 'read' })` / `requestPermission({ mode: 'read' })`. **Aucun `createWritable`** dans `src/`. Le fichier n'est jamais téléversé (parsing 100 % local). |
| Connexion aux serveurs Ankama | `src/`, `functions/`, `server/` | **Aucune.** Les seules URL `ankama.com` du code client sont des `src` d'`<img>` (`static.ankama.com`) et un lien sortant vers la page avatar du compte Ankama. Aucun appel à `wakfu.cdn.ankama.com` au runtime (les JSON sont téléchargés hors ligne, hors dépôt, puis importés en base). |
| Modification du client / de ses fichiers | — | **Aucune.** |
| Automatisation, frappe, clic, injection | `src/` | **Aucune** dans l'app web. |
| Interception réseau (packet sniffing, proxy, tunnel) | — | **Aucune.** Le log est un fichier écrit volontairement par le client, pas une capture de protocole. |
| Données envoyées au serveur Wakfu Companion (compte optionnel) | `server/history/ingest.ts`, `server/db/schema.ts` | Combats (résultat, durée, donjon, participants **avec pseudos de tiers**, classe, dégâts/soins, ventilation par sort en `jsonb`, butin), achats, échanges, pactes, réglages. **Aucun message de chat** côté serveur (vérifié : aucune occurrence dans `server/history/` ni `functions/api/v1/history/`). |
| Monétisation | tout le dépôt | **Aucune** (aucune trace de paiement, don, publicité, abonnement). CGU de l'app : « application web gratuite, développée à titre personnel et non lucratif ». |
| Images du jeu | voir § 3.7 | CDN communautaire `vertylo.github.io/wakassets` (principal), `static.ankama.com` (recours + galeries d'avatars), planches copiées dans `public/assets/classes|avatars|ui`, relais serveur `/api/v1/icons/*` pour l'overlay. |
| Référentiel de jeu servi par l'API | `functions/api/v1/catalog/`, `items/[id]`, `monsters/[id]`, `monster-loot`, `monster-families`, `dungeons` | Public, sans authentification, `cache-control: public`. Source : `repository/*.json` (gitignoré — non examiné), chargé en base par `server/import/import-catalog.ts`, dont les types `RawItem`/`RawMonster`/`RawDungeon`/`RawMonsterFamily`/`RawCategory`/`RawRecipe` décrivent le contenu attendu. Objets/recettes : JSON gamedata officiels fusionnés (`server/README.md`). Monstres/familles/donjons/sous-catégories : aucune source documentée dans le dépôt (voir § 3.6). |

---

## 3. Analyse article par article

### 3.1 Licence et limitations (art. 5.1, 5.2) — cœur de l'outil : ✅ conforme

Clauses concernées, et pourquoi le code n'y contrevient pas :

- **5.2.1 « reverse engineering, désassemblage, décompilation, modification »** — lire un fichier
  journal en clair n'est aucune de ces opérations. *Réserve* : le format du log a bien été
  « compris » empiriquement (regex de `log-parser.ts`), mais il s'agit d'un texte lisible destiné
  au diagnostic, pas d'un code ou d'un protocole protégé.
- **5.2.2 « modifier un fichier quelconque faisant partie des Jeux ou des Clients »** et règle
  WAKFU « La modification du client de jeu est interdite. Ceci englobe tous les fichiers présents
  dans le répertoire d'installation » — lecture seule stricte, permission `read` demandée
  explicitement au navigateur, aucun chemin d'écriture. ✅
- **5.2.3 / 5.1 « autres techniques de connexion que celles fournies par Ankama »** — l'app ne se
  connecte pas au jeu. ✅
- **5.2.4 « utiliser les Clients pour le développement de tout programme informatique »** — clause
  large, mais visant l'usage du client comme *plateforme* de développement ; l'app ne charge ni
  n'exécute le client. Considéré non applicable.
- **5.2.5 « programme ou outil susceptible [...] d'altérer l'expérience des Jeux ou de contourner
  les règles des Jeux [...] logiciels d'automatisation, auto-clic, logiciels non autorisés destinés
  à modifier les Jeux »** et règle WAKFU « programme tiers ou outil non autorisé [...] quel qu'en
  soit l'usage » — c'est la clause la plus ouverte, celle qui fait qu'*aucun* outil tiers n'est
  formellement « autorisé ». Le critère opérant reste « susceptible de causer un dommage, altérer
  l'expérience, contourner les règles ». Un damage meter *a posteriori*, lu dans un onglet de
  navigateur, n'altère ni le jeu ni son équilibre (les mêmes informations sont affichées à
  l'écran par le client). ✅ *avec l'incertitude inhérente à cette clause, que les CGU de l'app
  assument correctement (« Cette appréciation nous appartient et ne constitue ni une autorisation
  d'Ankama… »)*.
- **5.2.5 al. 2** — Ankama annonce pouvoir *surveiller* les programmes « qui s'exécutent
  conjointement à un Jeu ». Un onglet Chrome n'est pas détectable comme outil tiers de manière
  distinguable d'un navigateur ordinaire ; l'overlay, lui, est une fenêtre superposée au jeu (voir
  § 3.9).
- **5.2.6 « espionner et intercepter les protocoles de communication »** — aucune capture réseau.
  ✅
- **5.2.7 « fins commerciales »** — aucune monétisation. ✅ **À maintenir** : toute forme de
  revenu (dons compris, selon l'interprétation) ferait basculer simultanément 5.2.7, la licence
  JSON § 1 (« usage personnel et non commercial ») et la tolérance « sites de fans » de 5.3.3.
- **5.2.9 « programme pouvant servir à modifier les caractéristiques de votre Compte »** — non
  applicable (aucune écriture vers le jeu).

### 3.2 Règles de conduite (art. 5.3) : ✅ / ⚪

- **5.3.2 « collecter des informations dans les Jeux »** — la clause est écrite dans un contexte
  de harcèlement/spam (« mettre à disposition des informations personnelles sur un autre
  utilisateur ; collecter des informations dans les Jeux »). L'app collecte des données *du log*
  (dont les pseudos d'alliés et de partenaires d'échange, stockés côté serveur en mode connecté).
  Ce point est déjà traité sous l'angle RGPD (`docs/analyse-rgpd.md`, base légale des pseudonymes
  de tiers) ; sous l'angle CGU, le risque est faible tant que ces données ne sont **ni publiées ni
  croisées entre utilisateurs** — ce qui est le cas : l'historique d'un compte n'est visible que par
  lui. Seul `server/import/analyze-universal-loot.ts` agrège en lecture seule le butin de *tous*
  les comptes pour un usage de maintenance du référentiel (aucune donnée nominative en sortie). ⚪
- **5.3.3 « toute forme de publicité ou de promotion commerciale [...] Ankama pourra néanmoins
  autoriser, à sa seule discrétion, la diffusion de sites de fans »** — pas de publicité dans
  l'app. La tolérance des sites de fans est **discrétionnaire** : rien n'oblige à la demander, mais
  c'est le seul mécanisme prévu par les CGU pour sortir de la zone grise des § 3.5 à 3.7. ⚪
- **5.3.8 « failles, bugs [...] pour obtenir des avantages »** — aucun. ✅

### 3.3 Éléments de jeu, Crédits (art. 5.4, 9) : ✅

L'app n'échange, ne vend, n'évalue en argent réel aucun Élément de Jeu. Les kamas sont comptés,
jamais transférés. Le projet prix HDV (hors dépôt) affiche des prix *en kamas* — pas de conversion
en monnaie réelle, donc hors du champ de l'interdiction « échanger contre de l'argent réel ». ✅

### 3.4 Marques, meta-tags, textes cachés (art. 13.3) : 🔴 / 🟡

Texte : *« Vous ne pouvez pas utiliser ces marques sans l'autorisation écrite préalable d'Ankama.
Vous n'avez pas l'autorisation d'utiliser des meta-tags ou d'autres "textes cachés" utilisant les
noms et marques d'Ankama sans l'autorisation écrite préalable de celle-ci. »*

Constats dans le code :

| Élément | Fichier | Qualification |
| --- | --- | --- |
| `<meta name="keywords" content="wakfu tracker, wakfu companion, wakfu historique de combats, wakfu damage meter, …">` (14 variantes en 4 langues) | `src/index.html` | 🔴 **Exactement** ce que 13.3 interdit : un meta-tag invisible composé de la marque. Google ignore `keywords` depuis 2009 — la balise n'apporte rien au référencement, seulement une exposition contractuelle. |
| `<title>`, `meta description`, `og:title`, JSON-LD, `<noscript>` multilingue, `seo.title.*`/`seo.description.*` (`SeoService`) | `src/index.html`, `core/services/seo.service.ts`, `translations.ts` | 🟡 Usage *descriptif* de la marque (« compagnon pour le jeu Wakfu ») — c'est la référence nécessaire au produit, généralement admise (usage référentiel), à condition de ne pas suggérer une affiliation. Le texte dit explicitement « non-officiel, sans lien avec Ankama ». Acceptable ; éviter d'aller plus loin. |
| `public/llms.txt` : « alias : Wakfu Tracker, Wakfu Combat Tracker, Wakfu Damage Meter » | `public/llms.txt` | 🟡 Fichier non affiché aux visiteurs, destiné aux robots : c'est structurellement un « texte caché » au sens de 13.3, et les « alias » sont des noms de produit forgés autour de la marque, pas une description. À reformuler en description. |
| Nom « Wakfu Companion », domaine `wakfu-companion.com`, `og:site_name`, `manifest.webmanifest`, `contact@wakfu-companion.com` | partout | 🟡 La marque *dans* le nom du produit et du domaine est la pratique de tous les fan-sites Wakfu/Dofus (y compris le site de référence `wakfu-companion.nexuswow.workers.dev`), tolérée de fait par Ankama depuis des années — mais 13.3 ne l'autorise pas et 13.4 permet d'y mettre fin à tout moment. Risque de demande de renommage/cession de domaine, non de sanction de compte. |
| Consigne SEO de `CLAUDE.md` (« être trouvé sur "wakfu tracker", "wakfu companion", "wakfu historique"… ») | `CLAUDE.md` | Objectif légitime s'il est atteint par du contenu *visible* ; à ne plus poursuivre par des balises cachées. |

### 3.5 Données JSON officielles — licence 2019 : 🟡

Le fil officiel conditionne l'usage des `gamedata/*.json` à la « Licence d'utilisation de données
WAKFU » (v1, 2019-03-11). Ce que le code en fait :

| Clause de la licence | Constat | Statut |
| --- | --- | --- |
| § 1 « licence personnelle, limitée, non exclusive, non transférable et non cessible [...] usage personnel et non commercial, dans le cadre de votre Projet » | Projet non commercial. ✅ Mais les données dérivées (index compact objets, `items/[id]`, `catalog/search`) sont servies par une **API publique sans authentification, sans vérification d'origine** (`cache-control: public`), consommable par n'importe quel tiers — de fait, une redistribution que § 2 (« vous ne pouvez pas accorder de sous-licences ni céder ou transférer [...] les Données ») n'autorise pas. L'overlay et le site sont bien « votre Projet » ; un tiers qui consommerait l'API ne l'est pas. | 🟡 |
| § 1 « faire apparaître la mention suivante : *WAKFU MMORPG : © 2012-[année en cours] Ankama Studio. Tous droits réservés.* » | `footer.copyright` affiche « WAKFU MMORPG : © 2012-2026 **Ankama Games**. Tous droits réservés. WAKFU et ANKAMA sont des marques… » — présente dans les 4 langues, sur toutes les pages, et complétée d'un « site non-officiel sans aucun lien avec Ankama ». La formulation imposée dit « Ankama Studio », et l'année est codée en dur (à faire vieillir chaque 1ᵉʳ janvier dans 4 locales). | 🟡 |
| § 2 « ne pas altérer, enlever ou dissimuler tout avis de marque ou de droit d'auteur inclus sur les Données » | Aucun avis n'est présent dans les JSON ; non applicable. | ✅ |
| § 2 « ne pas utiliser les Données en association avec [...] des activités contraires aux CGU (sites de triche, vente de Kamas…) » | Rien de tel dans l'app. Point de vigilance : la licence lie l'usage des JSON à la conformité CGU de *l'ensemble* du Projet — un écart ailleurs (§ 3.4, 3.9) pourrait faire tomber cette licence aussi. | ✅ |
| § 2 « respecter sans délai toute demande de la Société de retirer tout contenu » | `legal.notice.body` § 3 : « Tout contenu appartenant à Ankama est retiré sur simple demande ». | ✅ |
| § 4 « modifications [...] cesser d'utiliser les Données et supprimer toute publication » | Rien à faire aujourd'hui ; la version 2019 est toujours celle liée du fil officiel (dernière mise à jour du fil : 1ᵉʳ octobre 2025). | ✅ |

### 3.6 Fouille de textes et de données — référentiel issu de l'encyclopédie (art. 13.5) : 🟠

Texte : *« Ankama s'oppose à toutes opérations de moissonnage et de fouille de textes et de données
au sens de l'article L. 122-5-3 du CPI. Cette opposition couvre l'ensemble du Site [...] Toutes
opérations de moissonnage [...] y compris par des dispositifs de collecte automatisée de données,
constituent donc des actes de contrefaçon sauf obtention d'un accord spécifique. »* Signal machine :
`TDM-RESERVATION: 1`.

**Ce que le dépôt permet d'établir.** Ni l'outil qui produit `repository/*.json` ni ces fichiers
eux-mêmes ne sont dans le dépôt (`server/README.md` : transformation « réalisée hors du dépôt,
manuellement, par le mainteneur » ; `/repository` gitignoré), et aucun commentaire n'en nomme la
source. La provenance se déduit néanmoins du code suivi par git :

| Indice | Où | Ce qu'il montre |
| --- | --- | --- |
| Aucune source documentée : `server/README.md` décrit la construction des référentiels comme « réalisée hors du dépôt, manuellement », sans dire d'où viennent monstres, familles, donjons et butins ; les commentaires parlent de « famille de monstres », « référentiel curé hors de ce dépôt » | `server/README.md` l. 166-186, `server/db/schema.ts`, `server/import/import-catalog.ts` | Le dépôt ne revendique aucune source officielle pour ces données — contrairement aux objets/recettes, explicitement rattachés aux JSON gamedata. |
| Type d'entrée `RawMonster` : `loot?: number[]` (« ids Ankama des objets droppables sur ce monstre »), `isBoss`, `isArchi`, `isDominant`, `family`, `wakfu_available`, `picture_url` | `server/import/import-catalog.ts` l. 93-112 | **Aucun gamedata public ne décrit les monstres ni leurs butins** (le fil officiel ne liste que objets, recettes, états, actions…). Tables de butin et statuts boss/archi/dominant n'existent, côté Ankama, que sur les fiches de l'encyclopédie `wakfu.com`. Un drapeau `wakfu_available` suppose d'avoir sondé le CDN Ankama pour chaque entrée. |
| Volumes documentés dans les commentaires : 851 monstres, « ~728 monstres avec du loot connu, ~17,6 objets en moyenne (jusqu'à 99) », 10 890 objets ; image monstre « déductible du gfxId » sur `static.ankama.com/wakfu/portal/game/monster/42/` « vérifié 851/851 » | `functions/api/v1/monster-loot.ts`, `server/catalog/compact-index.ts` l. 75-91, `fight-image.util.ts` l. 22-37 | Une couverture quasi exhaustive du bestiaire, alignée sur les identifiants d'images de l'encyclopédie (`/portal/`) : un traitement de masse, pas une consultation ponctuelle. |
| Endpoints qui redistribuent ces données | `functions/api/v1/monsters/[id].ts`, `monster-families.ts`, `monster-loot.ts`, `dungeons.ts`, `catalog/*` | Publics, sans authentification, `cache-control: public`. |
| Traçabilité : `server/README.md` parle de « fichiers déjà committés » et d'un workflow `.github/workflows/import-catalog.yml` déclenché sur `repository/**` — le dossier est gitignoré et ce workflow n'existe pas | `server/README.md` l. 166-186, `.gitignore` l. 56, `.github/workflows/` | Les référentiels ne transitent jamais par git et l'import est manuel : leur constitution est intraçable depuis le dépôt (ni date, ni méthode, ni volume de requêtes). |

Ce dépôt est donc le **destinataire et le diffuseur** de données extraites de l'encyclopédie.
Que la collecte ait été automatisée (ce que la couverture — 851 fiches × 4 locales, ~728 tables de
butin — rend très probable) ou manuelle ne change pas la
qualification de l'usage aval : 13.5 interdit le « moissonnage » et 13.2 la « reproduction,
extraction, distribution » des données liées aux Jeux, quelle que soit la technique.

Nuances :

- La *fouille* interdite par L. 122-5-3 vise la reproduction à des fins d'analyse ; ici, les données
  extraites sont des **faits** (nom d'un monstre, sa famille, ce qu'il peut laisser tomber) — non
  protégeables par le droit d'auteur en tant que tels — mais leur collecte *systématique et
  substantielle* relève aussi du **droit sui generis des bases de données** (L. 341-1 CPI), que 13.2
  invoque (« toutes données liées aux Jeux [...] appartiennent à Ankama »).
- Le site de référence Nexus-Hub et la quasi-totalité des fan-sites Wakfu font la même chose ;
  Ankama l'a toléré et a même ouvert les JSON *en réponse* à cette demande (« Face à la demande
  grandissante… »). La tolérance est réelle mais discrétionnaire.
- La demande la plus naturelle est de solliciter, via le fil « Le coin des développeurs », un
  export `monsters.json` officiel — ce qui ferait tomber ce point entier sous la licence 2019.
- Point de traçabilité, indépendant de la conformité : rien dans le dépôt ne date ni ne décrit la
  constitution de ces fichiers, et le dépôt public ne les contient pas. En cas de demande d'Ankama
  (ou simplement de mise à jour), il faudrait pouvoir dire d'où vient chaque champ — voir
  recommandation 7.

**La méthode de collecte est hors de portée de cet audit ; la dépendance à son produit, sa mise en
base et sa redistribution publique sont dans ce dépôt.** Statut 🟠.

### 3.7 Images et illustrations (art. 13.1, 13.2, 5.2.5) : 🟠 / 🟡

13.1 : *« toute œuvre d'art, animation, [...] ne peuvent faire l'objet d'aucune utilisation sans
l'autorisation préalable et écrite d'Ankama »* ; 13.2 : *« copier, reproduire, [...] distribuer »*.

| Usage | Fichiers | Constat | Statut |
| --- | --- | --- | --- |
| Icônes d'objets/monstres/types/raretés via `vertylo.github.io/wakassets` | `shared/item-icon`, `shared/entity-icon`, `wakfu-item-category.data.ts`, `rarity-icon.data.ts` | Hotlink vers un dépôt communautaire tiers qui redistribue lui-même des assets Ankama (sans licence Ankama connue). Le risque juridique premier est porté par ce dépôt ; l'app en dépend. `legal.notice.body` § 3 le déclare. | 🟡 |
| Relais serveur `/api/v1/icons/{folder}/{file}` | `functions/api/v1/icons/[folder]/[file].ts`, `server/icons/proxy.ts` | Nos serveurs **redistribuent** (cache 24 h, `access-control-allow-origin: *`) les icônes wakassets pour l'overlay — motivé par le RGPD (IP non transmise à GitHub). Du point de vue de 13.2, l'app passe de « lien » à « reproduction et distribution » d'œuvres Ankama, ouvertement à quiconque. | 🟠 |
| Planches copiées dans `public/assets/classes/` (36 portraits m/f), `public/assets/avatars/` (planche 2 × 18 depuis `static.ankama.com/web-test/{id}.png`), `public/assets/ui/header-*.png`, `breach-*.png`, `rarity-base` | `class-icons.data.ts`, `class-portraits.data.ts`, `header-icons.data.ts`, `breach-icon.data.ts` | Reproduction d'illustrations Ankama (portraits de classe, avatars officiels) et d'éléments d'UI du site de référence, hébergés et distribués par nous. Usage illustratif, non commercial, déclaré dans les mentions légales — mais sans autorisation écrite, ce que 13.1 exige. C'est la situation classique du fan-site ; le risque est une demande de retrait, pas une sanction de compte. | 🟠 |
| `static.ankama.com` en recours (`wakfu-item-image-overrides.data.ts`, `fight-image.util.ts` monstres `/portal/game/monster/42/`, avatars `/web-test/`) avec `referrerpolicy="no-referrer"` — 13 balises `<img>` dans 11 fichiers (`item-icon`, `entity-icon`, `fight-history`, `session-recap`, `purchases`, `profile`, `profile-page`, `entity-stat-tabs`, `theme-switch`) | `shared/item-icon/item-icon.component.ts` et al. | Le `Referer` est supprimé **parce que** le CDN bloque le hotlink depuis un domaine tiers (documenté dans `CLAUDE.md` et dans `wakfu-item-image-overrides.data.ts` : « static.ankama.com bloque ces URLs si la requête porte un en-tête Referer »). C'est un contournement délibéré d'une mesure technique de contrôle d'accès, généralisé par copie à des balises qui n'en ont pas besoin (icônes wakassets de `entity-stat-tabs`/`theme-switch`, où il ne sert qu'à ne pas transmettre l'URL de la page à GitHub). 5.2.5 vise formellement les mesures protégeant « les Jeux ou les Clients », pas le CDN du site — la clause ne s'applique donc pas à la lettre — mais l'intention documentée du contournement pèserait dans toute discussion avec Ankama. | 🟠 |
| Galeries d'avatars fan-art `static.ankama.com/web-test/{1101-1133, 203852-…}` | `avatar-fanart-galleries.data.ts`, page profil | Hotlink d'illustrations que des artistes tiers ont fournies à Ankama pour les avatars de compte ; leurs droits sont concédés à Ankama pour *ce* service, pas pour des sites tiers. Faible volume, usage identique à celui du compte Ankama ; libellé « merci à eux » dans l'app. | ⚪ |
| Données extraites du dépôt Nexus-Hub (`wakfu-class-spells.data.ts`, `wakfu-ally-summons.data.ts`, anciennes tables de noms/familles) | `core/data/` | Sans rapport avec les CGU Ankama ; dépend de la licence du dépôt Nexus-Hub (à vérifier, non documentée dans ce dépôt). | ⚪ |

### 3.8 Propriété des données de jeu et « enregistrements de parties » (art. 13.1) : 🟡

13.1 range parmi les éléments appartenant à Ankama la *« transcription de conversation dans les
Jeux, information relative au profil d'un personnage, enregistrement ou répétition de parties de
Jeu »*. Le cœur de Wakfu Companion — historique de combats, butin, chat par canal — est
littéralement une transcription/ré-exploitation de ces éléments, extraite du log.

- **Chat** : jamais transmis au serveur, jamais partagé — reste sur la machine de l'utilisateur, qui
  l'a de toute façon déjà à l'écran et dans son propre `wakfu.log`. ✅
- **Combats et profils de personnages** : stockés côté serveur pour les comptes connectés
  (`fights`, `fight_participants` avec pseudo, classe, dégâts, sorts). Une lecture stricte de 13.1
  ferait de cette base un « enregistrement de parties » reproduit sans autorisation. En pratique,
  cette clause est conçue pour la revendication de propriété (contre la revente/réutilisation
  commerciale), pas contre l'usage personnel par le joueur de ses propres parties ; les CGU
  reconnaissent d'ailleurs à l'utilisateur la responsabilité de « toutes les communications
  électroniques et contenus envoyés depuis votre ordinateur » (4.3.2.4). Statut 🟡 : à mentionner
  dans les CGU de l'app (le § 3 « référentiel de données de jeu tenu par nos soins » ne couvre que
  le catalogue, pas l'historique).

### 3.9 Écosystème hors dépôt — overlay : 🟠

L'overlay n'est pas dans ce dépôt, mais (a) ce dépôt lui fournit son backend
(`native_pairings`, `/api/v1/auth/native/*`, relais d'icônes, catalogue), (b) les CGU embarquées
de l'app le décrivent et engagent l'éditeur à son sujet.

**Overlay de bureau** (`wakfu-companion-overlay`, MIT), tel que décrit dans `terms.notice.body`
§ 2 :

- « tapent à votre place une commande dans le chat du jeu (une frappe clavier simulée, que vous
  déclenchez vous-même à chaque fois) » — une frappe injectée dans le client par un programme tiers
  est, au sens de 5.2.5, un « logiciel d'automatisation » même s'il est déclenché manuellement (la
  différence avec un auto-clic est l'absence de répétition, pas la nature). Les CGU de l'app le
  reconnaissent (« s'en rapprochent davantage »). 🟠 — c'est le point le plus exposé de tout
  l'écosystème pour les *utilisateurs*, et il est optionnel.
- « lit l'image de la fenêtre du jeu pendant un combat pour y reconnaître le nom de votre
  personnage » — capture d'écran + OCR local, sans interaction : comparable à la lecture du log,
  pas d'interdiction identifiable. ✅
- « embarque des éléments d'interface, des icônes de sorts et des portraits de classe issus du jeu
  [...] reproduire l'apparence du jeu par-dessus sa fenêtre » — reproduction d'assets (13.1) *et*
  superposition à la fenêtre du client, ce qui rend l'overlay détectable comme « programme
  s'exécutant conjointement à un Jeu » (5.2.5 al. 2). 🟠
- « ne se connecte jamais aux serveurs d'Ankama, ne lit pas la mémoire du client, ne modifie aucun
  de ses fichiers » — conforme, à condition que le code du dépôt overlay le confirme (non audité
  ici, même réserve que `docs/analyse-rgpd.md`).

### 3.10 Multi-compte, serveurs monocomptes : ✅ neutre

L'app affiche des onglets par combat simultané (multi-compte). Elle ne facilite aucune connexion
multiple : c'est le client qui écrit plusieurs sessions dans le même `wakfu.log`. Les règles
« serveurs monocomptes » s'adressent au joueur, pas à l'afficheur. ✅

---

## 4. Ce qui est déjà bien fait (à préserver)

- **Lecture seule explicite** (`mode: 'read'`), aucune écriture possible vers le disque du jeu.
- **Aucune connexion aux serveurs Ankama**, aucun appel réseau vers le jeu ou le CDN gamedata au
  runtime.
- **Aucune automatisation** dans l'app web ; l'overlay documente ses deux fonctions actives comme
  optionnelles et « plus proches » des pratiques interdites.
- **Non-commercial** de bout en bout, déclaré dans les mentions légales et les CGU.
- **Non-affiliation** affirmée partout où la marque apparaît (footer sur toutes les pages,
  mentions légales, `llms.txt`, `<noscript>`) — la condition centrale pour qu'un usage
  référentiel de la marque reste défendable.
- **Mention de copyright WAKFU** au pied de chaque page, dans les 4 langues, proche de celle
  qu'impose la licence JSON.
- **Engagement de retrait sur simple demande** (mentions légales § 3) — c'est concrètement ce qui
  évite l'escalade dans le cas d'un fan-site.
- **Chat jamais transmis**, historique cloisonné par compte.
- Les CGU de l'app renvoient l'utilisateur aux CGU Ankama et refusent de garantir la conformité
  de son usage — exact, et loyal.

---

## 5. Recommandations, par ordre de priorité

| # | Action | Fichiers | Clause | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Supprimer `<meta name="keywords">`** (aucun bénéfice SEO, contradiction littérale). Reformuler les « alias » de `llms.txt` en description (« souvent recherché comme tracker ou damage meter pour Wakfu ») plutôt qu'en noms de produit. | `src/index.html`, `public/llms.txt` | 13.3 | Trivial — **fait le 2026-09-19** |
| 2 | **Corriger la mention de licence JSON** : « WAKFU MMORPG : © 2012-{année} Ankama Studio. Tous droits réservés. » (formulation imposée), avec l'année calculée (`new Date().getFullYear()`) plutôt que codée dans 4 locales. Conserver la phrase de non-affiliation à la suite. | `translations.ts` (`footer.copyright` ×4), `app-footer.component` | Licence § 1 | Faible |
| 3 | **Demander à Ankama** (fil « Le coin des développeurs » ou Support, art. 11) : (a) la tolérance « site de fans » de 5.3.3 pour Wakfu Companion, nom et domaine compris ; (b) un export gamedata officiel pour monstres/familles/donjons/butins (ou, à défaut, un accord écrit sur l'usage des fiches de l'encyclopédie) — ce qui éteindrait le point 13.5. Archiver la réponse dans `docs/`. | — | 5.3.3, 13.3, 13.5 | Faible, délai externe |
| 4 | **Cadrer l'API catalogue** : soit restreindre l'origine (`Origin`/`Referer` du site et de l'overlay, ou clé d'app), soit assumer la redistribution et le dire dans les mentions légales avec la mention Ankama Studio *sur les réponses* (en-tête `X-Attribution` ou champ JSON). Le § 2 de la licence interdit la sous-licence ; une API ouverte en est une de fait. | `functions/api/v1/catalog/*`, `items/[id]`, `monsters/[id]`, `monster-*`, `dungeons` | Licence § 1-2, 13.2 | Moyen |
| 5 | **Retirer `referrerpolicy="no-referrer"` sur les images `static.ankama.com`** et remplacer les 2 recours (`wakfu-item-image-overrides.data.ts`) + l'image de repli monstre par des assets wakassets ou des icônes génériques ; garder le hotlink Ankama uniquement là où il fonctionne sans contournement (galeries d'avatars, si elles passent avec Referer). Retirer aussi l'attribut des balises qui ne pointent que vers wakassets (`entity-stat-tabs`, `theme-switch`…), pour qu'il ne subsiste que là où il est réellement justifié et assumé. | `item-icon.component.ts`, `entity-icon.component.ts`, `wakfu-item-image-overrides.data.ts`, `fight-image.util.ts`, 7 templates `features/*` et `shared/*` | 5.2.5 (esprit), 13.1 | Faible |
| 6 | **Compléter les CGU de l'app** (§ 3) : l'historique de combats et les profils de personnages synchronisés au compte sont une reproduction d'informations dont Ankama revendique la propriété (13.1) ; ajouter le renvoi à la licence JSON pour le référentiel, et une phrase sur l'origine encyclopédique des monstres. | `translations.ts` (`terms.notice.body` ×4) | 13.1, licence | Faible |
| 7 | **Inventorier et sourcer chaque asset copié dans `public/assets/`** (classes, avatars, ui, breach) dans un `public/assets/SOURCES.md` : origine, date, transformation ; préférer les versions wakassets déjà hotlinkées pour tout ce qui en dispose, afin que « nos serveurs » ne distribuent que ce qui n'existe pas ailleurs. Vérifier la licence du dépôt Nexus-Hub pour les données `core/data/*` qui en viennent. **Documenter de même la provenance des `repository/*.json`** (dans `server/README.md` ou un `docs/repository-sources.md`, puisque le dossier est gitignoré) : pour chaque fichier, source (gamedata `items.json`/`jobsItems.json` vs fiches de l'encyclopédie), champs concernés, date de la dernière extraction — et corriger `server/README.md` (« fichiers déjà committés », workflow `import-catalog.yml` : ni l'un ni l'autre n'existent dans le dépôt). | `public/assets/`, `core/data/`, `server/README.md` | 13.1-13.2, 13.5 | Moyen |
| 8 | **Relais d'icônes** : borner l'usage à l'overlay (vérifier `User-Agent`/en-tête d'appairage plutôt que `access-control-allow-origin: *`), pour ne pas devenir un CDN public d'assets Ankama. | `server/icons/proxy.ts` | 13.2 | Faible |
| 9 | **Overlay** (autre dépôt) : documenter dans son README, à côté de la licence MIT, que les fonctions de frappe simulée sont « hors lecture passive » au sens des CGU Ankama ; envisager de les livrer désactivées par défaut, comme la notification de tour. | `wakfu-companion-overlay` | 5.2.5 | Faible |

---

## 6. Extraits des textes cités

Reproduits pour référence, tels que lus le 19 septembre 2026.

**CGU art. 5.2.2** — « Vous n'avez pas le droit de modifier les Jeux ou les Clients (à l'exception
de l'application des mises à jour). Il vous est interdit de modifier ou de faire modifier un fichier
quelconque faisant partie des Jeux ou des Clients sans l'autorisation expresse de la Société et il
vous est interdit de créer des œuvres dérivées des Jeux. »

**CGU art. 5.2.5** — « Vous vous interdisez de créer, d'utiliser ou de promouvoir un quelconque
programme ou outil susceptible de causer un dommage aux Jeux ou aux Clients, d'altérer l'expérience
des Jeux ou de contourner les règles des Jeux, tels que, de manière non limitative, les bots, virus,
cheval de Troie, outils de piratage, moyens de tricherie, logiciels d'automatisation, logiciels de
modification, logiciels permettant d'automatiser des actions de clic de souris (communément appelés
"auto-clic") ou autres logiciels non autorisés, destinés à modifier les Jeux ou les Clients. Par
ailleurs, vous vous interdisez de contourner ou de tenter de contourner, de quelque manière que ce
soit, toute mesure technique mise en place par Ankama ou par un tiers pour protéger, contrôler ou
restreindre l'accès aux Jeux ou aux Clients [...]. Ankama peut surveiller l'utilisation de ses Jeux
et du Launcher, à la fois sur ses serveurs et sur votre ordinateur [...] les Clients peuvent
contenir des fonctionnalités conçues pour détecter l'utilisation de programmes et outils non
autorisés par les présentes qui s'exécutent conjointement à un Jeu. »

**CGU art. 5.2.6** — « Vous vous engagez à ne pas espionner et intercepter les protocoles de
communication que la Société utilise, ni à utiliser un intercepteur pour les données ou le
protocole. »

**CGU art. 5.2.7** — « De manière générale, vous vous engagez à ne pas utiliser et exploiter les
Clients et/ou les Jeux à des fins commerciales. »

**CGU art. 5.3.2** (extrait) — « [...] mettre à disposition des autres utilisateurs des
informations personnelles sur vous-même ou sur un autre utilisateur ; collecter des informations
dans les Jeux. »

**CGU art. 5.3.3** — « Vous vous interdisez de procéder à toute forme de publicité ou de promotion
commerciale. Ankama pourra néanmoins autoriser, à sa seule discrétion, la diffusion de sites de fans
et autres forums de guildes, en lien avec l'univers des jeux d'Ankama, sous réserve qu'ils ne
contiennent pas de contenu portant atteinte à la législation en vigueur et aux CGU. »

**CGU art. 13.1** (extrait) — « Tous les éléments [...] (de façon non limitative [...] tout titre,
code informatique, thème, objet, personnage, nom de personnage, histoire, dialogue, slogan,
concept, œuvre d'art, animation, son, [...] transcription de conversation dans les Jeux,
information relative au profil d'un personnage, enregistrement ou répétition de parties de Jeu et
le logiciel de serveur) sont protégés [...] et ne peuvent faire l'objet d'aucune utilisation sans
l'autorisation préalable et écrite d'Ankama. »

**CGU art. 13.2** — « Toutes données liées aux Jeux, Services ou Sites appartiennent à Ankama
[...]. Vous n'avez pas le droit, en tout ou partie, de copier, reproduire, traduire, extraire,
modifier le code source, désassembler, décompiler, modifier, louer, vendre, distribuer ou créer des
œuvres dérivées inspirées des Jeux ou du contenu sans l'accord écrit préalable d'Ankama. »

**CGU art. 13.3** — « Toutes les marques figurant sur les Sites ou dans les Services sont des
marques créées par la Société ou dont elle détient les droits d'exploitation. Vous ne pouvez pas
utiliser ces marques sans l'autorisation écrite préalable d'Ankama. Vous n'avez pas l'autorisation
d'utiliser des meta-tags ou d'autres "textes cachés" utilisant les noms et marques d'Ankama sans
l'autorisation écrite préalable de celle-ci. »

**CGU art. 13.4** — « Toute utilisation non conforme met fin à l'autorisation ou à la licence
accordée par Ankama. »

**CGU art. 13.5** (extrait) — « Ankama s'oppose à toutes opérations de moissonnage et de fouille
de textes et de données au sens de l'article L. 122-5-3 du code de la propriété intellectuelle.
Cette opposition couvre l'ensemble du Site et du Launcher et des contenus auxquels ils donnent
accès. [...] y compris par des dispositifs de collecte automatisée de données, constituent donc des
actes de contrefaçon sauf obtention d'un accord spécifique formellement exprimé d'Ankama. [...]
< TDM-RESERVATION: 1> ou TDM: NO »

**Règles de conduite WAKFU, « Triche »** — « La création, l'utilisation ou la promotion d'un
programme tiers ou d'un outil non autorisé par les CGU (dont les programmes communément appelés
"bot" ou "auto-clic") est interdite, quel qu'en soit l'usage. [...] La modification du client de
jeu est interdite. Ceci englobe tous les fichiers présents dans le répertoire d'installation du
jeu. » — Grille des sanctions : « Création, utilisation ou promotion d'un programme tiers non
autorisé par les CGU et/ou les règles du jeu. → Bannissement définitif ».

**Licence d'utilisation de données WAKFU v1 (2019-03-11), § 1** — « La Société ne vous accorde
qu'une licence personnelle, limitée, non exclusive, non transférable et non cessible d'utiliser les
Données pour votre usage personnel et non commercial, dans le cadre de votre Projet [...]. Si vous
utilisez tout ou partie des Données, vous vous engagez à faire apparaître la mention suivante :
WAKFU MMORPG : © 2012-[année en cours] Ankama Studio. Tous droits réservés. » — **§ 2** : « Vous
reconnaissez et acceptez que vous ne pouvez pas accorder de sous-licences ni céder ou transférer de
toute autre manière la présente licence ou les Données. [...] Vous devez respecter sans délai toute
demande de la Société de retirer tout contenu de votre Projet contrevenant aux présentes
dispositions. »
