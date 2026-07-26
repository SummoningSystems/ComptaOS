# Conventions

## Style de code

- TypeScript est configuré en mode `strict` dans le backend et le frontend.
- Le backend est ESM avec résolution `NodeNext` ; les imports relatifs TypeScript ciblent les chemins `.js` générés.
- Le frontend utilise des composants fonctionnels et des hooks. `App.tsx` contient une classe uniquement pour la frontière d'erreur React.
- Les domaines frontend sont regroupés sous `frontend/src/components/<Domaine>/`.
- Les routes HTTP restent dans `backend/src/routes/` et la logique réutilisable dans `backend/src/services/`.
- Les fonctions et types utilisent généralement l'anglais ; les libellés d'interface et commentaires métier sont majoritairement en français.

## API et chemins

- Toujours utiliser l'instance `api` de `frontend/src/api/client.ts` pour conserver le `BASE_URL` de production et les en-têtes communs.
- Une route Fastify enregistrée avec un `prefix` déclare des chemins internes relatifs (`/`, `/:id`) et non le préfixe complet.
- Les chemins de fichiers fournis par un client doivent passer par la résolution sécurisée du workspace.

## Données et nommage

- Une transaction est stockée dans `transactions/<id>.yaml`.
- Les écritures de transactions passent par `atomicWriteFile`; ne pas réintroduire d'écriture directe susceptible de laisser un fichier partiel.
- Un fichier métier invalide doit produire un diagnostic visible et ne doit jamais être ignoré silencieusement.
- Les configurations et registres sont généralement en JSON ; `_companies.json` et `_active.json` pilotent le multi-entreprises.
- Les identifiants portent fréquemment un préfixe métier, par exemple `txn_` ou `co_`.
- Les montants de TVA sont normalisés et arrondis à deux décimales par le service de transactions.

## Tests

- Les tests unitaires backend se trouvent sous `backend/src/__tests__/`.
- Les tests unitaires frontend se trouvent sous `frontend/src/__tests__/`.
- Les scénarios Playwright se trouvent sous `e2e/`.
- Une modification doit au minimum compiler avec `npm run build`; les tests du domaine touché doivent être exécutés.

## Git et déploiement

- Le dépôt applicatif et le dépôt Git créé dans chaque workspace sont deux historiques distincts.
- Le déploiement du code source doit passer par Git et le script serveur documenté ; ne pas envoyer le code source par SCP.
- Ne jamais enregistrer de clé API, jeton, secret ou donnée comptable réelle dans le dépôt ou dans CTX.
