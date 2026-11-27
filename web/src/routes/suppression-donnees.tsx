import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { contact } from "@/lib/contact";
import { useT } from "@/l10n";

// Suppression des données (P-66, P-83) : comment la demander, ce qui part, ce qui reste.
export const Route = createFileRoute("/suppression-donnees")({ component: Deletion });

function Deletion() {
  const t = useT();
  const L = t.legal;
  return (
    <InfoPage title={L.deletion.title} intro={L.deletion.intro} updated={L.updated}>
      {L.deletion.sections.map((s) => <InfoSection key={s.title} {...s} />)}
      {contact.email && <p className="py-4 text-[17px]"><a className="font-semibold underline underline-offset-4" href={`mailto:${contact.email}`}>{contact.email}</a></p>}
    </InfoPage>
  );
}
