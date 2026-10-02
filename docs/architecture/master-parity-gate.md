# Barrière de parité avec `master`

Cette liste protège le périmètre entreprise pendant la construction de la plateforme centrée sur la personne.

## Règle

Chaque ligne reste fournie par le module existant de `master`. Une adaptation est autorisée pour recevoir un `workspaceId` explicite ; une réécriture fonctionnelle exige une décision séparée et une recette comparative.

| Domaine entreprise | Comportement à préserver | Validation minimale |
| --- | --- | --- |
| Dashboard | soldes, résultat, TVA, trésorerie et prévisions | mêmes valeurs sur la même copie de données |
| Transactions | filtres, recherche, catégories, statuts, TVA multi-taux et actions en masse | parcours bureau et téléphone |
| Justificatifs | dépôt, compression, OCR, rotation, attente et associations multiples | images et PDF réels |
| Rapprochement | règles de validation, rapprochement PSD2 et traitement manuel | statuts et compteurs identiques |
| Banque PSD2 | connexion, synchronisation, solde et déduplication | aucune transaction doublée |
| TVA | collectée, déductible, régimes et échéances | comparaison période par période |
| Frais récurrents | décisions, projections et échéances | mêmes prévisions mensuelles |
| Trésorerie | solde bancaire, disponible, réserve TVA et scénarios | mêmes données d'entrée et résultats |
| Factures et devis | création, numérotation, PDF et tiers | documents identiques |
| Rapports | mensuel, activité, résultat et TVA | doublons rejetés exclus |
| Export comptable | journal, balance, FEC et archive des pièces | contrôles débit/crédit et pièces présents |
| Clôtures | mensuelle et annuelle, verrous et réouverture | aucune écriture historique modifiée |
| RH | dossiers, simulations et préparation de paie | données et projections conservées |
| Fichiers et Git | consultation des fichiers, pièces binaires et historique | aucun secret exposé |
| Paramètres | profil, PCG, catégories personnalisées et TVA | configuration rattachée au bon workspace |

## Conditions avant fusion

- aucune migration destructive ;
- comparaison automatisée des nombres de transactions, statuts, rapprochements, pièces et soldes ;
- tests des modules modifiés ;
- recette manuelle des parcours critiques sur ordinateur et téléphone ;
- possibilité de revenir à `master` avec le workspace inchangé ;
- validation fonctionnelle explicite, distincte d'un build ou d'une CI verte.

## Hors périmètre initial

Les vues consolidées ne génèrent pas d'écritures comptables et ne clôturent pas plusieurs entreprises ensemble. La consolidation légale, l'intégration fiscale de groupe et les conventions réglementées nécessiteront des lots métier dédiés.
