# Analyse de conformité aux CGU Ankama — Wakfu Companion

> **Version analysée** : 1.145.4 (commit `782359e`, 2026-09-21) · **Date de l'analyse** : 21 septembre 2026,
> mise à jour le même jour après les décisions du mainteneur (voir § 7, journal).
> **Texte de référence** : Conditions Générales d'Utilisation Ankama, <https://www.wakfu.com/fr/cgu>,
> « Dernière mise à jour : Août 2025 », récupérées le jour même (le site refuse les clients non
> navigateur : téléchargement avec un `User-Agent` de navigateur et un pot de cookies). Les **Règles
> de conduite WAKFU** (<https://www.wakfu.com/fr/mmorpg/communaute/regles-jeu>), que l'art. 5.3 des CGU
> incorpore et qui prévalent sur lui en cas de conflit, ont été récupérées de la même façon. Le fil
> officiel « Donnée JSON » du forum, qui porte la licence de données citée par le code, a répondu
> `202` sans contenu : **la licence de données n'a pas pu être relue ici**, seule sa mention dans le
> code est examinée.
> **Périmètre** : les 621 fichiers suivis par git (`git ls-files`), et eux seuls. Tout ce que
> `.gitignore` écarte est exclu — en particulier `repository/` (référentiel JSON lu par
> `server/import/import-catalog.ts`) et `wakfu.log` hors `tests/` : aucun constat ne repose sur un
> fichier ignoré. L'ancienne analyse `docs/analyse-cgu.md` n'a pas été utilisée.
> **Hors périmètre, mais cité** : l'overlay de bureau (`Oumbra/wakfu-companion-overlay`), dont ce
> dépôt héberge le backend d'appairage et décrit le fonctionnement dans ses propres CGU.
> **Nature** : audit de code, article par article. Ce document n'est pas un avis juridique.

---

## 1. Synthèse

Le cœur de l'application — lire `wakfu.log` en lecture seule dans un onglet de navigateur, ne
jamais se connecter aux serveurs du jeu, ne rien écrire, ne rien automatiser, ne rien monétiser —
ne contredit aucune clause des CGU. Sur ce cœur, rien à signaler.

Les écarts sont ailleurs et relèvent tous de la **propriété intellectuelle et de la marque**
(art. 13), jamais de la triche ou de l'atteinte aux serveurs. Le risque concret est une demande de
retrait ou de renommage par Ankama (art. 13.4 : « Toute utilisation non conforme met fin à
l'autorisation ou à la licence accordée par Ankama »), pas une sanction du compte de jeu du
mainteneur. La seule exposition des *utilisateurs* concerne la frappe simulée de l'overlay, dont le
code vit dans un autre dépôt.

Les quatre familles d'écarts :

1. **Identité visuelle** — le logo du site est le « W » du logotype WAKFU, pictogramme officiel
   recoloré en violet, utilisé comme favicon, icônes PWA, image de partage et logo d'en-tête.
   L'art. 13.3 interdit l'usage des marques d'Ankama sans autorisation écrite, et un signe modifié
   reste une imitation tant qu'il est reconnaissable. **Le mainteneur en demande l'autorisation à
   Ankama** (décision du 2026-09-21) ; jusqu'à réponse, l'usage reste non autorisé au sens du texte.
2. **Textes cachés portant la marque** — sept `alternateName` dans le JSON-LD de `src/index.html`,
   noms de produit forgés autour de « Wakfu », invisibles pour un visiteur. **Retirés le
   2026-09-21.**
3. **Données et images du jeu reproduites ou redistribuées** (13.1, 13.2) — un référentiel de
   851 monstres avec tables de butin, 151 donjons et ~150 familles constitué à partir de
   l'encyclopédie intégrée au jeu ; des illustrations officielles copiées dans `public/assets/` ; un
   relais serveur d'icônes ; et un contournement délibéré de la protection anti-hotlink de
   `static.ankama.com` pour les galeries d'avatars fan-art. **Tous inclus dans la demande
   d'autorisation.**
4. **Périphérie** (5.2.5) — les CGU de l'app décrivent un overlay qui « tape à votre place une
   commande dans le chat du jeu ». Le code et ses correctifs relèvent de l'autre dépôt ; seule la
   formulation du § 2 de `terms.notice.body` est du ressort de celui-ci.

| Gravité | Nb | Points | Statut au 2026-09-21 |
| --- | --- | --- | --- |
| 🔴 Contradiction littérale | 2 | Logo dérivé du logotype WAKFU (13.3, 13.1) · `alternateName` JSON-LD (13.3) | Demande d'autorisation à Ankama décidée · **corrigé** |
| 🟠 Risque réel, autorisation à obtenir | 3 | Illustrations Ankama hébergées et relayées (13.1, 13.2) · contournement anti-hotlink des galeries fan-art (5.2.5 al. 1, esprit ; 13.1) · overlay à frappe simulée décrit dans les CGU de l'app (5.2.5, règle « Triche ») | Inclus dans la demande d'autorisation · idem · à traiter dans le dépôt de l'overlay |
| 🟡 Modéré, à cadrer | 4 | Référentiel monstres/donjons/butin extrait du jeu (13.2) · nom et domaine `wakfu-companion.com` (13.3) · historique de combats et profils conservés côté serveur (13.1) · garde des routes référentiel contournable hors navigateur (13.2, licence de données) | Inclus dans la demande, CGU de l'app reformulées · inclus dans la demande · script d'agrégation supprimé, texte exact · options techniques en § 5 |
| ⚪ Mineur / documentaire | 3 | Tolérance « site de fans » à solliciter (5.3.3) · fixtures de journaux du client dans un dépôt public (5.2.8) · licence de données JSON non relue | Inclus dans la demande · — · à relire |

---

## 2. Ce que le code fait réellement

Établi par lecture du code avant toute qualification.

| Comportement | Où | Constat |
| --- | --- | --- |
| Lecture de `wakfu.log` | `core/services/log-file-access.service.ts` | File System Access API, `queryPermission({ mode: 'read' })` l. 120, `requestPermission({ mode: 'read' })` l. 198, sondage toutes les secondes de la portion nouvellement écrite. **Aucun `createWritable`** dans `src/`. Le fichier n'est jamais téléversé : seuls des événements structurés (combats, achats, échanges, pactes) partent vers l'API, et uniquement en mode connecté. |
| Interprétation du journal | `core/services/log-parser.ts` | Expressions régulières sur le texte lisible que le client écrit (`[_FL_] fightId=… join the fight`, `Vous avez ramassé…`, canaux de chat…). Aucune lecture de mémoire, aucun désassemblage, aucun fichier du client autre que ce journal. |
| Connexion aux serveurs Ankama | `src/`, `functions/`, `server/` | **Aucune**. Les seules URL `ankama.com` du dépôt sont trois `<img>` vers `static.ankama.com/web-test/{id}.png` (galeries d'avatars, voir § 3.7) et un lien sortant vers `account.ankama.com/fr/compte/profil/avatar` (`profile-page.component.html` l. 267). La CSP (`public/_headers`) n'autorise en `img-src` que `'self'` et `static.ankama.com`. |
| Modification du client, automatisation, injection, interception réseau | tout le dépôt | **Aucune**. |
| Monétisation | tout le dépôt | **Aucune** : pas de paiement, don, publicité ni abonnement. JSON-LD : `"price": "0"`. CGU de l'app : « application web gratuite, développée à titre personnel et non lucratif ». |
| Chat | `stats-store.service.ts` (`chatMessages`), `server/settings/keys.ts` | Messages conservés en mémoire seulement ; côté compte, seuls `chatActiveChannels` et `chatFilters` (préférences) sont synchronisés. Aucune table serveur ne porte un message. |
| Données de compte côté serveur | `server/db/schema.ts` | `fights` (résultat, durée, tours, XP, kamas, donjon, type), `fight_participants` (nom, classe, dégâts, soin, armure, ventilation par sort en `jsonb`, KO, fuite, XP — alliés compris, donc pseudonymes de tiers), `fight_loot`, `purchases`, `trades` (avec `peer_name`), `pact_extractions`, `user_settings` (profil, roster, watchlist…). Lecture toujours filtrée par `user_id`. |
| Référentiel de jeu | `server/import/import-catalog.ts`, `server/db/schema.ts` | Six fichiers JSON locaux, **gitignorés**, importés à la main : `items.json`, `recipes.json`, `monsters.json` (851 monstres, `loot: number[]`, `isBoss`/`isArchi`/`isDominant`, `family`, `wakfu_available`), `dungeons.json` (151, `type` curé), `monster-families.json` (~150, `picture`), `categories.json`. Servi par `GET /api/v1/catalog/`, `catalog/search`, `items/{id}`, `monsters/{id}`, `monster-loot`, `monster-families`, `dungeons`. |
| Garde des routes référentiel et du relais d'icônes | `functions/api/_caller.ts`, `server/http/caller.ts` | `rejectUnknownCaller` : accepte `Sec-Fetch-Site: same-origin` (site) ou une session `Authorization: Bearer` valide (overlay), 403 sinon. `game-servers` et `health` restent ouverts (sans donnée Ankama). |
| Images du jeu | voir § 3.7 | Relais `/api/v1/icons/{folder}/{file}` vers `vertylo.github.io/wakassets` (cache 7 jours), fichiers copiés dans `public/assets/{classes,avatars,ui}` (inventaire dans `public/assets/SOURCES.md`), hotlink `static.ankama.com/web-test/` pour les galeries d'avatars. |
| Marque et référencement | `src/index.html`, `public/{llms.txt,manifest.webmanifest,sitemap.xml,robots.txt}`, `core/services/seo.service.ts`, `translations.ts` (`seo.*`, `footer.copyright`) | Nom « Wakfu Companion », domaine `wakfu-companion.com`, `<title>`, descriptions, Open Graph, deux blocs JSON-LD (`WebApplication`, `FAQPage`), `<noscript>` multilingue, `llms.txt`. Pied de page sur toutes les pages : mention « WAKFU MMORPG : © 2012-{année} Ankama Studio… » + « site non-officiel sans aucun lien avec Ankama ». |
| Logo | `public/logo-purple.png`, `public/favicon.ico`, `public/icons/icon-{72…512}.png`, `public/assets/ui/logo-purple-9dfa03c6.png`, `core/data/app-logo.data.ts` | Le « W » du logotype WAKFU, recoloré en violet — origine déclarée dans `public/assets/SOURCES.md` (« pictogramme de l'encyclopédie du site officiel, `static.ankama.com/wakfu/ng/modules/icons/sprite_encyclopedia.png`, détouré du sprite, recoloré »). Vérifié visuellement sur `logo-purple.png`, `icon-192x192.png` et `logo-purple-9dfa03c6.png` ; `favicon.ico` non ouvert. |
| Overlay de bureau | `functions/api/v1/auth/native/*`, `server/auth/pairing.ts`, `features/native-pair/`, `terms.notice.body`, `privacy.notice.body` | Appairage par code, sessions `Bearer`, rotation, effacement. Les CGU de l'app décrivent deux fonctions « qui vont plus loin que la seule lecture du fichier » : frappe clavier simulée dans le chat du jeu (raccourcis « Inviter »/« Suivre », réponse à une alerte) et capture d'image de la fenêtre du jeu. |
| Fixtures de test | `tests/wakfu.log`, `tests/logs/**/*.log`, `tools/check-fixtures.mjs` | Extraits réels du journal du client, pseudonymisés (contrôle en hook et en CI). |

---

## 3. Analyse article par article

### 3.1 Licence d'utilisation (art. 3.3, 5.1) — ✅

3.3 et 5.1 concèdent une licence « limitée, non exclusive et non transférable » d'accès aux Services
« pour votre utilisation personnelle et non-commerciale », et interdisent « l'utilisation d'autres
techniques de connexion que celles fournies par Ankama ». L'application ne se connecte pas au jeu ;
elle lit un fichier que le client, lancé normalement, écrit sur le disque. Usage personnel et non
commercial : conforme.

### 3.2 Limitations de licence (art. 5.2)

- **5.2.1 (reverse engineering, décompilation, modification)** — comprendre le format d'un journal
  texte destiné au diagnostic n'est aucune de ces opérations. Les expressions de `log-parser.ts`
  portent sur des phrases en clair, pas sur un code ou un protocole. Relever à la main le contenu
  de l'encyclopédie intégrée au jeu (§ 3.6) n'en est pas une non plus : c'est un usage normal du
  client. ✅
- **5.2.2 (modifier un fichier des Jeux ou des Clients)** — lecture seule stricte, permission `read`
  demandée explicitement, aucun chemin d'écriture. La règle « La modification du client de jeu est
  interdite. Ceci englobe tous les fichiers présents dans le répertoire d'installation » (Règles de
  conduite, « Triche ») est respectée a fortiori : le journal est sous `%AppData%`, hors du
  répertoire d'installation, et n'est de toute façon jamais écrit. ✅
- **5.2.3 (serveurs pirates, proxys, VPN, émulateurs)** — sans objet. ✅
- **5.2.4 (utiliser les Clients pour développer un programme)** — la clause vise l'usage du client
  comme plateforme de développement ; l'application ne le charge ni ne l'exécute. Non applicable.
- **5.2.5 al. 1, première phrase (programmes susceptibles de causer un dommage, d'altérer
  l'expérience ou de contourner les règles ; bots, automatisation, auto-clic, « autres logiciels non
  autorisés »)** — c'est la clause la plus ouverte : aucun outil tiers n'est jamais « autorisé » au
  sens strict, et la règle « Triche » ajoute « quel qu'en soit l'usage ». Le critère opérant reste
  la nature de l'outil : un afficheur a posteriori dans un onglet, qui n'envoie rien au jeu, n'altère
  ni l'expérience ni l'équilibre — les mêmes informations sont à l'écran du client. Pour
  l'application web : ✅, avec l'incertitude inhérente à la clause, que les CGU de l'app assument
  honnêtement (« Cette appréciation nous appartient et ne constitue ni une autorisation d'Ankama… »).
  Pour l'overlay décrit par ces mêmes CGU : voir § 3.10.
- **5.2.5 al. 1, seconde phrase (contourner « toute mesure technique mise en place par Ankama ou par
  un tiers pour protéger, contrôler ou restreindre l'accès aux Jeux ou aux Clients »)** — trois
  balises `<img>` portent `referrerpolicy="no-referrer"` (`profile.component.html` l. 10,
  `profile-page.component.html` l. 177 et 255) précisément parce que `static.ankama.com` répond 403
  à toute requête d'image dont le `Referer` est un domaine tiers, ce que
  `avatar-fanart-galleries.data.ts` (l. 12-19) et `.claude/rules/catalog-assets.md` documentent en
  toutes lettres comme un contournement de protection anti-hotlink. À la lettre, la clause protège
  « les Jeux ou les Clients », pas le CDN du Site : elle ne s'applique donc pas directement. Mais
  l'intention documentée — neutraliser une mesure qu'Ankama a posée pour restreindre la
  réutilisation de ses images hors de ses sites — pèserait dans toute discussion, et le code le
  dit lui-même. 🟠 (analysé avec les images, § 3.7 ; inclus dans la demande d'autorisation).
- **5.2.5 al. 2 (surveillance des « programmes et outils non autorisés […] qui s'exécutent
  conjointement à un Jeu »)** — un onglet de navigateur n'est pas distinguable d'une navigation
  ordinaire ; l'overlay, fenêtre superposée au jeu, l'est (§ 3.10).
- **5.2.6 (espionner ou intercepter les protocoles, packet-sniffing, tunneling)** — aucune capture
  réseau nulle part. ✅
- **5.2.7 (fins commerciales)** et **5.2.8 (distribuer les Clients ou les fichiers qui
  l'accompagnent)** — aucune monétisation. Les fixtures `tests/` reproduisent des extraits de la
  *sortie* du client (son journal), pas des fichiers livrés avec lui : hors du champ de 5.2.8, mais
  ce sont bien des textes produits par le logiciel d'Ankama publiés dans un dépôt public. ⚪
  **À maintenir** : toute forme de revenu, dons compris, ferait basculer 5.2.7, la licence de données
  (« usage personnel et non commercial ») et la tolérance des sites de fans (5.3.3) en même temps.
- **5.2.9 (programme modifiant les caractéristiques d'un Compte)**, **5.2.10 (rendre les Jeux
  inaccessibles)** — sans objet. ✅

### 3.3 Règles de conduite (art. 5.3 et Règles WAKFU)

- **5.3.2 « collecter des informations dans les Jeux »** — la phrase est écrite dans une liste
  de comportements de harcèlement et de spam (« mettre à disposition des autres utilisateurs des
  informations personnelles sur […] un autre utilisateur ; collecter des informations dans les
  Jeux »). L'application collecte des informations *du journal*, dont les pseudonymes d'alliés et
  de partenaires d'échange, stockés côté serveur en mode connecté. Ils ne sont ni publiés ni
  croisés entre comptes : chaque lecture est filtrée par `user_id`. Traité sous l'angle RGPD dans
  `docs/analyse-rgpd.md`. Sous l'angle CGU : ⚪.
- **5.3.3 « toute forme de publicité ou de promotion commerciale […] Ankama pourra néanmoins
  autoriser, à sa seule discrétion, la diffusion de sites de fans »** — pas de publicité. La
  tolérance des sites de fans est le seul mécanisme que les CGU prévoient pour sortir de la zone
  grise des § 3.5 à 3.8 ; elle fait partie de la demande d'autorisation (§ 5, recommandation 1). ⚪
- **5.3.8 (failles, bugs)**, **5.3.9 (attaque des serveurs)** — sans objet. ✅
- **Règles WAKFU, « Serveurs monocomptes » et grille « Multi-compte non autorisé → bannissement
  définitif »** — l'application affiche un onglet par combat simultané et un roster « par compte »
  (README : « multi-compte, serveur de jeu par compte »). Elle ne connecte aucun compte : c'est le
  client qui écrit plusieurs sessions dans le même journal. La règle s'adresse au joueur, pas à
  l'afficheur ; l'outil ne facilite ni ne masque rien. ✅ neutre.

### 3.4 Éléments de jeu et Crédits (art. 5.4, 9) — ✅

Les kamas sont comptés (gains de combat, ventes HDV détectées via `HDV_KAMAS_SALE_ITEM`, achats,
échanges), jamais transférés, convertis ni valorisés en monnaie réelle. Aucun Élément de Jeu n'est
échangé « en dehors des Sites, des Jeux et de leurs règles ». ✅

### 3.5 Marques, meta-tags et textes cachés (art. 13.3)

Texte : *« Toutes les marques figurant sur les Sites ou dans les Services sont des marques créées par
la Société ou dont elle détient les droits d'exploitation. Vous ne pouvez pas utiliser ces marques
sans l'autorisation écrite préalable d'Ankama. Vous n'avez pas l'autorisation d'utiliser des
meta-tags ou d'autres « textes cachés » utilisant les noms et marques d'Ankama sans l'autorisation
écrite préalable de celle-ci. »*

| Élément | Fichiers | Qualification | Statut |
| --- | --- | --- | --- |
| **Logo de l'application = « W » du logotype WAKFU, pictogramme officiel recoloré** | `public/logo-purple.png` (servi en `og:image`/`twitter:image`, `src/index.html`), `public/favicon.ico`, `public/icons/icon-*.png` (8 tailles, `manifest.webmanifest`), `public/assets/ui/logo-purple-9dfa03c6.png` (en-tête, onboarding) ; origine consignée dans `public/assets/SOURCES.md` | 🔴 Le logotype WAKFU est une marque figurative d'Ankama (le pied de page du site le rappelle : « WAKFU et ANKAMA sont des marques ou des marques déposées d'Ankama »). Pourquoi la recoloration ne change rien : en droit des marques, l'*imitation* (signe modifié mais reconnaissable, avec risque de confusion) est traitée comme la reproduction ; l'art. 13.2 liste d'ailleurs « modifier » et « créer des œuvres dérivées » parmi les usages interdits ; et le « W » aux flammes reste reconnaissable en violet. Utilisé comme signe distinctif propre — onglet du navigateur, écran d'accueil d'un téléphone, aperçu du lien sur Discord —, il produit son effet avant tout texte : le disclaimer du pied de page, qui fonctionne pour le nom, n'atteint pas le logo. 13.1 s'y ajoute (« œuvre d'art »). Présent depuis juillet 2026. | **Demande d'autorisation à Ankama** décidée le 2026-09-21 : pictogramme officiel, recoloré, usage non commercial. Tant que la réponse n'est pas reçue, l'usage reste non autorisé au sens de 13.3 ; en cas de refus, remplacer par une création propre (recommandation 1, plan B). |
| `alternateName` du JSON-LD `WebApplication` : sept noms de produit construits sur la marque | `src/index.html` (ex-l. 572-580) | 🔴 Un bloc `<script type="application/ld+json">` n'est jamais affiché : c'est un texte destiné aux machines, comme un meta-tag. Et ce n'étaient pas des descriptions mais des *noms* alternatifs officiels de l'application (« Wakfu Tracker », « Wakfu Damage Meter »…). Nommer Wakfu dans le SEO reste permis et nécessaire (voir ligne suivante) ; c'est la forme « marque + nom de produit, en texte caché » qui contredisait 13.3. | **Retiré le 2026-09-21.** `name`, `description` et la FAQ JSON-LD, tous descriptifs, sont conservés. |
| Nom « Wakfu Companion », domaine `wakfu-companion.com`, `og:site_name`, `manifest.webmanifest` (`name`, `short_name`), adresse `contact@wakfu-companion.com` | partout | 🟡 La marque *dans* le nom du produit et le domaine dépasse la simple référence descriptive. C'est la pratique de tous les sites de fans Wakfu et Dofus, tolérée de fait par Ankama depuis des années — mais 13.3 ne l'autorise pas, et 13.4 permet d'y mettre fin à tout moment. Risque : demande de renommage ou de cession du domaine. **Le pied de page suffit-il ?** Il est la mesure de bonne foi attendue — non-affiliation écrite sur chaque page, à côté de la marque, dans les 4 langues, avec la mention de copyright — et c'est ce qui rend l'usage référentiel défendable. Il ne vaut pas *autorisation* : 13.3 exige un écrit d'Ankama, qu'aucune mention unilatérale ne remplace. Il faut donc les deux : garder le pied de page, et inclure nom et domaine dans la demande. | **Inclus dans la demande d'autorisation.** |
| `<title>`, `meta description`, `og:title`, `seo.title.*`/`seo.description.*`, `<noscript>` multilingue, JSON-LD `FAQPage`, `public/llms.txt` | `src/index.html`, `seo.service.ts`, `translations.ts`, `public/llms.txt` | ✅ Usage *descriptif* et nécessaire de la marque (« compagnon de jeu gratuit pour Wakfu », « tracker de combat pour Wakfu ») — la référence au produit que désigne le service, sans suggérer d'affiliation, avec la non-affiliation écrite dans `llms.txt` et le pied de page. C'est ce qui fait le référencement ; à conserver tel quel. Ne pas réintroduire de forme « Wakfu + nom de produit », même dans un fichier destiné aux robots. | — |
| `public/robots.txt` | — | Sans rapport avec 13.3 (il régit nos propres robots). | — |

### 3.6 Référentiel monstres, familles, donjons et butins (art. 13.2, 13.5) — 🟡

Texte, 13.2 : *« Toutes données liées aux Jeux, Services ou Sites appartiennent à Ankama […]. Vous
n'avez pas le droit, en tout ou partie, de copier, reproduire, traduire, extraire […] distribuer
[…] sans l'accord écrit préalable d'Ankama. »* — 13.5 : opposition à toute fouille et tout
moissonnage « du Site et du Launcher et des contenus auxquels ils donnent accès », « y compris par
des dispositifs de collecte automatisée », qualifiés de contrefaçon sans accord.

Ce que le dépôt établit, sans lire `repository/` :

| Indice | Où | Ce qu'il montre |
| --- | --- | --- |
| Les CGU de l'app, reformulées le 2026-09-21 sur indication du mainteneur : « Les monstres, familles de monstres, donjons et tables de butin, qu'Ankama ne publie pas sous cette licence, ont été constitués par nos soins à partir des informations publiques du jeu lui-même, principalement son encyclopédie intégrée » (auparavant : « du jeu et de son site officiel ») | `translations.ts`, `terms.notice.body` § 3 (4 locales) | La source principale est l'encyclopédie *dans le client*, consultable par tout joueur, pas le site web. Les objets et recettes, eux, sont rattachés aux JSON officiels sous licence. |
| Champs attendus du référentiel : `loot?: number[]` (« ids Ankama des objets droppables sur ce monstre »), `isBoss`, `isArchi`, `isDominant`, `family`, `picture_url`, `wakfu_available` ; donjons avec `type` et `bossMonsterId` « curés à la main » ; familles avec `picture` | `server/import/import-catalog.ts` l. 1039-1091 | Tables de butin par monstre, statuts boss/archimonstre/dominant, familles : aucun export public d'Ankama ne les fournit ; le jeu les affiche dans son encyclopédie. |
| Volumes : 851 monstres, ~728 avec du butin (« ~17,6 objets en moyenne, jusqu'à 99 »), 151 donjons, ~150 familles, 4 langues | `server/db/schema.ts`, `functions/api/v1/monster-loot.ts`, `server/README.md` | Une couverture quasi exhaustive du bestiaire dans 4 locales. |
| Règle de projet : « ne jamais le décrire (origine, chemin, contenu) dans le code ou la documentation » | `.claude/rules/catalog-assets.md` (en-tête) | La provenance précise et la méthode sont volontairement tenues hors du dépôt. |

Qualification. Avec l'encyclopédie intégrée comme source, **13.5 ne s'applique plus directement** :
son opposition vise le Site et le Launcher, pas le client de jeu (si une partie des données vient
malgré tout du site web — le « principalement » des CGU le laisse ouvert —, 13.5 reste applicable à
cette part). **13.2 s'applique toujours** : « toutes données liées aux Jeux […] appartiennent à
Ankama », et ce référentiel est une extraction systématique du contenu du jeu, stockée en base et
servie par l'API. Les faits eux-mêmes (un monstre, sa famille, ce qu'il laisse tomber) ne sont pas
protégeables par le droit d'auteur ; leur collecte substantielle et systématique relève du droit
sui generis des bases de données, que 13.2 revendique. Nuances : la quasi-totalité des sites de fans
Wakfu font la même chose avec la tolérance d'Ankama, et un export officiel `monsters.json` n'existe
pas. Point de traçabilité, indépendant de la conformité : en cas de demande d'Ankama, rien dans le
dépôt ne permet de dire d'où vient chaque champ ni quand il a été relevé ; cette traçabilité doit
exister ailleurs (recommandation 6). 🟡, inclus dans la demande d'autorisation.

### 3.7 Images et illustrations (art. 13.1, 13.2) — 🟠

13.1 : *« tout titre, code informatique, thème, objet, personnage, nom de personnage, […] œuvre d'art,
animation, son […] ne peuvent faire l'objet d'aucune utilisation sans l'autorisation préalable et
écrite d'Ankama »* ; 13.2 : *« copier, reproduire, […] distribuer »*.

| Usage | Fichiers | Constat | Statut |
| --- | --- | --- | --- |
| Planche d'avatars de classe assemblée depuis `static.ankama.com/web-test/{id}.png` (portraits « Galerie MMO » du compte Ankama), 36 icônes de classe, 7 en-têtes illustrés, `rarity-base`, `recipe`, `session-recap`, `unknown-entity` (copiés depuis wakassets et le site Nexus-Hub), deux pierres de brèche (captures d'écran du jeu détourées) | `public/assets/avatars/`, `public/assets/classes/`, `public/assets/ui/` ; sources dans `public/assets/SOURCES.md` | Reproduction et hébergement d'illustrations Ankama par nos serveurs, sans autorisation écrite. Usage illustratif, non commercial, inventorié et déclaré (mentions légales § 3 : « retiré sur simple demande »). Situation classique du site de fans : le risque est une demande de retrait. | 🟠 — inclus dans la demande d'autorisation |
| Relais `/api/v1/icons/{folder}/{file}` vers `vertylo.github.io/wakassets` (objets, monstres, illustrations, familles, raretés, types, sorts, aptitudes), cache périphérie 7 jours | `functions/api/v1/icons/[folder]/[file].ts`, `server/icons/proxy.ts` | Nos serveurs copient et redistribuent des images du jeu (via un dépôt communautaire sans licence Ankama connue), réservées à nos deux clients par `rejectUnknownCaller`. Motivation RGPD légitime (l'IP du visiteur ne part plus vers GitHub). Du point de vue de 13.2, on passe de « lien » à « reproduction et distribution » — bornée, mais réelle. | 🟠 — inclus dans la demande |
| Galeries d'avatars fan-art hotlinkées depuis `static.ankama.com/web-test/{1101-1133, 203852-203881, 203994-204039}` avec `referrerpolicy="no-referrer"` | `core/data/avatar-fanart-galleries.data.ts`, `profile.component.html` l. 10, `profile-page.component.html` l. 177 et 255 | Deux couches. (a) Ce sont des illustrations fournies par des artistes à Ankama pour *son* service d'avatars ; leurs droits sont concédés à Ankama pour cet usage, et 13.1 couvre « l'ensemble du contenu proposé sur […] les Sites ». Qu'elles ne soient pas dessinées par Ankama ne les rend pas libres. (b) Le chargement ne fonctionne qu'en supprimant le `Referer`, mesure technique qu'Ankama a posée pour restreindre ce réemploi (§ 3.2, 5.2.5). Le code documente le contournement et le limite à ces trois balises ; l'app crédite les artistes et renvoie vers le compte Ankama. Volume faible, mais c'est l'endroit du dépôt où l'intention est la plus explicitement contraire à celle d'Ankama. | 🟠 — inclus dans la demande ; en cas de refus, retirer les galeries |
| Logo dérivé du logotype WAKFU | voir § 3.5 | Traité comme marque (13.3) ; 13.1 s'y ajoute. | 🔴 — demande d'autorisation |
| GIF et affiches d'onboarding (captures de l'application, données factices) | `public/assets/onboarding/` | Reproduisent des icônes du jeu telles que l'app les affiche. Accessoire. | ⚪ |
| Sons d'alerte | `public/assets/sounds/` | FilterBlade et Pixabay, sans rapport avec Ankama. | ✅ |

### 3.8 Données du jeu servies par l'API et licence de données (art. 13.2) — 🟡

Le pied de page affiche, dans les 4 langues et sur toutes les pages, « WAKFU MMORPG : © 2012-{année}
Ankama Studio. Tous droits réservés. » (`footer.copyright`, année calculée dans
`app-footer.component.ts`), formulation que `terms.notice.body` § 3 rattache à la « Licence
d'utilisation de données WAKFU » pour les objets et recettes. **Cette licence n'a pas pu être relue
ici** (fil du forum inaccessible) : la conformité de la mention et les limites de la licence
(sous-licence, redistribution) ne sont pas vérifiées dans cette analyse.

Ce que le code fait de ces données : l'index compact, la recherche, le détail des objets et
recettes, les monstres, familles, butins et donjons sont servis par huit routes réservées au site et
à l'overlay. La garde repose sur `Sec-Fetch-Site: same-origin`, un en-tête qu'un navigateur pose et
qu'aucun script de page ne peut forger — mais qu'un client non navigateur (`curl`, script) écrit
librement : `curl -H "Sec-Fetch-Site: same-origin" …/api/v1/catalog/` est servi. La garde exprime
donc une *intention* de non-redistribution, opposable à un usage de bonne foi, pas un contrôle
d'accès. C'est cohérent avec « dans le cadre de votre Projet » si l'on considère que le site et
l'overlay sont le Projet ; ce n'est pas une barrière contre un tiers qui voudrait aspirer le
référentiel. Les options pour aller plus loin sans imposer de connexion sont en § 5,
recommandation 4. 🟡

### 3.9 « Enregistrements de parties » et profils de personnages (art. 13.1) — 🟡

13.1 range parmi les éléments appartenant à Ankama la *« transcription de conversation dans les
Jeux, information relative au profil d'un personnage, enregistrement ou répétition de parties de
Jeu »*. L'historique de combats, le butin et le chat par canal sont littéralement une
ré-exploitation de ces éléments.

- **Chat** : jamais transmis, jamais persisté. ✅
- **Combats et profils** : conservés côté serveur pour les comptes connectés (`fights`,
  `fight_participants` avec pseudo, classe, dégâts, sorts). Une lecture stricte de 13.1 en fait un
  « enregistrement de parties » reproduit sans autorisation. En pratique, la clause sert la
  revendication de propriété (contre la revente ou la réutilisation commerciale), pas l'usage
  personnel par le joueur de ses propres parties — que 4.3.2.4 lui impute d'ailleurs (« vous […] êtes
  responsable de toutes les communications électroniques et des contenus envoyés depuis votre
  ordinateur »). Les CGU de l'app le disent (§ 3 : « nous les conservons pour votre seul usage, ne
  les publions pas, ne les croisons pas entre comptes »).
- **« Ne les croisons pas entre comptes »** — cette phrase était plus absolue que la pratique :
  `server/import/analyze-universal-loot.ts` agrégeait en lecture seule le butin de *tous* les comptes
  pour constituer `core/data/wakfu-universal-loot.data.ts`. Le mainteneur a confirmé qu'il s'agissait
  d'un script d'analyse ponctuel, sans usage prévu ; **supprimé le 2026-09-21** avec ses trois
  scripts npm. La phrase des CGU est désormais exacte. 🟡 pour la lecture stricte de 13.1, rien à
  faire de plus.

### 3.10 Écosystème hors dépôt — overlay (art. 5.2.5, Règles « Triche ») — 🟠

Le code de l'overlay n'est pas ici, et ses correctifs relèvent de son dépôt. Ce dépôt (a) lui
fournit son appairage, ses sessions, son relais d'icônes et son catalogue, (b) le décrit dans
`terms.notice.body` § 1-2 et `privacy.notice.body` § 1.4, avec un lien vers son dépôt. Or 5.2.5
interdit de « créer, d'utiliser **ou de promouvoir** » un outil d'automatisation, et la règle
« Triche » vise « la création, l'utilisation ou la promotion d'un programme tiers ou d'un outil non
autorisé par les CGU […] quel qu'en soit l'usage », sanction unique dans la grille : « Bannissement
définitif ». La seule chose de ce dépôt qui relève de « promouvoir » est ce paragraphe de CGU.

Ce que les CGU de l'app décrivent :

- « les raccourcis « Inviter » et « Suivre », ainsi que la réponse à une alerte de chat, tapent à
  votre place une commande dans le chat du jeu (une frappe clavier simulée, que vous déclenchez
  vous-même à chaque fois) » — une frappe injectée dans le client par un programme tiers est, au
  sens de 5.2.5, un « logiciel d'automatisation » même déclenché à la main : la différence avec un
  auto-clic est l'absence de répétition, pas la nature. Les CGU de l'app le reconnaissent (« s'en
  rapprochent davantage »). C'est le point le plus exposé de tout l'écosystème, **pour
  l'utilisateur**, et il est optionnel. 🟠
- « la notification de tour […] lit l'image de la fenêtre du jeu » — capture d'écran locale, sans
  interaction : comparable à la lecture du journal. ✅
- « embarque des éléments d'interface, des icônes de sorts et des portraits de classe issus du jeu
  […] reproduire l'apparence du jeu par-dessus sa fenêtre » (mentions légales § 3) — reproduction
  d'assets (13.1) et superposition à la fenêtre du client, donc programme « s'exécutant
  conjointement à un Jeu » au sens de 5.2.5 al. 2. 🟠

### 3.11 Sanctions et résiliation (art. 10, 13.4, 14) — qui porte quel risque

- Pour le **mainteneur** : 13.4 (fin de l'autorisation) et 10.6 (poursuites civiles) sont les seuls
  leviers pertinents — demande de retrait d'images ou de données, de renommage, de changement de
  logo. Rien dans le dépôt ne justifierait une sanction de son compte de jeu.
- Pour l'**utilisateur** du site : rien d'identifiable. Pour l'utilisateur de l'overlay qui active
  la frappe simulée : la grille « Triche » ne prévoit qu'une sanction, définitive.

---

## 4. Ce qui est déjà bien fait (à préserver)

- Lecture seule explicite (`mode: 'read'`), aucune écriture possible vers le disque du jeu, fichier
  jamais téléversé.
- Aucune connexion aux serveurs Ankama, aucun appel réseau vers le jeu, aucun appel au CDN de données
  au runtime.
- Aucune automatisation dans l'application web ; les deux fonctions actives de l'overlay sont
  décrites comme optionnelles et « plus proches » des pratiques interdites.
- Non-commercial de bout en bout, écrit dans les mentions légales, les CGU et le JSON-LD.
- Non-affiliation affirmée partout où la marque apparaît en texte : pied de page sur toutes les
  pages, mentions légales, `llms.txt`.
- Mention de copyright WAKFU au pied de chaque page, dans les 4 langues, année calculée.
- Engagement de retrait sur simple demande (mentions légales § 3) — concrètement, ce qui évite
  l'escalade pour un site de fans.
- Chat jamais transmis, historique cloisonné par compte, fixtures pseudonymisées et contrôlées en CI.
- Routes référentiel et relais d'icônes réservés aux deux clients du projet (intention de
  non-redistribution écrite dans le code).
- Inventaire des assets copiés avec origine et transformation (`public/assets/SOURCES.md`).
- Les CGU de l'app renvoient l'utilisateur aux CGU d'Ankama et refusent de garantir la conformité de
  son usage : exact, et loyal.

---

## 5. Recommandations, par ordre de priorité

| # | Action | Fichiers | Clause | Statut / effort |
| --- | --- | --- | --- | --- |
| 1 | **Une demande d'autorisation écrite à Ankama** (Support, art. 11, ou « Le coin des développeurs »), archivée dans `docs/` avec sa réponse, couvrant explicitement : (a) le logo — pictogramme officiel de l'encyclopédie, recoloré, utilisé comme identité d'un outil communautaire non commercial ; (b) le nom « Wakfu Companion » et le domaine `wakfu-companion.com`, avec le pied de page de non-affiliation ; (c) les illustrations copiées et relayées (`public/assets/`, relais wakassets) ; (d) les galeries d'avatars fan-art de `static.ankama.com/web-test/` ; (e) le référentiel monstres/familles/donjons/butins relevé dans l'encyclopédie intégrée, ou à défaut un export officiel ; (f) la tolérance « site de fans » de 5.3.3. **Plan B en cas de refus, point par point** : logo propre (favicon, 8 icônes PWA, `og:image`, en-tête), retrait des galeries fan-art et de l'attribut `referrerpolicy`, retrait des assets visés. | — | 13.3, 13.1, 13.2, 5.3.3 | **Décidé le 2026-09-21**, à envoyer |
| 2 | Retirer `alternateName` du JSON-LD ; garder `name`, `description` et la FAQ, descriptifs. | `src/index.html` | 13.3 | **Fait le 2026-09-21** |
| 3 | Reformuler `terms.notice.body` § 3 : source des monstres = « informations publiques du jeu lui-même, principalement son encyclopédie intégrée » ; date « Dernière mise à jour » passée au 21 septembre 2026 dans les 4 locales. | `translations.ts` (×4) | 13.2, 13.5 | **Fait le 2026-09-21** |
| 4 | **Garde des routes référentiel sans connexion** — voir les options détaillées ci-dessous. Décision du mainteneur : B + C. **Fait le 2026-09-21** : jeton d'application signé en cookie `wc_app` (`server/http/app-token.ts`), émis par `POST /api/v1/app/token` après vérification Turnstile (`server/http/turnstile.ts`), exigé par les six routes de données en plus de `Sec-Fetch-Site: same-origin` (`functions/api/_caller.ts`) ; le relais d'icônes reste sur l'en-tête seul ; rejeu automatique côté client sur `403 app_token_required` (`ApiClientService`) ; CSP, workflows, politique de confidentialité § 2 (4 locales) et `server/README.md` mis à jour. Émission du jeton limitée par IP dans le code (`APP_TOKEN_RULE`, 20 par 10 min, table `auth_rate_limits`). **Option A non retenue** : le rate limiting de zone n'est pas disponible sur le plan Cloudflare du projet (constat du mainteneur) ; ce qu'il aurait apporté relève du coût en cas de flot, pas de la redistribution, voir `server/README.md`. **Reste à faire par le mainteneur** : créer les deux widgets Turnstile (prod, preview) et poser `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `APP_TOKEN_SECRET` (+ `_PREVIEW`). | `server/http/app-token.ts`, `server/http/turnstile.ts`, `functions/api/v1/app/token.ts`, `functions/api/_caller.ts`, `src/app/core/api/app-token.service.ts`, `public/_headers`, workflows | 13.2, licence de données | **Fait le 2026-09-21** (code) ; configuration Cloudflare à faire |
| 5 | **Overlay** (autre dépôt) : livrer la frappe simulée désactivée par défaut, l'annoncer comme « programme tiers » au sens des Règles de conduite. Dans ce dépôt, seule la formulation de `terms.notice.body` § 2 est concernée : dire que ces fonctions relèvent des programmes tiers que les Règles sanctionnent d'un bannissement définitif « quel qu'en soit l'usage », et non seulement qu'elles « s'en rapprochent davantage ». | `translations.ts` (`terms.notice.body` ×4) ; dépôt overlay | 5.2.5, règle « Triche » | Reporté au dépôt de l'overlay |
| 6 | **Traçabilité du référentiel** : puisque la règle du projet est de ne rien décrire dans le dépôt, tenir hors dépôt, pour chaque fichier de `repository/`, la source (JSON officiel, encyclopédie intégrée, site web le cas échéant), la méthode, la date de relevé et le volume — de quoi répondre à une demande d'Ankama en une page. | hors dépôt | 13.2, 13.5 | Faible |
| 7 | **Relire la licence de données WAKFU** depuis le fil officiel (inaccessible à cet audit) : libellé exact de la mention imposée, interdiction éventuelle de sous-licence, année « en cours ». | `footer.copyright`, `terms.notice.body` § 3 | licence | Trivial |
| 8 | **Maintenir** : aucun revenu (dons compris) sans réévaluer 5.2.7, la licence et 5.3.3 ensemble ; aucun nouveau `<img>` vers `static.ankama.com` ; aucun nouveau texte machine portant « Wakfu + nom de produit ». | — | 5.2.7, 13.3 | — |
| — | ~~Cohérence de « ne les croisons pas entre comptes » avec le script d'agrégation~~ | `server/import/analyze-universal-loot.ts`, `package.json` | 13.1 | **Sans objet : script et scripts npm supprimés le 2026-09-21** |

### Recommandation 4, détail : protéger les routes référentiel sans imposer de connexion

Préalable honnête : sans identité, aucune technique ne rend le catalogue inaccessible à un script
déterminé, parce qu'un navigateur *est* un script. Tout ce qui suit distingue un navigateur humain
d'un automate avec plus ou moins de fiabilité, ou rend l'aspiration coûteuse. L'overlay n'est pas
concerné : il garde sa session `Bearer`. Contrainte propre au site : les `<img>` du relais d'icônes
ne peuvent pas porter d'en-tête `Authorization`, donc tout jeton côté site doit voyager en
**cookie**, pas en `Bearer`.

| Option | Principe | Ce que ça arrête | Ce que ça n'arrête pas | Coût |
| --- | --- | --- | --- | --- |
| **A. Réglages Cloudflare, zéro code** | Règle de *Rate Limiting* sur `/api/v1/catalog/*`, `/api/v1/icons/*`, `/api/v1/monster-loot`, `/api/v1/monster-families`, `/api/v1/dungeons`, `/api/v1/items/*`, `/api/v1/monsters/*` (ex. 60 requêtes/min par IP) + *Bot Fight Mode*. | L'aspiration en masse des icônes et des détails d'objets, les bots connus. | Un téléchargement unique de l'index (`/catalog/`, ~350 Ko en une requête). | Nul en code ; 1 règle de rate limiting incluse dans le plan gratuit. |
| **B. Cookie d'application signé** | Route `POST /api/v1/app/token` : émet un jeton HMAC-SHA256 (WebCrypto, secret `APP_TOKEN_SECRET` en variable Pages, horodatage, durée 1 h) posé en cookie `wc_app` `httpOnly; Secure; SameSite=Strict; Path=/api/v1`. `rejectUnknownCaller` accepte : session `Bearer` (overlay) **ou** cookie `wc_app` valide **et** `Sec-Fetch-Site: same-origin`. `ApiClientService` appelle la route au démarrage et à l'expiration. | Le `curl` naïf, le hotlink de nos icônes depuis un autre site, la lecture directe d'une URL d'API dans la barre d'adresse. | Un script qui appelle d'abord `/app/token` puis rejoue le cookie : deux requêtes au lieu d'une. Seul, c'est un ralentisseur. | Faible : une route, une fonction de vérification, ~40 lignes plus tests. |
| **C. B + Cloudflare Turnstile** | `/app/token` n'émet le cookie qu'après vérification serveur (`siteverify`) d'un jeton Turnstile obtenu par le widget en mode *invisible/managed* au chargement de l'app. | Les scripts et navigateurs headless ordinaires : c'est la seule option qui distingue réellement un humain d'un automate sans connexion. | Un service de résolution payant ; l'aspiration devient coûteuse, pas impossible. | Moyen : clé de site + secret, script `challenges.cloudflare.com` à autoriser dans la CSP (`script-src`, `frame-src`, `connect-src`), mention dans la politique de confidentialité § 2 (Cloudflare traite des signaux navigateur), écran de secours si le widget échoue. Skill `turnstile-spin` disponible pour le câblage. |
| **D. Middleware Pages sur la page HTML** | `functions/_middleware.ts` pose le cookie signé sur toute réponse HTML ; les routes exigent le cookie. | Le `curl` naïf, comme B. | Un script qui charge `/` d'abord. | Déconseillé : le middleware racine s'exécute sur *chaque* requête statique et consomme le quota d'invocations (100 000/jour en plan gratuit). B fait la même chose à moindre coût. |

Décision (2026-09-21) : **B + C**, implémentés ; A écarté, le rate limiting de zone n'étant pas
disponible sur le plan Cloudflare du projet. B + C suffisent pour l'objectif CGU : la garde exprime
et applique une intention de non-redistribution, et un automate ne l'obtient plus gratuitement.
Résiduel accepté : un acteur qui paie un service de résolution Turnstile obtient 12 h d'accès aux
données par jeton ; un flot de requêtes coûte des invocations Pages avant d'être refusé (aucune
mesure en code ne l'évite). `Sec-Fetch-Site` reste le premier filtre, `robots.txt`
(`Disallow: /api/`) inchangé.

---

## 6. Extraits des textes cités

Reproduits pour référence, tels que lus le 21 septembre 2026.

**CGU art. 5.1** — « la Société vous concède une licence limitée, non-exclusive, non-transférable et
révocable vous permettant d'accéder et d'utiliser les Jeux et de télécharger, d'installer et
d'utiliser les Clients pour votre utilisation personnelle et non-commerciale. Vous reconnaissez que
l'utilisation d'autres techniques de connexion que celles fournies par Ankama ou par l'un de ses
partenaires pour accéder aux Jeux est interdite. »

**CGU art. 5.2.2** — « Vous n'avez pas le droit de modifier les Jeux ou les Clients (à l'exception de
l'application des mises à jour). Il vous est interdit de modifier ou de faire modifier un fichier
quelconque faisant partie des Jeux ou des Clients sans l'autorisation expresse de la Société et il
vous est interdit de créer des œuvres dérivées des Jeux. »

**CGU art. 5.2.5** — « Vous vous interdisez de créer, d'utiliser ou de promouvoir un quelconque
programme ou outil susceptible de causer un dommage aux Jeux ou aux Clients, d'altérer l'expérience
des Jeux ou de contourner les règles des Jeux, tels que, de manière non limitative, les bots, virus,
cheval de Troie, outils de piratage, moyens de tricherie, logiciels d'automatisation, logiciels de
modification, logiciels permettant d'automatiser des actions de clic de souris (communément appelés
« auto-clic ») ou autres logiciels non autorisés, destinés à modifier les Jeux ou les Clients. Par
ailleurs, vous vous interdisez de contourner ou de tenter de contourner, de quelque manière que ce
soit, toute mesure technique mise en place par Ankama ou par un tiers pour protéger, contrôler ou
restreindre l'accès aux Jeux ou aux Clients ou pour empêcher l'utilisation non autorisée des Jeux et
des Clients. […] Ankama peut surveiller l'utilisation de ses Jeux et du Launcher, à la fois sur ses
serveurs et sur votre ordinateur ou appareil mobile, afin de prévenir la triche […]. Dans ce cadre,
les Clients peuvent contenir des fonctionnalités conçues pour détecter l'utilisation de programmes
et outils non autorisés par les présentes qui s'exécutent conjointement à un Jeu sur votre
ordinateur ou appareil mobile. »

**CGU art. 5.2.6** — « Vous vous engagez à ne pas espionner et intercepter les protocoles de
communication que la Société utilise, ni à utiliser un intercepteur pour les données ou le
protocole. »

**CGU art. 5.2.7** — « De manière générale, vous vous engagez à ne pas utiliser et exploiter les
Clients et/ou les Jeux à des fins commerciales. »

**CGU art. 5.3.2** (extrait) — « […] mettre à disposition des autres utilisateurs des informations
personnelles sur vous-même ou sur un autre utilisateur ; collecter des informations dans les Jeux. »

**CGU art. 5.3.3** — « Vous vous interdisez de procéder à toute forme de publicité ou de promotion
commerciale. Ankama pourra néanmoins autoriser, à sa seule discrétion, la diffusion de sites de fans
et autres forums de guildes, en lien avec l'univers des jeux d'Ankama, sous réserve qu'ils ne
contiennent pas de contenu portant atteinte à la législation en vigueur et aux CGU. »

**CGU art. 13.1** (extrait) — « Tous les éléments, fonctionnalités, outils, documents qui font partie
de l'univers d'Ankama et fournis par Ankama (de façon non limitative les Jeux, le Launcher, les Sites
et l'ensemble du contenu proposé sur le Launcher, les Sites, […] tout titre, code informatique,
thème, objet, personnage, nom de personnage, histoire, dialogue, slogan, concept, œuvre d'art,
animation, son, […] transcription de conversation dans les Jeux, information relative au profil
d'un personnage, enregistrement ou répétition de parties de Jeu et le logiciel de serveur) sont
protégés par les lois françaises et internationales sur le droit d'auteur et la propriété
intellectuelle et ne peuvent faire l'objet d'aucune utilisation sans l'autorisation préalable et
écrite d'Ankama. »

**CGU art. 13.2** — « Toutes données liées aux Jeux, Services ou Sites appartiennent à Ankama et sont
protégées par les lois françaises, européennes et internationales sur le droit d'auteur. […] Vous
n'avez pas le droit, en tout ou partie, de copier, reproduire, traduire, extraire, modifier le code
source, désassembler, décompiler, modifier, louer, vendre, distribuer ou créer des œuvres dérivées
inspirées des Jeux ou du contenu sans l'accord écrit préalable d'Ankama. »

**CGU art. 13.3** — « Toutes les marques figurant sur les Sites ou dans les Services sont des marques
créées par la Société ou dont elle détient les droits d'exploitation. Vous ne pouvez pas utiliser
ces marques sans l'autorisation écrite préalable d'Ankama. Vous n'avez pas l'autorisation d'utiliser
des meta-tags ou d'autres « textes cachés » utilisant les noms et marques d'Ankama sans
l'autorisation écrite préalable de celle-ci. »

**CGU art. 13.4** — « Toute utilisation non conforme met fin à l'autorisation ou à la licence
accordée par Ankama. »

**CGU art. 13.5** (extrait) — « Ankama s'oppose à toutes opérations de moissonnage et de fouille de
textes et de données au sens de l'article L. 122-5-3 du code de la propriété intellectuelle. Cette
opposition couvre l'ensemble du Site et du Launcher et des contenus auxquels ils donnent accès.
Toutes opérations de moissonnage et de fouille de textes et de données visant le Site, le Launcher
et leur contenu, y compris par des dispositifs de collecte automatisée de données, constituent donc
des actes de contrefaçon sauf obtention d'un accord spécifique formellement exprimé d'Ankama. […]
< TDM-RESERVATION: 1> ou TDM: NO »

**Règles de conduite WAKFU, « Triche »** — « La création, l'utilisation ou la promotion d'un
programme tiers ou d'un outil non autorisé par les CGU (dont les programmes communément appelés
« bot » ou « auto-clic ») est interdite, quel qu'en soit l'usage. […] La modification du client de
jeu est interdite. Ceci englobe tous les fichiers présents dans le répertoire d'installation du
jeu. » — Grille des sanctions : « Création, utilisation ou promotion d'un programme tiers non
autorisé par les CGU et/ou les règles du jeu. → Bannissement définitif » ; « Multi-compte non
autorisé par les règles du jeu → Bannissement définitif ».

**Règles de conduite WAKFU, « Serveurs monocomptes »** — « Un même joueur ne peut connecter qu'un
seul compte à la fois par serveur. »

---

## 7. Journal des décisions et modifications

- **2026-09-21** — Analyse initiale (commit `782359e`).
- **2026-09-21** — Décisions du mainteneur : demande d'autorisation à Ankama pour le logo
  (pictogramme officiel recoloré), les illustrations, les galeries fan-art, le nom et le domaine, le
  référentiel ; le référentiel provient principalement de l'encyclopédie intégrée au jeu ;
  l'overlay se traite dans son dépôt.
- **2026-09-21** — Modifications dans ce dépôt : retrait des `alternateName` du JSON-LD
  (`src/index.html`) ; reformulation de `terms.notice.body` § 3 et date au 21 septembre 2026 dans les
  4 locales ; suppression de `server/import/analyze-universal-loot.ts` et des scripts npm
  `analyze:universal-loot`, `main:analyze:universal-loot`, `dev:analyze:universal-loot` ; commentaire
  de `wakfu-universal-loot.data.ts` mis à jour.
- **2026-09-21** — Recommandation 4, options B + C implémentées : jeton d'application en cookie
  `wc_app` + vérification Turnstile (voir la ligne 4 du tableau pour le détail des fichiers et ce
  qui reste à configurer côté Cloudflare). Politique de confidentialité § 2 et date au 21 septembre
  2026 dans les 4 locales.
- **2026-09-21** — Mise en service : widgets Turnstile créés (production `wakfu-companion.com`,
  preview `claude-dev.wakfu-companion.com`, mode *Managed*, sans pre-clearance), variables et
  secrets GitHub posés, commits `2410cc1` (fonctionnalité) et `254d527` (délai porté à 3 min pendant
  un défi interactif, constaté sur la preview) ; flux vérifié en navigateur réel sur la preview
  (passage invisible en fenêtre privée, chemin interactif après clic) ; fusion dans `main` et
  déploiement en production vérifiés (`120abfb`). Registre des traitements du responsable (hors
  dépôt) mis à jour — version 8 : Turnstile au traitement n° 2 et à l'annexe A, décision motivée au
  § 7, fiche sous-traitants et note d'absence d'AIPD complétées.
