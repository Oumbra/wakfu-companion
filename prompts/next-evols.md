<!--
- J'aimerai que tu sauvegarde en localStorage le choix d'activation et désactivation des canaux du chat.
- J'aimerai que tu sauvegarde l'association nom de personnage et sa classe dans le localStorage afin que tu puisses automatiquement afficher la classe d'un personnage dans le combat en cours, ou dans l'historique d'un combat ou encore dans la modal de recap.
- j'aimerai qu'il soit possible de remettre à zero le compteur d'un element suivi avec un petit bouton qui précéde le bouton de suppression.
- J'aimerai que la tooltip de l'horloge de la premier ligne d'historique soit visible et lisible, elle est actulement caché par le bloque du dessus. 
- J'aimerai que les compteurs d'objet suivi ne se réincremente pas lorsque l'on recharge le même fichier de log, car là, à chaque rechargement les compter se réincremente alors que l'on a rien fait de plus en jeu. Donc, je pense qu'il ne faut pas incrementer les suivi lors du premier chargement du fichier.
- J'aimerai que tu fusionnes les suivis des "ennemis vaincus" et des "ressources obtenues". Afin de différentier s'il s'agit d'un suivi d'obtention ou de mise en KO, tu pourrais rajouter l'icon de tête de mort après le nombre pour les lignes où le nom est celui d'un des ennemis du jeu. Cela permettrait aux utilisateurs de faire la différence d'un simple coup d'oeil.
    - J'aimerai que la date et heure affichée par le tooltip de l'horloge des elements d'historique soit sujet au formattage de la langue sélectionnée.
    - J'aimerai que dans la section chat, si le scroll n'est pas tout en bas, un bouton s'affiche afin de pouvoir aller tout en bas du chat.
    - J'aimerai que dans la section chat, si le scroll est tout en bas et qu'un nouveau message arrive, le scroll aille automatiquement tout en bas afin de suivre les derniers message.
 -->

# Améliorations

- J'aimerai ajouter un système de profil en haut à droite. Dans un premier temps il aura l'aspect d'un point d'interrogation dans un rond (il faudrait que le design soit leché). 
    Ce nouveau bloque est cliquable, il permettra d'afficher une modal où l'on pourra :
    - Choisir une image de classe : https://static.ankama.com/wakfu/ng/modules/mmorpg/encyclopedia/breeds/assets/breeds.jpg à decoupé par 36 car il y a 18 classes et une image par sexe.
    - Ajouter un pseudo
    - Ajouter un ou plusieurs objets dans une liste prérempli par : Pierre d'aventure, Pierre d'équilibre, Pierre d'entourage, Pierre de vitesse, Pierre ultime, Influence III. Chaque ligne de cette liste d'objet affichera l'image de l'objet, son nom et un icon de son. L'icon de son est cliquable, il a deux état, activé (icon son) et désactivé (icon son barré). De plus, s'il n'est pas présent dans la liste d'objet prérempli, il pourra être retiré par un bouton (icon croix). Lorsqu'un des objets listé est détecté dans les butins (uniquement) et que le son est activé, alors j'aimerai qu'un son soit joué et que afficher une petite modal avec l'image et le nom de l'objet ramassé ainsi qu'un petit défait de confettis.


- Je remarque que certain objet n'ont pas d'image, par exemple "Jeton Brut", "Eclat" ou encore "Mimicroquettes". J'ai pu trouver un bon nombre des images manquante sur l'encyclopédie de wakfu officiel https://www.wakfu.com/fr/mmorpg/encyclopedie/ et là plu précisement sur le detail du monstre El Pochito : https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/2443-pochito. Où l'image de "Jeton Brut" est : https://static.ankama.com/wakfu/portal/game/item/64/64921003.png; et l'image de "Eclat" est https://static.ankama.com/wakfu/portal/game/item/64/81127083.png, ou encore "Mimicroquettes": https://static.ankama.com/wakfu/portal/game/item/42/47612324.w40h40.png. J'ignore comme tu peux récupérer les images qui ne sont pas visible également sur l'encyclopedie, il y a également le cdn de Wakfuli qui permet de récupérer les images d'autre objet que je n'ai pas trouvé sur l'encyclopedie tel que l'objet "Ficelle d'El Pochito" : https://cdn.wakfuli.com/items/13316901.webp. 
Il serait peut nécessaire que tu construises un referentiel d'objet et d'item via les différents json mis à disposition de l'equipe Wakfu pour connaitre l'id des elements qui semble être utilisé pour leur système d'image. Voici le lien où tout est expliqué sur la méthode de récupération des fameux JSON et sur ce qu'ils continnent et de leur relation entre eux : https://www.wakfu.com/fr/forum/590-outils/416762-donnee-json


 # A corriger

- J'aimerai que le code pays (fr, en, es, pt) soit changé par un drapeau. Cherche une librairie de font icon qui permettrait de répondre à ce besoin et utilise là.
- J'aimerai que tu ajoutes un fond légerment différent encore les lignes de suivi afin de simplifié la lecture, en alternant une ligne sans fond colorée, un ligne avec un fond très legerment coloré, un gris très très léger, par exemple. Car actuellement ce n'est pas le cas, cf l'image ci-joint

# Evolutions

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