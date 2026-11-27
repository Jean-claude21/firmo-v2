# Stratégie de Firmo — fiche du Kete Product Framework

- Version : 2026-11-27 (décision du porteur : framework appliqué, sections manquantes de la landing ajoutées)
- Statuts : **fait** (vérifié dans le produit ou sourcé), **hypothèse** (à valider en entretien),
  **inconnu** (à mesurer). Aucun chiffre de cette page n'est inventé ; un chiffre sans source n'y entre pas.

## 1. Fiche stratégique

| Dimension | Réponse | Statut | Prochaine action |
|---|---|---|---|
| Pourquoi | Un artisan qui sait faire son travail mérite des documents qui le présentent aussi bien que son travail. | Conviction | — |
| Cible | Artisan ou petit prestataire africain qui chiffre des travaux ou des ventes (menuisier, électricien, plombier, soudeur, couturier, imprimeur…), à son compte, avec un smartphone et WhatsApp. | Hypothèse | Choisir 1 ou 2 métiers pilotes |
| Problème | Il sait faire son calcul, pas le transformer vite en document propre : il écrit à la main ou attend quelqu'un qui « tape » le devis. | Hypothèse (reprise de la v1) | Entretiens |
| Frustration | Le devis part tard, fait amateur face à un concurrent ; il perd sans savoir pourquoi. | Hypothèse | Entretiens |
| Coût du problème | Devis par mois, temps de rédaction, coût de la mise au propre, marchés perdus. | **Inconnu** | Questions « la dernière fois… » |
| Aspiration | Être vu comme une entreprise sérieuse, viser de plus gros clients, avoir des papiers à montrer. | Hypothèse | Entretiens |
| Marché | 83 % des travailleurs africains sont dans l'emploi informel en 2024 (CEA), 86,3 % en Afrique subsaharienne (OIT) ; Côte d'Ivoire : ~5 millions de personnes dans l'artisanat selon le ministre. | Fait (ordre de grandeur) | Chiffres par pays pilote |
| Concurrence | Papier et carnet à souches, Word chez un tiers, modèles Excel, applications de facturation à installer. | Hypothèse | Observer 5 artisans faire un devis |
| Valeur | Un devis propre en quelques minutes depuis WhatsApp, sans apprendre un logiciel ; ses prix restent les siens. | Fait (produit) | Mesurer le délai réel |
| Différenciation | Vocal ou photo de la feuille ; ne touche jamais au prix ; aucun paiement client ; rien à installer ; ses couleurs, sans marque Firmo. | Fait (produit) | — |
| Perception | Sérieux, respectueux, « met au propre » sans faire la leçon. | Choix | — |
| Preuves | Aucune : pas encore d'utilisateur ni de témoignage. | **Manquant** | 5 artisans pilotes, accord écrit pour témoigner |
| Conversion | Écrire « Bonjour Firmo » sur WhatsApp et faire son premier devis, gratuit. | Fait (bouton prêt ; numéro à poser) | Poser `VITE_WHATSAPP_NUMBER` |

## 2. Quatre niveaux de discours

1. Fonctionnalités : devis, proformas, factures en PDF depuis WhatsApp, par vocal, photo ou texte.
2. Bénéfices : ton devis part le jour même, propre, sans attendre personne.
3. Transformation : du carnet griffonné au document d'entreprise.
4. Ambition et identité : « Ton devis te présente avant toi. » Signature : *Firmo — je raffermis*.

## 3. Landing : les 12 étapes

| # | Étape | Sur la landing |
|---|---|---|
| 01 | Accroche | « Tu parles. Firmo rédige. » + bouton WhatsApp |
| 02 | Problème | « Ce qui se passe vraiment », juste après l'accroche |
| 03 | Enjeux | Phrase d'enjeu sans chiffre (aucun coût mesuré) |
| 04 | Transformation | « Ton devis te présente avant toi. » puis feuille → document |
| 05 | Solution | « Ça vit dans ta messagerie » (trois gestes) |
| 06 | Fonctionnalités | Couleurs, espace web |
| 07 | Différenciation | « Ce qu'on ne fera jamais » |
| 08 | Démonstration | Conversation animée, rendus réels |
| 09 | Preuves | Faits sourcés sur la façon de travailler (pas encore de témoignage) |
| 10 | Tarifs | Essai puis abonnement, sans reconduction |
| 11 | Objections | Questions fréquentes, réponses limitées à ce que Firmo fait |
| 12 | Conversion | « Dis ta première vente » + bouton WhatsApp |

## 4. Product Readiness Score : 41 / 100

| Critère | Note | Preuve / prochaine action |
|---|---|---|
| Problème réel et documenté | 5 | Hypothèses v1 ; entretiens |
| Cible clairement identifiée | 4 | Métiers pilotes à choisir |
| Clients ayant confirmé le besoin | 1 | 10 à 15 entretiens |
| Coût du problème quantifié | 1 | Questions sur le dernier devis |
| Proposition de valeur claire | 7 | — |
| Disposition à payer validée | 2 | Ce qu'ils paient aujourd'hui pour la mise au propre |
| Concurrence comprise | 4 | Observation |
| Différenciation crédible | 8 | — |
| Discours orienté bénéfices | 7 | Niveaux 3 et 4 ajoutés en 016 |
| Preuves commerciales | 2 | Artisans pilotes |

Moins de 50 : validation nécessaire. Le produit est prêt ; la preuve marché manque.

## 5. Guide d'entretien (Mom Test)

Questions sur le passé, jamais « est-ce que tu utiliserais… » :

1. Raconte-moi le dernier devis que tu as fait : quand, pour qui, comment ?
2. Combien de temps ça t'a pris ? Qui l'a mis au propre ? Ça t'a coûté combien ?
3. Le client l'a reçu quand ? Tu as eu le marché ? Sinon, tu sais pourquoi ?
4. Combien de devis par mois ? Combien de factures ?
5. Qu'as-tu déjà essayé (application, cahier, quelqu'un) ? Pourquoi as-tu arrêté ?

Objectif : 10 à 15 entretiens, puis 5 artisans pilotes pendant un mois. Mesures : documents émis,
délai entre la demande du client et l'envoi, renouvellement à 2 000 F CFA. Les réponses remplacent
les hypothèses de la section « Ce qui se passe vraiment ».

## 6. Test « est-ce que je l'achète ? »

- Artisan à 4 devis par mois qui paie quelqu'un pour les taper : oui, à 2 000 F CFA par mois, si le
  premier vocal donne un devis juste en moins de deux minutes.
- Artisan à un devis tous les deux mois : non, l'abonnement ne vaut pas le coup ; une recharge à
  l'unité le pourrait. D'où la décision attendue sur le prix de la recharge.

## Sources

- CEA (ONU), emploi informel en Afrique 2024 : https://papersmart.uneca.org/download/5389
- OIT via Brookings, Afrique subsaharienne 86,3 % (2024) : https://www.brookings.edu/articles/rethinking-informality-in-africa/
- Statista, plateformes au Nigeria (3e trimestre 2024, WhatsApp > 95 % des internautes de 16 ans et plus) : https://www.statista.com/statistics/1176101/leading-social-media-platforms-nigeria/
- IGC, tenue des comptes des petits commerces à Nairobi : https://www.theigc.org/publications/data-without-insight-why-small-businesses-under-invest-record-keeping-evidence-kenya
- Côte d'Ivoire, artisanat (déclaration ministérielle) : https://news.abidjan.net/articles/647523/l8217-artisanat-ivoirien-emploie-5-millions-de-personnes-reparties-sur-8-branches-ministre
- Sénégal, absence d'étude fiable : https://africacheck.org/fr/fact-checks/articles/senegal-7-et-7-millions-et-demi-de-personnes-dans-lartisanat-mame-boye-diao-presidentielle-2024
