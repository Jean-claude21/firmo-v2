import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, MessageCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PublicFooter, PublicHeader } from "@/components/public-layout";
import { useApi } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { type Currency, figure } from "@/lib/format";
import chat from "@/l10n/landing-chat.json";
import { useI18n, useT } from "@/l10n";

// Landing (P-61, maquette validée de la v1) : « Tu parles. Firmo rédige. » Les images sont des
// rendus et des captures réels de Firmo (compte de démonstration, présenté comme tel) ; la feuille
// manuscrite est une photo d'illustration. Une seule chose bouge : la feuille qui devient document.
export const Route = createFileRoute("/")({ component: Landing });

interface Offer {
  trialDocuments: number;
  plans: Array<{ label: string; priceMinor: string; quota: number; periodDays: number; currency: Currency }>;
}

const COLORS = ["a8391f", "1f6f43", "2c5a8c", "6b3fa0", "15171a"];
const ARTISAN = "#a8391f";

function useChat() {
  const t = useT();
  const channel = chatChannel();
  return { channel, link: chatLink(channel, t.landing.firstMessage) };
}

function ChatButton({ label, inverse = false }: { label: string; inverse?: boolean }) {
  const t = useT();
  const { link } = useChat();
  if (!link) return <span className={`inline-flex min-h-12 items-center rounded-[var(--radius-field)] px-5 text-[16px] ${inverse ? "bg-white/10 text-white/80" : "bg-paper-alt text-ink-soft"}`}>{t.landing.ctaSoon}</span>;
  return (
    <a href={link} target="_blank" rel="noreferrer" className={`inline-flex min-h-12 items-center gap-2.5 rounded-[var(--radius-field)] px-5 text-[16px] font-semibold ${inverse ? "bg-paper text-ink hover:bg-white" : "bg-ink text-paper hover:bg-ink-soft"}`}>
      <MessageCircle className="size-5" aria-hidden /> {label}
    </a>
  );
}

/** La feuille manuscrite qui se retourne en document (rotation CSS 3D, deux faces, sans bibliothèque). */
function Flip() {
  const t = useT();
  const L = t.landing;
  const [flipped, setFlipped] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        const timer = setTimeout(() => setFlipped(true), 900);
        io.disconnect();
        return () => clearTimeout(timer);
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (reduced) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <figure><img src="/landing/feuille-atelier.webp" alt={L.sheetAlt} className="aspect-[3/4] w-full object-cover" /><figcaption className="mono-label mt-2">{L.sheetLabel}</figcaption></figure>
        <figure><img src="/landing/doc-final.webp" alt={L.docAlt} className="aspect-[3/4] w-full border border-line bg-white object-cover object-top" /><figcaption className="mono-label mt-2">{L.docLabel}</figcaption></figure>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[440px] [perspective:1600px]">
        <div className="relative h-full w-full transition-transform duration-[1100ms] ease-[cubic-bezier(.2,.7,.2,1)] [transform-style:preserve-3d]" style={{ transform: flipped ? "rotateY(180deg)" : "none" }}>
          <img src="/landing/feuille-atelier.webp" alt={L.sheetAlt} className="absolute inset-0 h-full w-full object-cover shadow-[0_26px_50px_-26px_rgba(21,23,26,0.55)] [backface-visibility:hidden]" />
          <img src="/landing/doc-final.webp" alt={L.docAlt} className="absolute inset-0 h-full w-full border border-line bg-white object-cover object-top shadow-[0_26px_50px_-26px_rgba(21,23,26,0.45)] [backface-visibility:hidden] [transform:rotateY(180deg)]" />
        </div>
      </div>
      <div className="mx-auto mt-4 flex max-w-[440px] items-center justify-between">
        <p className="mono-label">{flipped ? L.docLabel : L.sheetLabel}</p>
        <button type="button" onClick={() => setFlipped((f) => !f)} className="inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold"><RotateCcw className="size-4" aria-hidden /> {L.replay}</button>
      </div>
    </div>
  );
}

function ChatExcerpt() {
  const t = useT();
  return (
    <figure className="w-full max-w-[400px]">
      <div className="overflow-hidden border border-line bg-[#e9e4dc]">
        <div className="flex items-center justify-between bg-ink px-4 py-3 text-paper">
          <span className="inline-flex items-center gap-2.5 font-semibold"><span className="flex size-7 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: ARTISAN }}>F</span> Firmo</span>
          <span className="text-[12px] text-paper/70">{t.landing.online}</span>
        </div>
        <div className="space-y-2.5 p-3 text-[14px] leading-[20px]">
          {chat.map((m, i) => (
            m.from === "me" ? (
              <p key={i} className="ml-auto w-fit max-w-[85%] rounded-[8px] bg-[#d9f2c7] px-3 py-2">{m.text}</p>
            ) : "file" in m && m.file ? (
              <div key={i} className="w-fit max-w-[85%] rounded-[8px] bg-white p-2.5">
                <p className="mb-2">{m.text}</p>
                <div className="flex items-center gap-3 bg-paper px-3 py-2.5">
                  <span className="flex h-9 w-8 items-center justify-center text-[10px] font-bold text-white" style={{ background: ARTISAN }}>PDF</span>
                  <span><span className="block font-mono text-[13px] font-semibold">{m.file as string}</span><span className="text-[12px] text-muted">PDF · 1 page</span></span>
                </div>
              </div>
            ) : (
              <p key={i} className="w-fit max-w-[88%] whitespace-pre-line rounded-[8px] bg-white px-3 py-2">{m.text}</p>
            )
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-[13px] text-muted">{t.landing.chatCaption}</figcaption>
    </figure>
  );
}

function Colors() {
  const t = useT();
  const L = t.landing;
  const [color, setColor] = useState(COLORS[0]!);
  return (
    <div>
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={L.colorsTitle}>
        {COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={L.colorName(`#${c.toUpperCase()}`)} onClick={() => setColor(c)}
            className={`size-11 rounded-full ${color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-paper-alt" : ""}`} style={{ background: `#${c}` }} />
        ))}
      </div>
      <div className="mt-6 max-w-[560px] border border-line bg-white shadow-[0_26px_50px_-30px_rgba(21,23,26,0.4)]">
        {COLORS.map((c) => <img key={c} src={`/landing/doc-${c}.webp`} alt={L.docAlt} className={`w-full ${c === color ? "block" : "hidden"}`} />)}
      </div>
      <p className="mt-3 max-w-[560px] text-[13px] text-muted">{L.colorsCaption} <Link to="/formats" className="font-semibold text-ink underline underline-offset-4">{L.formatsLink}</Link></p>
    </div>
  );
}

function Price() {
  const t = useT();
  const L = t.landing;
  const { locale } = useI18n();
  const offer = useApi<Offer>(null, `/v1/public/offer?locale=${locale}`);
  const plan = offer.data?.plans[0];
  const cell = "border border-line bg-surface p-6";
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={cell}>
          <p className="mono-label">{L.trial}</p>
          <p className="mt-2"><span className="font-mono text-[34px] font-bold">0</span> <span className="text-ink-soft">{plan?.currency.symbol ?? ""}</span></p>
          <p className="text-ink-soft">{offer.data ? L.trialText(offer.data.trialDocuments) : " "}</p>
          <ul className="mt-5 space-y-2 border-t border-line pt-5">{L.trialItems.map((i) => <li key={i} className="flex gap-3"><span className="mt-[13px] h-px w-3 shrink-0" style={{ background: ARTISAN }} aria-hidden />{i}</li>)}</ul>
        </div>
        <div className={`${cell} border-ink`}>
          <p className="mono-label">{plan?.label ?? " "}</p>
          {plan ? (
            <>
              <p className="mt-2"><span className="font-mono text-[34px] font-bold">{figure(plan.priceMinor, plan.currency)}</span> <span className="text-ink-soft">{plan.currency.symbol} {L.perPeriod(plan.periodDays)}</span></p>
              <p className="text-ink-soft">{L.planText(plan.quota)}</p>
            </>
          ) : <div className="skeleton mt-3 h-16" />}
          <ul className="mt-5 space-y-2 border-t border-line pt-5">{L.planItems.map((i) => <li key={i} className="flex gap-3"><span className="mt-[13px] h-px w-3 shrink-0" style={{ background: ARTISAN }} aria-hidden />{i}</li>)}</ul>
        </div>
      </div>
      <p className="mt-4 max-w-md text-[14px] text-muted">{L.priceNote} <Link to="/conditions" className="underline underline-offset-4">{L.termsLink}</Link></p>
    </div>
  );
}

function Landing() {
  const t = useT();
  const L = t.landing;
  const { link } = useChat();
  const wrap = "mx-auto max-w-[1180px] px-4 sm:px-6";
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <main>
        <section className="border-b border-line">
          <div className={`${wrap} grid items-center gap-12 py-14 lg:grid-cols-[1fr_minmax(0,460px)] lg:py-20`}>
            <div>
              <p className="font-mono text-[12px] uppercase tracking-[0.14em]" style={{ color: ARTISAN }}>{L.kicker}</p>
              <h1 className="mt-4 text-[48px] font-bold leading-[50px] tracking-[-0.02em] sm:text-[58px] sm:leading-[60px]">
                {L.titleA}<br /><span style={{ color: ARTISAN }}>Firmo</span> {L.titleB}
              </h1>
              <p className="mt-5 max-w-[460px] text-[19px] leading-[29px] text-ink-soft">{L.lead} <strong className="text-ink">{L.leadStrong}</strong></p>
              <div className="mt-7 flex flex-wrap gap-2"><ChatButton label={L.tryVoice} /></div>
              <p className="mt-5 text-[15px] text-muted">{L.heroNote}</p>
              <p className="mt-1 text-[15px] text-muted">{L.heroPhoto} {link ? <a href={link} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">{L.heroPhotoLink}</a> : L.heroPhotoLink} {L.heroPhotoEnd}</p>
            </div>
            <Flip />
          </div>
        </section>

        <section className="border-b border-line">
          <div className={`${wrap} grid items-center gap-10 py-16 md:grid-cols-[minmax(0,360px)_1fr]`}>
            <img src="/landing/feuille-atelier.webp" alt={L.sheetAlt} loading="lazy" className="w-full shadow-[0_26px_50px_-26px_rgba(21,23,26,0.55)]" />
            <div>
              <p className="font-mono text-[12px] uppercase tracking-[0.14em]" style={{ color: ARTISAN }}>{L.photoKicker}</p>
              <h2 className="mt-3 text-[36px] font-semibold leading-[44px]">{L.photoTitle}</h2>
              <p className="mt-4 max-w-[480px] text-[18px] leading-[28px] text-ink-soft">{L.photoText} <strong className="text-ink">{L.photoTextStrong}</strong>{L.photoTextEnd}</p>
              <p className="mt-5 max-w-[480px] text-[15px] text-muted">{L.photoNote} <strong className="text-ink-soft">{L.photoNoteStrong}</strong></p>
            </div>
          </div>
        </section>

        <section className="border-b border-line bg-paper-alt">
          <div className={`${wrap} py-16`}>
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.chatTitle}</h2>
            <p className="mt-3 max-w-[520px] text-[18px] leading-[28px] text-ink-soft">{L.chatLead}</p>
            <div className="mt-10 grid items-start gap-10 md:grid-cols-[minmax(0,400px)_1fr]">
              <ChatExcerpt />
              <div className="space-y-8">
                {L.chatPoints.map((p) => (
                  <div key={p.title}>
                    <h3 className="text-[20px] font-semibold">{p.title}</h3>
                    <p className="mt-2 max-w-[520px] text-[17px] leading-[27px] text-ink-soft">{p.text} {"strong" in p && p.strong ? <strong className="text-ink">{p.strong}</strong> : null}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-line">
          <div className={`${wrap} py-16`}>
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.realTitle}</h2>
            <div className="mt-10 grid gap-10 md:grid-cols-3">
              {L.real.map((r, i) => (
                <div key={r.title}>
                  <p className="font-mono text-[13px]" style={{ color: ARTISAN }}>{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="mt-3 text-[20px] font-semibold leading-7">{r.title}</h3>
                  <p className="mt-2 text-[17px] leading-[27px] text-ink-soft">{r.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-line bg-paper-alt">
          <div className={`${wrap} py-16`}>
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.colorsTitle}</h2>
            <p className="mb-8 mt-3 max-w-[520px] text-[18px] leading-[28px] text-ink-soft">{L.colorsLead}</p>
            <Colors />
          </div>
        </section>

        <section className="border-b border-line">
          <div className={`${wrap} py-16`}>
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.spaceTitle}</h2>
            <p className="mt-3 max-w-[560px] text-[18px] leading-[28px] text-ink-soft">{L.spaceLead}</p>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {L.spaceShots.map((s, i) => (
                <figure key={s.title}>
                  <img src={`/landing/${["espace-accueil", "espace-editeur", "espace-presentation", "page-client"][i]}.webp`} alt={L.shotAlt(s.title)} loading="lazy" className="aspect-[390/844] w-full border border-line object-cover object-top" />
                  <figcaption className="mt-4"><span className="block text-[18px] font-semibold">{s.title}</span><span className="mt-1 block text-[15px] leading-[23px] text-ink-soft">{s.text}</span></figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-8 inline-flex items-center gap-2 text-[15px] text-muted"><FileText className="size-4" aria-hidden />{L.spaceLogin}</p>
          </div>
        </section>

        <section className="bg-ink text-paper">
          <div className="mx-auto max-w-[760px] px-4 py-16 sm:px-6">
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.neverTitle}</h2>
            <p className="mt-3 text-[18px] text-paper/80">{L.neverLead}</p>
            <ul className="mt-8 border-t border-white/15">
              {L.never.map((n) => (
                <li key={n.title} className="flex gap-4 border-b border-white/15 py-5">
                  <span className="mt-[12px] h-px w-3 shrink-0" style={{ background: "#d0603f" }} aria-hidden />
                  <span><span className="block text-[18px] font-semibold">{n.title}</span><span className="mt-1 block text-[15px] text-paper/70">{n.text}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-b border-line">
          <div className={`${wrap} py-16`}>
            <h2 className="text-[36px] font-semibold leading-[44px]">{L.priceTitle}</h2>
            <p className="mb-8 mt-3 text-[18px] text-ink-soft">{L.priceLead}</p>
            <Price />
          </div>
        </section>

        <section className="bg-ink text-paper">
          <div className="mx-auto max-w-[620px] px-4 py-16 text-center sm:px-6">
            <h2 className="text-[38px] font-semibold leading-[46px]">{L.finalTitle}</h2>
            <p className="mt-4 text-[18px] leading-[28px] text-paper/80">{L.finalText}</p>
            <div className="mt-7 flex justify-center"><ChatButton label={L.openChat} inverse /></div>
            <p className="mt-5 text-[14px] text-paper/70">{L.finalNote}</p>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
