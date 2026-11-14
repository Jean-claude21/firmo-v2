import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link2Off, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { api, session } from "@/lib/api";
import { useT } from "@/l10n";

// Lien à usage unique envoyé dans le chat (ART-1) → session artisan → page demandée.
export const Route = createFileRoute("/acces/$token")({ component: Access });

function Access() {
  const t = useT();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<{ token: string; expiresAt: string; target: string | null }>(null, "/v1/portal/session", { body: { token } })
      .then((r) => {
        session.set("org", r.token, r.expiresAt);
        // Le jeton ne reste pas dans l'historique du navigateur.
        void navigate({ to: (r.target ?? "/app") as "/app", replace: true });
      })
      .catch(() => setFailed(true));
  }, [token, navigate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <Logo />
      {failed ? (
        <div className="card mt-8 p-6">
          <Link2Off className="mx-auto size-8 text-danger" aria-hidden />
          <p className="mt-3 font-semibold">{t.access.invalid}</p>
          <p className="mt-2 text-muted">{t.access.howTo}</p>
        </div>
      ) : (
        <p className="mt-8 flex items-center gap-2 text-muted" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden /> {t.access.working}
        </p>
      )}
    </main>
  );
}
