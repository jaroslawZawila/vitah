import { Check } from "lucide-react";
import styles from "./obra.module.css";

export type Step = {
  key: string;
  label: string;
  meta?: string;
  state: "done" | "current" | "todo";
  /** Set when staff may jump to this step. */
  onSelect?: () => void;
  selectLabel?: string;
};

/** Presentational: a horizontal (desktop) / vertical (phone) row of steps. */
export default function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol
      className={styles.stepper}
      aria-label={label}
      style={{ "--steps": steps.length } as React.CSSProperties}
    >
      {steps.map((step) => {
        const marker = (
          <span className={`${styles.marker} ${styles[`marker_${step.state}`]}`} aria-hidden>
            {step.state === "done" && <Check size={14} strokeWidth={2.6} />}
            {step.state === "current" && <span className={styles.markerDot} />}
          </span>
        );
        return (
          <li
            key={step.key}
            className={styles.step}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className={styles.stepHead}>
              {step.onSelect ? (
                <button
                  type="button"
                  className={styles.markerButton}
                  onClick={step.onSelect}
                  aria-label={step.selectLabel}
                >
                  {marker}
                </button>
              ) : (
                marker
              )}
              <span className={`${styles.stepLine} ${step.state === "done" ? styles.stepLineDone : ""}`} />
            </span>
            <span className={styles.stepLabel}>{step.label}</span>
            {step.meta && <span className={styles.stepMeta}>{step.meta}</span>}
          </li>
        );
      })}
    </ol>
  );
}
