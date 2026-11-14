"use client";

import { useSyncExternalStore } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import StatusNotice from "./components/StatusNotice";
import "./globals.css";

// The last resort: the root layout itself failed, so nothing of it is here
// (no providers, no translations, no fonts). This page brings its own
// <html> and <body>, the stylesheet, and its two languages; the notice itself
// is the plain markup every other error page uses.

const TEXT = {
  es: {
    descriptor: "TECNOLOGÍA PARA VIVIR MEJOR",
    eyebrow: "Error",
    title: "Algo ha fallado",
    text: "No hemos podido cargar el portal. Vuelve a intentarlo; si sigue fallando, indica a soporte el código de abajo.",
    retry: "Reintentar",
    toProjects: "Volver a Proyectos",
    digest: "Código del error",
  },
  en: {
    descriptor: "TECHNOLOGY FOR BETTER LIVING",
    eyebrow: "Error",
    title: "Something went wrong",
    text: "We couldn't load the portal. Try again; if it keeps failing, give support the code below.",
    retry: "Try again",
    toProjects: "Back to Projects",
    digest: "Error code",
  },
} as const;

type Language = keyof typeof TEXT;

/** The browser's first language we have, else Spanish (the portal's default): as the login page picks it. */
function browserLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const language = tag.toLowerCase().split("-")[0];
    if (language === "es" || language === "en") return language;
  }
  return "es";
}

const never = () => () => {};

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Spanish on the server and while hydrating, then the browser's.
  const language = useSyncExternalStore<Language>(never, browserLanguage, () => "es");
  const t = TEXT[language];

  return (
    <html lang={language}>
      <body>
        <title>ViTAH</title>
        {/* Never the error's message: it can carry internals. The digest is in the server's log line. */}
        <StatusNotice
          page
          tone="bad"
          eyebrow={t.eyebrow}
          title={t.title}
          text={t.text}
          descriptor={t.descriptor}
          digest={error.digest ? { label: t.digest, value: error.digest } : undefined}
        >
          {/* A full load: the root layout that failed runs again. */}
          <button type="button" onClick={() => window.location.reload()} className={buttonVariants()}>
            {t.retry}
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load too, not a client navigation */}
          <a href="/dashboard/projects" className={cn(buttonVariants({ variant: "outline" }))}>
            {t.toProjects}
          </a>
        </StatusNotice>
      </body>
    </html>
  );
}
