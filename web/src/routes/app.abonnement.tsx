import { createFileRoute } from "@tanstack/react-router";
import { Card, ErrorBox, PageTitle, SkeletonList } from "@/components/ui";
import { date } from "@/lib/format";
import { useMe } from "@/lib/portal";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/app/abonnement")({ component: Subscription });

function Subscription() {
  const { t, locale } = useI18n();
  const S = t.app.subscription;
  const me = useMe();
  const e = me.data?.entitlement;
  return (
    <div className="space-y-5">
      <PageTitle title={S.title} />
      {me.error && <ErrorBox onRetry={me.reload} />}
      {!me.data && <SkeletonList rows={2} />}
      {me.data && (
        <Card>
          <p className="text-sm text-muted">{S.current}</p>
          <p className="mt-1 text-xl font-bold">
            {!e ? S.none : e.kind === "trial" ? S.trial : e.kind === "grant" ? S.grant : S.paid}
            {e?.periodEnd && <span className="ml-2 text-base font-normal text-muted">{S.until(date(e.periodEnd, locale))}</span>}
          </p>
          {e && <p className="mt-2 text-muted">{S.remaining(e.remaining)}</p>}
        </Card>
      )}
    </div>
  );
}
