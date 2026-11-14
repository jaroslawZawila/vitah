"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import StatusNotice from "./StatusNotice";

/**
 * What an error boundary shows (app/error.tsx, app/dashboard/error.tsx): the
 * translated message, "Reintentar", the way back to Proyectos and the error's
 * digest, which the server's log line carries too (instrumentation.ts).
 * Never the error's own message: it can carry internals.
 */
export default function ErrorNotice({
  error,
  reset,
  page = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Alone on a grafito page (outside the dashboard) instead of a card in the workspace. */
  page?: boolean;
}) {
  const t = useTranslations("errorPages");
  const login = useTranslations("login");
  const router = useRouter();

  // `reset()` alone would render the same failed server result again: ask the server anew, then clear the error.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <StatusNotice
      eyebrow={t("error.eyebrow")}
      title={t("error.title")}
      text={t("error.text")}
      tone="bad"
      digest={error.digest ? { label: t("error.digest"), value: error.digest } : undefined}
      page={page}
      descriptor={page ? login("descriptor") : undefined}
    >
      <Button type="button" onClick={retry}>
        {t("error.retry")}
      </Button>
      <Link href="/dashboard/projects" className={cn(buttonVariants({ variant: "outline" }))}>
        {t("toProjects")}
      </Link>
    </StatusNotice>
  );
}
