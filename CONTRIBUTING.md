# Contribuer à ComptaOS

Merci de l'intérêt que vous portez à ComptaOS ! Ce document explique comment contribuer au projet.

---

## 🚀 Démarrage rapide

```bash
# 1. Fork le repo sur GitHub, puis clone
git clone https://github.com/SummoningSystems/ComptaOS.git
cd ComptaOS

# 2. Installer les dépendances
npm run install:all

# 3. Copier et remplir les variables d'environnement
cp backend/.env.example backend/.env

# 4. Lancer en développement
npm run dev
```

---

## 🌿 Workflow Git

```bash
# Créer une branche à partir de develop
git switch develop
git switch -c type/description-courte

# Exemples de noms de branches
git switch -c feat/export-fec
git switch -c fix/calcul-tva-intracom
git switch -c chore/mise-a-jour-deps
```

Types de branches : `feat`, `fix`, `chore`, `docs`, `refactor`, `test`

---

## ✅ Checklist avant Pull Request

- [ ] Les tests E2E passent (`npm run test:e2e`)
- [ ] Le code TypeScript compile sans erreurs (`npm run build`)
- [ ] Aucune clé API, token ou secret dans le code
- [ ] Les nouvelles routes backend valident leurs entrées
- [ ] L'UI fonctionne sur les 3 thèmes (light/dark/high-contrast)

---

## 🏗️ Architecture du projet

```
backend/src/
  routes/     ← Routes Fastify
  services/   ← Logique métier (fileSystem, licenseService…)
  plugins/    ← Plugins Fastify (CORS, static…)

frontend/src/
  components/ ← Vues React (une dossier par domaine)
  stores/     ← État global Zustand
  types/      ← Types TypeScript partagés
```

**Conventions :**
- Fichiers de données : YAML par transaction, JSON pour les configs
- Pas d'ORM, pas de base de données — tout est fichier
- Backend ESM / NodeNext, imports avec `.js` obligatoires
- Frontend : composants fonctionnels, hooks uniquement, pas de classes

---

## 🐛 Signaler un bug

Utilisez le template [Bug Report](https://github.com/SummoningSystems/ComptaOS/issues/new?template=bug_report.md).

Incluez :
1. La version de ComptaOS (`package.json`)
2. Votre OS et version de Node.js
3. Les étapes pour reproduire
4. Le comportement attendu vs observé
5. Les logs du terminal si disponibles

---

## 💡 Proposer une fonctionnalité

Utilisez le template [Feature Request](https://github.com/SummoningSystems/ComptaOS/issues/new?template=feature_request.md).

---

## 📄 Licence

En contribuant, vous acceptez que votre code soit publié sous licence **MIT**.

Les changements ordinaires partent de `develop` et sont proposés par Pull Request vers `develop`. `master` est protégé et reçoit les changements validés par Pull Request.
