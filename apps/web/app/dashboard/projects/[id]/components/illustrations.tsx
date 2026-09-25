import styles from "./EmptyState.module.css";

// Line drawings for the empty states, in the brand's thin-stroke style.
// Decorative: the empty state's heading says what they mean.

const svgProps = {
  viewBox: "0 0 160 120",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: styles.illustration,
  "aria-hidden": true,
} as const;

/** An empty folder with a spider dangling into it. */
export function EmptyFolder() {
  return (
    <svg {...svgProps}>
      <path d="M24 56V38a4 4 0 0 1 4-4h26l8 8h56a4 4 0 0 1 4 4v10" />
      <path d="M84 4v36" strokeWidth={1.2} strokeDasharray="2 3" />
      <path
        d="M79 42l-6-4M79 46h-7M79 49l-6 4M89 42l6-4M89 46h7M89 49l6 4"
        strokeWidth={1.5}
      />
      <ellipse cx="84" cy="46" rx="5" ry="6" fill="currentColor" />
      <circle cx="82" cy="48" r="1.2" stroke="none" className={styles.solid} />
      <circle cx="86" cy="48" r="1.2" stroke="none" className={styles.solid} />
      <path
        d="M16 60a4 4 0 0 1 4-4h112a4 4 0 0 1 4 4l-6 38a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4Z"
        className={styles.solid}
      />
    </svg>
  );
}

/** A camera fast asleep: its lens is a snoozing face. */
export function SleepingCamera() {
  return (
    <svg {...svgProps}>
      <path d="M22 44a6 6 0 0 1 6-6h18l6-10h32l6 10h18a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6Z" />
      <path d="M30 32h10" />
      <rect x="100" y="46" width="10" height="6" rx="2" />
      <circle cx="68" cy="68" r="20" />
      <circle cx="68" cy="68" r="14" strokeWidth={1.2} />
      <path d="M59 66q3 3 6 0M71 66q3 3 6 0M65 75q3 2 6 0" strokeWidth={1.5} />
      <path d="M112 22h7l-7 8h7M126 10h5l-5 6h5M134 30h4l-4 5h4" strokeWidth={1.5} />
    </svg>
  );
}
