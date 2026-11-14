import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, CheckCircle2, FileText, Globe2, Hash, Mic, Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Logo, Mark } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { type Currency, money } from "@/lib/format";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/")({ component: Landing });

// Adresses des canaux, fixées à la construction (aucune valeur dans le code).
const WHATSAPP = import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined;
const TELEGRAM = import.meta.env.VITE_TELEGRAM_BOT as string | undefined;

interface Offer {
  trialDocuments: number;
  plans: Array<{ code: string; label: string; priceMinor: string; quota: number; currency: Currency }>;
}

function Cta({ large = false }: { large?: boolean }) {
  const { t } = useI18n();
  const size = large ? "min-h-13 px-6 text-base" : "";
  if (!WHATSAPP && !TELEGRAM) {
    return <span className="inline-flex min-h-11 items-center rounded-[var(--radius-field)] bg-ink/5 px-4 font-medium text-muted">{t.landing.ctaSoon}</span>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      {WHATSAPP && (
        <LinkButton href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Bonjour Firmo")}`} variant="accent" className={size} icon={<Send className="size-4" aria-hidden />}>
          {t.landing.ctaWhatsapp}
        </LinkButton>
      )}
      {TELEGRAM && (
        <LinkButton href={`https://t.me/${TELEGRAM}?start=site`} variant={WHATSAPP ? "outline" : "accent"} className={size} icon={<Send className="size-4" aria-hidden />}>
          {t.landing.ctaTelegram}
        </LinkButton>
      )}
    </div>
  );
}

function ChatMock() {
  const { t } = useI18n();
  const lines = t.landing.mock;
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="rounded-[28px] border border-line bg-[#ECE5DD] p-4 shadow-[0_24px_60px_-20px_rgb(20_33_61/0.35)]">
        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-ink px-3 py-2 text-white">
          <Mark className="size-7" />
          <span className="font-semibold">Firmo</span>
        </div>
        <div className="space-y-2 text-[14px] leading-snug">
          <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2">{lines.me}</p>
          <p className="w-fit max-w-[88%] whitespace-pre-line rounded-2xl rounded-tl-sm bg-white px-3 py-2">{lines.firmo}</p>
          <p className="ml-auto w-fit rounded-2xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2">{lines.ok}</p>
          <div className="w-fit max-w-[88%] rounded-2xl rounded-tl-sm bg-white p-2">
            <img src="/samples/devis-modern.png" alt="" className="h-28 w-full rounded-lg object-cover object-top" />
            <p className="px-1 pt-1.5">{lines.done}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const { t, locale } = useI18n();
  const offer = useApi<Offer>(null, `/v1/public/offer?locale=${locale}`);
  const [template, setTemplate] = useState<"classic" | "modern" | "clean">("modern");
  const L = t.landing;
  const icons = [Mic, BadgeCheck, Send];
  const featureIcons = [FileText, Globe2, Hash, ShieldCheck];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Logo />
          <div className="hidden items-center gap-6 text-[15px] text-muted md:flex">
            <a href="#how" className="hover:text-ink">{L.nav.how}</a>
            <a href="#pricing" className="hover:text-ink">{L.nav.pricing}</a>
            <a href="#faq" className="hover:text-ink">{L.nav.faq}</a>
          </div>
          <Link to="/app" className="inline-flex min-h-11 items-center rounded-[var(--radius-field)] px-3 font-medium text-ink hover:bg-ink/5">
            {L.nav.login}
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-soft px-3 py-1 text-sm font-medium text-amber-text">
              <CheckCircle2 className="size-4" aria-hidden /> {L.eyebrow}
            </p>
            <h1 className="font-serif text-[40px] font-bold leading-[1.08] tracking-tight sm:text-[54px]">{L.title}</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{L.subtitle}</p>
            <div className="mt-8"><Cta large /></div>
            <p className="mt-3 text-sm text-muted">{L.free}</p>
          </div>
          <ChatMock />
        </section>

        <section className="border-y border-line bg-ink text-white">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="font-serif text-2xl font-semibold sm:text-3xl">{L.ruleTitle}</p>
            <p className="mt-2 max-w-3xl text-white/75">{L.ruleText}</p>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <h2 className="font-serif text-3xl font-bold">{L.stepsTitle}</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {L.steps.map((s, i) => {
              const Icon = icons[i] ?? Mic;
              return (
                <li key={s.title} className="card p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-amber-soft text-amber-text"><Icon className="size-5" aria-hidden /></span>
                    <span className="text-sm font-semibold text-muted">{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-muted">{s.text}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="font-serif text-3xl font-bold">{L.showcaseTitle}</h2>
              <p className="mt-3 text-muted">{L.showcaseText}</p>
              <div className="mt-6 flex flex-wrap gap-2" role="tablist">
                {(["classic", "modern", "clean"] as const).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={template === k}
                    onClick={() => setTemplate(k)}
                    className={`min-h-11 rounded-full px-4 font-medium transition ${template === k ? "bg-ink text-white" : "bg-paper text-ink hover:bg-line/60"}`}
                  >
                    {L.templates[k]}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[var(--radius-card)] border border-line bg-paper p-3 shadow-[var(--shadow-card)]">
              <img src={`/samples/devis-${template}.png`} alt={L.templates[template]} className="aspect-[1/1.1] w-full rounded-lg object-cover object-top" loading="lazy" />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-serif text-3xl font-bold">{L.featuresTitle}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {L.features.map((f, i) => {
              const Icon = featureIcons[i] ?? FileText;
              return (
                <div key={f.title} className="flex gap-4">
                  <Icon className="mt-1 size-6 shrink-0 text-amber-text" aria-hidden />
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1 text-muted">{f.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section id="pricing" className="scroll-mt-20 bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="font-serif text-3xl font-bold">{L.pricingTitle}</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="card p-6">
                <p className="font-semibold text-muted">{L.pricingTrial}</p>
                <p className="mt-2 font-serif text-4xl font-bold">0</p>
                <p className="mt-2 text-muted">{offer.data ? L.pricingTrialText(offer.data.trialDocuments) : <span className="skeleton inline-block h-4 w-40" />}</p>
              </div>
              <div className="card border-ink p-6 ring-2 ring-ink">
                <p className="font-semibold text-muted">{L.pricingPlan}</p>
                {offer.loading && <div className="skeleton mt-3 h-10 w-40" />}
                {offer.data?.plans[0] && (
                  <p className="mt-2 font-serif text-4xl font-bold">
                    {money(offer.data.plans[0].priceMinor, offer.data.plans[0].currency)}
                    <span className="ml-1 font-sans text-base font-normal text-muted">{L.perMonth}</span>
                  </p>
                )}
                <p className="mt-2 text-muted">{L.pricingPlanText}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 sm:px-6">
          <h2 className="font-serif text-3xl font-bold">{L.faqTitle}</h2>
          <div className="mt-6 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
            {L.faq.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold">
                  {f.q}
                  <span className="text-xl text-muted transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 flex justify-center"><Cta large /></div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
          <Logo />
          <p>{L.footer}</p>
        </div>
      </footer>
    </div>
  );
}
