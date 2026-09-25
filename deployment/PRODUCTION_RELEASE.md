# Mise en production contrôlée de la migration multi-utilisateur

Cette procédure ne doit être lancée qu'après validation de la préproduction et fusion de `release/develop-migration` dans `master`. Elle conserve le dépôt de production sur `master`.

## 1. Avant la fenêtre

1. Vérifier que la CI du commit de `master` est verte.
2. Noter son SHA complet : `git rev-parse origin/master`.
3. Confirmer que la sauvegarde hors VPS est toujours lisible et conserver son chemin local.
4. Prévenir les utilisateurs : pendant la fenêtre, l'interface peut rester visible mais les appels API échoueront temporairement ; aucune saisie ne doit être faite.
5. Prévoir au moins 30 minutes et garder un accès SSH ouvert.

## 2. Sauvegarde immédiate et déploiement

Depuis le VPS :

```bash
cd ~/apps/comptaos
EXPECTED_COMMIT=<sha-complet-de-master> bash deployment/deploy-production-safe.sh
```

Le wrapper :

- refuse une branche autre que `master`, un dépôt suivi modifié ou un SHA inattendu ;
- arrête le backend avant la copie, ce qui ouvre la fenêtre de maintenance et fige les écritures ;
- archive `workspace/` hors du dépôt, justificatifs et secrets compris ;
- vérifie que l'archive est lisible et écrit sa somme SHA-256 ;
- force une reconstruction complète, puis contrôle l'API publique HTTPS.

Les éléments de retour arrière sont dans `~/backups/comptaos-releases/<date>-<commit>/release.env`.

Copier immédiatement ce dossier hors du VPS avant de reprendre les saisies :

```powershell
scp -P 2222 -r benoit@77.37.120.101:/home/benoit/backups/comptaos-releases/<dossier> "C:\travaille\summoning systems\compta_backups\production-releases\"
```

## 3. Contrôles avant réouverture

- connexion propriétaire puis utilisateur restreint ;
- même nombre de transactions, opérations rapprochées et justificatifs qu'avant ;
- solde bancaire et comptes visibles inchangés ;
- ouverture d'une pièce jointe PDF et image ;
- export comptable sur un exercice connu ;
- accès à la clôture annuelle sans confirmer ses cases ni clôturer l'exercice ;
- capture mobile d'un justificatif jetable, à supprimer après le test.

## 4. Retour arrière du code

Ne pas réécrire l'historique de `master`. Si le code doit être annulé, créer depuis un poste de travail un commit de revert du merge de release, le pousser sur `master`, puis relancer le wrapper avec le nouveau SHA. Cela garde une piste d'audit complète.

## 5. Retour arrière des données

Restaurer les données uniquement si une comparaison prouve qu'elles ont été modifiées ou perdues. Cette opération remplace le workspace courant : garder d'abord une copie de quarantaine.

```bash
cd ~/apps/comptaos
docker stop comptaos-backend
timestamp=$(date +%Y%m%d%H%M%S)
mv workspace "workspace-quarantine-$timestamp"
tar -xzf <BACKUP_ARCHIVE> -C ~/apps/comptaos
test -f workspace/auth.json
docker start comptaos-backend
curl -fsS https://tipforgood.com/comptaos/api/health
```

Comparer ensuite transactions, rapprochements, justificatifs, comptes et soldes avant de supprimer la quarantaine. En cas de doute, laisser la production arrêtée et restaurer d'abord l'archive dans un troisième dossier pour vérification.
