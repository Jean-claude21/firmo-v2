# Roadmap — Firmo

> État réel du projet. Chaque spec terminée est cochée et datée.
> Hypothèses produit : considérées validées par le porteur le 2026-11-14 (voir `HYPOTHESES.md`).

| Spec | Contenu | Fonctionnalités | État |
|---|---|---|---|
| 001-socle | Dépôt, outillage base (migrations, pgTAP), référentiels, organisations, identités, équipe, audit, file de tâches, liens, API Hono + worker, CI, Neon staging | CH-2, CH-5, ADM-1, ADM-5 (données) | ✅ 2026-11-14 |
| 002-documents | Modèle documentaire en SQL : lignes, totaux, taxes, numérotation, transitions, paiements notés, reçus, essai et quotas | DOC-3, DOC-4, DOC-6, DOC-7, OFF-1 (essai), OFF-2 | ✅ 2026-11-14 |
| 003-rendu | Typst : trois modèles, PDF, SVG, PNG, QR, montant en lettres, cas difficiles, rendu à l'émission | DOC-5, DOC-8 | ✅ 2026-11-14 |
| 004-conversation | Canaux (simulateur, Telegram, WhatsApp), IA (transcription, lecture, intentions), garde anti-invention, moteur de conversation, voix | CH-1, CH-3, CH-4, CH-5, DOC-1, DOC-2 | ✅ 2026-11-14 |
| 005-espace-artisan | Web : site, lien signé, tableau de bord, documents, clients, profil, formulaires, page publique | ART-1 à ART-5, ART-7, CH-4 | ✅ 2026-11-14 |
| 006-offre | Essai, abonnement, quota, paiement (simulateur, Moneroo) | OFF-1, OFF-3, ART-6 | ✅ 2026-11-14 |
| 007-administration | Console : tableau de bord, organisations, conversations, configuration, simulateur, coûts | ADM-1 à ADM-7 | ✅ 2026-11-14 |
| 008-mise-en-ligne | Staging Neon + Coolify (https://firmo-staging.kete.digital), image unique, Doppler, documentation d'exploitation | IX | ✅ staging 2026-11-14 · production à ouvrir |

## Ce que le porteur doit fournir (hors code)

- Entreprise au Togo (RCCM, NIF) → vérification Meta → nom « Firmo » et WhatsApp Flows.
- Numéro de téléphone dédié à Firmo.
- Bot Telegram (BotFather) pour les essais réels immédiats.
- Compte Moneroo de l'entreprise pour l'abonnement.
