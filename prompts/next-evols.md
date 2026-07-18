
# Ameliorations

- Je remarque que certain objet n'ont pas d'image, par exemple "Jeton Brut", "Eclat" ou encore "Mimicroquettes". J'ai pu trouver un bon nombre des images manquante sur l'encyclopédie de wakfu officiel https://www.wakfu.com/fr/mmorpg/encyclopedie/ et là plu précisement sur le detail du monstre El Pochito : https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/2443-pochito. Où l'image de "Jeton Brut" est : https://static.ankama.com/wakfu/portal/game/item/64/64921003.png; et l'image de "Eclat" est https://static.ankama.com/wakfu/portal/game/item/64/81127083.png, ou encore "Mimicroquettes": https://static.ankama.com/wakfu/portal/game/item/42/47612324.w40h40.png. J'ignore comme tu peux récupérer les images qui ne sont pas visible également sur l'encyclopedie, il y a également le cdn de Wakfuli qui permet de récupérer les images d'autre objet que je n'ai pas trouvé sur l'encyclopedie tel que l'objet "Ficelle d'El Pochito" : https://cdn.wakfuli.com/items/13316901.webp. 
Il serait peut nécessaire que tu construises un referentiel d'objet et d'item via les différents json mis à disposition de l'equipe Wakfu pour connaitre l'id des elements qui semble être utilisé pour leur système d'image. Voici le lien où tout est expliqué sur la méthode de récupération des fameux JSON et sur ce qu'ils continnent et de leur relation entre eux : https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json


- J'aimerai que tu fusionne les deux inputs "ennemis vaincus" et "ressources obtenues" afin de rendre la fonctionnalité plus simple pour l'utilisateur.

- J'aimerai que le son des alertes soit le même que celui-ci (https://www.filterblade.xyz/assets/sounds/AlertSound6.mp3)

# Features

- Détection de double comptes (lorsque les messages du chat sont en double)

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