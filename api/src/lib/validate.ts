import type { Context } from "hono";
import type { z } from "zod";
import { httpErrors } from "./errors.js";

/** Corps JSON validé par un schéma zod ; erreurs par champ en 422. */
export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw httpErrors.badRequest("corps JSON attendu");
  }
  return parseWith(schema, raw);
}

export function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw httpErrors.validation(fields);
  }
  return parsed.data;
}

/** Paramètre de requête validé. */
export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parseWith(schema, c.req.query());
}
