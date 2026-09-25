# ComptaOS — Instructions Copilot

## Workflow de déploiement — RÈGLE ABSOLUE

**Toujours passer par Git. Ne jamais utiliser SCP pour déployer du code source.**

### Processus standard
1. Faire les modifications en local
2. Builder le frontend en local pour vérifier : `cd frontend && $env:BASE_PATH="/comptaos/"; npm run build`
3. Créer ou utiliser `develop` (master est protégé), puis commit et push sur GitHub :
   ```
   git add -A
   git commit -m "description du changement"
   git push origin develop
   ```
4. Après validation, ouvrir une Pull Request de `develop` vers `master`. Déployer seulement après fusion, via le script :
   ```
   ssh -p 2222 benoit@77.37.120.101 "~/apps/comptaos/deploy.sh"
   ```

Le script `deploy.sh` fait automatiquement :
- `git pull origin master`
- Build frontend (`npm install` + `npm run build`) et copie dans Nginx
- Build backend (`tsc`) et redémarre le container

### Informations serveur
- **Hôte** : `77.37.120.101`, SSH port `2222`, user `benoit`
- **Repo sur serveur** : `~/apps/comptaos/` (git remote = `https://github.com/SummoningSystems/ComptaOS.git`)
- **Script de déploiement** : `~/apps/comptaos/deploy.sh`
- **Container frontend** : `tipforgood_frontend_1` (Nginx, fichiers dans `/usr/share/nginx/html/comptaos/`)
- **Container backend** : `comptaos-backend` (Node 20 + Fastify, source montée depuis `~/apps/comptaos/backend`)
- **Workspace data** : `~/apps/comptaos/workspace` (ignoré par git — données live)
- **URL de l'app** : `https://tipforgood.com/comptaos/`

### Architecture
- Frontend : React + Vite + TypeScript, `BASE_URL = /comptaos/`
- Backend : Fastify 5 + TypeScript ESM, port 3003 interne, proxy Nginx `^~ /comptaos/api/`
- Auth : JWT en cookie httpOnly `comptaos_token`
- API base URL frontend : `${import.meta.env.BASE_URL}api` → `/comptaos/api`

### Pièges connus
- Ne jamais utiliser `axios` brut dans les composants — toujours importer `api` depuis `../../api/client`
- Ne jamais créer d'instance axios locale avec `baseURL: "/api"` — utiliser l'instance partagée de `client.ts`
- Les routes Fastify enregistrées avec un `prefix` doivent utiliser des chemins **relatifs** (ex: `/`, `/:id`) et non le chemin complet (ex: `/api/quotes`)
- Le lien d'invitation doit utiliser `window.location.origin + import.meta.env.BASE_URL` pour inclure `/comptaos/`
