# Bug

- Lors du premier chargement du fichier, un nouvel historique de combats et construit. Le problème c'est que si on fait plusieurs fois la manipulation, on se rend vite compte que les historiques sont dupliqués.
- lorsque l'on utilise le clique pour sélectionner le fichier `wakfu.log` à interprété et que celui-ci est enrichi par le jeu, l'application ne met pas à jour les informations, comme si la lecture du fichier n'était pas en continue avec cette méthode.

# Ameliorations

- J'aimerai que tu appliques le même système que le bouton "changer de fichier" pour le bouton "Réinitialiser". C'est à dire fond transparent et bordure grise et lors du hover, mettre les couleurs actuelle.

- Je remarque que certain objet n'ont pas d'image, par exemple "Jeton Brut", "Eclat" ou encore "Mimicroquettes". J'ai pu trouver un bon nombre des images manquante sur l'encyclopédie de wakfu officiel https://www.wakfu.com/fr/mmorpg/encyclopedie/ et là plu précisement sur le detail du monstre El Pochito : https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/2443-pochito. Où l'image de "Jeton Brut" est : https://static.ankama.com/wakfu/portal/game/item/64/64921003.png; et l'image de "Eclat" est https://static.ankama.com/wakfu/portal/game/item/64/81127083.png, ou encore "Mimicroquettes": https://static.ankama.com/wakfu/portal/game/item/42/47612324.w40h40.png. J'ignore comme tu peux récupérer les images qui ne sont pas visible également sur l'encyclopedie, il y a également le cdn de Wakfuli qui permet de récupérer les images d'autre objet que je n'ai pas trouvé sur l'encyclopedie tel que l'objet "Ficelle d'El Pochito" : https://cdn.wakfuli.com/items/13316901.webp. 
Il serait peut nécessaire que tu construises un referentiel d'objet et d'item via les différents json mis à disposition de l'equipe Wakfu pour connaitre l'id des elements qui semble être utilisé pour leur système d'image. Voici le lien où tout est expliqué sur la méthode de récupération des fameux JSON et sur ce qu'ils continnent et de leur relation entre eux : https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json


# Features

- historique des achats par objet:
    - date via tooltip sur icon
    - icon de l'objet
    - nom de l'objet
    - quantité
    - prix

- historique des échanges :
    - date via tooltip sur icon
    - nom du personnage
    - deux sections (acquis / cédés)
        - icon de l'objet
        - nom de l'objet
        - quantité (acquis ou cédé)