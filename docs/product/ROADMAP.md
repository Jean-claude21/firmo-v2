# Roadmap — Firmo

> État réel du projet. Chaque spec terminée est cochée et datée.
> Hypothèses produit : considérées validées par le porteur le 2026-11-14 (voir `HYPOTHESES.md`).

| Spec | Contenu | Fonctionnalités | État |
|---|---|---|---|
| 001-socle | Dépôt, outillage base (migrations, pgTAP), référentiels, organisations, identités, audit, API Hono, web, CI | CH-2, CH-5, ADM-1, ADM-5 (données) | ⏳ |
| 002-documents | Modèle documentaire en SQL : lignes, totaux, taxes, numérotation, transitions, paiements notés, quotas | DOC-3, DOC-4, DOC-6, DOC-7, OFF-2 | ⏳ |
| 003-rendu | Typst : trois modèles, PDF, SVG, PNG, QR, montant en lettres, cas difficiles | DOC-5, DOC-8 | ⏳ |
| 004-conversation | Canaux (simulateur, Telegram, WhatsApp), IA (transcription, lecture, intentions), moteur de conversation, voix | CH-1, CH-3, CH-4, DOC-1, DOC-2 | ⏳ |
| 005-espace-artisan | Web : site, lien signé, tableau de bord, documents, clients, profil, formulaires, page publique | ART-1 à ART-5, ART-7, CH-4 | ⏳ |
| 006-offre | Essai, abonnement, quota, paiement (simulateur, Moneroo) | OFF-1, OFF-3, ART-6 | ⏳ |
| 007-administration | Console : tableau de bord, organisations, conversations, configuration, simulateur, coûts | ADM-1 à ADM-7 | ⏳ |
| 008-mise-en-ligne | Staging Neon + Netlify, bout en bout, suivi d'erreurs, analytics, documentation d'exploitation | IX | ⏳ |

## Ce que le porteur doit fournir (hors code)

- Entreprise au Togo (RCCM, NIF) → vérification Meta → nom « Firmo » et WhatsApp Flows.
- Numéro de téléphone dédié à Firmo.
- Bot Telegram (BotFather) pour les essais réels immédiats.
- Compte Moneroo de l'entreprise pour l'abonnement.
