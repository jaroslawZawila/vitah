"use client";

import ErrorNotice from "./components/ErrorNotice";

/** An error outside the dashboard's own boundary (its layout included): alone on a grafito page. */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorNotice {...props} page />;
}
