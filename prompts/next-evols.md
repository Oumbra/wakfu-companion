# Features

- Nettoyage des sources qui doivent être devenue inutile, comme par exemple `wakfu-item-image-overrides.data.ts`, ...
- Aujourd'hui les constantes de référentiel d'objet et de monstre sont orienté sur la langue FR mais ça ne fonctinnera pas sur des fichiers de logs où le jeu est en EN, ES ou encore PT. Il faut corriger ce point afin que cela fonctionne sur toutes les langues.
- J'aimerai que le champ permettant d'ajouter un objet ou un ennemi en suivi ai une autocomplétion sur le référentuiel (montres + objets). Il faudrait que cette autocomplétion se déclenche à partir de trois caractères. N'affiche au maximum que les cinq premiers résultat les plus pertinent au format : `[image] [nom]`. Avec ce nouveau fonctionnement, aucune entrée libre n'est désormais possible. Seules les données du référentiel peuvent être ajouté au suivie.
- J'aimerai que tu ajoute le même système que le point précédent, uniquement pour les objets, sur le champ d'ajout de objet déclenchant des alertes sonore, dans la page profil.

- Parcourir tous les objets dropable (drops) des monstres et référencé tous ceux qui ne sont présent dans aucun des jsons de `/référentiel`.    

- Détection de double comptes (lorsque les messages du chat sont en double)
- Déclaration des personnages par compte (nom et classe)

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