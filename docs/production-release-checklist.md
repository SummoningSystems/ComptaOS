# Passage en production de la plateforme centrée personnes

## Décision de fusion

La fusion reste refusée tant que les points suivants ne sont pas tous cochés :

- [ ] fiches réelles complétées sans valeur juridique inventée ;
- [ ] cinq circuits testés sur une copie des données ;
- [ ] matrice des comptes signée par l’expert-comptable ;
- [ ] export annuel et dossier mensuel contrôlés ;
- [ ] recette ordinateur et téléphone validée ;
- [ ] sauvegarde complète copiée hors du VPS et restauration testée ;
- [ ] commit candidat et commit de retour arrière notés.

## Sauvegarde

Sur le VPS :

```bash
bash deployment/backup-production.sh
```

Copier ensuite les trois fichiers `.tar.gz`, `.sha256` et `.commit` sur un stockage hors VPS, vérifier le SHA-256, puis extraire l’archive dans un dossier isolé. La sauvegarde contient le workspace entier, donc les pièces jointes et fichiers sensibles : elle doit rester privée et chiffrée au repos.

## Retour arrière

Pendant une fenêtre de maintenance seulement :

```bash
ARCHIVE=/chemin/comptaos-production-AAAAMMJJTHHMMSSZ.tar.gz \
CONFIRM_RESTORE=RESTORE_COMPTAOS_PRODUCTION \
bash deployment/restore-production-workspace.sh
```

Le script conserve l’ancien workspace à côté du dépôt, restaure dans un répertoire intermédiaire, redémarre le backend et remet automatiquement l’ancien workspace si le contrôle de santé échoue.
