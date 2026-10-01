# Mail de demande d'autorisation à Ankama — 1er octobre 2026

Version mail de `demande-autorisation-ankama-2026-09-21.md`, restructurée pour l'adresse
officielle `contact@ankama.com` : objectif, fonctionnement, mesures prises (CGU, confidentialité,
sécurité), points soumis à autorisation, puis fonctions soumises à leur jugement. Les crochets sont
à compléter avant envoi. Archiver ici la réponse reçue.

---

**À :** contact@ankama.com
**Objet :** Demande d'autorisation – Wakfu Companion, outil communautaire gratuit et non commercial

Bonjour,

Je m'appelle [Prénom Nom], joueur de WAKFU depuis [année] ([pseudo en jeu], serveur [serveur]). Je
développe sur mon temps libre **Wakfu Companion**, un compagnon de jeu destiné à la communauté. Avant
d'aller plus loin, je souhaite vous présenter l'outil en toute transparence et vous demander les
autorisations écrites prévues par vos Conditions Générales d'Utilisation (articles 13.1 à 13.3), ainsi
que votre avis sur trois fonctions précises.

Je le dis d'emblée : ce projet est fait de bonne foi, par un joueur pour les joueurs. Il est
**entièrement gratuit, sans publicité, sans don et sans revenu d'aucune sorte**, et je n'en retire
ni n'en chercherai jamais aucun bénéfice. Son seul but est d'apporter quelque chose à la communauté
de WAKFU, dans le respect du jeu et de son éditeur.


**1. Objectif du projet**

Wakfu Companion aide le joueur à suivre et à comprendre ses propres parties : dégâts et soins de
chaque combat, historique des combats, butins obtenus, achats à l'Hôtel de Vente, suivi du chat avec
des alertes sonores configurables. Il s'adresse notamment aux joueurs qui veulent améliorer leur jeu
ou garder une trace de leur progression.

- Site : https://wakfu-companion.com
- Code source public : https://github.com/Oumbra/wakfu-companion
- Overlay de bureau facultatif : https://github.com/Oumbra/wakfu-companion-overlay


**2. Fonctionnement**

L'outil s'appuie uniquement sur le journal de jeu (`wakfu.log`) que le client WAKFU écrit déjà sur
l'ordinateur du joueur. Le joueur choisit lui-même ce fichier dans son navigateur ; le site le lit
**en lecture seule**, ligne par ligne, et en tire des statistiques affichées à l'écran.

L'outil ne se connecte jamais à vos serveurs, ne lit pas la mémoire du client, ne modifie aucun
fichier du jeu, n'intercepte aucun échange réseau et ne déclenche aucune action de jeu.

Un overlay de bureau facultatif (Windows et Linux) lit le même fichier et affiche les mêmes
informations par-dessus la fenêtre du jeu. Il comporte les fonctions décrites au point 7.


**3. Mesures prises pour respecter vos CGU**

- Lecture seule du fichier `wakfu.log` ; aucune lecture mémoire, aucune injection, aucune
  modification du client.
- Aucune action jouée à la place du joueur : pas de déplacement, de sort ni de clic automatique.
  Les seules saisies de texte sont les trois fonctions détaillées au point 7, toujours déclenchées
  par le joueur lui-même.
- Mention de non-affiliation affichée sur chaque page, dans les quatre langues du site :
  « WAKFU MMORPG : © 2012-2026 Ankama Studio. Tous droits réservés. WAKFU et ANKAMA sont des marques
  ou des marques déposées d'Ankama en France et/ou dans d'autres pays. Le site WAKFU-COMPANION est un
  site non-officiel sans aucun lien avec Ankama. »
- Objets et recettes issus des données JSON que vous publiez, sous votre licence d'utilisation des
  données.
- Inventaire public de chaque visuel repris du jeu, avec son origine
  (`public/assets/SOURCES.md` dans le dépôt).
- Aucune exploitation commerciale, sous quelque forme que ce soit.


**4. Mesures prises pour la confidentialité**

- Mode invité par défaut : sans compte, toutes les données restent dans le navigateur du joueur et
  rien n'est transmis.
- Le fichier `wakfu.log` n'est jamais envoyé sur un serveur.
- Le contenu du chat n'est jamais transmis ni conservé côté serveur : ces messages appartiennent à
  d'autres joueurs qui n'ont rien demandé.
- Compte facultatif (connexion via Discord ou Google) : il sert uniquement à retrouver son propre
  historique sur plusieurs appareils. Ces données ne sont ni publiées, ni croisées entre comptes, ni
  revendues.
- Le joueur peut exporter l'intégralité de ses données et supprimer son compte à tout moment ; la
  suppression est réelle et immédiate, sans conservation « au cas où ».
- Aucun outil de mesure d'audience, de publicité ou de traçage ; seuls des cookies strictement
  nécessaires au fonctionnement.
- Politique de confidentialité et mentions légales publiées dans les quatre langues du site,
  conformément au RGPD.


**5. Mesures prises pour la sécurité**

- Connexion exclusivement en HTTPS ; aucun mot de passe stocké (authentification déléguée à Discord
  ou Google, protocole OAuth avec PKCE).
- Jetons de session aléatoires, stockés uniquement sous forme d'empreinte (SHA-256), révocables par
  le joueur, purgés après expiration.
- Cookies protégés (`HttpOnly`, `Secure`, `SameSite`), protection anti-CSRF, politique de sécurité
  du contenu (CSP) bloquante.
- Limitation du nombre de requêtes, protection anti-robots, adresses IP jamais conservées en clair.
- Appairage de l'overlay par code à usage unique ; l'overlay apparaît dans la liste des sessions du
  joueur, qui peut le déconnecter à tout moment.
- Code source public, donc vérifiable par tous, y compris par vos équipes.


**6. Points pour lesquels je sollicite votre autorisation écrite**

1. **Logo** : utiliser comme logo de l'outil le pictogramme « W » de WAKFU, détouré de l'icône de
   l'encyclopédie de votre site et recoloré en violet. Si vous préférez que l'outil ait une identité
   propre, je le remplacerai par une création originale.
2. **Nom et domaine** : conserver le nom « Wakfu Companion » et le domaine `wakfu-companion.com`,
   avec la mention de non-affiliation citée plus haut.
3. **Images du jeu hébergées par le site** : environ 15 000 icônes d'objets, de monstres, de sorts,
   de familles et de donjons, reprises du dépôt communautaire `Vertylo/wakassets` ; ainsi que
   36 icônes de classe, une planche des portraits de classe de la « Galerie MMO » du compte Ankama,
   sept en-têtes d'interface et deux pierres de brèche détourées de captures d'écran.
4. **Avatars fan-art** : proposer comme avatar de profil les trois galeries fan-art du compte Ankama
   (Barbottine, Hoopyon, Papetona), affichées depuis `static.ankama.com` sans copie, avec le nom de
   l'artiste et un lien vers votre page. Je vous le signale en toute transparence : votre serveur
   refuse ces images lorsque la page envoie son adresse (en-tête `Referer`), et le site ne l'envoie
   pas pour ces seules images. S'il s'agit d'une protection voulue, je retire ces galeries.
5. **Données de monstres et de donjons** : reprendre les noms et caractéristiques des monstres,
   familles, donjons et tables de butin, tels que le jeu les rend publics (encyclopédie intégrée),
   afin de reconnaître un combat ou un donjon dans le journal. Ces données ne figurent pas dans vos
   exports JSON ; si vous préférez une source officielle, je m'y conformerai.
6. **Historique de combats des comptes** : conserver, pour les joueurs qui créent un compte,
   l'historique de leurs propres combats (participants, classes, dégâts, butin), réservé à son seul
   titulaire.
7. **Overlay de bureau** : distribuer l'overlay décrit au point 2, qui utilise des éléments
   d'interface, des icônes de sorts et des portraits de classe issus du jeu. Il comporte aussi une
   notification de fin de tour (Windows, désactivée par défaut) : pendant les combats seulement,
   elle observe une étroite bande au-dessus du bouton « Fin du tour » et compare l'image du nom
   affiché à celles des personnages du joueur, pour le prévenir quand c'est à lui de jouer alors que
   sa fenêtre est en arrière-plan. Aucun texte n'est lu, rien ne quitte l'ordinateur, et aucune
   action n'est déclenchée.
8. Plus généralement, **bénéficier de la tolérance que l'article 5.3.3 de vos CGU prévoit pour les
   sites de fans**.


**7. Fonctions soumises à votre jugement**

Trois fonctions de l'overlay, toutes facultatives, vont au-delà de la simple lecture : elles
**écrivent du texte dans la barre de chat du jeu à la place du joueur**. Je sais que l'article 5.2.5
et vos Règles de conduite visent les logiciels d'automatisation, et je préfère vous les exposer
moi-même plutôt que de vous laisser les découvrir.

Elles ont été conçues uniquement pour faciliter l'usage, en particulier pour le joueur qui joue deux
personnages à la fois, chacun dans sa propre fenêtre de jeu, et **en aucun cas pour tricher** ou
procurer un avantage en jeu. Chacune est déclenchée par le joueur, une fois par action, et ne
produit qu'une seule commande de chat.

1. **Raccourci « Inviter »** (désactivé par défaut) : tape `/i "Nom"` dans la fenêtre de jeu active,
   pour inviter dans le groupe le personnage de la seconde fenêtre de jeu du même joueur.
2. **Raccourci « Suivre »** (désactivé par défaut) : tape `/fol "Nom"` de la même façon, pour que le
   personnage suive l'autre.

   Pour ces deux raccourcis, « Nom » est toujours le personnage de **l'autre fenêtre de jeu du même
   joueur**, lu dans le titre de cette fenêtre (« Nom - WAKFU »). Le joueur ne peut ni saisir un
   autre nom ni viser un autre joueur, et rien n'est tapé si la fenêtre active n'est pas une
   fenêtre de jeu.

3. **Réponse depuis une alerte de chat** : lorsqu'un message déclenche une alerte, un clic sur
   l'icône en forme de bulle place `/w "Nom" ` dans la barre de chat du jeu, pour répondre à
   l'auteur du message. Le message n'est **jamais validé ni envoyé** : le joueur écrit et envoie
   lui-même sa réponse.

**Mon engagement** : si l'une de ces fonctions ne vous convient pas, elle sera modifiée
immédiatement. La saisie dans le jeu sera remplacée par une simple copie de la commande dans le
presse-papiers du joueur, qui la collera et l'enverra lui-même. Il en va de même pour la
notification de fin de tour, que je retirerai si vous la jugez inacceptable.


**8. Mes engagements**

- Ne tirer aucun revenu de ces outils, sous quelque forme que ce soit.
- Ne jamais leur faire jouer à la place du joueur.
- Maintenir la mention de non-affiliation sur chaque page.
- Retirer ou modifier sans délai tout élément que vous me signaleriez.
- Mettre l'outil en conformité si vos conditions évoluent.

Tous ces engagements seront tenus. S'il est nécessaire de formaliser cet accord par un document
juridique (convention, licence, engagement écrit), je suis tout à fait disposé à le signer.

Une réponse, même partielle (par exemple sur le seul logo, ou sur les seules fonctions du point 7),
m'aiderait déjà beaucoup : pour chaque point refusé, une solution de remplacement est prévue.

Je reste ouvert à la discussion, quel que soit le sujet, et à votre disposition pour tout échange,
démonstration ou question, à l'adresse contact@wakfu-companion.com ou [autre moyen de contact].

Je vous remercie sincèrement pour le temps que vous consacrerez à cette demande, ainsi que pour le
jeu que vous faites vivre depuis tant d'années.

Bien cordialement,

[Prénom Nom]
[Pseudo en jeu – serveur]
Wakfu Companion – https://wakfu-companion.com

---

## Réponse d'Ankama

_À compléter à réception : date, teneur de la réponse, points accordés ou refusés, suites données
dans le dépôt._
