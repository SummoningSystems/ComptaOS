# Revue comptable des transferts patrimoniaux

Statut : **propositions techniques à faire valider par l’expert-comptable avant comptabilisation réelle**.

Référence normative : [Plan comptable général ANC, version au 1er janvier 2026](https://www.anc.gouv.fr/plan-comptable-general-0).

## Matrice de contrôle

| Circuit | Proposition côté société qui verse | Proposition côté société qui reçoit | Point à confirmer |
|---|---|---|---|
| Virement entre deux banques d’une même entité | `580` puis `512` | `512` puis `580` | Le `580` ne doit pas masquer un transfert entre deux personnes morales distinctes. |
| Apport en capital | `261` uniquement si le souscripteur est une société et que les titres constituent une participation | `4561`/`4563` pendant l’opération, puis `101` quand le capital devient effectif | Formalités, date d’effet, prime éventuelle et nature du souscripteur. |
| Compte courant d’associé | Créance ou suivi patrimonial selon la qualité du prêteur | `455` au crédit pour les fonds laissés temporairement par l’associé | Convention, rémunération, blocage et sens débiteur/créditeur. |
| Prêt interentreprises | `267` si la créance est rattachée à une participation ; sinon compte de créance adapté | `168` ou dette rattachée à une participation selon le lien | Durée, convention, taux, lien de participation et intérêts courus. |
| Acquisition/détention d’une filiale | `261` pour les titres de participation | Capital dans les comptes de la filiale | Pourcentage, contrôle, frais d’acquisition et date de prise de contrôle. |
| Frais bancaires liés au transfert | `627` contre `512` | Aucun | Vérifier que les frais figurent bien uniquement sur le mouvement débité. |

Le dossier personnel ou foyer n’est pas automatiquement soumis au PCG : ComptaOS doit y conserver le mouvement et sa preuve, mais ne doit pas présenter une contrepartie de société comme une écriture personnelle certifiée.

## Recette attendue avec le comptable

- qualifier chaque partie : personne physique, foyer, société commerciale, SCI, holding ou filiale ;
- confirmer le compte de chaque côté et pas seulement la paire globale ;
- confirmer le moment où une souscription passe de `456` à `101` ;
- confirmer si un prêt relève de `267/168`, de comptes de groupe, ou d’un autre compte de tiers ;
- signer le résultat dans la fiche de recette avant d’autoriser « Générer les écritures ».
