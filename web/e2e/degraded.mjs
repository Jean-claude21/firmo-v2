// IA en panne (clé sans crédit, quota, réseau) : Firmo passe en lecture simplifiée sans répéter
// ses messages ni laisser l'artisan sans réponse (P-39).
import { check, conversation, staffLogin, summary } from "./lib.mjs";

const staff = await staffLogin();
const c = conversation(staff.token);
let out = await c.send("Devis pour la Clinique Saint-Luc : 3 climatiseurs split à 285000", { timeout: 120_000 });
const texts = out.map((m) => m.text ?? "");
console.log(texts.join("\n---\n"));
check(texts.filter((t) => t.startsWith("Envoie-moi une vente")).length === 1, "accueil dit une seule fois");
check(!texts.some((t) => /Je n'ai pas su traiter/.test(t)), "pas d'abandon : le message est traité");
out = await c.send("3 | climatiseur split | 285000", { timeout: 120_000 });
const after = out.map((m) => m.text ?? "");
console.log(after.join("\n---\n"));
check(after.some((t) => /climatiseur/i.test(t) && /855 000|285 000/.test(t)), "format de secours lu : la ligne apparaît avec son prix");
process.exit(summary() ? 1 : 0);
