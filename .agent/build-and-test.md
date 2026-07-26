# Build et tests

## Prérequis

- Node.js 20+ et npm 10+.
- Installer les dépendances avec `npm run install:all` après l'installation racine.
- Copier `backend/.env.example` vers `backend/.env`; `WORKSPACE_PATH` configure le dossier de données.

Sous PowerShell avec une politique bloquant `npm.ps1`, utiliser `npm.cmd` à la place de `npm`.

## Développement

```bash
npm run dev
```

Cette commande démarre Fastify sur `127.0.0.1:3001`, attend `/api/health`, puis démarre Vite sur `localhost:5173`.

```bash
npm run electron:dev
```

Cette variante démarre également Electron.

## Build

```bash
npm run build
```

Le script racine compile successivement le backend avec `tsc`, puis le frontend avec `tsc && vite build`.

Pour reproduire le sous-chemin de production sous PowerShell :

```powershell
$env:BASE_PATH = "/comptaos/"
npm run build --prefix frontend
```

Le build Electron complet utilise `npm run electron:build`.

## Tests

Il n'existe pas de script `npm test` à la racine. Exécuter :

```bash
npm test --prefix backend
npm test --prefix frontend
npm run test:e2e
```

Les variantes `test:coverage` existent dans `backend/` et `frontend/`. Playwright requiert les navigateurs correspondants et une application disponible selon `playwright.config.ts`.

## Dernière vérification locale

Le 2026-07-26 :

- `npm run build` : réussi.
- backend Vitest : 8 fichiers, 49 tests réussis.
- frontend Vitest : 3 fichiers, 22 tests réussis.
- E2E Playwright : 10 scénarios réussis avec un workspace éphémère et `AUTH_ENABLED=false`.
- avertissement de build restant : bundle frontend principal supérieur à 500 kB.
