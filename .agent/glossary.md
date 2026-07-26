# Glossaire

- **ComptaOS** : application local-first de gestion et de préparation comptable ; elle n'est pas présentée comme un logiciel comptable certifié.
- **Workspace** : racine des données comptables, configurée par `WORKSPACE_PATH` ou choisie par Electron sous son dossier `userData`.
- **Entreprise active** : entreprise dont le sous-dossier de workspace est utilisé par les services métier à un instant donné.
- **Dépôt applicatif** : présent dépôt contenant le code source de ComptaOS.
- **Dépôt du workspace** : dépôt Git distinct, initialisé dans les données de l'entreprise pour l'historique et la synchronisation optionnelle.
- **Transaction** : écriture métier stockée individuellement en YAML dans `transactions/`.
- **Tiers** : client ou fournisseur référencé par les fonctions comptables.
- **Rapprochement** : association entre mouvements importés et écritures/documents attendus.
- **Copilote** : fonctions IA de suggestion ou d'analyse utilisant un fournisseur configuré.
- **BASE_PATH** : sous-chemin public injecté au build Vite, notamment `/comptaos/` pour le déploiement documenté.
- **CTX** : mémoire locale indexée du dépôt ; `.ctx/` contient la base générée et `.agent/` les connaissances partageables et vérifiables.
