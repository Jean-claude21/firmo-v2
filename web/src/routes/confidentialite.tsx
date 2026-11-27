import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { contact } from "@/lib/contact";
import { useT } from "@/l10n";

// Confidentialité (P-66) : lien envoyé dès le premier message du chat (voix v1).
export const Route = createFileRoute("/confidentialite")({ component: Privacy });

function Privacy() {
  const t = useT();
  const L = t.legal;
  return (
    <InfoPage title={L.privacy.title} intro={L.privacy.intro} updated={L.updated}>
      <InfoSection title={L.privacy.sections[0]!.title} paragraphs={L.privacy.sections[0]!.paragraphs} />
      <section className="border-b border-line py-7">
        <p className="text-[17px] leading-[27px] text-ink-soft">{contact.publisher ? L.publisherLine(contact.publisher, contact.publisherDetails) : L.noPublisher}</p>
      </section>
      {L.privacy.sections.slice(1).map((s) => <InfoSection key={s.title} {...s} />)}
      {contact.email && <p className="py-4 text-[17px]"><a className="font-semibold underline underline-offset-4" href={`mailto:${contact.email}`}>{contact.email}</a></p>}
    </InfoPage>
  );
}
