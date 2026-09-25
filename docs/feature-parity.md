# Parité fonctionnelle : écosystème financier

Cette matrice accompagne le passage de l’ancienne interface entreprise à l’interface partagée. `?legacy=1` reste disponible pour compatibilité. La présence d’un module dans cette matrice ne remplace pas sa recette navigateur.

## Règles de données

- Une personne, une entreprise et un compte sont des objets distincts, identifiés indépendamment de leur nom.
- Les titulaires ne déterminent pas la répartition des dépenses. `common` désigne la vie commune, `unassigned` une affectation à préciser. `root` désigne la vue d’ensemble.
- Un débit bancaire existe une seule fois. Ses affectations totalisent exactement le débit ; les traitements comptables des entreprises proviennent de ces affectations.
- Un compte dédié à une entreprise contribue à sa trésorerie sur une période explicite, bornes incluses. Deux périodes ne peuvent se chevaucher. Les liens d’usage ou de participation dans Structure ne consolident pas automatiquement la trésorerie.
- Les indicateurs personnels utilisent les affectations personnelles ; activités et comptes associés restent visibles séparément.
- Les remboursements diminuent les dépenses ; les virements, y compris ceux dont la contrepartie reste à retrouver, ne constituent pas un revenu ni une dépense.
- Les prévisions et simulations ne créent pas de mouvements. Un solde inconnu est affiché comme inconnu.
- Les catégories financières et comptables restent distinctes. Les budgets historiques comptables sont identifiés comme tels.

## Registre par fonctionnalité

| Lot | Fonction historique | Entrée dans la nouvelle interface | Source / adaptation | Recette attendue |
| --- | --- | --- | --- | --- |
| 0 | Sélection d’entreprise | Sélecteur de périmètre et Structure | Catalogue d’outils à identifiants stables ; anciens liens normalisés | Changement d’outil et de nom sans casser les liens |
| 0 | Données existantes | Chargement du serveur | Migration v1 → v2, copie originale, rapport de révision | Identifiants préservés, migration idempotente |
| 1 | Dashboard | Icône Dashboard | Périmètre actif ; module natif pour entreprise | Ne retourne pas involontairement à Structure globale |
| 1 | Navigation / éditeur | Onglets et Fichiers | API liée au contexte de chaque onglet | Un enregistrement différé reste dans son périmètre |
| 1 | Recherche | Recherche / Ctrl+K | Entités, mouvements, pièces, traitements et fichiers autorisés | Résultat ouvert dans son contexte d’origine ; secrets absents |
| 1 | Vue globale | Vue d’ensemble / Flux | Totaux des affectations, comptes uniques, activités distinctes | Compte joint compté une fois ; aucune répartition 50/50 implicite |
| 2 | Import CSV | Mouvements → Importer un relevé | Compte bancaire canonique ; aperçu et choix des colonnes | Réimport sans doublon |
| 2 | OFX / QIF | Même entrée | Même source canonique | Même mouvement bancaire quel que soit le format |
| 2 | Powens | Connexions bancaires | Connexion personnelle, correspondance explicite vers compte commun | Import paginé, doublons et corrections à confirmer |
| 2 | Filtres / étiquettes | Mouvements → Filtres avancés | Compte, affectation, catégorie, nature, montant, étiquette | Filtrer une dépense mixte sans modifier ses montants |
| 2 | Catégorisation / IA | Entreprise → Écritures et catégorisation | Ancien module connecté aux traitements canoniques ; client IA lié à l’entreprise | Proposition explicitement appliquée, aucune validation automatique |
| 2 | Actions en masse | Mouvements / Écritures | Révisions et écriture atomique de la sélection | Un élément verrouillé fait échouer tout le lot |
| 2 | Virements | Mouvements → Virements | Paire de mouvements ou contrepartie à retrouver | Aucun revenu artificiel ; règlement comptable uniquement si périmètre explicite |
| 2 | Rapprochement | Rapprochement partagé | Pièces ↔ mouvements ↔ traitements ; montants partiels facultatifs | Plusieurs pièces / règlements, origine et reste visibles |
| 2 | TVA multi-taux | Traitement d’entreprise | Ventilation bornée à la part professionnelle | Débit 100 €, entreprise 70 €, personne 30 €, TVA uniquement sur 70 € |
| 2 | Journal, TVA, P&L | Entreprise → Comptabilité / Finance | Modules natifs sur les traitements canoniques | Contrepartie explicite, validation et réouverture |
| 2 | Clôture / export comptable | Entreprise → Clôture / Export | Verrous mensuels et dossier de justificatifs | Une modification indirecte ne contourne pas une clôture |
| 2 | Alertes | Mouvements → Alertes | Tâches contextualisées, pièces à relier, corrections et traitements | Chaque action ouvre le bon mouvement ou traitement |
| 3 | Bibliothèque | Documents | Une ressource, plusieurs liens directs ou associés | La même pièce est accessible aux deux membres |
| 3 | OCR | Document → Analyser avec l’OCR local | Parseur structuré local, proposition éditable, application explicite | Pas de mouvement créé ; montant professionnel vérifié |
| 3 | Capture mobile | Documents → Ajouter | Photos acceptées, capture caméra proposée, filtre « À relier » | Photographier puis affecter plus tard |
| 3 | Factures / devis | Documents → Facturation / Créer des devis | Modules natifs par entreprise, consultation transversale | Création liée à une entreprise, PDF accessible dans la bibliothèque |
| 3 | Tiers / modèles | Documents → Tiers / Modèles | Modules natifs liés à l’entreprise | Pas d’écriture dans l’entreprise voisine |
| 3 | RH | Entreprise → RH | Dossiers, pièces et variables de paie conservés | Contributions RH présentes dans la prévision, sans doublon |
| 4 | Budgets | Finance → Budgets | Budgets communs ; anciens budgets comptables explicitement identifiés | Remboursements et virements correctement traités |
| 4 | Échéances historiques | Finance → Frais récurrents | Migration conservant les anciens fichiers ; adaptateur des routes natives | Une seule écriture canonique ; modification concurrente refusée |
| 4 | Détection / calendrier / décisions | Frais récurrents | Détection à confirmer, date de fin, conserver/réduire/supprimer/projet | Les décisions changent la simulation, jamais le réalisé |
| 4 | Trésorerie | Finance | Comptes contribuants explicites, horizons 3/6/12 mois, soldes inconnus | Séparer dépenses prévues et soldes calculables |
| 5 | Rapports financiers | Analyses & Export → Rapports | Même calcul d’affectations que Vue d’ensemble | Personne / compte / ensemble cohérents |
| 5 | Exports CSV / FEC / pièces | Analyses & Export → Export | CSV financier par périmètre ; comptabilité légale par entreprise | Aucun FEC multi-entreprises implicite |
| 5 | Mini-tableurs | Analyses & Export → Tableaux | HyperFormula, feuilles, formats, CSV/XLSX conservés | Formules persistées, espaces séparés, conflit d’écriture refusé |
| 5 | Variables | Analyses & Export → Variables | Source, indicateur, période propre, filtre, identifiant stable | Renommage sans casse, cycles / source manquante / solde inconnu signalés |
| 6 | Utilisateurs / invitations | Application | Gestion complète des rôles et membres | Deux utilisateurs partagent les données ; lecteur sans mutation |
| 6 | Profil, TVA, comptes | Entreprise → Profil et comptabilité | Réglages natifs liés à l’entreprise | Réglages appliqués au bon contexte |
| 6 | Assistant IA | Entreprise → Paramètres → Assistant | Conversation et client HTTP liés à l’entreprise | Requête sans dépendance au sélecteur global |
| 6 | Fichiers / éditeur | Paramètres → Fichiers | Répertoire isolé par périmètre ; données gérées protégées | Ctrl+S concerne l’onglet actif uniquement |
| 6 | Historique métier / Git | Historique / Historique Git | Acteur et périmètres de mutation ; historique Git séparé | Une opération métier ne se réduit pas à un commit |
| 6 | Extensions | Application → Extensions | Inventaire central et installations historiques, exécution avec périmètre explicite | Activation administrateur ; résultat consultable sans validation comptable |
| 6 | Plans / licence | Application → Plans et licence | Module existant conservé | Même comportement qu’avant |
| 6 | Sauvegarde / restauration | Application / commande hors ligne | Archive complète, hashes et destination vide pour restauration | Restauration de l’ensemble, pièces et variables incluses |

## Migration et compatibilité

`ecosystem.v1.backup.json` conserve les octets de l’état original avant migration. Les anciennes affectations « À classer » du périmètre racine deviennent non affectées ; les autres deviennent vie commune. Les comptes dont l’affectation par défaut était ambiguë sont signalés dans `migration.review`.

Les fichiers `settings/manual_recurring.json` et `settings/budgets.json` des entreprises sont importés une fois. L’état préalable est conservé dans `ecosystem.planning.backup.json` ; les fichiers sources ne sont pas réécrits. Une ancienne échéance sans compte explicite reste « compte à préciser ». Le journal `planning-migration` permet de retrouver ces cas.

Les données du premier Foyer indépendant ne sont ni supprimées ni converties automatiquement. Les chemins des tableurs d’entreprise ne changent pas. Les nouveaux fichiers libres utilisent `scope-data/<scope>/files` et les tableurs partagés `scope-data/<scope>/spreadsheets`.

Les règles pures de calcul sont partagées entre serveur et interface dans `backend/src/domain/`, sans accès au système de fichiers. Le build Docker de l’interface copie explicitement ce répertoire.

## Variables et calculs

Une variable de référence choisit une personne, entreprise, compte, vie commune, non affecté ou ensemble ; un indicateur ; une période (`2026`, `2026-09`, `current-month`, `current-year`, ou toutes les dates selon l’indicateur) ; une catégorie facultative.

Les familles sont distinctes : affectations TTC, débits/crédits bancaires, solde de trésorerie, montants comptables HT/TVA validés et échéances futures de référence. Les indicateurs comptables exigent une entreprise. Une variable calculée combine des références `{identifiant}` avec `+ - * /` et des parenthèses. Le tableur utilise le symbole stable `V_<identifiant>`. Le nom affiché peut changer.

Une variable non calculable présente une erreur ; elle n’est pas injectée comme zéro dans HyperFormula. Utiliser « Actualiser les variables » après modification des sources. L’écran Variables présente l’origine, la période, l’unité et la date de calcul.

## Vérification

Les tests de domaine et API couvrent le calcul mixte, la neutralité des virements, les remboursements, les affectations datées, les migrations, les conflits de révision, les actions comptables atomiques, les fichiers isolés et les variables. La suite navigateur `playwright.ecosystem-live.config.ts` utilise l’application réelle et des données temporaires avec deux utilisateurs ; elle ne passe pas par `legacy=1`.

La recette réelle Powens et celle d’un worker OCR externe nécessitent leurs services configurés. Leur disponibilité ne doit pas être déduite des tests simulés. La restauration reste une opération hors ligne documentée dans `deployment/LOCAL.md`.


### Résultats locaux du 24 septembre 2026

- Serveur : **159 tests réussis**, 2 tests de liens symboliques ignorés sous Windows.
- Interface : **70 tests réussis** ; lint sans erreur.
- Compilation serveur et interface réussie, y compris avec `BASE_PATH=/comptaos/`.
- **6 tests du prototype et 14 tests métier de compatibilité réussis**.
- **2 parcours navigateur réels réussis** : écosystème partagé (avec TVA multi-taux 70/30) et modules entreprise / administration.
- Les services Powens, IA et OCR externes n’ont pas été appelés avec des données réelles pendant cette vérification.
