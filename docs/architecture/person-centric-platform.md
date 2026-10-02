# Architecture ComptaOS centrée sur la personne

Statut : décision fondatrice de la branche `next/person-centric-platform`.

## Intention

ComptaOS devient une plateforme financière partant d'une personne. Une personne peut gérer sa comptabilité personnelle, plusieurs entreprises et des montages reliant plusieurs personnes morales (holding, filiales, SCI, participations et comptes partagés).

Cette évolution ajoute une couche d'orchestration. Elle ne remplace pas le moteur de gestion d'entreprise présent sur `master`.

## Invariants de non-régression

1. Un espace entreprise continue d'utiliser les services, fichiers et écrans métier de `master`.
2. Une transaction d'entreprise reste stockée dans son workspace d'origine. La couche globale ne la recopie pas.
3. L'OCR, la TVA, les justificatifs, le rapprochement, les rapports, les exports, les frais récurrents, la trésorerie, les clôtures et la RH ne sont pas réécrits pour construire la vue globale.
4. Une vue consolidée est d'abord une projection en lecture seule des données sources.
5. La comptabilité personnelle possède son propre espace et ses propres règles. Elle ne détourne pas les catégories ou règles fiscales d'une entreprise.
6. Une migration rattache les workspaces existants par identifiant et chemin ; elle ne déplace ni ne duplique leurs données.
7. Une nouvelle version ne peut remplacer un parcours de `master` qu'après une recette de parité explicite sur une copie de données réelles.

## Modèle conceptuel

### Personne

Point d'entrée de la plateforme. Elle possède des droits d'accès et peut être :

- titulaire ou cotitulaire d'un compte ;
- propriétaire, dirigeante, associée ou salariée d'une entreprise ;
- membre d'un foyer ou d'un périmètre partagé ;
- porteuse d'un espace comptable personnel.

### Entité juridique

Une entité juridique référence un workspace entreprise ComptaOS existant. Son type décrit sa place dans la structure sans modifier son moteur comptable : entreprise individuelle, micro-entreprise, SAS, SASU, SARL, holding, SCI, association ou autre.

### Compte financier

Un compte bancaire ou financier est un objet unique. Ses relations indiquent ses titulaires et ses usages personnels ou professionnels. Un même compte ne doit jamais être compté deux fois dans une consolidation.

### Relations

Les relations sont datées lorsque nécessaire :

- personne titulaire d'un compte ;
- personne exerçant un rôle dans une entité ;
- compte utilisé par une personne ou une entité ;
- entité détenant une participation dans une autre entité ;
- pourcentage de détention et période de validité ;
- appartenance à un foyer ou à un périmètre partagé.

### Espace personnel

L'espace personnel gère les mouvements privés, budgets, revenus, dépenses, patrimoine et documents personnels. Il doit rester distinct des traitements comptables professionnels, tout en permettant l'identification explicite des apports, remboursements, comptes courants d'associés et dépenses mixtes.

## Architecture cible

```text
Plateforme d'une personne
├── Structure et relations
├── Vue consolidée en lecture seule
├── Comptabilité personnelle
└── Entités juridiques
    ├── Entreprise A → workspace et interface métier de master
    ├── Holding      → workspace et interface métier de master
    └── SCI          → workspace et interface métier de master
```

La couche plateforme stocke uniquement son registre, ses relations, les préférences de navigation et les données strictement personnelles. Chaque entreprise reste propriétaire de ses transactions, justificatifs, paramètres, écritures et clôtures.

## Navigation cible

- **Vue d'ensemble** : structure personnes/entreprises/comptes et indicateurs consolidés.
- **Personne** : finances personnelles et éléments partagés.
- **Entreprise** : ouverture de l'interface complète actuelle, dans le contexte du workspace choisi.
- **Compte** : mouvements du compte et affectations vers les contextes concernés.
- **Montage** : lecture des participations, flux inter-entités et contrôles de cohérence.

La carte « Structure financière » de la branche expérimentale sert de référence visuelle. Ses réimplémentations simplifiées des modules métier ne sont pas reprises.

## Stratégie de réalisation

### Étape 1 — Socle sans régression

- registre versionné des personnes, entités, comptes et relations ;
- rattachement non destructif des entreprises existantes ;
- écran Structure financière ;
- ouverture d'une entreprise dans l'interface complète de `master` ;
- aucune modification du contenu d'un workspace entreprise.

### Étape 1.5 — Portefeuilles et autorisations

- distinction stricte entre utilisateur connecté et personne modélisée ;
- attribution explicite d'une personne ou d'une entreprise à plusieurs utilisateurs ;
- rôles par périmètre : responsable, gestionnaire/comptable et lecture seule ;
- entreprise active conservée séparément pour chaque utilisateur ;
- contexte de requête isolé pour empêcher deux utilisateurs de partager le même workspace actif ;
- caches métier séparés par workspace ;
- reprise automatique des accès historiques lors de la première migration.

### Étape 2 — Comptabilité personnelle

- workspace personnel séparé ;
- comptes, mouvements, catégories, budgets et justificatifs personnels ;
- distinction explicite privé, professionnel et mixte ;
- imports bancaires sans double comptage.

### Étape 3 — Consolidation

- soldes et flux consolidés en lecture seule ;
- détention et rôles datés ;
- neutralisation visible des virements internes ;
- flux entre personne, holding, société opérationnelle et SCI.

### Étape 4 — Écritures inter-contextes

- apports et retraits ;
- comptes courants d'associés ;
- remboursements de frais ;
- conventions et flux inter-entreprises ;
- validations symétriques sans écriture implicite.

## Migration de `master`

Au premier démarrage, l'entreprise historique devient une entité juridique rattachée à la personne principale. Son workspace reste inchangé. La migration produit un aperçu, une sauvegarde et un rapport de contrôle, et doit pouvoir être rejouée sans doublon.

## Critère de réussite

La nouvelle couche est réussie si un utilisateur peut ignorer les fonctions globales, ouvrir son entreprise historique et retrouver le même comportement, les mêmes données et les mêmes capacités que sur `master`.
