"use client";

import ErrorNotice from "../components/ErrorNotice";

/** An error in a dashboard page: the rail stays, the workspace says what happened. */
export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorNotice {...props} />;
}
