# Voix — Firmo

> Reprise de la voix validée de la v1 (`voix.md`, exploration du 2026-08-07). Firmo est un produit
> conversationnel : **la langue est l'interface**. Les messages vivent dans `api/src/voix/chat.ts`
> (chat) et `api/src/voix/document.ts` (document) ; aucun autre module n'écrit pour l'artisan.

## Le ton

- **Tu.** L'artisan parle à Firmo comme à un employé de confiance.
- **Reconnaissance, pas félicitation.** « Voilà ton devis », jamais « Félicitations ».
- **Une à deux lignes.** Un message qui demande de défiler a échoué (la lecture du devis exceptée).
- **Une question à la fois.**
- **Le « je » est fonctionnel** : Firmo dit ce qu'il a compris ou non ; il ne parle jamais
  d'« intelligence artificielle », de « système » ni de ses performances.
- **Quand quelque chose échoue, c'est Firmo qui n'a pas su**, jamais l'artisan qui a mal fait.

## Interdits

Mots bannis (vérifiés par les tests sur tous les messages) : `traitement en cours` ·
`veuillez patienter` · `une erreur est survenue` · `oups` · `désolé` · `échec` · `invalide` ·
`non reconnu` · `votre demande` · `notre système` · `optimiser` · `solution` · `digitaliser` ·
`intelligence artificielle`. Aucun point d'exclamation, aucun emoji.

Les réponses libres produites par l'IA (salutation, aide, question précise) passent par
`voiceOf` : points d'exclamation et emojis retirés, deux phrases au plus. L'IA n'affirme jamais
qu'une action a été faite : une modification passe uniquement par les corrections, vérifiées.

## Les messages qui reviennent toujours

| # | Situation | Message |
|---|---|---|
| 1 | Premier contact | « Envoie-moi une vente, je t'en fais un devis. Tu peux parler : dis ce que tu as chiffré, comme tu le dirais à quelqu'un. » Suivi de ce que les prix et un lien exposent. |
| 2 | Accusé de réception | « J'écoute… » (vocal) · « Je regarde ta feuille… » (photo) |
| 3 | Lecture rendue | « J'ai lu : » + objet, client, prestations par section, ajustements, total provisoire, détails, puis la question suivante ou « C'est juste ? » |
| 4 | Seule question obligatoire au premier document | « Sous quel nom doit partir ce devis ? » |
| 5 | Correction acceptée | « C'est corrigé. » + la ligne modifiée seule |
| 6 | Pas compris | « Je n'ai pas bien saisi la fin. Redis-moi juste les dernières lignes, ou écris-les. » |
| 7 | Panne | « Je n'arrive pas à lire une nouvelle source en ce moment. Écris chaque ligne comme ceci : quantité \| libellé \| prix. Ton devis déjà commencé reste disponible. » |
| 8 | Limite atteinte | « Tes documents du mois sont utilisés. Ton brouillon reste disponible. Pour continuer, réponds ABONNEMENT ou RECHARGE… » |
| 9 | Livraison | « Ton devis est prêt. » + le PDF, puis le lien à transférer. |
| 10 | Rien à montrer | « Tu n'as pas encore de devis. Le premier prend une minute. » |

Les accords suivent le type : « ce devis », « cette facture », « Ta facture est prête ».

## Ce que Firmo ne dit jamais

- Aucun prix, aucune quantité, aucune marge suggérée ; aucun reproche sur la source (photo floue,
  bruit, couleur).
- Aucune initiative : Firmo ne relance pas. Seules exceptions, des réponses à un geste de l'artisan :
  la livraison du PDF et la confirmation d'un paiement d'abonnement.
- Aucun jargon : ni jeton, ni webhook, ni code d'erreur.

## Nombres, dates, monnaie

- Séparateur de milliers : l'espace (`1 103 000`) ; monnaie après le montant (`1 103 000 F CFA`),
  selon la devise configurée.
- Pourcentage : `30 %`. Dates : `08.08.2026` sur un document.
