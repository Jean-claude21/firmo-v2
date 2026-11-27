import { createFileRoute } from "@tanstack/react-router";
import { InfoPage, InfoSection } from "@/components/public-layout";
import { useT } from "@/l10n";

// Accord de traitement des données (spec 015) : rôles, engagements, sous-traitants, durées.
export const Route = createFileRoute("/traitement-donnees")({ component: Dpa });

function Dpa() {
  const t = useT();
  const L = t.legal;
  return (
    <InfoPage title={L.dpa.title} intro={L.dpa.intro} updated={L.updated}>
      {L.dpa.sections.map((s) => <InfoSection key={s.title} {...s} />)}
    </InfoPage>
  );
}
