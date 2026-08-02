# Features

- J'aimerais que toutes les tooltips de l'application soit bien des élements normalisé avec à minima le style suivant : 
    { padding: 4px 8px; background: #000; color: #fff; font-family: inherit; font-size: .72rem; font-weight: 400; white-space: nowrap; border-radius: 4px; border: 1px solid #333; }
    J'aimerais que tous les attributs `title` soit convertit en attribut `data-tooltip`.

- J'aimerais que toutes les images d'historique de combat aient un tooltip affichant le nom correspondant à l'image :
    - S'il s'agit d'une image de donjon, il faut que la tooltip affiche le nom de ce donjon. 
    - S'il s'agit d'une image de monstre, il faut que la tooltip affiche le nom de ce monstre.
    - s'il s'agit d'une image de brèche, ne pas affiché de tooltip

- J'aimerais ajouter des petits icones `?` sur les sections/features (combats, historique > combats, historique > achats, historique > échanges, chat, profil > alerte, profil > personnages) afin d'afficher une modale explicant le foncitonnement de la section/feature avec ses règles, contrainte, bénéfices, etc... Par exemple, pour la section/feature `historique > échanges` il faut expliqué que les échanges entre les personnages du roster déclaré ne sont pas historisé. Etc...

- J'aiemrais que tu ajoutes une tooltip sur toutes les lignes présentant un allié (combat en cours, historique de combat, recap de session) avec le message "Clic droit pour changer la classe/sexe".

- J'aimerais que tu rajoutes une section butin dans le collapse combat de la modal recap répertoriant l'ensemble des objets qui ont été récupéré à la fin des combats. Je veux que TOUTES les fonctionnalités (design, actions, tries) présentent dans la section `historique > combat > butin` soient implémenté dans cette nouvelle section dans `recap > combat > butin`.

- J'aimerais ajouter une fonction dans le suivi des objets avec un switch icone où par defaut le comportement reste inchanger et compte le nombre d'élément (objet ou monstre). L'autre option serait de décompter à partir d'une valeur numérique et jouer une alerte sonore, avec un toast et l'animation de confetti déjà existante, lorsque le compteur de l'élément suivi tombe à zero.

# WIP to reading / to ignore

- J'aimerais que tu fasses un réferentiel de toutes les recettes des objets du jeu ...