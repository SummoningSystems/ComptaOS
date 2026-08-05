# État actuel

## Statut

Version déclarée `1.0.0-beta` dans le README et `1.0.0` dans les packages. Le projet est en développement sur la branche active `master`.

## Changements récents observés

Le commit indexé par CTX est `ac0ee8b8` du 2026-06-02. Les derniers commits portent principalement sur le tableur (import/export XLSX/CSV), le calcul de TVA et la déduplication de transactions bancaires.

Le 2026-07-26, CTX a été initialisé avec 180 fichiers indexés. Les six documents de mémoire projet ont été renseignés à partir du code et de la documentation courante.

## Validation connue

- Build backend et frontend réussi le 2026-07-26.
- 57 tests unitaires backend réussis sur 9 fichiers.
- 22 tests unitaires frontend réussis.
- 13 tests E2E Playwright réussis dans un workspace éphémère, dont une recette comptable complète, une ventilation multi-TVA et le rapprochement bancaire guidé.
- Le 2026-08-04, le dossier expert-comptable a été ajouté : écritures en partie double, lignes HT/TVA/TTC, comptes PCG configurables, balance générale, anomalies bloquantes, FEC contrôlé et archive de justificatifs. Le build complet, 61 tests backend, 22 tests frontend et un smoke test API FEC/ZIP sont réussis ; l'audit backend signale zéro vulnérabilité.
- Le pilotage des frais récurrents consolide désormais les frais confirmés et les récurrences bancaires, mensualise correctement toutes les fréquences, projette les échéances par mois calendrier et permet de simuler conservation, réduction, suppression ou nouveau projet avec impact annuel et trésorerie.
- Les justificatifs photo supérieurs à 1 Mo sont compressés dans le navigateur avant envoi : dimension maximale 2 200 px, JPEG progressif visant environ 1,5 Mo, retour du gain obtenu et suppression de l'ancien fichier lors d'un remplacement. Les PDF et petites images restent inchangés.
- Le dépôt d'un justificatif photo/PDF propose automatiquement fournisseur, date, référence, catégorie et ventilation multi-TVA. PaddleOCR fonctionne localement par défaut dans un conteneur limité à un cœur CPU, 1,5 Gio de mémoire et une analyse à la fois ; les montants sont structurés par des règles locales. Le recours Mistral/IA est désactivé par défaut et seulement facultatif. L'utilisateur doit confirmer la proposition ; un écart avec le TTC bancaire bloque l'application et la saisie manuelle reste toujours disponible.
- Sur les écrans de moins de 768 px, ComptaOS ouvre automatiquement un parcours mobile ciblé : recherche et sélection d'une dépense, appareil photo arrière, compression, OCR local et validation de la TVA. Un bouton conserve l'accès à l'interface complète ; `?mobile=1` force ce mode pour les essais sur ordinateur et `?desktop=1` force l'interface complète sur téléphone.
- Le parcours mobile possède une boîte d'attente durable pour photographier une note avant l'arrivée de sa transaction bancaire. Le fichier compressé et la proposition OCR sont conservés sans créer de fausse transaction, puis rattachés plus tard à une dépense sélectionnée ; la vérification TVA réutilise le résultat déjà calculé.

## Problèmes et risques observés

- Le socle frontend initial est ramené d'environ 1,5 MB à environ 329 kB non compressés grâce au chargement à la demande des vues. Le worker tableur reste séparé.
- La protection atomique couvre les transactions, entreprises, factures, devis, paramètres, frais récurrents, authentification et données bancaires. Des services secondaires écrivent encore directement leurs fichiers, notamment les tableurs et licences.
- Le déploiement TipForGood utilise Node.js 20.19.5 pour les builds et le backend. Les en-têtes HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy et Permissions-Policy sont actifs sur `/comptaos`.
- Les trois audits npm locaux ne signalent plus aucune vulnérabilité connue. L'ancien conteneur Node 18 est conservé arrêté pour rollback pendant la période d'observation.
- L'authentification de production a été réinitialisée le 2026-07-26 avec sauvegarde hors workspace ; le compte propriétaire a ensuite été recréé et les données comptables ont été préservées.
- Les tests unitaires couvrent actuellement onze fichiers seulement face à un périmètre fonctionnel large.

## Questions ouvertes

- Le déploiement web et la distribution Electron ont-ils le même niveau de priorité produit ?
- Quelle couverture minimale est attendue pour les calculs comptables et les routes critiques ?
