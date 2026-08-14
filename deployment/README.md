# Déploiement de production

`deploy-production.sh` compare le commit cible au dernier commit effectivement validé en production. Il ne reconstruit que les composants concernés :

- `frontend/` ou `deployment/nginx/` : frontend uniquement ;
- `backend/` ou sa configuration Docker : backend uniquement ;
- `deployment/ocr-worker/` : worker OCR uniquement.

Le commit validé est conservé dans `.deploy-state/last-successful-commit` sur le serveur. Un échec ne déplace pas cette référence : le prochain lancement reprend donc tous les changements qui n'ont pas été validés.

## Forcer une reconstruction

```bash
FORCE_FULL=1 bash deployment/deploy-production.sh
FORCE_FRONTEND=1 bash deployment/deploy-production.sh
FORCE_BACKEND=1 bash deployment/deploy-production.sh
FORCE_OCR=1 bash deployment/deploy-production.sh
```

Le contrôle de la page publique, du bundle principal et de l'API reste exécuté à chaque déploiement, même si aucun composant n'a besoin d'être reconstruit.

## Tests pendant le développement

Pendant une modification locale, lancer d'abord le test ou le contrôle TypeScript de la partie touchée. Les suites complètes frontend et backend restent requises avant une évolution comptable, bancaire, d'authentification ou avant une version stable.
