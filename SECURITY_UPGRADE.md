# Durcissement sécurité et performance — 2026-07-26

## Dépendances

Les trois arbres npm (`racine`, `backend`, `frontend`) passent désormais `npm audit --audit-level=low` sans vulnérabilité connue.

- Electron passe de 31 à 43 et Electron Builder de 24 à 26.
- `brace-expansion` est verrouillé sur la version corrigée 5.0.8 pour la chaîne de packaging Electron.
- Fastify passe de 4 à 5 avec ses plugins compatibles.
- Vite passe de 5 à 7.
- SheetJS utilise la distribution officielle 0.20.3 plutôt que l'ancienne version 0.18.5 du registre npm.
- Les dépendances PWA/Workbox et React Router, inutilisées par l'application, sont retirées.

L'ancien service worker est désinscrit au prochain chargement du frontend pour éviter de conserver des bundles ou réponses API obsolètes.

## Bundle frontend

Les vues métier sont chargées à la demande avec `React.lazy` et `Suspense`.

- ancien bundle principal : environ 1 498 kB, 431 kB gzip ;
- nouveau socle initial : environ 329 kB répartis en deux chunks, environ 100 kB gzip ;
- les modules lourds (`xlsx`, graphiques, tableur et éditeur) ne sont téléchargés qu'à l'ouverture de leur vue.

Le worker du tableur reste un fichier séparé d'environ 566 kB et n'alourdit pas le chargement initial.

## Node.js 20

Les builds et le backend de production utilisent l'image épinglée `node:20.19.5-alpine`. La migration du conteneur conserve l'ancien conteneur Node 18 arrêté sous le nom `comptaos-backend-node18-backup` pour permettre un rollback immédiat.

Le Node.js installé globalement sur l'hôte n'est plus utilisé par le déploiement ComptaOS.

## En-têtes HTTP

La configuration Nginx ajoute uniquement pour `/comptaos` : HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy et Permissions-Policy.

Le fichier est testé avec `nginx -t` avant chaque rechargement. En cas d'échec, il est retiré et le déploiement s'arrête.

## Validation attendue après déploiement

```bash
node --version
npm audit --audit-level=low
curl -I https://tipforgood.com/comptaos/
curl https://tipforgood.com/comptaos/api/health
```

Le conteneur de rollback Node 18 ne doit être supprimé qu'après une période d'observation satisfaisante.
