@"C:\Users\Oumbra\AppData\Roaming\zaap\gamesLogs\wakfu\logs\wakfu_chat.log" Voici un fichier qui montre plusieurs problème pour la partie tracker de combat.

* Premièrement, lorsqu'un combat démarre il est suivi dans l'onglet "combat en cours" mais lorsqu'il est terminé, toutes ses informations sont retirés de l'onglet "combat en cours" pour ajouter une nouvelle entrée d'historique dans l'onglet historique.
* Deuxièmement, les dégâts de l'état "enflammé" ne sont pas correctement attribué au personnage mais à l'ennemi qui les subit. C'est incorrecte, il faut ajouter une ligne (Enflammé). Pareil pour les poisons ou passif tel que "Hachure" ou encore "Force sage"
Peux tu faire les changements afin de corriger ces erreurs d'interpretation ?

--

Je remarque encore que les dégats indirect ne sont pas correctement interprété.
Il existe un pattern simple pour les identifier facilement, le voici:
([^:\]]+): -((\d+\s)?\d+) PV \([^\)]+\) \([^\)]+\)? \([^\)]+\)? \([^\)]+\)?

Ce pattern peu surement être amélioré mais l'objectif c'est qu'il match avec les cas suivant :

- "[Information (combat)] The Undertroolker: -712 PV (Lumière) (Eau) (Parade !) (Contre-attaque)", ici le sort ou capacité "Contre-attaque" à infligé 712 dommages de type lumière (axé Eau)
- "[Information (combat)] El Pochito: -2 228 PV (Lumière) (Eau) (Contre-attaque)", ici le sort ou capacité "Contre-attaque" à infligé 2 228 dommages de type lumière (axé Eau)
- "[Information (combat)] The Undertroolker: -2 548 PV (Lumière) (Eau) (Parade !) (Enflammé)", ici le sort ou capacité "Enflammé" à infligé 2 548 dommages de type lumière (axé Eau)
- "[Information (combat)] El Pochito: -3 596 PV (Lumière) (Eau) (Enflammé)", ici le sort ou capacité "Enflammé" à infligé 3 596 dommages de type lumière (axé Eau)
- "[Information (combat)] Rey Mystroolrio: -789 PV (Lumière) (Eau) (Canine)", ici le sort ou capacité "Canine" à infligé 789 dommages de type lumière (axé Eau)
- "[Information (combat)] Sac à patates: -275 PV (Terre) (Hachure)", ici le sort ou capacité "Hachure" à infligé 275 dommages de type Terre

Dans ce pattern le "Parade !" est à ignoré

--

- J'aimerai que l'experience affiché dans la modal de recap soit bloqué à 3 lignes maximum et que s'il y a plus d'information, une petit bout "afficher plus", "..." ou encore un chevron vers le bas permette d'afficher le reste des informations mais sans agrandir le block, il devra donc être scrollable. 
- Pour les combats, j'aimerai que tu mettes un collapse où l'on voit les combats totaux (victoire + defaite) et lorsque l'on ouvre le collapse, on est le détail: une ligne pour les victoires (vert), une ligne pour les defaites dépensé (rouge). J'aimerai également comptabiliser les challenges réussi ou échoué en combat, sur une seule ligne après les victoires et les défaites, tel que :
    > Challenges
    > --------------------
    > Réussi X | Échoué X
- J'aimerai que pour les historiques de combats, le butin soit un collapse avec pour libellé "BUTIN    x objet(s)" où x est le nombre d'objet distinct (pas la somme des objets). S'il n'y a eu aucun butin, ne pas mettre le rendu en collapse.
- J'aimerai qu'il y ai, pour les historiques de combats, une section qui affiche l'expérience gagné par celui-ci, par personnage avec leur image de classe, leur nom et l'experience. Tout ça doit être dans un collapse sauf si aucun point d'expérience n'a été gagné.

- J'aimerai que les éléments suivi par la section "Suivi" soit précédé par leur image, ennemi comme objet.
- J'aimerai que le champ de recherche de la section "Suivi" aie une auto-complétion à partir de 3 caractères sur le nom des ennemis et des objets. les 5 propositions les plus pertinente devront être affichée ([image] [nom]).
