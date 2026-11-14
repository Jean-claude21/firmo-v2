# Design — Firmo

## Intention

Le sérieux d'un document bien tenu, la chaleur d'un atelier. Un artisan doit s'y sentir chez lui ;
son client doit y voir une entreprise fiable. Peu d'éléments, beaucoup de lisibilité.

## Jetons (`web/src/styles/app.css`)

| Rôle | Valeur | Usage |
|---|---|---|
| `ink` | `#14213D` | texte fort, en-têtes, boutons principaux |
| `amber` | `#E9A23B` (texte : `#9A5B0B`) | appel à l'action, accents, focus |
| `paper` | `#FAF8F4` | fond des pages |
| `surface` | `#FFFFFF` | cartes |
| `line` | `#E7E3DB` | séparateurs, bordures |
| `muted` | `#5F5E5A` | texte secondaire (AA sur `paper`) |
| `ok` / `warn` / `danger` | `#067647` / `#B54708` / `#B42318` | statuts |

- Polices : Inter (interface), Source Serif 4 (titres du site, comme le modèle Classique).
- Rayons : 10 px (champs, boutons), 16 px (cartes). Ombres très légères.
- Mobile d'abord : navigation basse sur téléphone, latérale à partir de 1024 px.
- Cibles tactiles ≥ 44 px, focus visible (anneau ambre), contraste AA.
- Chaque écran a ses états : chargement (squelettes), vide (phrase + action), erreur (message +
  réessayer), hors ligne (bandeau).

## Composants

`Button` (primary ink, accent amber, ghost), `Card`, `Field` (libellé au-dessus, aide, erreur),
`Badge` de statut (brouillon gris, émis bleu, accepté vert, refusé rouge, acompte ambre, payé
vert plein), `Money` (montant formaté selon la devise de l'API), `Empty`, `Skeleton`, `Sheet`
(panneau du bas sur mobile).

## Statuts des documents

| Statut | Libellé | Couleur |
|---|---|---|
| draft | Brouillon | gris |
| issued | Émis | bleu |
| accepted | Accepté | vert |
| refused | Refusé | rouge |
| partially_paid | Acompte | ambre |
| paid | Payé | vert plein |
| cancelled | Annulé | gris barré |
