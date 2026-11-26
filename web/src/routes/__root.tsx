import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { I18nProvider, useT } from "@/l10n";
import { fr } from "@/l10n/fr";
import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#15171A" },
      { title: fr.meta.title },
      { name: "description", content: fr.meta.description },
      { property: "og:title", content: fr.meta.title },
      { property: "og:description", content: fr.meta.description },
      { property: "og:image", content: "/brand/firmo-og.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  component: () => (
    <Document>
      <I18nProvider>
        <Outlet />
      </I18nProvider>
    </Document>
  ),
  notFoundComponent: NotFound,
});

function NotFound() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="font-serif text-6xl font-bold text-amber">404</p>
      <p className="mt-3 text-lg">{t.common.notFound}</p>
      <Link to="/" className="mt-6 font-medium text-ink underline underline-offset-4">
        {t.common.home}
      </Link>
    </main>
  );
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
