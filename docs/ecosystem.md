# Écosystème financier — guide de prise en main

ComptaOS ouvre désormais un espace partagé vide. La structure, les mouvements,
les documents et les traitements comptables sont enregistrés sur le serveur.
Le prototype reste accessible uniquement en développement avec `?prototype=ecosystem`.

## Installation et premier accès

Suivre [le guide du serveur local](../deployment/LOCAL.md) pour Docker, HTTPS et
l’adresse LAN. Il n’existe aucun identifiant par défaut : le premier accès à une
installation vide propose de créer le propriétaire. Une installation déjà configurée
conserve ses utilisateurs et affiche la connexion habituelle.

Après connexion, saisir le nom de l’espace puis **Créer l’écosystème**. Les anciennes
données ne sont ni effacées ni converties. Pour repartir entièrement de zéro, créer
une sauvegarde, arrêter le serveur et utiliser un nouveau volume de données ; conserver
l’ancien volume pour revenir en arrière. Ne pas supprimer le volume Caddy, qui contient
l’autorité de certification locale. Le développement se fait sur `develop`.

## Construire votre espace à deux

1. Dans **Structure**, utiliser **+ Ajouter → Personne** pour vous ajouter chacun.
   Ces personnes décrivent les finances ; elles ne créent pas d’identifiants de connexion.
2. Ajouter vos deux entreprises. Activer la comptabilité pour chacune si nécessaire,
   puis la TVA uniquement pour les entreprises concernées. Une holding ou une SCI peut
   aussi être ajoutée ; son type ne configure pas automatiquement ses règles comptables.
3. Ajouter librement les six comptes, par exemple :

   | Compte | Titulaires | Usage / entreprise associée |
   |---|---|---|
   | Personnel — vous | Vous | Personnel |
   | Professionnel — vous | Selon la titularité bancaire réelle | Votre entreprise |
   | Personnel — partenaire | Votre partenaire | Personnel |
   | Professionnel — partenaire | Selon la titularité bancaire réelle | Son entreprise |
   | Commun — charges | Vous deux | Administratif et récurrent |
   | Commun — quotidien | Vous deux | Vie courante |

4. Créer explicitement les relations **Titulaire**, **Exerce dans** et **Utilisé pour**.
   Un compte joint est un seul élément avec deux titulaires. **Participation dans**
   relie les entreprises entre elles et refuse les cycles.
5. Organiser la carte en colonnes, librement ou en hiérarchie. Le placement et les
   onglets sont propres à chaque utilisateur et enregistrés sur le serveur.
6. Ouvrir les paramètres de chaque compte : nom, usage, IBAN facultatif, affectation
   par défaut et solde initial facultatif. Le solde initial est celui du début de la
   date choisie ; les mouvements de cette date sont ensuite ajoutés.
7. Dans **Application**, créer une invitation et partager son lien avec votre partenaire.
   Elle ouvre le lien sur l’adresse LAN de votre serveur et choisit ses propres identifiant
   et mot de passe. Les deux membres voient et modifient les mêmes données. Si son compte de connexion
   existe déjà, choisir **Application → Utilisateur existant → Ajouter à l’espace**.

Les comptes, personnes et entreprises sont dynamiques : six comptes ne constituent
pas une limite. Archiver un élément conserve son historique.

## Pour votre partenaire, au quotidien

1. Ouvrir l’adresse du serveur et se connecter avec son identifiant.
2. Choisir **Vue d’ensemble**, une personne, une entreprise ou un compte dans le menu du haut.
3. Ouvrir **Mouvements → Transactions**. Choisir un mouvement pour vérifier son libellé,
   ses affectations et ses justificatifs.
4. Pour un achat mixte de 100 €, saisir par exemple −70 € pour l’entreprise et −30 €
   pour la personne. La somme doit toujours rester égale au mouvement bancaire.
5. Ajouter le reçu via **Ajouter / consulter les justificatifs**. Le même document
   devient accessible depuis les périmètres concernés sans recopier le fichier.
6. Ouvrir le traitement comptable proposé pour la partie professionnelle. Confirmer
   la catégorie, la TVA éventuelle et la contrepartie du règlement. Un paiement
   personnel exige une contrepartie appropriée, à déterminer selon votre comptabilité.
   Aucun compte d’avance ni droit à déduction de TVA n’est supposé automatiquement.
7. Revenir à l’onglet du mouvement ou à la carte : les autres onglets restent ouverts.

Un traitement validé doit être rouvert avant correction. Les périodes clôturées sont
protégées. Un conflit entre deux modifications demande de recharger et de vérifier
les changements ; le serveur ne remplace pas silencieusement la première modification.

## Import et connexions bancaires

**Mouvements → Importer un relevé** accepte CSV, OFX et QIF. Choisir d’abord le compte,
vérifier les colonnes CSV et la prévisualisation, puis confirmer. Les doublons certains
sont ignorés ; les ressemblances entre sources demandent une comparaison. Les mêmes
achats sur deux comptes distincts restent deux mouvements.

**Connexions bancaires** utilise Powens :

- L’administrateur configure le domaine et les identifiants Powens, ou les fournit via
  l’environnement existant. Un abonnement/configuration Powens valide reste nécessaire.
- Enregistrer dans Powens l’URL de retour exacte affichée, accessible depuis le navigateur.
  Avec un proxy, `COMPTAOS_PUBLIC_URL` peut fixer l’origine attendue.
- Chaque membre connecte sa propre identité bancaire. Les secrets restent sur le serveur.
- Découvrir les comptes puis associer chacun à son compte existant dans Structure.
  Pour un compte joint, une seule connexion est associée au compte partagé.
- Cliquer **Synchroniser** pour récupérer les mouvements disponibles chez Powens.
  Il n’y a ni tâche périodique ni webhook de synchronisation ComptaOS. La disponibilité
  des opérations récentes dépend aussi de l’actualisation effectuée par Powens.
- Vérifier les corrections et doublons proposés. Une correction bancaire ne remplace
  pas automatiquement un montant déjà traité. Déconnecter un flux conserve l’historique.

Cette version traite l’EUR. Les tests Powens utilisent des réponses simulées ; une
recette avec vos identifiants et votre banque reste nécessaire.

## Flux, virements, budgets et soldes

Confirmer les deux côtés d’un virement dans **Virements**. Il reste visible dans chaque
compte mais est exclu des revenus/dépenses affectés. Une contrepartie manquante peut
rester à retrouver. Les remboursements de dépenses se distinguent des revenus.
Les flux sont consultables sous forme de diagramme ou de liste, avec accès aux mouvements.

Les budgets sont mensuels par affectation et catégorie. Les échéances récurrentes sont
prévisionnelles : elles ne créent jamais de mouvements bancaires. La sélection multiple
permet de vérifier ou d’affecter plusieurs mouvements en une opération.

Le solde calculé utilise le solde initial et les mouvements importés. Le dernier solde
communiqué par la banque est affiché séparément avec sa date. Un solde sans base connue
reste inconnu. Le dashboard comptable considère comme trésorerie d’entreprise uniquement
les comptes dont l’entreprise est explicitement titulaire : un lien d’usage ne transforme
pas un compte personnel en compte de l’entreprise. Les allocations professionnelles
payées personnellement influencent les charges, pas cette trésorerie.

## Documents et outils d’entreprise

La bibliothèque affiche les documents directs et associés au périmètre sélectionné.
Elle réunit les fichiers partagés, les justificatifs d’entreprise et les factures/devis
produits par les outils existants. Les PDF/images restent locaux. L’analyse de la
bibliothèque utilise seulement `OCR_LOCAL_URL`, si ce service local est configuré.

Les entreprises conservent journal, clôture, TVA, bilan, facturation, devis, RH, rapports
et exports dans les mêmes onglets. Les exports comptables reprennent les contreparties
validées et les justificatifs partagés. La hiérarchie holding/SCI organise la navigation ;
elle ne réalise pas de consolidation comptable automatique.

## Mini-tableurs

**Analyses & Export → Tableaux** ouvre le tableur HyperFormula dans chaque périmètre.
Les classeurs de la vue d’ensemble sont partagés ; chaque personne, compte et entreprise
possède aussi ses propres classeurs. Les onglets restent liés à leur périmètre, y compris
pour les sauvegardes différées. Les formules, feuilles multiples, formats et imports/exports
CSV/XLSX sont conservés. Les variables comptables sont disponibles dans les tableaux
rattachés à une entreprise ; les autres périmètres disposent des formules usuelles.
Les classeurs d’entreprise déjà présents conservent leur emplacement.

## Architecture et exploitation

- Une instance serveur, un disque local, plusieurs sessions utilisateur.
- Un `ecosystem.json` versionné par espace : structure, banque, affectations, traitements,
  budgets, échéances, index documentaire et historique avec acteur.
- Les mouvements et leurs traitements comptables sont validés sous le même verrou et
  écrits dans une seule transaction durable. `ecosystem.pending.json` permet de reprendre
  une interruption avant de servir la lecture suivante.
- Les modules d’entreprise restent dans leurs répertoires ; les transactions liées sont
  lues depuis l’état partagé. Une API liée explicitement à chaque onglet empêche le menu
  global de rediriger une requête vers une autre entreprise.
- `documents/` contient les pièces partagées ; les documents natifs sont référencés.
- `preferences/<user>.json` contient carte et onglets ; `.powens_profiles.json` contient
  les jetons individuels, exclus de Git mais inclus dans les sauvegardes complètes.
- L’ancien écran Foyer n’est plus une entrée de l’application. Les anciennes API et les
  outils d’entreprise via `?legacy=1` restent disponibles pour compatibilité ; aucun
  convertisseur de l’ancien Foyer indépendant n’est exécuté. Les états écosystème v1 et les anciennes prévisions d’entreprise sont migrés avec conservation des sources (voir le registre de parité).

Utiliser **Application → Sauvegarder maintenant** et les instructions de restauration
hors ligne du guide local. Sauvegarder avant la bascule et avant chaque mise à jour.

## Vérification

```sh
npm test --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
npx playwright test --config playwright.ecosystem-live.config.ts
npx playwright test --config playwright.ecosystem.config.ts
npm run test:e2e
```

Les suites navigateur démarrent leurs serveurs et données temporaires. La CI vérifie
également le démarrage Docker, HTTPS, une sauvegarde et la persistance après redémarrage.


## Adaptation des fonctionnalités

Voir [le registre de parité](feature-parity.md) pour les entrées de chaque outil, les règles de périmètre et les migrations. Les nouveautés principales sont **Variables**, les périodes de **Trésorerie dédiée** dans les paramètres d’un compte, les filtres avancés, le rapprochement partagé et les outils complets sous **Application**.
