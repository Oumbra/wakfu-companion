# Features

- J'aimerais que tu fasses un réferentiel de toutes les recettes des objets du jeu. Utilises les JSON mis à disposition par ankama : 
    -  https://wakfu.cdn.ankama.com/gamedata/{version}/recipeResults.json
    -  https://wakfu.cdn.ankama.com/gamedata/{version}/recipeIngredients.json

    Voici les propriétés que doit avoir chaque élément du référentiel :
    - itemId: propriété `productedItemId` du fichier `recipeResults.json`
    - recipe[]:
        - itemId: propriété `itemId` du fichier `recipeIngredients.json`
        - quantity: propriété `quantity` du fichier `recipeIngredients.json`

    J'aimrais ensuite que tu ajoutes une nouvelle propriété `hasRecipe` sur les éléments du fichier de `/referentiel/items_wakfu.json`, où la valeur est à `true` si l'id de l'objet est présent dans le referentiel des recettes.
    Met à jour le skill `wakfu-item-sync` avec ce nouveau comportement pour pouvoir le même à jour le référentiel plus tard.

- J'aimerais que dans la liste de résultat d'autocomplétion, tu ajoutes un icones `/wakassets/itemTypes/812/png` à droite (avec un padding de 10px) pour tous les items qui ont leur propriété `hasRecipe` à `true`.
    Ajouter un tooltip sur ce nouvel icone avec le texte "Suivre les objets de la recette". 
    Lorsqu'on clic sur cet icone, une petite modal s'ouvre avec un input number avec 1 comme valeur par defaut, avec le même comportement que l'input number des kpi, et un bouton de validation. Lorsqu'on clic sur le bouton de validation ou la touche "entrée" du clavier, lorsque l'utilisateur est focus sur l'input number, un kpi en mode "decompte" est créé (s'il n'existe pas déjà sinon modifie son mode et sa valeur numérique) pour chaque objet de la recette de l'objet source et alimenter la valeur numérique par la quantité de l'objet de la recette multiplié par la quantité saisie par l'utillisateur dans la modal.