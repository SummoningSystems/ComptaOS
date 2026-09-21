# ComptaOS

> **Le VS Code de la comptabilité.** Local-first, open-source, IA copilote intégrée.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0--beta-orange)](https://github.com/SummoningSystems/ComptaOS/releases)
[![CI](https://github.com/SummoningSystems/ComptaOS/actions/workflows/ci.yml/badge.svg)](https://github.com/SummoningSystems/ComptaOS/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/SummoningSystems/ComptaOS/releases)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Fastify%20%2B%20Electron-61DAFB)](https://github.com/SummoningSystems/ComptaOS)

Vos données comptables vous appartiennent. Pas de cloud imposé, pas de lock-in, pas d'abonnement obligatoire. ComptaOS tourne entièrement sur votre machine avec une synchronisation Git optionnelle.

## Écosystème financier partagé

L’entrée principale permet d’organiser personnes, entreprises et comptes bancaires
sur une carte dynamique, avec documents partagés et traitements comptables liés aux
mouvements. Les outils d’entreprise restent dans leurs onglets.

- [Guide pour configurer votre espace à deux et vos six comptes](docs/ecosystem.md)
- [Installer le serveur local avec HTTPS et accès LAN](deployment/LOCAL.md)


---

## ✨ Fonctionnalités

| Module | Description |
|--------|-------------|
| 📊 Dashboard | KPIs en temps réel, graphiques CA / charges |
| 🧾 Factures & Devis | Création, envoi PDF, suivi de statut, relances automatiques |
| 💰 TVA | Calcul automatique, export CA3 PDF |
| 📈 Bilan / P&L | Compte de résultat PCG, export PDF |
| 🏦 Trésorerie | Prévisionnel de trésorerie, tableau de flux |
| 🔗 Rapprochement | Import relevé bancaire, matching automatique |
| 🏦 PSD2 / Open Banking | Connexion bancaire directe via Powens (configuration requise) |
| IA Copilote | Suggestions et analyse avec une clé fournisseur configurée |
| 📋 Multi-entreprises | Gérez plusieurs structures en parallèle |
| 🔒 Chiffrement | AES-256-GCM — vos données chiffrées, clé jamais stockée |
| 🧩 Plugins | Système d'extensions (vm sandbox), marketplace à venir |
| 🖥️ Electron | Application desktop native Windows / macOS / Linux |
| 📅 Frais récurrents | Abonnements et charges périodiques automatiques |
| 🗂️ Tiers | Gestion clients / fournisseurs |
| 📉 Budgets | Suivi budgétaire par poste |
| 📊 Tableaux | Spreadsheet intégré (HyperFormula) |
| 🗃️ Journal | Journal comptable complet |
| ⚠️ Alertes | Seuils personnalisables (TVA, trésorerie…) |
| 📄 Modèles | Bibliothèque de modèles de documents |
| 📤 Export | FEC, CSV, XLSX, PDF |
| 📜 Historique | Audit trail avec Git |
| OCR PDF | Extraction PDF avec un worker local ou un fournisseur configuré |

Les intégrations Powens, IA et OCR ne fonctionnent qu'après configuration de leurs services. Le navigateur web nécessite une connexion au serveur ; l'ancien service worker hors ligne a été retiré.

---

## 🚀 Démarrage rapide

Le script d'installation installe les dépendances racine, backend et frontend depuis leurs lockfiles.

```bash
# 1. Cloner et installer
git clone https://github.com/SummoningSystems/ComptaOS.git
cd ComptaOS
npm run install:all

# 2. Configurer l'environnement
cp backend/.env.example backend/.env
# Éditez backend/.env avec votre WORKSPACE_PATH

# 3. Lancer en développement
npm run dev
# Frontend → http://localhost:5173
# Backend  → http://localhost:3001/api

# 4. Ou construire l'app desktop
npm run electron:build
```

**Prérequis :** Node.js 20.19+ (production : 20.19.5), npm 10+. Sous PowerShell, utilisez `Copy-Item backend/.env.example backend/.env` à la place de `cp`.

---

## 💼 Offres envisagées

Pro et Pro+ sont en liste d'attente. Le tableau décrit les offres prévues, pas des fonctionnalités livrées ou des installateurs publiés.

| | Open-source (Gratuit) | Pro — 39 € | Pro+ — 9 €/mois |
|---|:---:|:---:|:---:|
| Toutes les features core | ✅ | ✅ | ✅ |
| Multi-entreprises illimité | ✅ | ✅ | ✅ |
| Factures, Devis, TVA, Bilan | ✅ | ✅ | ✅ |
| IA copilote (votre clé API) | ✅ | ✅ | ✅ |
| Connexion bancaire PSD2 | ✅ | ✅ | ✅ |
| Installateur natif (sans Node.js) | ❌ | ✅ | ✅ |
| Mises à jour automatiques | ❌ | 12 mois | ✅ |
| Templates premium | ❌ | ✅ | ✅ |
| IA copilote hébergée (sans clé perso) | ❌ | ❌ | ✅ |
| Sync cloud chiffrée multi-appareils | ❌ | ❌ | ✅ |
| Support | Communauté | 30 jours email | Prioritaire |

**Pro et Pro+ en liste d'attente — inscrivez-vous dans l'app pour un accès anticipé à −30 %**

---

## 🏗️ Architecture

```
ComptaOS/
├── backend/          # Fastify 5 + TypeScript (ESM) — port 3001
│   ├── src/
│   │   ├── routes/   # invoices, vat, reports, banking, stripe, license…
│   │   └── services/ # fileSystem, licenseService, stripeService, bankingService…
│   └── .env.example
├── frontend/         # React 18 + Vite 7 + TailwindCSS 3 + Zustand
│   └── src/
│       ├── components/  # 25+ vues (Dashboard, Invoices, Banking…)
│       └── stores/      # appStore (Zustand)
├── electron/         # Main process Electron (CommonJS)
├── .github/
│   ├── workflows/    # CI GitHub Actions
│   └── ISSUE_TEMPLATE/
├── e2e/              # Tests Playwright
└── workspace/        # Données locales (YAML/JSON — ignoré par git)
```

---

## ⚙️ Variables d'environnement

Copiez `backend/.env.example` vers `backend/.env` et remplissez :

| Variable | Défaut | Description |
|---|---|---|
| `WORKSPACE_PATH` | `../workspace` | Chemin du workspace de données |
| `PORT` | `3001` | Port du backend |
| `LOCAL_API_KEY` | _(vide)_ | Clé API optionnelle pour sécuriser l'accès local |
| `AUTH_ENABLED` | `true` dans `.env.example` | Active l'authentification JWT ; obligatoire sur une instance Internet |
| `HTTPS_ONLY` | `true` dans `.env.example` | Ajoute l'attribut `Secure` au cookie JWT |
| `JWT_SECRET` | _(généré localement)_ | Secret JWT persistant ; à fournir par l'environnement en production |
| `ANTHROPIC_API_KEY` | _(vide)_ | Clé Anthropic pour l'IA copilote |
| `MISTRAL_API_KEY` | _(vide)_ | Clé Mistral (alternative) |
| `STRIPE_SECRET_KEY` | _(vide)_ | Clé secrète Stripe (Pro / Pro+) |
| `STRIPE_WEBHOOK_SECRET` | _(vide)_ | Signing secret webhook Stripe |
| `STRIPE_PRICE_PRO` | _(vide)_ | Price ID ou Product ID Stripe — plan Pro |
| `STRIPE_PRICE_PROPLUS` | _(vide)_ | Price ID ou Product ID Stripe — plan Pro+ |
| `POWENS_DOMAIN` | _(vide)_ | Domaine client Powens |
| `POWENS_CLIENT_ID` | _(vide)_ | Identifiant client Powens |
| `POWENS_CLIENT_SECRET` | _(vide)_ | Secret client Powens |
| `POWENS_USER_TOKEN` | _(vide)_ | Jeton utilisateur Powens persistant optionnel |

> `WORKSPACE_PATH` a une valeur par défaut ; configurez-le pour choisir l'emplacement des données. Le fichier d'exemple active l'authentification et demande la création du premier utilisateur. La connexion bancaire, l'IA et l'OCR demandent une configuration ou un worker supplémentaire. Le frontend web actuel ne fournit pas de mode hors ligne.

---

## 🗺️ Roadmap

- [x] Multi-entreprises + onboarding wizard
- [x] Factures / Devis avec relances automatiques
- [x] Export PDF TVA (CA3) + Bilan comptable
- [x] Système de plugins (sandbox vm)
- [x] Chiffrement AES-256-GCM du workspace
- [x] Spreadsheet avec Web Worker (HyperFormula)
- [x] Application Electron (desktop natif)
- [x] Tests E2E Playwright
- [x] Intégration bancaire PSD2 (Powens, configuration requise)
- [x] Système de licence + waitlist
- [x] Intégration Stripe (paiements Pro / Pro+)
- [ ] Installateur natif (sans Node.js requis)
- [ ] Télédéclaration URSSAF auto-entrepreneur
- [ ] IA hébergée (Pro+)
- [ ] Sync cloud chiffrée multi-appareils (Pro+)
- [ ] Dashboard multi-clients (cabinet comptable)
- [ ] Marketplace de plugins
- [ ] Application mobile (React Native)

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Lisez [CONTRIBUTING.md](CONTRIBUTING.md) avant de commencer.

```bash
# Fork + clone
git clone https://github.com/SummoningSystems/ComptaOS.git

# Créer une branche depuis develop
git switch develop
git switch -c feat/ma-fonctionnalite

# Lancer les tests
npm run test:e2e

# Ouvrir une Pull Request vers develop ; master est protégé
```

---

## 📄 Licence

MIT — Voir [LICENSE](LICENSE)

---

*ComptaOS n'est pas un logiciel de comptabilité certifié. Il est conçu comme outil de pilotage et de préparation comptable. Pour vos déclarations officielles, consultez un expert-comptable agréé.*


## Foyer partagé et activités freelance

Le mode **Foyer** propose un espace commun avec des connexions individuelles,
des comptes personnels/professionnels et communs, des affectations mixtes,
le rapprochement des virements, les contributions, les budgets et les échéances.
Les imports CSV/OFX/QIF sont associés à un compte et prévisualisés avant validation.
Les chiffres sont un suivi de trésorerie TTC, sans calcul automatique de TVA.

Choisir **Nouveau foyer**, puis inviter le second utilisateur dans **Membres**.
Les espaces professionnels existants restent disponibles séparément.
La sélection d’espace est indépendante entre utilisateurs et fenêtres.

- [Installation locale Docker, HTTPS et sauvegardes](deployment/LOCAL.md)
- Validation du parcours à deux utilisateurs : npx playwright test --config playwright.household.config.ts
- Données : transactions YAML, métadonnées JSON versionnées et journal de récupération.
- Synchronisation bancaire automatique et comptabilité réglementaire dans le foyer : évolutions ultérieures.
