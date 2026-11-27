import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock3, Link2Off, Loader2, Lock, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui";
import { api, type ApiError, session } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { useT } from "@/l10n";

// Lien envoyé dans le chat (ART-1) → session artisan → page demandée. Réutilisable pendant sa durée
// (P-68) ; s'il ne s'ouvre pas, l'écran dit pourquoi et comment en recevoir un autre.
export const Route = createFileRoute("/acces/$token")({ component: Access });

type Failure = "expired" | "invalid" | "suspended" | "network";

function Access() {
  const t = useT();
  const A = t.access;
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const chat = chatLink(chatChannel(), A.newLinkMessage);

  useEffect(() => {
    setFailure(null);
    api<{ token: string; expiresAt: string; target: string | null }>(null, "/v1/portal/session", { body: { token } })
      .then((r) => {
        session.set("org", r.token, r.expiresAt);
        // Le jeton ne reste pas dans l'historique du navigateur.
        void navigate({ to: (r.target ?? "/app") as "/app", replace: true });
      })
      .catch((e: ApiError) => setFailure(e.status === 0 ? "network" : e.code === "link_expired" ? "expired" : e.code === "org_suspended" ? "suspended" : "invalid"));
  }, [token, navigate, attempt]);

  const icon = { expired: Clock3, invalid: Link2Off, suspended: Lock, network: WifiOff };
  const Icon = failure ? icon[failure] : null;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Logo />
      {failure && Icon ? (
        <div className="mt-10">
          <Icon className="size-8" aria-hidden />
          <h1 className="mt-4 text-[28px] font-bold leading-9">{A.titles[failure]}</h1>
          <p className="mt-3 text-[17px] text-ink-soft">{A.texts[failure]}</p>
          <div className="mt-6 flex flex-col gap-2">
            {failure === "network" && <Button onClick={() => setAttempt((a) => a + 1)}>{t.common.retry}</Button>}
            {failure !== "network" && failure !== "suspended" && chat && <a href={chat} className="inline-flex min-h-12 items-center justify-center rounded-[var(--radius-field)] bg-ink px-5 font-semibold text-paper">{A.askNewLink}</a>}
          </div>
        </div>
      ) : (
        <p className="mt-10 flex items-center gap-2 text-ink-soft" role="status">
          <Loader2 className="size-5 animate-spin" aria-hidden /> {A.working}
        </p>
      )}
    </main>
  );
}
