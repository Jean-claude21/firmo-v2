import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { useT } from "@/l10n";

// Mentions légales (P-66, spec 015) : éditeur Kete, hébergement, propriété.
export const Route = createFileRoute("/mentions-legales")({ component: Notice });

function Notice() {
  const t = useT();
  const L = t.legal;
  return (
    <InfoPage title={L.notice.title} intro={L.notice.intro} updated={L.updated}>
      {L.notice.sections.map((s) => <InfoSection key={s.title} {...s} />)}
    </InfoPage>
  );
}
