"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type WizardStepLink = { id: string; title: string; reachable: boolean };

/**
 * Presentational wizard layout: title, stepper, the current step's content and
 * the footer buttons. Submitting the form means "next" (or "finish" on the
 * review screen), so native field validation runs before moving on.
 */
export default function Wizard({
  title,
  steps,
  position,
  isFirst,
  isReview,
  pending,
  finishLabel,
  cancelHref,
  error,
  onNext,
  onBack,
  onGoTo,
  children,
}: {
  title: string;
  /** Every stop, including the review screen as the last one. */
  steps: WizardStepLink[];
  position: number;
  isFirst: boolean;
  isReview: boolean;
  pending: boolean;
  finishLabel: string;
  cancelHref: string;
  error?: string;
  onNext: () => void;
  onBack: () => void;
  onGoTo: (position: number) => void;
  children: ReactNode;
}) {
  const t = useTranslations("wizard");
  const current = steps[position];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onNext();
  }

  return (
    <form
      className="flex max-w-[760px] flex-col gap-5"
      onSubmit={handleSubmit}
      aria-labelledby="wizard-title"
    >
      <header className="flex flex-col gap-1.5">
        <h1 id="wizard-title">{title}</h1>
        <p className="text-[13px] text-muted-foreground">
          {t("stepOf", { current: position + 1, total: steps.length })}
          {current && ` · ${current.title}`}
        </p>
      </header>

      <ol className="m-0 flex list-none gap-1.5 p-0">
        {steps.map((step, index) => {
          const state =
            index === position ? "current" : index < position ? "done" : "todo";
          return (
            <li key={step.id} className="min-w-0 flex-1">
              <button
                type="button"
                className={cn(
                  "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-[13px] font-medium text-muted-foreground shadow-card transition-colors not-disabled:cursor-pointer not-disabled:hover:border-primary md:justify-start md:px-3",
                  state === "current" &&
                    "border-primary font-semibold text-foreground",
                  state === "done" && "text-brand-ink",
                )}
                aria-current={index === position ? "step" : undefined}
                disabled={!step.reachable || index === position}
                onClick={() => onGoTo(index)}
              >
                <span
                  className={cn(
                    "inline-flex size-6 flex-none items-center justify-center rounded-full bg-raise text-[11.5px] font-semibold tabular-nums",
                    state === "current" && "bg-primary text-primary-foreground",
                    state === "done" && "bg-brand-soft text-brand-ink",
                  )}
                >
                  {index + 1}
                </span>
                <span className="hidden truncate md:inline">{step.title}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className={cardVariants()}>
        {!isReview && current && <h2>{current.title}</h2>}
        {children}
        {error && (
          <FormMessage role="alert">{error}</FormMessage>
        )}
      </section>

      <footer className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-end">
        <Link
          href={cancelHref}
          className={buttonVariants({ variant: "ghost" })}
        >
          {t("cancel")}
        </Link>
        <div className="flex flex-col-reverse gap-2 md:flex-row">
          {!isFirst && (
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={pending}
            >
              {t("back")}
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {isReview ? finishLabel : t("next")}
          </Button>
        </div>
      </footer>
    </form>
  );
}
