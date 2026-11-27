import { z } from "zod";

// Variables d'environnement de l'API. Secrets : Doppler → Coolify (jamais dans le dépôt).
// Un service facultatif absent est remplacé par son simulateur et signalé (constitution IV).
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Nom de l'environnement affiché et utilisé pour interdire les simulateurs en production.
  FIRMO_ENV: z.enum(["local", "staging", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(8790),
  DATABASE_URL: z.string().min(1),
  FIRMO_SESSION_SECRET: z.string().min(32, "FIRMO_SESSION_SECRET : 32 caractères minimum"),
  // Dérive les liens de partage des documents (QR code) ; le changer révoque tous les liens.
  FIRMO_SHARE_SECRET: z.string().min(32, "FIRMO_SHARE_SECRET : 32 caractères minimum"),
  // Origines du web autorisées (CORS), séparées par des virgules.
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  // Adresse publique du web (liens envoyés dans le chat) et de l'API (webhooks, fichiers).
  WEB_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:8790"),
  WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),

  // Neon Auth (admins). Vide : connexion admin indisponible.
  NEON_AUTH_URL: z.string().default(""),

  // Stockage S3 (Neon Object Storage). Vide : disque local (STORAGE_DIR).
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  STORAGE_DIR: z.string().default(".local/storage"),

  // IA. Vide : lecture indisponible, signalée à l'artisan.
  OPENAI_API_KEY: z.string().default(""),

  // Canaux.
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_APP_SECRET: z.string().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  // Identifiant du Flow « profil » publié chez Meta (compte vérifié) ; vide : lien web.
  WHATSAPP_FLOW_PROFILE_ID: z.string().default(""),
  /** Modèle Meta approuvé pour les avis hors fenêtre de 24 h (docs/OPERATIONS.md). */
  WHATSAPP_NOTICE_TEMPLATE: z.string().default("firmo_avis"),

  // Paiement de l'abonnement.
  PAYMENTS_SIMULATOR_SECRET: z.string().default(""),
  MONEROO_SECRET_KEY: z.string().default(""),
  MONEROO_WEBHOOK_SECRET: z.string().default(""),
  // Chariow (fournisseur de la v1) : clé d'API et secret des avis « pulse ».
  CHARIOW_API_KEY: z.string().default(""),
  CHARIOW_PULSE_SECRET: z.string().default(""),

  // Observabilité.
  ERROR_REPORTING_DSN: z.string().default(""),
  // Mesure (Umami de Kete) : relais des événements du serveur, sans donnée personnelle.
  UMAMI_URL: z.string().default(""),
  UMAMI_WEBSITE_ID: z.string().default(""),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join("\n");
    throw new Error(`configuration invalide\n${issues}`);
  }
  return parsed.data;
}

export function splitList(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
