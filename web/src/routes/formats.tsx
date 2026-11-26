import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PublicFooter, PublicHeader } from "@/components/public-layout";
import { chatChannel, chatLink } from "@/lib/chat";
import { useI18n } from "@/l10n";

// Formats (P-67) : aperçus publics réels, composés par le moteur des documents. Chaque option
// retirée referme sa place : on voit ce que Firmo produit vraiment, du plus simple au plus complet.
export const Route = createFileRoute("/formats")({ component: Formats });

type Scenario = "express" | "detaille" | "professionnel" | "facture";
const OPTIONS = ["client", "site", "delivery", "groups", "subtotals", "labor", "transport", "discount", "tax", "deposit", "validity", "warranty", "conditions"] as const;
type Option = (typeof OPTIONS)[number];
const AVAILABLE: Record<Scenario, Option[]> = {
  express: ["client"],
  detaille: ["client", "site", "delivery"],
  professionnel: ["client", "site", "delivery", "groups", "subtotals", "labor", "transport", "discount", "tax", "deposit", "validity", "warranty", "conditions"],
  facture: [...OPTIONS],
};

function Formats() {
  const { t, locale } = useI18n();
  const F = t.legal.formats;
  const [scenario, setScenario] = useState<Scenario>("professionnel");
  const [options, setOptions] = useState<Set<Option>>(() => new Set(OPTIONS));
  const [img, setImg] = useState<{ url: string; key: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const chat = chatLink(chatChannel(), t.landing.firstMessage);
  const available = AVAILABLE[scenario];
  const query = useMemo(() => {
    const on = OPTIONS.filter((o) => options.has(o));
    return `scenario=${scenario}&options=${on.join(",")}&locale=${locale}`;
  }, [scenario, options, locale]);

  useEffect(() => {
    let alive = true;
    setState("loading");
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      setImg({ url: image.src, key: query });
      setState("ready");
    };
    image.onerror = () => alive && setState("error");
    image.src = `/v1/public/formats/preview.png?${query}`;
    return () => {
      alive = false;
    };
  }, [query]);

  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <main>
        <section className="border-b border-line">
          <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-8 sm:px-6">
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-[15px] text-ink-soft hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> {t.legal.back}</Link>
            <h1 className="mt-4 max-w-2xl text-[40px] font-bold leading-[46px] tracking-[-0.01em]">{F.title}</h1>
            <p className="mt-4 max-w-2xl text-[18px] leading-7 text-ink-soft">{F.intro}</p>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1180px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <div>
            <div role="tablist" aria-label={F.preview} className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(F.scenarios) as Scenario[]).map((s) => (
                <button key={s} role="tab" type="button" aria-selected={scenario === s} onClick={() => setScenario(s)}
                  className={`min-h-[76px] rounded-[var(--radius-field)] border-[1.5px] p-3 text-left ${scenario === s ? "border-ink bg-surface" : "border-line hover:border-ink-soft"}`}>
                  <span className="block font-semibold">{F.scenarios[s].label}</span>
                  <span className="block text-[14px] text-muted">{F.scenarios[s].text}</span>
                </button>
              ))}
            </div>
            {available.length > 0 && (
              <>
                <h2 className="mt-8 text-[22px] font-semibold">{F.optionsTitle}</h2>
                <ul className="mt-3 border-t border-line">
                  {available.map((o) => (
                    <li key={o} className="border-b border-line">
                      <label className="flex min-h-[64px] cursor-pointer items-center gap-3 py-2">
                        <input type="checkbox" className="size-5 shrink-0 accent-ink" checked={options.has(o)} onChange={() => setOptions((cur) => {
                          const n = new Set(cur);
                          if (n.has(o)) n.delete(o);
                          else n.add(o);
                          return n;
                        })} />
                        <span>
                          <span className="block font-semibold">{F.options[o]!.label}</span>
                          <span className="block text-[15px] text-ink-soft">{F.options[o]!.said}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="mono-label">{F.preview}</p>
              <a href={`/v1/public/formats/preview.pdf?${query}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold"><Download className="size-4" aria-hidden /> {F.download}</a>
            </div>
            <div className="relative border border-line bg-white shadow-[0_18px_40px_-24px_rgba(21,23,26,0.35)]">
              {img ? <img src={img.url} alt={F.scenarios[scenario].label} className={`block w-full transition-opacity ${state === "loading" ? "opacity-60" : ""}`} /> : <div className="skeleton aspect-[1/1.414] w-full" />}
              {state === "loading" && <p className="absolute inset-x-0 top-3 flex justify-center"><span className="inline-flex items-center gap-2 bg-paper px-3 py-1 text-[14px]"><Loader2 className="size-4 animate-spin" aria-hidden /> {F.loading}</span></p>}
            </div>
            {state === "error" && <p className="mt-3 text-danger" role="alert">{F.failed}</p>}
            <p className="mt-3 text-[14px] text-muted">{F.example}</p>
            {chat && (
              <a href={chat} target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-field)] bg-ink px-5 font-semibold text-paper">
                <MessageCircle className="size-5" aria-hidden /> {F.cta}
              </a>
            )}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

