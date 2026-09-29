# Demande d'autorisation à Ankama — brouillon du 21 septembre 2026, relu le 28 septembre 2026

Brouillon de la demande prévue par la recommandation 1 de `analyse-cgu-2026-09-21.md`. À envoyer
par le mainteneur, puis à archiver ici avec la réponse reçue. Les crochets sont à compléter avant
envoi.

**Canal conseillé** : un ticket au Support Ankama (art. 11 des CGU), catégorie la plus proche de
« autre demande » ou « partenariat / communauté ». Il laisse une trace écrite datée, attendue par
l'art. 13.3 (« autorisation écrite »), et peut être transmis au service juridique. « Le coin des
développeurs » du forum est public et ne garantit pas une réponse d'Ankama : à réserver à une
relance. Si le formulaire limite la longueur du message, joindre la lettre en PDF et ne garder dans
le corps que le premier paragraphe et la liste des points.

**Relecture du 28 septembre 2026** — corrections apportées au brouillon du 21, vérifiées dans le
code :

- Point 4 : le brouillon affirmait que les portraits de la « Galerie MMO » étaient « affichés depuis
  vos serveurs sans copie ». C'est faux : ils sont copiés et assemblés dans une planche hébergée
  par le site (`public/assets/avatars/`). Ce qui est chargé depuis `static.ankama.com/web-test/`,
  ce sont les trois galeries **fan-art**, et seulement en supprimant l'en-tête `Referer` que le
  serveur d'Ankama exige. Le brouillon taisait ce contournement ; il est désormais déclaré.
- Point 3 : « illustrations officielles chargées directement depuis `static.ankama.com` » ne
  correspondait plus au code (retiré le 2026-09-20). Le miroir complet des icônes wakassets
  (≈ 15 000 fichiers, publiés par le site depuis le 2026-09-23) n'était pas mentionné.
- Overlay : absent du brouillon, alors que le site le présente et le fait appairer, et que
  l'engagement « ne jamais en faire un programme d'automatisation » était contredit par sa frappe
  clavier simulée. Une autorisation obtenue sans le mentionner ne le couvrirait pas et fragiliserait
  le reste de la demande. Le point 7 le décrit tel qu'il est. **Décision du mainteneur à prendre
  avant envoi** : garder ce point (recommandé), ou retirer d'abord la frappe simulée de l'overlay
  (presse-papiers, recommandation 1 de `wakfu-companion-overlay/docs/analyse-cgu.md`) et adapter le
  paragraphe.
- Ajouts : l'historique de combats conservé côté serveur pour les comptes (point 6, art. 13.1), la
  distinction avec les objets et recettes déjà couverts par la licence de données JSON, et le
  détail du plan de remplacement par point.

---

**Objet : demande d'autorisation pour « Wakfu Companion », outil communautaire non commercial**

Bonjour,

Je m'appelle [Prénom Nom], joueur de WAKFU depuis [année], et je développe sur mon temps libre
**Wakfu Companion**, un compagnon de jeu accessible à l'adresse `https://wakfu-companion.com`. Il lit
le journal de jeu (`wakfu.log`) que le client WAKFU écrit déjà sur l'ordinateur du joueur et lui
présente ses propres combats : dégâts, soins, historique, butins, achats à l'Hôtel de Vente, avec
des alertes sonores. Le site ne lit que ce fichier texte, en lecture seule : il ne se connecte
jamais à vos serveurs, ne lit pas la mémoire du client, ne modifie aucun de ses fichiers et ne
déclenche aucune action de jeu. Le code est public (`https://github.com/Oumbra/wakfu-companion`) et
l'outil est **gratuit, sans publicité, sans don ni revenu d'aucune sorte**.

En relisant vos Conditions Générales d'Utilisation (version d'août 2025), j'ai constaté que plusieurs
aspects de l'outil relèvent de votre autorisation écrite (articles 13.1 à 13.3), que la mention de
non-affiliation affichée sur chaque page ne remplace pas. Les objets et recettes proviennent des
données JSON que vous publiez sous votre licence d'utilisation des données ; ce qui suit concerne le
reste. Je vous demande donc l'autorisation, pour cet usage personnel et non commercial, de :

1. **Utiliser comme logo de l'outil le pictogramme « W » de WAKFU**, détouré de l'icône de
   l'encyclopédie de votre site et recoloré en violet, comme icône d'onglet, icône d'application
   web, logo d'en-tête et image d'aperçu des liens. Si vous préférez que l'outil ait une identité
   propre, je le remplacerai par une création originale.
2. **Conserver le nom « Wakfu Companion » et le domaine `wakfu-companion.com`**, avec, sur chaque
   page et dans les quatre langues du site, la mention : « WAKFU MMORPG : © 2012-2026 Ankama
   Studio. Tous droits réservés. WAKFU et ANKAMA sont des marques ou des marques déposées d'Ankama
   en France et/ou dans d'autres pays. Le site WAKFU-COMPANION est un site non-officiel sans aucun
   lien avec Ankama. »
3. **Afficher des images du jeu, hébergées par le site** :
   - environ 15 000 icônes d'objets, de monstres, de sorts, de familles et de donjons, reprises du
     dépôt communautaire `Vertylo/wakassets` et publiées par le site lui-même (plutôt que chargées
     depuis GitHub, pour ne pas transmettre l'adresse IP des visiteurs à un tiers) ;
   - quelques visuels copiés : 36 icônes de classe, une planche des portraits de classe de la
     « Galerie MMO » du compte Ankama, sept en-têtes d'interface et deux pierres de brèche
     détourées de captures d'écran.

   Chaque fichier copié est inventorié avec son origine dans le dépôt
   (`public/assets/SOURCES.md`).

4. **Proposer comme avatar de profil les trois galeries fan-art du compte Ankama** (Barbottine,
   Hoopyon, Papetona), affichées depuis `static.ankama.com/web-test/` sans copie, avec le nom de
   l'artiste et un lien vers la page d'avatar du compte Ankama. Je vous le signale en toute
   transparence : votre serveur refuse ces images quand la page qui les appelle envoie son adresse
   (en-tête `Referer`), et le site ne l'envoie pas pour ces seules images. Je comprends qu'il peut
   s'agir d'une protection voulue ; c'est pourquoi je vous demande explicitement si cet usage vous
   convient. À défaut, je retire ces galeries.
5. **Reprendre les noms et caractéristiques des monstres, familles de monstres, donjons et tables
   de butin**, tels que le jeu les rend publics, principalement dans son encyclopédie intégrée,
   afin de reconnaître un combat ou un donjon dans le journal du joueur. Ces données ne figurent
   pas dans vos exports JSON ; si vous préférez qu'elles proviennent d'un export officiel, je m'y
   conformerai.
6. **Conserver, pour les joueurs qui créent un compte sur le site, l'historique de leurs propres
   combats** (participants, classes, dégâts, butin), afin qu'ils le retrouvent sur plusieurs
   appareils. Ces données restent réservées à leur titulaire : elles ne sont ni publiées ni croisées
   entre comptes, et le joueur peut les supprimer à tout moment. Le chat n'est jamais transmis.
7. **L'overlay de bureau** (`https://github.com/Oumbra/wakfu-companion-overlay`), programme
   facultatif pour Windows et Linux qui lit le même fichier `wakfu.log` et affiche les mêmes
   informations par-dessus la fenêtre du jeu, avec des éléments d'interface, des icônes de sorts
   et des portraits de classe issus du jeu. Comme le site, il ne se connecte pas à vos serveurs, ne
   lit pas la mémoire du client et n'en modifie aucun fichier. Deux fonctions optionnelles vont
   au-delà de la lecture, et je préfère vous les exposer plutôt que de vous laisser les découvrir :
   - une frappe clavier simulée dans le chat, déclenchée par le joueur à chaque fois. Elle sert
     au joueur qui joue deux personnages à la fois, chacun dans sa fenêtre de jeu. Les raccourcis
     « Inviter » et « Suivre » (désactivés par défaut) tapent `/i "Nom"` ou `/fol "Nom"` dans la
     fenêtre de jeu active, et « Nom » est toujours le personnage de **la seconde fenêtre de jeu
     du même joueur** : l'overlay le lit dans le titre de cette fenêtre (« Nom - WAKFU »). Le
     joueur ne peut donc ni saisir un autre nom, ni viser un autre joueur, et rien n'est tapé si
     la fenêtre active n'est pas une fenêtre de jeu. Par ailleurs, un clic sur une alerte de chat
     prépare `/w "Nom" ` pour répondre à l'auteur du message, sans l'envoyer.

     Code correspondant :
     - choix du personnage de l'autre fenêtre, et refus si la fenêtre active n'est pas une fenêtre de jeu : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/chat_command.rs#L180-L198
     - reconnaissance d'une fenêtre de jeu par son titre « Nom - WAKFU » : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/game_window.rs#L96-L99

   - une notification de fin de tour (Windows, désactivée par défaut), qui prévient le joueur quand
     vient le tour d'un de ses personnages, utile lorsque sa fenêtre est en arrière-plan. Elle ne
     lit pas toute la fenêtre du jeu : seulement une bande en bas de la fenêtre, où se trouve le
     bouton « Fin du tour », et elle n'analyse que la zone juste au-dessus de ce bouton, où le jeu
     affiche le nom du personnage dont c'est le tour. Ce nom n'est pas lu comme du texte : son image
     est comparée à celles que l'overlay a mémorisées pour les personnages du joueur. Cette lecture
     n'a lieu que pendant les combats, et rien ne quitte l'ordinateur.

     Code correspondant :
     - hauteur de la bande lue en bas de la fenêtre : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/turn_watch/capture.rs#L31-L33
     - copie des seules dernières lignes de la fenêtre : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/turn_watch/capture.rs#L64-L91
     - zone du nom, juste au-dessus du bouton « Fin du tour » : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/turn_watch/vision.rs#L191-L215
     - comparaison d'images, sans lecture du texte : https://github.com/Oumbra/wakfu-companion-overlay/blob/32756ad0c4d5e907aa4c408b9412ed8e68d8c15e/crates/overlay-ui/src/turn_watch/vision.rs#L380-L386

   Je sais que l'article 5.2.5 et vos Règles de conduite visent les logiciels d'automatisation.
   Pouvez-vous m'indiquer si ces deux fonctions sont acceptables ? Si ce n'est pas le cas, je les
   retirerai : la frappe simulée serait remplacée par une simple copie de la commande dans le
   presse-papiers, que le joueur colle lui-même.

8. Plus généralement, **bénéficier de la tolérance que l'article 5.3.3 des CGU prévoit pour les
   sites de fans**.

Je m'engage en retour à ne tirer aucun revenu de ces outils, à ne jamais leur faire jouer à la place
du joueur, à maintenir la mention de non-affiliation, à retirer sans délai tout élément que vous me
signaleriez, et à les mettre à jour si vos conditions évoluent. Une réponse même partielle (par
exemple sur le seul logo, ou sur le seul overlay) m'aiderait déjà : pour chaque point refusé, le
remplacement est prévu.

Je vous remercie pour votre attention et reste à votre disposition pour toute question, à
l'adresse `contact@wakfu-companion.com`.

Cordialement,

[Prénom Nom]
[pseudo en jeu, serveur]

---

## Réponse d'Ankama

_À compléter à réception : date, canal, teneur de la réponse, points accordés ou refusés, suites
données dans le dépôt._
