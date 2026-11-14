# Spec 010 — Conversation au niveau de la v1

- Branche : `feat/010-conversation-v1`
- Source : `docs/product/PARITE_V1.md` §3 (P-30 à P-43) ; v1 : `voix.md`, `model.md`,
  `backend/app/features/conversation` (contrats, consignes, intentions), `backend/app/voix/messages.py`.
- Statut : terminée

## Pourquoi

La v2 lisait une liste de lignes et comprenait quelques corrections. La v1 conduisait une vraie
conversation : une décision par message avec le contexte des 12 derniers échanges et le brouillon
structuré, vingt intentions, des corrections sur tout le document, une question à la fois, un aperçu
gratuit avant l'émission, une voix précise. Cette spec ramène ce comportement.

## Exigences et vérifications

| ID | Exigence | Vérifié par |
|---|---|---|
| P-30 | Vocal, photo (transcrite mot pour mot puis lue), texte ; lecture toujours montrée avant le PDF | `conversation.db` (parcours v1), évaluation réelle |
| P-31 | Corrections sur lignes, sections, ajustements, champs, paiements ; nombre ET texte prouvés par le message | `conversation.db` (« mets 99 000 » refusé), `conversation-units` |
| P-32, P-33 | Une question à la fois (prestation, client, valeurs, ajustements, objet) ; nom de l'entreprise au premier document | `conversation.db` |
| P-34 | 21 intentions (les 20 de la v1 + suppression des données) | `conversation.db` (intentions), `conversation-units` (commandes) |
| P-35 | 12 derniers échanges + brouillon structuré transmis à l'IA | `conversation.db` (contexte) |
| P-36 | Un brouillon actif ; « NOUVEAU » repart de zéro | `conversation.db` |
| P-37 | Aperçu filigrané gratuit, puis émission sur confirmation explicite (1 document) | `conversation.db`, évaluation (« on continue » n'émet pas) |
| P-38 | Messages de la voix v1, accords (« cette facture »), mots bannis, ni exclamation ni emoji, réponses de l'IA ramenées à la voix | `conversation-units` (tous les messages, fr et en) |
| P-39 | Mode dégradé : format « quantité \| libellé \| prix », vocal et photo signalés | `conversation.db` (mode dégradé) |
| P-40 | Webhooks idempotents (inchangé) | `conversation.db` |
| P-41 | Évaluation des dialogues avec la vraie IA : artisan, BTP, facture + dernier PDF, > 12 échanges | `api/scripts/eval-dialogues.ts` : 4/4, deux passages consécutifs |
| P-42 | « Je demande la suppression de mes données » enregistré, journalisé, une seule demande en attente | `020_conversation_v1.sql`, `conversation.db` |
| P-43 | Mémoire des postes (spec 009) | `019_document_v1.sql` |

## Ce que l'évaluation réelle a fait corriger

Le premier passage de l'évaluation avec l'IA réelle n'a réussi qu'un scénario sur quatre. Défauts
trouvés et corrigés : quantité recopiée dans le libellé ; destinataire pris pour le chantier ;
questions prises pour des ordres (« tu fais aussi les factures ? » convertissait le document) ;
client inventé (« j'attends le client » → « principal ») ; garantie annoncée sans être enregistrée ;
« on continue » émettait le PDF final. Les corrections tiennent dans le code, pas seulement dans
les consignes : texte d'une correction exigé dans le message, main-d'œuvre jamais en ligne,
confirmation explicite avant toute émission.

## Choix d'implémentation

- `ai/types.ts` : lecture structurée (sections, ajustements, champs) et décision par tour.
- `ai/openai.ts` : consignes de la v1, une décision structurée par message, photo transcrite puis lue.
- `ai/guard.ts` : chaque nombre et chaque texte vérifiés contre la source ou le message.
- `conversation/engine.ts` : états `missing`, `pdf_offer`, `issue_confirm`, `business_name`.
- `ai/rules.ts` : mode dégradé sans IA.
- Migration `0014_conversation_v1.sql` : `data_requests`, `app.request_data`, `app.org_chat_stats`.

## Hors de cette spec

Lien d'administration par « ADMIN » (spec 013 : la réponse est « Cette identité n'ouvre pas
l'administration » tant que l'identité n'est pas reliée à l'équipe). Traitement des demandes de
suppression et export (spec 014).
