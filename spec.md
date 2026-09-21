# Spécification Fonctionnelle — ComptaOS
> Rétro-ingénierie exhaustive · 1er juin 2026

> Document historique : le README, les manifests et le code décrivent le comportement actuel. La connexion bancaire utilise désormais Powens, même si la conception initiale ci-dessous mentionne GoCardless.

## Vision produit

Application web **local-first** inspirée de VS Code / Obsidian pour gérer sa comptabilité professionnelle via des fichiers texte structurés (`.md`, `.yaml`, `.json`, `.csv`), enrichis par une IA copilote. Les données restent la propriété de l'utilisateur, versionnées dans un dépôt Git.

---

## Sommaire des domaines

1. [Authentification & Utilisateurs](#1-authentification--utilisateurs)
2. [Transactions](#2-transactions)
3. [Import de données](#3-import-de-données)
4. [Factures sortantes](#4-factures-sortantes)
5. [Devis](#5-devis)
6. [Rapports](#6-rapports)
7. [TVA (vue dédiée)](#7-tva-vue-dédiée)
8. [Trésorerie & Alertes](#8-trésorerie--alertes)
9. [Dashboard](#9-dashboard)
10. [Rapprochement Bancaire](#10-rapprochement-bancaire)
11. [Journal Comptable](#11-journal-comptable)
12. [Tiers](#12-tiers)
13. [Frais Récurrents](#13-frais-récurrents)
14. [Modèles de Transactions](#14-modèles-de-transactions)
15. [Budgets](#15-budgets)
16. [Export](#16-export)
17. [Connexion Bancaire PSD2](#17-connexion-bancaire-psd2-gocardless)
18. [Intelligence Artificielle](#18-intelligence-artificielle)
19. [Pièces Jointes](#19-pièces-jointes)
20. [Paramètres](#20-paramètres)
21. [Multi-Entreprises](#21-multi-entreprises)
22. [Historique Git](#22-historique-git)
23. [Recherche](#23-recherche)
24. [Tableaux (Spreadsheets)](#24-tableaux-spreadsheets)
25. [Plugins](#25-plugins)
26. [Licence & Plans](#26-licence--plans)
27. [Navigation & Interface](#27-navigation--interface)
28. [Infrastructure Backend](#28-infrastructure-backend)

---

## 1. Authentification & Utilisateurs

### Modèle de données — `AuthUser`
| Champ | Type | Description |
|---|---|---|
| `id` | string | UUID unique |
| `username` | string | Login (minuscules, alphanumérique) |
| `displayName` | string | Nom affiché dans l'interface |
| `email` | string? | Optionnel |
| `passwordHash` | string | Hash bcrypt — jamais exposé en réponse |
| `role` | `"owner" \| "admin" \| "member" \| "readonly"` | Rôle RBAC |
| `createdAt` | string | ISO date |
| `createdBy` | string? | ID de l'utilisateur créateur |
| `lastLogin` | string? | ISO date |
| `active` | boolean | Désactivable sans suppression |

### Modèle de données — `Invitation`
| Champ | Type | Description |
|---|---|---|
| `token` | string | UUID aléatoire |
| `email` | string? | Optionnel |
| `role` | `"admin" \| "member" \| "readonly"` | — |
| `createdBy` | string | ID de l'admin créateur |
| `createdAt` | string | — |
| `expiresAt` | string | Calculée à la création |
| `usedAt` | string? | — |
| `usedBy` | string? | — |

### Fonctionnalités
- **F-001** : Démarrage sans utilisateur → écran Setup (création du compte `owner`)
- **F-002** : Login username/password → JWT dans cookie httpOnly `comptaos_token`
- **F-003** : Logout → effacement du cookie
- **F-004** : `GET /api/auth/me` — retourne l'identité de l'utilisateur courant depuis le JWT
- **F-005** : Lister les utilisateurs (admin+)
- **F-006** : Créer un utilisateur directement (admin+) — username, displayName, password, role
- **F-007** : Mettre à jour displayName, email, role, active, password (admin+ ou soi-même pour nom/mdp)
- **F-008** : Supprimer un utilisateur (admin+)
- **F-009** : Créer un lien d'invitation avec role et email optionnel
- **F-010** : Accepter une invitation via token (public, crée le compte)
- **F-011** : Lister les invitations en attente (admin+)
- **F-012** : Révoquer une invitation (admin+)
- **F-013** : Vérification JWT en middleware global si `AUTH_ENABLED=true`

### Règles / Exigences
- **R-001** : Mot de passe minimum 8 caractères
- **R-002** : Un seul compte `owner` par instance ; il ne peut pas être supprimé
- **R-003** : Cookie : `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` (30 jours)
- **R-004** : Cookie `Secure` uniquement si `HTTPS_ONLY=true`
- **R-005** : Routes publiques (sans JWT) : `/api/health`, `/api/auth/status`, `/api/auth/login`, `/api/auth/setup`, `/api/auth/invite/:token`, `/api/auth/invite/:token/accept`
- **R-006** : Toutes les routes `/api/*` non publiques retournent 401 si token absent ou expiré
- **R-007** : Un `admin` ne peut pas modifier ni supprimer un `owner`
- **R-008** : Flux auth frontend : `loading → setup | login | invite | app`
- **R-009** : URL avec `?invite=TOKEN` déclenche `AcceptInviteView` avant authentification
- **R-010** : Le lien d'invitation utilise `window.location.origin + import.meta.env.BASE_URL` pour inclure le base path

---

## 2. Transactions

### Modèle de données — `Transaction`
| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique |
| `date` | string | Format YYYY-MM-DD |
| `label` | string | Libellé de l'opération |
| `amount_ht` | number | Montant HT (négatif = dépense, positif = recette) |
| `vat` | number | Montant TVA absolu |
| `vat_rate` | number? | Taux TVA en % |
| `amount_ttc` | number | Montant TTC (négatif = dépense) |
| `currency` | string | Devise (ex: EUR) |
| `category` | Category | Catégorie comptable |
| `account` | string | Compte bancaire source |
| `status` | `"validated" \| "pending" \| "rejected"` | Statut de validation |
| `attachment` | string? | Nom du fichier pièce jointe |
| `notes` | string? | Note libre / **nom du tiers** |
| `tags` | string[]? | Étiquettes libres |
| `justified` | boolean? | Présence de justificatif |
| `comment` | string? | Commentaire interne |
| `paymentType` | string? | Mode de paiement |
| `cardHolder` | string? | Porteur de carte |
| `invoiceRef` | string? | Référence facture liée |
| `reconciled` | boolean? | Rapprochement bancaire effectué |

### Catégories et comptes PCG
| Catégorie | Compte PCG | Libellé |
|---|---|---|
| `hosting` | 616200 | Hébergement web |
| `software` | 615600 | Logiciels |
| `salary` | 641100 | Salaires |
| `travel` | 625100 | Voyages et déplacements |
| `restaurant` | 625700 | Réceptions |
| `food` | 606000 | Achats non stockés |
| `taxes` | 447900 | Impôts et taxes |
| `equipment` | 218300 | Matériel informatique |
| `subscription` | 622600 | Abonnements |
| `rent` | 613200 | Loyers |
| `legal` | 622200 | Honoraires |
| `insurance` | 616000 | Primes d'assurance |
| `misc` | 628800 | Charges diverses |

### Fonctionnalités
- **F-020** : Lister toutes les transactions (`GET /api/transactions`)
- **F-021** : Créer une transaction (`POST /api/transactions`) — déclenche auto-commit Git
- **F-022** : Modifier une transaction (`PATCH /api/transactions/:id`) — déclenche auto-commit
- **F-023** : Supprimer une transaction (`DELETE /api/transactions/:id`) — déclenche auto-commit
- **F-024** : Suppression en masse (`DELETE /api/transactions` body `{ ids }`) — déclenche auto-commit
- **F-025** : Export FEC (`GET /api/transactions/fec?year=`) — format Fichier des Écritures Comptables DGFiP
- **F-026** : Suggestions de catégorisation automatique sans LLM (`GET /api/transactions/smart-categorize`)
- **F-027** : Appliquer suggestions de catégorisation (`POST /api/transactions/smart-categorize/apply`)
- **F-028** : Édition de tags inline dans la liste avec autocomplétion sur tags existants
- **F-029** : Édition inline du taux TVA avec snapping sur presets (0, 2.1, 5.5, 10, 20%)

### Règles / Exigences
- **R-020** : `id`, `date`, `label` obligatoires à la création
- **R-021** : Transactions `rejected` exclues de tous les calculs (TVA, trésorerie, rapports)
- **R-022** : FEC — dépenses → journal `AC` (Achats), recettes → journal `VT` (Ventes)
- **R-023** : FEC — compte banque : 512100, compte produits : 706000
- **R-024** : Smart catégorisation — tokenisation : minuscules, sans accents, sans caractères spéciaux, tokens ≥ 3 caractères
- **R-025** : Smart catégorisation — confidence `high` si score > 0.8, `medium` > 0.5, `low` sinon
- **R-026** : Smart catégorisation — seules les transactions `misc` non-rejetées sont candidates
- **R-027** : Chaque modification déclenche `autoCommit()` dans le workspace Git actif

---

## 3. Import de données

### Modèle de données — `CsvMappingConfig`
| Champ | Type | Description |
|---|---|---|
| `date` | string | Nom de la colonne date |
| `label` | string | Nom de la colonne libellé |
| `amount` | string | Colonne montant unique (+/-) |
| `debit` | string? | Colonne débit séparée |
| `credit` | string? | Colonne crédit séparée |
| `notes` | string? | Colonne tiers → `transaction.notes` |
| `status_col` | string? | Colonne statut — lignes "Transaction rejetée" ignorées |
| `category_col` | string? | Colonne catégorie Penylane → mappée |

### Fonctionnalités
- **F-030** : Import CSV avec mapping personnalisé (`POST /api/import/csv`)
- **F-031** : Prévisualisation colonnes CSV sans import (`POST /api/import/preview`) — retourne colonnes + 3 lignes exemple
- **F-032** : Import fichier OFX/OFC (`POST /api/import/ofx`)
- **F-033** : Import fichier QIF (`POST /api/import/qif`)

### Règles / Exigences
- **R-030** : Déduplication automatique — empreinte : `date | label.trim().toLowerCase() | amount_ttc`
- **R-031** : Retour : `{ imported, skipped, transactions }` — `skipped` = doublons ignorés
- **R-032** : Import déclenche auto-commit Git si nouvelles transactions ajoutées
- **R-033** : Champs requis : `content` (chaîne CSV brute) + `mapping` (objet JSON)
- **R-034** : CSV vide ou sans transaction retourne HTTP 422

---

## 4. Factures sortantes

### Modèle de données — `OutgoingInvoice`
| Champ | Type | Description |
|---|---|---|
| `id` | string | — |
| `number` | string | Format `FA-YYYY-NNN` |
| `client` | string | Nom du client |
| `date` | string | YYYY-MM-DD |
| `dueDate` | string | Date d'échéance |
| `description` | string | Objet (tronqué à 80 chars dans le PDF) |
| `amount_ht` | number | — |
| `vat_rate` | number | Taux TVA en % |
| `amount_ttc` | number | — |
| `status` | `"draft" \| "sent" \| "paid" \| "overdue"` | — |
| `paidDate` | string? | Rempli quand statut → `paid` |
| `notes` | string? | Notes internes (max 120 chars dans le PDF) |

### Fonctionnalités
- **F-040** : Lister les factures sortantes
- **F-041** : Créer une facture
- **F-042** : Modifier une facture (`PUT` — remplacement complet)
- **F-043** : Supprimer une facture
- **F-044** : Génération PDF à la volée (`GET /api/invoices/:id/pdf`)
- **F-045** : Changement rapide de statut depuis la liste
- **F-046** : Auto-marquage `overdue` si `status=sent` et `dueDate < today` au chargement
- **F-047** : Recalcul TTC automatique depuis HT + taux TVA dans le formulaire

### Règles / Exigences
- **R-040** : Numérotation auto : `FA-{année}-{index padded 3}` (index = nb factures + 1)
- **R-041** : PDF format A4 (595×842 pts), généré backend avec `pdf-lib`
- **R-042** : PDF inclut : bande accent, en-tête société (nom, SIREN, TVA, adresse), numéro + dates, section client, tableau HT/TVA/TTC, totaux, notes, pied de page (email, tel, IBAN, RCS)
- **R-043** : `paidDate` rempli automatiquement avec la date du jour au passage en `paid`
- **R-044** : `CompanyProfile` utilisé pour remplir l'en-tête du PDF

---

## 5. Devis

### Modèle de données — `Quote`
| Champ | Type | Description |
|---|---|---|
| `id` | string | — |
| `number` | string | — |
| `client` | string | — |
| `date` | string | YYYY-MM-DD |
| `validUntil` | string | Date d'expiration du devis |
| `description` | string | — |
| `amount_ht` | number | — |
| `vat_rate` | number | — |
| `amount_ttc` | number | — |
| `status` | `"draft" \| "sent" \| "accepted" \| "refused" \| "converted"` | — |
| `notes` | string? | — |
| `invoiceId` | string? | Rempli après conversion |

### Fonctionnalités
- **F-050** : Lister tous les devis
- **F-051** : Créer un devis
- **F-052** : Modifier un devis (`PUT`)
- **F-053** : Supprimer un devis
- **F-054** : Convertir un devis en facture (`POST /api/quotes/:id/convert`)

### Règles / Exigences
- **R-050** : Conversion → crée facture `draft` avec `dueDate = date + 30 jours`
- **R-051** : Conversion → numérotation `FA-{année}-{N+1}` sur base des factures existantes
- **R-052** : Après conversion → devis passe en `status: "converted"` et `invoiceId` est renseigné
- **R-053** : Les devis `converted` restent visibles dans la liste

---

## 6. Rapports

### Fonctionnalités
- **F-060** : Générer rapport Markdown (`POST /api/reports/generate`) — types : `monthly`, `vat`, `activity`
- **F-061** : Résumé TVA par trimestre (`GET /api/reports/vat-summary?year=`)
- **F-062** : Compte de résultat PCG avec SIG (`GET /api/reports/pnl?year=`)
- **F-063** : Export PDF TVA (`GET /api/reports/vat-pdf?year=&quarter=`)
- **F-064** : Compte de résultat N vs N-1 (`GET /api/pl?year=`) avec données mensuelles
- **F-065** : Interface frontend : 4 onglets (Mensuel, TVA, Activité, Compte de résultat)
- **F-066** : Sélecteur de période : mois (`input[type=month]`), trimestre (`YYYY-Q1..Q4`), année

### Réponse — `vat-summary`
- `year`, `quarters: [{ quarter, collected, deductible, net, revenue, expenses }]`
- `total: { collected, deductible, net }`
- `details: VatTransactionDetail[]` — chaque transaction avec `direction: "collected" | "deductible"`

### Réponse — `pnl`
- `produits: [{ account, label, amount, count }]`
- `charges: [{ account, label, amount, count }]` — triés par montant décroissant
- `total_produits`, `total_charges`, `resultat_brut`
- `is_estimate` : 25% du résultat brut si positif
- `resultat_net` : résultat brut − provision IS

### Réponse — `/api/pl`
- `current / previous : { revenue[], expenses[], totalRevenue, totalExpenses, netResult, monthly[] }`
- `monthly: [{ month, revenue, expenses, net }]`

### Règles / Exigences
- **R-060** : Transactions `rejected` exclues de tous les calculs
- **R-061** : TVA collectée = somme `vat` des transactions `amount_ttc > 0`
- **R-062** : TVA déductible = somme abs(`vat`) des transactions `amount_ttc < 0`
- **R-063** : Provision IS = 25% si `resultat_brut > 0`, sinon 0
- **R-064** : Rapports Markdown sauvegardés dans `workspace/reports/`

---

## 7. TVA (vue dédiée)

### Fonctionnalités
- **F-070** : Tableau TVA par trimestre (données depuis `/api/reports/vat-summary`)
- **F-071** : Détail des transactions TVA avec libellé et catégorie éditables inline
- **F-072** : Édition inline du taux TVA (presets : 0, 2.1, 5.5, 10, 20%)
- **F-073** : Snapping du taux saisi vers le preset le plus proche (±0.2%)

### Règles / Exigences
- **R-070** : Modification inline → `PATCH /api/transactions/:id`

---

## 8. Trésorerie & Alertes

### Modèle de données — `TreasuryAlert`
- `threshold`: number — seuil en euros
- `enabled`: boolean

### Modèle de données — `SystemAlert`
- `id`, `level: "error" | "warn" | "info"`, `category`, `message`, `count?`

### Fonctionnalités
- **F-080** : Trésorerie = somme de tous les `amount_ttc` non rejetés
- **F-081** : Runway = trésorerie / moyenne dépenses mensuelles (3 derniers mois)
- **F-082** : Alertes automatiques : unjustified, uncategorized, budgets, trésorerie, TVA, rapprochement

### Règles / Exigences
- **R-080** : `unjustified` (warn) — transactions avec `justified === false`
- **R-081** : `uncategorized` (info) — transactions avec `category === "misc"`
- **R-082** : `budget_{cat}` (error) — dépenses mois courant > `monthlyLimit`
- **R-083** : `budget_warn_{cat}` (warn) — dépenses mois courant > 80% de `monthlyLimit`
- **R-084** : `treasury_negative` (error) — trésorerie < 0
- **R-085** : `treasury_low` (error) — runway < 2 mois
- **R-086** : `treasury_warn` (warn) — runway < 4 mois
- **R-087** : `vat_due` (info) — TVA nette estimée > 1 000 €
- **R-088** : Alerte rapprochement si > 20 transactions non réconciliées

---

## 9. Dashboard

### Modèle de données — `DashboardData`
| Champ | Type |
|---|---|
| `monthly_revenue` | `{ month: "YYYY-MM", amount }[]` |
| `monthly_expenses` | idem |
| `vat_estimate` | number |
| `treasury` | number |
| `top_categories` | `{ category, amount }[]` |
| `net_result` | number |
| `is_estimate` | number — provision IS |
| `runway_months` | number |
| `misc_count` | number |
| `unjustified_count` | number |
| `current_year` | string |
| `monthly_balance` | `{ month, amount }[]` |
| `forecast` | `{ month, balance, projected? }[]` |
| `accounts` | string[] |

### Fonctionnalités
- **F-090** : KPIs : Trésorerie, Résultat net, Provision IS, Runway
- **F-091** : Graphique AreaChart revenus vs dépenses (Recharts)
- **F-092** : Graphique BarChart top catégories de dépenses
- **F-093** : Graphique LineChart forecast trésorerie (points projetés distincts)
- **F-094** : Compteurs alertes : `misc_count`, `unjustified_count`

---

## 10. Rapprochement Bancaire

### Fonctionnalités
- **F-100** : Lister les transactions par mois avec statut réconcilié/total/pending
- **F-101** : Toggle réconciliation d'une transaction (`PATCH /api/reconcile/:id`)
- **F-102** : Réconciliation en masse (`POST /api/reconcile/bulk`)

### Règles / Exigences
- **R-100** : Transactions `rejected` exclues du rapprochement
- **R-101** : Chaque action de réconciliation déclenche un auto-commit Git

---

## 11. Journal Comptable

### Modèle de données — Écriture
| Champ | Description |
|---|---|
| `date`, `label` | — |
| `account_debit` | Compte PCG débité |
| `account_credit` | Compte PCG crédité |
| `account_vat` | Compte TVA (445710 recettes / 445660 charges) |
| `amount_ht`, `amount_vat`, `amount_ttc` | — |
| `category`, `pcg_label`, `reconciled`, `txn_id` | — |

### Imputations PCG par catégorie
| Catégorie | Débit | Crédit |
|---|---|---|
| Recette | 512000 | 706000 (TVA : 445710) |
| hosting | 626000 | 512000 |
| software | 605000 | 512000 |
| salary | 641000 | 512000 |
| travel | 625000 | 512000 |
| restaurant/food | 625100 | 512000 |
| taxes | 695000 | 512000 |
| equipment | 606000 | 512000 |
| subscription | 626100 | 512000 |
| rent | 613000 | 512000 |
| legal | 622000 | 512000 |
| insurance | 616000 | 512000 |
| misc | 658000 | 512000 |

### Fonctionnalités
- **F-110** : Afficher le journal comptable filtré par année/mois
- **F-111** : Retourner `totalDebit`, `totalCredit` (journal équilibré)
- **F-112** : Retourner la liste des années disponibles

---

## 12. Tiers

### Modèle de données — `TierStats` (calculé frontend)
- `name` : valeur du champ `transaction.notes`
- `count`, `totalIn`, `totalOut`, `balance`, `lastDate`, `transactions[]`

### Fonctionnalités
- **F-120** : Grouper les transactions par valeur du champ `notes`
- **F-121** : Filtrer par nom (recherche textuelle)
- **F-122** : Filtrer par direction : tous / entrants / sortants
- **F-123** : Trier par : balance, count, name, lastDate
- **F-124** : Afficher résumé total : nb tiers, totalIn, totalOut
- **F-125** : Dépliage inline des transactions du tiers

### Règles / Exigences
- **R-120** : Transactions sans `notes` → tiers `"(sans tiers)"`
- **R-121** : Pas de backend dédié — tout calculé côté client

---

## 13. Frais Récurrents

### Modèle de données — `ManualRecurring`
| Champ | Type |
|---|---|
| `id` | string |
| `label` | string |
| `category` | Category |
| `amount` | number |
| `frequency` | `"mensuel" \| "trimestriel" \| "annuel"` |
| `nextPayment` | string — YYYY-MM-DD |
| `active` | boolean |

### Fonctionnalités
- **F-130** : Lister les frais récurrents (`GET /api/recurring/manual`)
- **F-131** : Sauvegarder la liste complète (`PUT /api/recurring/manual`) — remplacement total

### Règles / Exigences
- **R-130** : Corps PUT = tableau JSON complet
- **R-131** : Stocké dans `workspace/settings/manual_recurring.json`

---

## 14. Modèles de Transactions

### Modèle de données — `TransactionTemplate`
| Champ | Type |
|---|---|
| `id` | string |
| `name` | string — nom du modèle |
| `label` | string |
| `amount_ttc`, `amount_ht`, `vat` | number |
| `category` | Category |
| `account` | string |
| `tags` | string[]? |
| `notes` | string? |

### Fonctionnalités
- **F-140** : Lister les modèles (`GET /api/templates`)
- **F-141** : Créer un modèle (`POST /api/templates`)
- **F-142** : Modifier un modèle (`PATCH /api/templates/:id`)
- **F-143** : Supprimer un modèle (`DELETE /api/templates/:id`)

### Règles / Exigences
- **R-140** : Création et suppression déclenchent un auto-commit Git
- **R-141** : Stocké dans `workspace/templates.yaml`

---

## 15. Budgets

### Modèle de données — `CategoryBudget`
- `category`: string
- `monthlyLimit`: number (€)

### Fonctionnalités
- **F-150** : Lire la configuration budgets (`GET /api/settings/budgets`)
- **F-151** : Sauvegarder les budgets (`PUT /api/settings/budgets`)
- **F-152** : Les dépassements génèrent des alertes système (voir §8)

---

## 16. Export

### Fonctionnalités
- **F-160** : Export Excel XLSX (`GET /api/export/xlsx?year=&month=`)
- **F-161** : Export CSV (`GET /api/export/csv?year=&month=`)
- **F-162** : Export FEC (`GET /api/transactions/fec?year=`)

### Structure Excel (3 feuilles)
1. **Grand Livre** : Date, Libellé, Catégorie, Compte, Statut, HT, TVA, TTC, Justifié, Référence
2. **Balance** : Catégorie, Charges HT, Produits HT, Solde HT
3. **TVA** : Trimestre, TVA Collectée, TVA Déductible, TVA Nette

### Règles / Exigences
- **R-160** : CSV avec BOM UTF-8 (`\uFEFF`), séparateur `;` (compatibilité Excel FR)
- **R-161** : Filtre optionnel par mois en plus de l'année
- **R-162** : Transactions `rejected` exclues des exports
- **R-163** : Nom de fichier : `compta_{year}.xlsx` ou `compta_{year}_{month}.xlsx`

---

## 17. Connexion Bancaire PSD2 (GoCardless)

### Fonctionnalités
- **F-170** : Configurer les credentials GoCardless (mode self-hosted)
- **F-171** : Lister les banques disponibles par pays (`country=FR` par défaut)
- **F-172** : Gérer les connexions bancaires existantes
- **F-173** : Initier la connexion OAuth2 vers la banque
- **F-174** : Finaliser la connexion après retour OAuth
- **F-175** : Synchroniser les transactions d'un compte
- **F-176** : Synchroniser tous les comptes d'une connexion
- **F-177** : Supprimer une connexion

### Règles / Exigences
- **R-170** : Deux modes : `hosted` (credentials opérateur via env vars) et `self_hosted` (credentials utilisateur)
- **R-171** : Mode `hosted` → GET config retourne `{ configured: true, mode: "hosted" }` sans exposer les clés ; POST config retourne 403
- **R-172** : La synchronisation réutilise la déduplication par empreinte

---

## 18. Intelligence Artificielle

### Modèle de données — `AiConfig`
| Champ | Type |
|---|---|
| `provider` | `"anthropic" \| "openai" \| "github-models" \| "ollama"` |
| `apiKey` | string — masquée en GET (4 premiers + "…" + 3 derniers) |
| `model` | string |
| `baseUrl` | string? — pour Ollama ou provider custom |
| `mistralApiKey` | string? — clé dédiée OCR Mistral |

### Fonctionnalités
- **F-180** : Catégorisation LLM d'une transaction (`POST /api/ai/categorize`)
- **F-181** : Chat Copilot comptable avec contexte financier (`POST /api/ai/chat`)
- **F-182** : OCR de factures PDF via Mistral (`POST /api/ocr/invoice`)

### Règles / Exigences
- **R-180** : Aucun provider configuré → HTTP 503
- **R-181** : Clé OCR Mistral distincte de la clé LLM principale
- **R-182** : OCR accepte uniquement PDF, max 20 MB
- **R-183** : OCR sauvegarde le fichier dans `workspace/attachments/` avant traitement
- **R-184** : Catégorisation LLM envoie les 20 dernières transactions en contexte
- **R-185** : Chat injecte : liste transactions, trésorerie courante, TVA estimée

---

## 19. Pièces Jointes

### Fonctionnalités
- **F-190** : Upload pièce jointe pour une transaction (`POST /api/attachments/upload/:txnId`)
- **F-191** : Suppression pièce jointe (`DELETE /api/attachments/:txnId`)

### Règles / Exigences
- **R-190** : Formats acceptés : PDF, JPEG, PNG, WEBP, GIF
- **R-191** : Taille max : 20 MB
- **R-192** : Nom de fichier stocké : `{txnId}_{timestamp}{ext}`
- **R-193** : Upload → `transaction.justified = true` automatiquement
- **R-194** : Stockage dans `workspace/attachments/`

---

## 20. Paramètres

### Modèle de données — `CompanyProfile`
| Champ |
|---|
| `name`, `legalForm`, `siren`, `vatNumber`, `capital`, `rcs` |
| `address`, `postalCode`, `city`, `email`, `phone`, `website` |
| `iban`, `bankName` |
| `onboardingDone?` : boolean |

### Fonctionnalités
- **F-200** : CRUD règles de catégorisation automatique (`GET/PUT /api/settings/category-rules`)
- **F-201** : Alerte trésorerie (`GET/PUT /api/settings/treasury-alert`)
- **F-202** : Configuration IA (`GET/PUT /api/settings/ai`) — clé masquée en lecture
- **F-203** : Budgets mensuels par catégorie (`GET/PUT /api/settings/budgets`)
- **F-204** : Profil entreprise (`GET/PUT /api/settings/profile`)

### Règles / Exigences
- **R-200** : GET config IA retourne `apiKeyPreview` — jamais la clé complète
- **R-201** : `provider`, `apiKey`, `model` obligatoires pour sauvegarder la config IA
- **R-202** : `CompanyProfile` utilisé dans les PDF factures et rapports

---

## 21. Multi-Entreprises

### Modèle de données — `Company`
- `id`, `name`, `path`, `createdAt`

### Fonctionnalités
- **F-210** : Lister toutes les entreprises
- **F-211** : Obtenir l'entreprise active
- **F-212** : Changer l'entreprise active
- **F-213** : Créer une nouvelle entreprise

### Règles / Exigences
- **R-210** : `ensureDefaultCompany()` appelé automatiquement au démarrage
- **R-211** : Le changement d'entreprise active invalide le cache des transactions
- **R-212** : Chaque entreprise a son dossier `workspace/companies/{id}/`
- **R-213** : `auth.json` (users + invitations) est partagé au niveau racine workspace — pas par entreprise

---

## 22. Historique Git

### Fonctionnalités
- **F-220** : Lister les N derniers commits (`GET /api/git/log?n=`, max 500)
- **F-221** : Afficher le diff d'un commit (`GET /api/git/diff/:hash`)
- **F-222** : Statut de synchronisation remote (`GET /api/git/sync`)
- **F-223** : Configurer la synchronisation remote avec test préalable (`POST /api/git/sync/configure`)
- **F-224** : Tester la connexion remote sans sauvegarder (`POST /api/git/sync/test`)
- **F-225** : Push vers le remote (`POST /api/git/sync/push`)

### Règles / Exigences
- **R-220** : Hash validé par regex `/^[0-9a-f]{4,64}$/i` avant `git diff`
- **R-221** : Config sync requiert : `provider`, `remoteUrl`, `token`, `branch`
- **R-222** : Connexion testée avant enregistrement de la config remote
- **R-223** : Chaque CRUD transaction/template déclenche un auto-commit local

---

## 23. Recherche

### Fonctionnalités
- **F-230** : Recherche full-text sur les transactions (`GET /api/search?q=&limit=`)
- **F-231** : Lister tous les tags uniques utilisés (`GET /api/search/tags`)

### Règles / Exigences
- **R-230** : Requête < 1 caractère retourne tableau vide
- **R-231** : Limite par défaut : 30 résultats
- **R-232** : SearchOverlay accessible depuis la palette de commandes

---

## 24. Tableaux (Spreadsheets)

### Fonctionnalités
- **F-240** : CRUD sur feuilles de calcul personnalisées
- **F-241** : Variables comptables (`GET /api/spreadsheets/variables`) — données du dashboard injectées

### Règles / Exigences
- **R-240** : `id` dans le body PUT doit correspondre au `:id` de l'URL
- **R-241** : Les variables permettent de référencer trésorerie, CA, charges dans les feuilles

---

## 25. Plugins

### Fonctionnalités
- **F-250** : Lister les plugins (crée un exemple si aucun)
- **F-251** : Activer / désactiver un plugin
- **F-252** : Exécuter manuellement un hook de plugin

### Règles / Exigences
- **R-250** : Un plugin expose des "hooks" déclenchés par des événements comptables
- **R-251** : L'exécution d'un hook retourne le résultat dans la réponse

---

## 26. Licence & Plans

### Modèle de données — `License`
| Champ | Type |
|---|---|
| `plan` | `"free" \| "pro" \| "pro_plus"` |
| `licenseKey` | string \| null |
| `email` | string \| null |
| `activatedAt` | string \| null |
| `expiresAt` | string \| null — null = perpétuelle |

### Plans
| Plan | Format clé |
|---|---|
| `free` | open-source, gratuit, sans clé |
| `pro` | `PRO-XXXX-XXXX-XXXX` |
| `pro_plus` | `PROPLUS-XXXX-XXXX-XXXX` |

### Fonctionnalités
- **F-260** : Lire la licence courante
- **F-261** : Lister les plans disponibles avec prix et descriptions
- **F-262** : Activer une licence avec clé + email
- **F-263** : Désactiver la licence (retour plan free)

### Règles / Exigences
- **R-260** : Licence stockée dans `workspace/.license.json`
- **R-261** : Format clé validé par regex avant activation
- **R-262** : Licence expirée → retour silencieux au plan free
- **R-263** : Email validé par regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

---

## 27. Navigation & Interface

### Sections de la Sidebar
| # | Section | Entrées |
|---|---|---|
| 1 | Comptabilité | Transactions, Journal, Rapprochement, TVA, Import CSV, OCR PDF, Banque PSD2 |
| 2 | Documents | Factures, Devis, Modèles, Tiers |
| 3 | Finance | Trésorerie, Budgets, Bilan/P&L, Frais récurrents |
| 4 | Analyses & Export | Rapports, Export, Tableaux |
| 5 | Fichiers | Explorateur du workspace |
| 6 | Outils | Paramètres, Plugins, Plans & Licence, Historique, Alertes |

### Types d'onglets (26)
`dashboard`, `editor`, `import`, `transactions`, `ocr`, `reports`, `recurring`, `invoices`, `quotes`, `settings`, `tiers`, `vat`, `budgets`, `spreadsheets`, `history`, `journal`, `alerts`, `templates`, `reconcile`, `treasury`, `export`, `profitloss`, `plugins`, `pricing`, `banking`, `users`

### Fonctionnalités
- **F-300** : Interface multi-onglets style VS Code (TabBar + Sidebar)
- **F-301** : `ViewErrorBoundary` — empêche les pages blanches sur crash avec bouton "Réessayer"
- **F-302** : `SearchOverlay` — palette de recherche globale
- **F-303** : `CommandPalette` — palette de commandes
- **F-304** : `CopilotPanel` — panneau chat IA latéral
- **F-305** : Badge orange sur "Comptabilité" si transactions `pending > 0`
- **F-306** : Onboarding Wizard au premier lancement (si `onboardingDone !== true`)
- **F-307** : `CompanySelector` — sélection/création d'entreprise
- **F-308** : Menu utilisateur avec déconnexion
- **F-309** : `StatusBar` — barre de statut en bas
- **F-310** : Vue `users` accessible uniquement aux rôles `owner` et `admin`

### Règles / Exigences
- **R-300** : Onglet `dashboard` accessible via bouton 📊 de l'activity bar
- **R-301** : Tooltip au survol sur les icônes de l'activity bar
- **R-302** : `UsersView` conditionné à `role === "owner" || "admin"`

---

## 28. Infrastructure Backend

### Fonctionnalités
- **F-400** : Middleware API Key optionnel (`LOCAL_API_KEY` env var)
- **F-401** : Middleware JWT global si `AUTH_ENABLED=true`
- **F-402** : CORS pour `localhost:5173` et `localhost:4173`
- **F-403** : Serving frontend statique via `@fastify/static`
- **F-404** : `GET /api/health` — health check public
- **F-405** : Initialisation auto du dépôt Git du workspace au démarrage
- **F-406** : Création auto de l'entreprise par défaut au démarrage

### Règles / Exigences
- **R-400** : `LOCAL_API_KEY` et `AUTH_ENABLED` sont indépendants (rétrocompat)
- **R-401** : Cookie JWT parsé manuellement dans les middlewares (sans plugin cookie)
- **R-402** : Routes banking enregistrées **sans prefix** (chemins complets dans la route)
- **R-403** : Toutes les autres routes utilisent un prefix + chemins relatifs (`/`, `/:id`)

---

*Document généré par rétro-ingénierie — 1er juin 2026*
de catégoriser automatiquement les opérations
de calculer une estimation TVA / charges
d’avoir un dashboard simple
d’interagir avec un copilote IA
d’éditer les données dans une interface type VSCode
Positionnement produit
Ce que le produit EST
assistant comptable intelligent
cockpit financier personnel
outil local-first
système basé sur fichiers + IA
Ce que le produit N’EST PAS
logiciel comptable certifié
solution de paie
ERP
télédéclaration officielle
Stack technique recommandée
Frontend
React
TypeScript
Vite
TailwindCSS
Monaco Editor (éditeur VSCode)
Backend
Go + Fiber
OU
Node.js + Fastify/Nest
Base de données

Aucune DB obligatoire pour le MVP.

Le filesystem est la source de vérité.

Optionnel :

SQLite pour cache/indexation
Architecture générale
Workspace

L’utilisateur ouvre un “workspace” contenant tous ses fichiers financiers.

Exemple :

/workspace
    /transactions
    /invoices
    /vat
    /reports
    /attachments
    settings.yaml
Format des données
Transactions

Format recommandé : YAML ou Markdown frontmatter.

Exemple :

id: txn_0001
date: 2026-05-20
label: OVH
amount_ht: 10.83
vat: 2.16
amount_ttc: 12.99
currency: EUR
category: hosting
account: business
status: validated
attachment: invoice_ovh_may.pdf
notes: Hébergement VPS
Factures
id: inv_0001
supplier: OVH
date: 2026-05-20
vat_rate: 20
amount_ht: 10.83
amount_ttc: 12.99
category: hosting
file: attachments/invoice.pdf
Fonctionnalités MVP
1. Workspace Explorer
Objectif

Interface type VSCode permettant :

navigation fichiers
édition
création
suppression
Features
arbre de fichiers
onglets
édition YAML/MD
sauvegarde automatique
Librairie

Monaco Editor

2. Import bancaire CSV
Objectif

Importer un export bancaire standard.

Features
drag & drop CSV
mapping colonnes
détection :
date
montant
label
création automatique des transactions
Résultat

Génération des fichiers transaction.

3. Catégorisation automatique IA
Objectif

Proposer une catégorie automatiquement.

Catégories MVP
hosting
software
salary
travel
restaurant
taxes
equipment
subscription
misc
Fonctionnement

LLM reçoit :

label
montant
historique

Puis propose :

catégorie
taux TVA probable
type de charge

L’utilisateur valide.

4. OCR Factures
Objectif

Lire automatiquement les PDF.

Solutions possibles
Mistral OCR
AWS Textract
Tesseract (offline)
Extraction
fournisseur
date
TVA
montant
5. Dashboard Financier
Widgets MVP
CA mensuel
dépenses
TVA estimée
trésorerie
top catégories
évolution mensuelle
Charts
Recharts
6. Copilote IA
Objectif

Assistant conversationnel contextuel.

Exemple de questions
“Combien de TVA je dois probablement ce trimestre ?”
“Quels sont mes plus gros postes de dépense ?”
“Cette dépense semble-t-elle déductible ?”
“Quels abonnements augmentent ?”
Fonctionnement

Le LLM reçoit :

fichiers workspace
contexte financier
historique récent
7. Recherche globale
Fonctionnalités

Recherche :

texte
catégorie
fournisseur
montant

Inspirée de VSCode.

8. Tags & Métadonnées
Support
tags:
  - deductible
  - recurring
9. Génération rapports
MVP

Export Markdown/PDF :

dépenses mensuelles
TVA
récap activité
IA — Architecture
Modèle

Abstraction provider :

OpenAI
Claude
Mistral
Ollama local
Capacité requise
classification
résumé
extraction
dialogue
Local-first
Important

Les données doivent :

rester accessibles sans cloud
pouvoir être sauvegardées via Git
rester lisibles humainement
Git Integration (phase 2)
Objectif

Versionning complet.

Features :

historique
rollback
audit
Sécurité
MVP
stockage local
chiffrement optionnel
aucun partage public
Non objectifs MVP

❌ Paie
❌ DSN
❌ Déclarations fiscales officielles
❌ Comptabilité certifiée
❌ Multi-entreprise complexe
❌ Collaboration temps réel

UX cible

Mélange entre :

VS Code
Obsidian
Notion
dashboard financier
Priorités de développement
Phase 1
Workspace
édition fichiers
import CSV
dashboard simple
Phase 2
IA catégorisation
OCR
copilote conversationnel
Phase 3
Git
plugins
automatisations avancées
Vision long terme

Créer un environnement financier personnel programmable, transparent et assisté par IA, où les données restent sous le contrôle de l’utilisateur plutôt qu’enfermées dans un ERP opaque.