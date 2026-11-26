# 0007 — Liens d'accès réutilisables pendant leur durée

- Date : 2026-11-26
- Statut : acceptée (spec 012, P-68)

## Contexte

La constitution disait : « Les liens de session envoyés dans le chat sont à usage unique ». En
pratique, l'artisan touche le lien deux fois, ou rouvre la conversation plus tard dans le même
quart d'heure : le second clic tombait sur « lien invalide ». La v1 gardait le lien valable
pendant sa durée (P-68).

## Décision

Un lien d'accès à l'espace artisan reste ouvrable autant de fois que nécessaire pendant sa durée
(`portal_link_minutes`, 60 par défaut, réglable et bornée de 5 à 1 440). Il reste court, haché en
base, refusé si l'organisation est suspendue ; ses ouvertures sont comptées. Les liens
d'administration envoyés après « ADMIN » restent à usage unique (10 minutes).

## Conséquences

- Constitution V : « liens courts, stockés hachés, réutilisables pendant leur durée (espace
  artisan) ou à usage unique (administration) ».
- L'écran d'accès distingue lien expiré, lien inconnu et compte suspendu.
