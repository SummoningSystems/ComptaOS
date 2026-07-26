# Architecture

## Conception générale

ComptaOS est composé d'un frontend React qui consomme une API HTTP Fastify. Le backend lit et écrit les données métier dans le dossier de l'entreprise active. Aucun ORM ni serveur de base de données métier n'est utilisé dans le code observé : les transactions sont des fichiers YAML et les index/configurations sont principalement des fichiers JSON.

Deux modes d'exécution partagent ce socle :

- Web/PWA : Vite sert le frontend en développement et proxifie `/api` vers Fastify.
- Electron : le processus principal démarre le build backend sur un port local libre, définit un workspace sous `userData`, attend `/api/health`, puis ouvre une `BrowserWindow` sur le backend.

En production, Fastify peut servir `frontend/dist` avec un fallback SPA. Le frontend accepte aussi un `BASE_PATH` Vite, utilisé pour le déploiement sous `/comptaos/`.

## Composants

- `backend/src/index.ts` : composition Fastify, sécurité optionnelle, enregistrement des routes, initialisation de l'entreprise et du dépôt Git du workspace.
- `backend/src/routes/` : adaptateurs HTTP organisés par domaine fonctionnel.
- `backend/src/services/` : persistance fichier, calculs métier et intégrations externes.
- `backend/src/services/companiesService.ts` : registre des entreprises et résolution du dossier actif.
- `backend/src/services/fileSystem.ts` : accès aux fichiers limité au workspace actif.
- `backend/src/services/transactionService.ts` : persistance YAML atomique, validation à la lecture, normalisation TVA, cache mémoire et surveillance du dossier.
- `backend/src/services/atomicFile.ts` : écritures asynchrone et synchrone dans un fichier temporaire synchronisé, puis remplacement atomique de la cible.
- `backend/src/services/gitService.ts` : historique local, commits automatiques et synchronisation distante optionnelle du workspace.
- `frontend/src/App.tsx` : authentification initiale, shell principal, onglets et sélection des vues.
- `frontend/src/api/client.ts` : client API partagé, basé sur `${import.meta.env.BASE_URL}api`.
- `frontend/src/stores/appStore.ts` : état global des onglets, de l'arbre de fichiers et de la barre latérale.

## Flux de données

1. Une vue React appelle le client API partagé.
2. Une route Fastify valide/interprète la requête et délègue au service métier.
3. Le service résout le dossier de l'entreprise active puis lit ou écrit les fichiers du workspace.
4. Les réponses JSON mettent à jour l'état local React/Zustand.
5. Les opérations prévues par les services peuvent créer un historique Git dans le workspace, indépendamment du dépôt source de ComptaOS.

Les transactions illisibles sont exclues du calcul, journalisées et exposées comme alertes d'intégrité afin de ne pas produire silencieusement des résultats incomplets.

## Sécurité observée

- `LOCAL_API_KEY` active un contrôle optionnel par en-tête ou paramètre.
- `AUTH_ENABLED=true` active une authentification JWT par cookie HTTP-only via les routes d'authentification.
- En production, le cookie JWT reçoit automatiquement l'attribut `Secure`.
- `resolveSafe` interdit les accès en dehors du workspace actif.
- Les secrets d'intégration proviennent des variables d'environnement ou de fichiers locaux non destinés au dépôt.
- Les fichiers locaux d'authentification et de banque sont validés et écrits atomiquement avec des permissions restrictives ; le `.gitignore` du workspace les exclut de la synchronisation Git.
