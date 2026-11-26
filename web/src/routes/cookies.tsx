import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { useT } from "@/l10n";

// Cookies (spec 015) : aucune mesure par cookie ; ce qui reste dans le navigateur.
export const Route = createFileRoute("/cookies")({ component: Cookies });

function Cookies() {
  const t = useT();
  const L = t.legal;
  return (
    <InfoPage title={L.cookies.title} intro={L.cookies.intro} updated={L.updated}>
      {L.cookies.sections.map((s) => <InfoSection key={s.title} {...s} />)}
    </InfoPage>
  );
}
