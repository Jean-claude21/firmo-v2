# Spec 011 — Offre au niveau de la v1

- Branche : `feat/011-offre-v1`
- Source : `docs/product/PARITE_V1.md` §4 (P-50 à P-57) ; v1 : `decisions.md`, `model.md`,
  `backend/app/features/billing`, migrations `20260810006000_billing_chariow.sql` à
  `20260817001000_essential_offer_15_documents.sql`. Conditions de fin reprises de Struo
  (spec 060 de Struo : cycle de licence, conditions générales).
- Fonctionnalités : OFF-1, OFF-2, OFF-3, ART-6
- Statut : terminée

## Pourquoi

La v2 savait vendre une période de 30 jours. La v1 allait plus loin : recharges, alerte de quota,
versions d'offre gardées par les abonnements, Chariow comme fournisseur, rapprochement par l'équipe,
message de confirmation qui ne se perd pas. Le porteur a demandé en plus des conditions de fin
claires, sur le modèle de Struo.

## L'offre de référence

La v1 a changé son offre le 2026-08-17 (migration `essential_offer_15_documents`) : **2 000 F CFA
par mois pour 15 documents finaux**, produit Chariow `prd_s1bcdqkm`. Ses documents (`decisions.md`,
`contenus.md`) disaient encore 30 documents : c'est la migration, plus récente, qui fait foi. La
migration `0015` publie donc une version 2 de l'offre `standard` dans chaque devise : 15 documents,
recharge de 10 documents, 3 jours de grâce. Le prix d'une recharge n'a jamais été fixé dans la v1 :
il reste vide (recharge non proposée) tant que le porteur ne le saisit pas dans la console.

## Conditions de fin (reprises de Struo)

| Struo | Firmo |
|---|---|
| Licence payée d'avance, sans reconduction automatique | Période payée d'avance, sans reconduction automatique |
| Gérants prévenus par e-mail et bandeau, 14 jours avant | Artisan prévenu dans son chat `subscription_warn_days` jours avant (3 par défaut), puis la veille ; bandeau sur la page Abonnement |
| Grâce de 7 jours : tout reste ouvert | Grâce par version d'offre (`grace_days`, 3 par défaut) : on émet encore |
| Après la grâce : lecture seule, export possible | Après la grâce : plus de document final ; lecture, téléchargement et brouillons restent |
| Un avis par étape et par période, jamais répété | Une tâche par étape et par période (clé `period_notice:<période>:<étape>`) |
| Nouvelle licence : la séquence repart | Renouvellement : la période suivante coupe les rappels de la précédente |

Les rappels sont programmés à la création de chaque période (déclencheur sur `subscriptions`), comme
des tâches différées de la file : aucune tâche planifiée à ajouter. Ils ne portent pas de lien
(un lien d'accès expire en quelques minutes) : l'artisan répond ABONNEMENT pour en recevoir un.

Le texte de ces conditions est affiché sur la page Abonnement (`web/src/l10n`,
`app.subscription.conditions`) ; la page publique **Conditions** (P-66, spec 012) le reprendra.

## Exigences et vérifications

| ID | Exigence | Vérifié par |
|---|---|---|
| P-50 | Essai : 3 documents finaux sans carte | `021_offer_v1.sql`, `013_offers.sql` |
| P-51 | Offre v1 : 2 000 F CFA pour 15 documents (version 2) ; l'ancienne version reste | `021_offer_v1.sql` |
| P-52 | Recharges : taille et prix par version ; non proposées sans prix ; pas pendant l'essai ni la grâce ; ajoutées à la période en cours sans la réécrire | `021_offer_v1.sql`, `billing.db` (recharge) |
| P-53 | Avertissement à 80 % ; au plafond, brouillon gardé, ABONNEMENT ou RECHARGE ; période finie : message dédié | `conversation.db` (spec 010 et « abonnement terminé ») |
| P-54 | Versions : un abonnement garde la sienne ; une version reprend recharge, grâce et produits de la précédente ; périodes successives ; grâce | `021_offer_v1.sql`, `018_admin.sql` |
| P-55 | Une correction ne consomme rien, une révision émise non plus ; une conversion émise consomme 1 document | `021_offer_v1.sql` |
| P-56 | Chariow : passage en caisse côté serveur, produit de l'offre, téléphone et pays pré-remplis, avis « pulse » signés (HMAC, événement de l'en-tête = celui du corps), vente relue chez Chariow, vente et produit comparés à ceux du paiement, appliquée une fois ; rapprochement par un administrateur avec motif | `billing.db` (Chariow), `021_offer_v1.sql` |
| P-57 | File de confirmation : le message est mis en file dans la transaction du paiement ; un échec d'envoi est repris ; le paiement reste acquis | `021_offer_v1.sql`, `billing.db`, `conversation.db` |
| — | Conditions de fin : rappels avant la fin, à la fin, à la fin de la grâce, une fois chacun, coupés par un renouvellement | `021_offer_v1.sql`, `conversation.db` |

## Non vérifié

- Chariow réel : la clé d'API et le secret « pulse » de Firmo ne sont pas encore dans Doppler ;
  le fournisseur est désactivé en base. Le format des avis suit la v1 (rapprochée avec un vrai
  paiement en 2026-08), pas un nouvel essai.
- Le prix d'une recharge : décision du porteur, à saisir dans la console.
- Un rappel programmé garde le délai en vigueur à la création de sa période : changer
  `subscription_warn_days` vaut pour les périodes suivantes.
