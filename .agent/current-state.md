# État actuel

## Statut

Version déclarée `1.0.0-beta` dans le README et `1.0.0` dans les packages. Le projet est en développement sur la branche active `master`.

## Changements récents observés

Le commit indexé par CTX est `ac0ee8b8` du 2026-06-02. Les derniers commits portent principalement sur le tableur (import/export XLSX/CSV), le calcul de TVA et la déduplication de transactions bancaires.

Le 2026-07-26, CTX a été initialisé avec 180 fichiers indexés. Les six documents de mémoire projet ont été renseignés à partir du code et de la documentation courante.

## Validation connue

- Build backend et frontend réussi le 2026-07-26.
- 50 tests unitaires backend réussis.
- 22 tests unitaires frontend réussis.
- 10 tests E2E Playwright réussis dans un workspace éphémère.

## Problèmes et risques observés

- Le build frontend produit un bundle principal d'environ 1,5 MB avant gzip et déclenche l'avertissement Vite sur les chunks supérieurs à 500 kB.
- La protection atomique couvre les transactions, entreprises, factures, devis, paramètres, frais récurrents, authentification et données bancaires. Des services secondaires écrivent encore directement leurs fichiers, notamment les tableurs et licences.
- Le déploiement TipForGood fonctionne, mais utilise Node.js 18 alors que le projet attend Node.js 20+, et ses en-têtes HTTP de sécurité restent à renforcer. Voir `DEPLOYMENT_AUDIT.md`.
- L'authentification de production a été réinitialisée le 2026-07-26 avec sauvegarde hors workspace ; le compte propriétaire a ensuite été recréé et les données comptables ont été préservées.
- Les tests unitaires couvrent actuellement onze fichiers seulement face à un périmètre fonctionnel large.

## Questions ouvertes

- Le déploiement web et la distribution Electron ont-ils le même niveau de priorité produit ?
- Quelle couverture minimale est attendue pour les calculs comptables et les routes critiques ?
