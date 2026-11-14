// Politique Neon de Firmo (Config-as-Code), appliquée par `neon deploy --branch <branche>`.
// Aucune valeur secrète. L'API et le web tournent sur Coolify (décision 0005) : Neon fournit
// Postgres, Neon Auth (comptes de l'équipe) et le stockage objet.
import { defineConfig } from "@neon/config/v1";

/** Fichiers privés : médias reçus (inbox/), logos (brand/), documents émis (documents/). */
export const FILES_BUCKET = "firmo-files";

export default defineConfig({
  auth: true,
  // Pas de Data API : le web passe uniquement par l'API (décision 0002).
  buckets: {
    [FILES_BUCKET]: { access: "private" },
  },
  // `main` (production) et `staging` sont durables ; toute autre branche (tests) expire.
  branch: (branch) => ({
    protected: branch.name === "main",
    ...(branch.isDefault || branch.name === "staging" ? {} : { ttl: "2d" }),
  }),
});
