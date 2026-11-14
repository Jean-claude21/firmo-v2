import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { en } from "./en";
import { fr, type Messages } from "./fr";

// Langue du web : celle de l'organisation dans l'espace artisan, celle du navigateur ailleurs.
// Français par défaut (rendu serveur), anglais si le navigateur le demande.

const DICTS: Record<string, Messages> = { fr, en };

export type Locale = "fr" | "en";

const Ctx = createContext<{ t: Messages; locale: Locale; setLocale: (l: Locale) => void }>({ t: fr, locale: "fr", setLocale: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("fr");
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) setLocale("en");
  }, []);
  return <Ctx.Provider value={{ t: DICTS[locale] ?? fr, locale, setLocale }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function useT(): Messages {
  return useContext(Ctx).t;
}

export function localeOf(value: string | null | undefined): Locale {
  return value?.startsWith("en") ? "en" : "fr";
}
