# Spec 004 — Conversation

- Branche : `feat/004-conversation`
- Fonctionnalités : CH-1, CH-3, CH-4, CH-5, DOC-1, DOC-2
- Statut : terminée

## Objectif

L'artisan fait tout depuis sa messagerie : il envoie sa vente (texte, vocal, photo), voit ce que
Firmo a lu, corrige en un mot ou en langage libre, valide, reçoit l'aperçu, le PDF et le lien
pour son client ; il transforme un devis en facture, note les paiements et émet les reçus.

## Architecture

- Canaux derrière `Channel` : simulateur (toujours), Telegram (jeton), WhatsApp Cloud API
  (jeton + numéro). Webhooks vérifiés (secret Telegram, HMAC Meta), journalisés bruts,
  idempotents (`app.receive_message`), traités par la file (`process_message`).
- IA derrière `AiReader` : OpenAI (modèles en base, `ai_tasks`) ou lecture simplifiée sans
  clé (signalée). L'IA recopie les nombres en texte ; la **garde anti-invention** refuse toute
  valeur absente de la source ; une photo donne des valeurs « à vérifier ».
- Commandes sans IA (fr, en) ; l'IA n'interprète que le reste.
- Formulaires depuis le chat : lien signé vers le web ; WhatsApp Flows si le drapeau
  `whatsapp_flows` est actif et qu'un Flow est configuré.
- Remise du document quand le rendu est prêt (`document_deliveries`).

## Vérification

- vitest : commandes, garde (dont valeurs réelles renvoyées par l'IA), lecture simplifiée,
  conversation complète sur Postgres (prix inventé refusé, nom demandé, émission, PDF,
  facture, paiement, reçu, événements), idempotence.
- Essai réel avec OpenAI via le simulateur : lecture juste de « 450 mille », « 35000 chacune »,
  « quinze mille » ; correction libre ; émission et PDF reçus.
- pgTAP 015 : messages idempotents, état de conversation.

## Non vérifié

- Telegram et WhatsApp réels : jeton du bot et compte Meta à fournir par le porteur.
