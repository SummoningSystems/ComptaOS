# Audit du déploiement ComptaOS

Date de vérification : 2026-07-26
Environnement : `https://tipforgood.com/comptaos/`

## État vérifié

- La page publique répond en HTTP 200.
- `/comptaos/api/health` répond en HTTP 200 avec `{"status":"ok"}`.
- L'authentification est activée et le setup initial est terminé.
- Les routes `/api/transactions` et `/api/banking/config` répondent 401 sans session.
- Nginx transmet `/comptaos/api/` au conteneur `comptaos-backend:3003` et sert le frontend sous `/comptaos/`.
- Les conteneurs frontend et backend ont une politique de redémarrage `unless-stopped`.
- Le checkout serveur est sur `master`, commit `ac0ee8b8`.
- Le build présent dans `frontend/dist/index.html` correspond à celui servi par le conteneur Nginx lors du contrôle.

## Écarts et risques

1. Le serveur et le conteneur backend utilisent Node.js `18.20.8`, tandis que le README et la CI attendent Node.js 20+.
2. `HTTPS_ONLY` n'est pas défini sur le backend. Le code local corrigé active désormais automatiquement les cookies `Secure` lorsque `NODE_ENV=production`.
3. Le checkout serveur contient des artefacts `frontend/dist` non suivis. Ils rendent `git status` bruyant et compliquent la distinction entre source et build.
4. `deploy.sh` est marqué modifié uniquement parce que son bit exécutable diffère du dépôt. Ce point doit être normalisé dans Git.
5. Le script historique publiait le frontend avant de compiler le backend et utilisait `npm install`, ce qui pouvait produire un déploiement partiel ou non reproductible.
6. Les fichiers `auth.json`, `.jwt_secret`, `.banking_config.json` et `banking/` existent dans le workspace. Ils ne sont pas suivis lors du contrôle, mais aucune règle du `.gitignore` ne les exclut encore : un futur `git add -A` pourrait les intégrer.
7. La réponse du frontend ne contient pas encore les en-têtes `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` ou `Referrer-Policy`. Leur ajout doit être coordonné au niveau Nginx pour ne pas affecter les autres applications du domaine.

## Corrections préparées localement

- `git pull --ff-only` pour refuser une divergence silencieuse.
- `npm ci` pour un frontend reproductible.
- compilation backend avant publication du frontend.
- validation Nginx avant rechargement.
- contrôle de santé public après redémarrage du backend.
- persistance atomique et validation des fichiers d'authentification et bancaires.
- erreurs Powens nettoyées pour ne pas renvoyer le corps potentiellement sensible d'une réponse distante.
- mise à jour automatique du `.gitignore` du workspace pour exclure authentification, secret JWT et données de connexion bancaire.

## Actions serveur restantes

1. Mettre le conteneur backend à niveau vers Node.js 20 LTS ou une version LTS plus récente validée par le projet.
2. Déployer les changements via Git et `~/apps/comptaos/deploy.sh` après commit et push.
3. Vérifier après déploiement que le cookie `comptaos_token` possède `HttpOnly`, `SameSite=Lax` et `Secure`.
4. Confirmer que les secrets Powens et JWT sont fournis par l'environnement sans afficher leurs valeurs.
5. Nettoyer les anciens artefacts non suivis de `frontend/dist` après avoir vérifié les chemins exacts.
6. Ajouter et tester les en-têtes HTTP de sécurité dans Nginx, en tenant compte du chargement actuel de Google Fonts et des autres applications TipForGood.

Le serveur n'a pas été modifié pendant cet audit.

## Opération d'authentification du 2026-07-26

À la demande du propriétaire, l'authentification de production a ensuite été réinitialisée sans toucher aux données comptables :

- `workspace/auth.json` et `workspace/.jwt_secret` ont été déplacés hors du workspace ;
- sauvegarde privée : `/home/benoit/apps/comptaos-auth-backups/reset-20260726-codex/` ;
- le dossier de transactions a été vérifié comme présent ;
- `/comptaos/api/auth/status` renvoie `needsSetup: true`.

Cette opération est récupérable tant que la sauvegarde privée est conservée.

## Mise à jour après durcissement — 2026-07-26

- le compte propriétaire a été recréé et `needsSetup` vaut désormais `false` ;
- les builds et le backend utilisent Node.js 20.19.5 ;
- les en-têtes HTTP de sécurité sont actifs sur `/comptaos` ;
- les trois audits npm locaux ne signalent aucune vulnérabilité ;
- le bundle initial est découpé et ramené à environ 329 kB non compressés ;
- l'ancien conteneur backend Node 18 est conservé arrêté pour rollback.

Les contrôles post-déploiement confirment un healthcheck HTTP 200 et un refus HTTP 401 des routes protégées sans cookie.
