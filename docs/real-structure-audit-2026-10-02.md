# Audit des structures réelles — 2 octobre 2026

## Données reprises automatiquement

Le profil comptable existant de **Summoning systems** fournit des preuves suffisantes pour préremplir :

- type de structure : société / entreprise ;
- forme source : SAS ;
- capital : 900 € ;
- régime de TVA : simplifié CA12.

La synchronisation ne remplace jamais une valeur déjà saisie manuellement dans la structure financière.

## Informations restant à confirmer

| Structure ou lien | Champs manquants |
|---|---|
| Summoning systems / Mon entreprise | régime fiscal, début d’activité, bornes de l’exercice ; pourcentage et date d’effet de la détention, nombre de parts, bénéficiaire effectif |
| auto | forme juridique exacte, capital si applicable, régime fiscal, régime de TVA, début d’activité, exercice ; pourcentage/date de détention et bénéficiaire effectif |
| foyer thomas jurado | autres membres éventuels et liens vers les structures patrimoniales |

Aucune SCI, holding ou filiale réelle n’est actuellement présente dans la copie de préproduction. Ces circuits sont couverts par la recette automatisée, mais leur recette sur données réelles reste impossible tant que ces structures et leurs relations n’ont pas été créées.

## Recette exécutée

- personne vers entreprise : couverte ;
- foyer vers SCI : couverte sur données de test ;
- holding vers filiale : couverte sur données de test ;
- compte courant d’associé : couvert jusqu’à la génération, la correction et la contrepassation ;
- transfert partiel intermois avec frais : couvert ;
- export : les écritures de transfert équilibrées sont incluses dans le journal/FEC ;
- clôture : les écritures de transfert font désormais partie de l’empreinte et aucune nouvelle comptabilisation n’est autorisée sur un mois clos.

## Décision actuelle

La branche peut être déployée en préproduction pour recette visuelle. Elle ne doit pas être fusionnée ni déployée en production avant validation de la matrice comptable et saisie des informations réelles manquantes ci-dessus.
