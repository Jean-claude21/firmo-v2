import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link2Off, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { api, session } from "@/lib/api";
import { useT } from "@/l10n";

// Lien d'administration envoyé dans le chat après « ADMIN » (P-76) : usage unique, quelques minutes.
export const Route = createFileRoute("/admin/acces/$token")({ component: AdminAccess });

function AdminAccess() {
  const t = useT();
  const A = t.admin.access;
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ token: string; expiresAt: string }>(null, "/v1/admin/session/link", { body: { token } })
      .then((r) => {
        session.set("staff", r.token, r.expiresAt);
        void navigate({ to: "/admin", replace: true });
      })
      .catch(() => setFailed(true));
  }, [token, navigate]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Logo to="/admin" />
      {failed ? (
        <div className="mt-10">
          <Link2Off className="size-8" aria-hidden />
          <h1 className="mt-4 text-[28px] font-bold leading-9">{A.invalid}</h1>
          <p className="mt-3 text-ink-soft">{A.howTo}</p>
        </div>
      ) : (
        <p className="mt-10 flex items-center gap-2 text-ink-soft" role="status"><Loader2 className="size-5 animate-spin" aria-hidden /> {A.working}</p>
      )}
    </main>
  );
}
