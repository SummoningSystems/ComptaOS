# Projet : ComptaOS

## Description

ComptaOS est une application de gestion et de préparation comptable local-first, distribuée sous licence MIT. Elle fournit une interface inspirée d'un IDE pour gérer notamment transactions, factures, devis, TVA, rapports, trésorerie, rapprochement bancaire et données multi-entreprises. Le README précise qu'il ne s'agit pas d'un logiciel comptable certifié.

## Architecture générale

- `backend/` : API Fastify et logique métier TypeScript.
- `frontend/` : interface React/Vite, état global Zustand et PWA.
- `electron/` : processus principal desktop qui démarre le backend local puis charge l'interface.
- `workspace/` : données métier locales par entreprise, principalement en YAML et JSON, ignorées par le dépôt applicatif.
- `e2e/` : scénarios Playwright.

## Technologies principales

- Node.js 20+ attendu par le README et la CI.
- TypeScript strict, Fastify 4 et modules ESM côté backend.
- React 18, Vite 5, Tailwind CSS et Zustand côté frontend.
- Electron 31 pour l'application desktop.
- Vitest pour les tests unitaires et Playwright pour les tests de bout en bout.

## Sources de référence

Le code courant prévaut sur `README.md`, `spec.md` et les fichiers `.agent`. Les contraintes de déploiement et les pièges connus sont consignés dans `.github/copilot-instructions.md`.
