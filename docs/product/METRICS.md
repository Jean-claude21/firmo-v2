# Métriques — Firmo

Événements émis **côté serveur** dans `analytics_events` (et relayés à PostHog si configuré).
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
| `payment_recorded` | paiement noté par l'artisan | `partial` |
| `portal_opened` | lien signé utilisé | `purpose` |
| `quota_warning` | 80 % du quota | `plan_code` |
| `subscription_paid` | paiement de l'abonnement confirmé | `plan_code`, `provider` |

## KPIs (console d'administration)

- **Indicateur décisif** : part des organisations qui ont un `document_shared` dans les 7 jours qui
  suivent `org_created`.
- Fidélité de lecture : 1 − (`reading_corrected` / valeurs lues).
- Conversion devis → facture, taux d'acceptation des devis.
- Coût IA par document émis. Revenus d'abonnement par devise.
