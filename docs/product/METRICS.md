# Métriques — Firmo

Événements émis **côté serveur** dans `analytics_events` (et relayés à l'Umami de Kete si configuré).
Aucune donnée personnelle dans les propriétés : identifiants techniques et valeurs agrégées seulement.

| Événement | Quand | Propriétés |
|---|---|---|
| `org_created` | premier message d'une identité inconnue | `channel`, `country_code` |
| `submission_received` | message reçu | `channel`, `kind` (text, audio, image) |
| `reading_done` | lecture IA terminée | `kind`, `lines`, `to_confirm`, `duration_ms`, `cost_micro_usd` |
| `reading_corrected` | correction de l'artisan sur une valeur lue | `field` (label, quantity, unit_price) |
| `document_issued` | émission | `doc_type`, `template`, `lines`, `currency_code` |
| `document_shared` | PDF ou lien envoyé au client (par le chat ou le web) | `doc_type`, `via` |
| `document_viewed` | page publique ouverte | `doc_type` |
| `quote_accepted` / `quote_refused` | réponse du client | — |
| `quote_converted` | devis → facture | — |
| `portal_opened` | lien signé utilisé | `purpose` |
| `quota_warning` | 80 % du quota | `plan_code` |
| `subscription_paid` | paiement de l'abonnement confirmé | `plan_code`, `plan_version`, `provider` |
| `top_up_paid` | recharge confirmée | `units`, `provider` |
| `subscription_notice` | rappel de fin de période envoyé dans le chat | `stage` (ending, ended, closed) |
| `data_deletion_requested` / `data_export_requested` | demande sur les données | `origin` (chat, web) |
| `data_deleted` | suppression exécutée par l'équipe | `kept_documents` |

Relais Umami (P-80) : `app.analytics_batch` ne transmet que des propriétés techniques connues
(liste blanche en SQL), comme événements nommés du site « Firmo » ; jamais un nom ni un numéro.
Firmo ne suit pas les paiements des clients de l'artisan (décision 0008) : aucun événement de paiement client.

## KPIs (console d'administration)

- **Indicateur décisif** : part des organisations qui ont un `document_shared` dans les 7 jours qui
  suivent `org_created`.
- Fidélité de lecture : 1 − (`reading_corrected` / valeurs lues).
- Conversion devis → facture, taux d'acceptation des devis.
- Coût IA par document émis. Revenus d'abonnement par devise.
