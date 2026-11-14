import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/brand";
import { Button, Card, ErrorBox, Notice } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { useT } from "@/l10n";

// Page du fournisseur simulé (hors production) : l'artisan choisit l'issue de son paiement.
export const Route = createFileRoute("/paiement/simulateur/$id")({ component: SimulatedPayment });

function SimulatedPayment() {
  const t = useT();
  const S = t.app.subscription;
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const payment = useApi<{ reference: string; status: string }>("org", `/v1/billing/payments/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function settle(outcome: "succeeded" | "failed") {
    setBusy(outcome);
    try {
      await api("org", `/v1/billing/simulator/${id}`, { body: { outcome } });
      void navigate({ to: "/app/abonnement", search: { paiement: id } });
    } catch (e) {
      setError(e as ApiError);
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <Logo />
      <Card className="space-y-4">
        <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-5 text-amber-text" aria-hidden /> {S.simulator}</p>
        {payment.error && <ErrorBox onRetry={payment.reload} />}
        {payment.data && <p className="text-muted">{payment.data.reference} · {S.statuses[payment.data.status] ?? payment.data.status}</p>}
        {error && <Notice tone="warn">{error.message}</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="accent" loading={busy === "succeeded"} disabled={payment.data?.status !== "pending"} onClick={() => settle("succeeded")}>{S.statuses.succeeded}</Button>
          <Button variant="danger" loading={busy === "failed"} disabled={payment.data?.status !== "pending"} onClick={() => settle("failed")}>{S.statuses.failed}</Button>
        </div>
      </Card>
    </main>
  );
}
