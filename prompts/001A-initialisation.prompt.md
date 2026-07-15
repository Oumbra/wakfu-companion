# Objectif

Créer une interface web local en Angular. 
Celle-ci demandera, si elle ne connait pas déjà, le chemin du fichier de log `wakfu_chat.log` pour le lire en temps réel.

# Fonctionnalités

- Compter le nombre de kamas gagnés
- Compter le nombre de kamas perdue / dépensé
- Compter l'expérience gagné (par personnage)
- Compter les dégats infligé et leur élément (par personnage, par nom d'attaque)
- Compter les dégats infligé et leur élément (par ennemi, par nom d'attaque)
- Afficher le chat par type (proximité, groupe, guilde, recrutement, commerce, communauté)
- Champ texte permettant de filtrer le chat afin de mettre en evidence uniquement les messages comprenant la saisie utilisateur
- Permettre de compter le nombre de combat réalisé: terminé avec succès mais aussi perdu
- Champ texte permettant d'ajouter un nom d'ennemi qui sera ensuite incrémenté à chaque fois qu'un énnemie ayant ce nom sera vaincu

# Règles

- Le projet devra reprendre le design système du site suivant : https://wakfu-companion.nexuswow.workers.dev/
- Le projet devra être en Angular 21 et Typescript
- Le projet devra produire un fichier HTML standalone permettant d'accéder à l'ensemble des fonctionnalités décrite
