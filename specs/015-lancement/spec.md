# Spec 015 — Lancement en Afrique

- Branche : `feat/015-lancement` (depuis `feat/012-web-v1`, PR #14)
- Source : décisions du porteur du 2026-11-27 (Afrique seulement, Chariow, aucun paiement client,
  Kete éditeur, Umami et Sentry).
- Statut : terminée

| ID | Exigence | Vérifié par |
|---|---|---|
| L-01 | Seuls les pays africains sont proposés ; la France et la Belgique restent en base, inactives | pgTAP 001, 024 |
| L-02 | Un artisan non assujetti voit « Non assujetti à la TVA » sur ses documents (formule du pays, modifiable), jamais quand le document porte une taxe | pgTAP 024, `render` |
| L-03 | Firmo ne note aucun paiement client et n'émet aucun reçu (décision 0008) : fonctions SQL refusées, routes retirées, réponse claire dans le chat, rien dans l'espace ni sur Formats | pgTAP 012, 024, `documents.db`, `portal.db`, `conversation.db`, `flow.mjs`, `ui-artisan.mjs` |
| L-04 | Chariow : adresse du Pulse, étapes, état de la configuration, produits par offre et derniers avis dans la console ; plusieurs secrets Pulse acceptés ; activation automatique après vente | `billing.db`, `ui-admin.mjs` |
| L-05 | Avis envoyés par Firmo (abonnement, équipe) hors de la fenêtre de 24 h de WhatsApp : modèle approuvé `firmo_avis`, dans la langue de l'artisan | `whatsapp`, `conversation.db` |
| L-06 | Changement de numéro : un administrateur rattache le nouveau numéro à l'organisation d'origine, avec motif ; refusé si le nouveau numéro a des documents | pgTAP 024, `data.db` |
| L-07 | Mesure : événements serveur relayés à l'Umami de Kete ; pages publiques mesurées sans cookie ; espace et console jamais mesurés | `data.db`, `ui-public.mjs` |
| L-08 | Pages légales de Kete : mentions légales, cookies, traitement des données (sous-traitants nommés), éditeur et contact par défaut | `ui-public.mjs` |
| L-09 | Landing : « Toucher à l'argent de tes clients » dans ce que Firmo ne fera jamais | `ui-landing.mjs` |

## Vérifié le 2026-11-27

- pgTAP 298/298 sur une branche Neon jetable issue de `staging` (supprimée ensuite) ; CI verte sur
  #13, #14 et #15, fusionnées dans `dev`.
- Staging migré (0015 → 0020) et déployé : `/health` sain ; Pulse signé avec chacun des deux secrets
  accepté (200), signature invalide refusée (401) ; mesure Umami présente dans le site construit
  (variables passées au build du `Dockerfile`) ; pages légales servies.

## Non vérifié

- Vente Chariow réelle : le produit de l'abonnement n'existe pas encore dans la boutique de la clé
  posée ; à créer, puis à coller dans Console › Configuration › Offres (champ « Produit Chariow »),
  et Chariow à activer dans Console › Paiements.
- Modèle `firmo_avis` : à faire approuver chez Meta ; tant qu'il ne l'est pas, un avis hors fenêtre échoue chez WhatsApp et la tâche est journalisée.
- Canaux WhatsApp et Telegram : aucune variable `WHATSAPP_*` ni `TELEGRAM_*` sur l'application de staging.
- Production : aucune application Firmo de production sur Coolify (`firmo.kete.digital` ne répond pas).
