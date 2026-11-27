import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { useApi } from "@/lib/api";
import { contact } from "@/lib/contact";
import { type Currency, money } from "@/lib/format";
import { useI18n } from "@/l10n";

// Conditions (P-66) : celles de la v1, plus les conditions de l'abonnement (spec 011, reprises de
// Struo) avec les valeurs réelles de l'offre en vigueur (prix, quota, grâce, rappels).
export const Route = createFileRoute("/conditions")({ component: Terms });

interface Offer {
  trialDocuments: number;
  warnDays: number;
  plans: Array<{ priceMinor: string; quota: number; periodDays: number; graceDays: number; topUp: { documents: number; priceMinor: string } | null; currency: Currency }>;
}

function Terms() {
  const { t, locale } = useI18n();
  const L = t.legal;
  const T = L.terms;
  const offer = useApi<Offer>(null, `/v1/public/offer?locale=${locale}`);
  const plan = offer.data?.plans[0];
  const items = offer.data
    ? [
        T.trial(offer.data.trialDocuments),
        plan ? T.plan(money(plan.priceMinor, plan.currency), plan.quota, plan.periodDays) : T.noPlan,
        T.consumption,
        T.carry,
        ...(plan?.topUp ? [T.topUp(plan.topUp.documents, money(plan.topUp.priceMinor, plan.currency))] : []),
        T.notices(offer.data.warnDays, plan?.graceDays ?? 0),
        T.versions,
        T.payment,
      ]
    : [];
  return (
    <InfoPage title={T.title} intro={T.intro} updated={L.updated}>
      <section className="border-b border-line py-7">
        <p className="text-[17px] leading-[27px] text-ink-soft">{contact.publisher ? L.publisherLine(contact.publisher, contact.publisherDetails) : L.noPublisher}</p>
      </section>
      {T.sections.map((s) => <InfoSection key={s.title} {...s} />)}
      {offer.data ? <InfoSection title={T.offerTitle} items={items} /> : <div className="skeleton my-7 h-40" />}
      {T.end.map((s) => <InfoSection key={s.title} {...s} />)}
    </InfoPage>
  );
}
