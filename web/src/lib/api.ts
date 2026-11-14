import { useCallback, useEffect, useRef, useState } from "react";

// Client de l'API (même origine : /v1 est relayé vers l'API). Le web n'envoie que ce que la
// personne tape ; il ne calcule ni montant ni statut (constitution III).

export type Scope = "org" | "staff";

const KEYS: Record<Scope, string> = { org: "firmo.session.org", staff: "firmo.session.staff" };

export const session = {
  get(scope: Scope): string | null {
    try {
      const raw = localStorage.getItem(KEYS[scope]);
      if (!raw) return null;
      const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: string };
      if (new Date(expiresAt).getTime() < Date.now()) {
        localStorage.removeItem(KEYS[scope]);
        return null;
      }
      return token;
    } catch {
      return null;
    }
  },
  set(scope: Scope, token: string, expiresAt: string) {
    try {
      localStorage.setItem(KEYS[scope], JSON.stringify({ token, expiresAt }));
    } catch {
      // navigation privée : la session vit le temps de la page
    }
  },
  clear(scope: Scope) {
    try {
      localStorage.removeItem(KEYS[scope]);
    } catch {
      // rien à faire
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(scope: Scope | null, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = scope ? session.get(scope) : null;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network", "réseau indisponible");
  }
  if (res.status === 401 && scope) session.clear(scope);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
    throw new ApiError(res.status, body.error?.code ?? "error", body.error?.message ?? res.statusText, body.error?.fields ?? {});
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** URL d'un fichier protégé : le jeton passe en paramètre pour <img> et les téléchargements. */
export async function authedBlobUrl(scope: Scope, path: string): Promise<string> {
  const token = session.get(scope);
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "error", res.statusText);
  return URL.createObjectURL(await res.blob());
}

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** Chargement avec états (chargement, erreur, rechargement). */
export function useApi<T>(scope: Scope | null, path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (!path) return;
    const n = ++current.current;
    setLoading(true);
    setError(null);
    api<T>(scope, path)
      .then((d) => n === current.current && setData(d))
      .catch((e: ApiError) => n === current.current && setError(e))
      .finally(() => n === current.current && setLoading(false));
  }, [scope, path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
