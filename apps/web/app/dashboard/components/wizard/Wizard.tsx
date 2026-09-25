"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import styles from "./wizard.module.css";

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
    <form className={styles.wizard} onSubmit={handleSubmit} aria-labelledby="wizard-title">
      <header className={styles.header}>
        <h1 id="wizard-title" className={styles.title}>
          {title}
        </h1>
        <p className={styles.progress}>
          {t("stepOf", { current: position + 1, total: steps.length })}
          {current && ` · ${current.title}`}
        </p>
      </header>

      <ol className={styles.stepper}>
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              className={styles.stepLink}
              data-state={index === position ? "current" : index < position ? "done" : "todo"}
              aria-current={index === position ? "step" : undefined}
              disabled={!step.reachable || index === position}
              onClick={() => onGoTo(index)}
            >
              <span className={styles.stepNumber}>{index + 1}</span>
              <span className={styles.stepTitle}>{step.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className={styles.body}>
        {!isReview && current && <h2 className={styles.stepHeading}>{current.title}</h2>}
        {children}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </section>

      <footer className={styles.footer}>
        <Link href={cancelHref} className={styles.cancel}>
          {t("cancel")}
        </Link>
        <div className={styles.navButtons}>
          {!isFirst && (
            <button type="button" className={styles.secondary} onClick={onBack} disabled={pending}>
              {t("back")}
            </button>
          )}
          <button type="submit" className={styles.primary} disabled={pending}>
            {isReview ? finishLabel : t("next")}
          </button>
        </div>
      </footer>
    </form>
  );
}
