"use client";

import { useRef } from "react";

/** What a create's server action answers: `success`, or an error code. */
type Answer = { success?: boolean } | null | undefined;

/** What tells one submission from another: its fields, and a file by its name, size and date. */
const fingerprint = (submission: unknown) =>
  JSON.stringify(submission, (_name, value: unknown) => (value instanceof File ? [value.name, value.size, value.lastModified] : value));

type Attempt = { key: string; refused?: string };

/**
 * The idempotency key of a form that creates a record: the server applies a
 * create once per key (packages/core/src/idempotency.ts), so a double click or
 * a request sent again can't make two payments or two orders.
 *
 * `submit(submission, send)` gives `send` the key to put in the action's input
 * (`idempotencyKey`). The form has one key from its first submit, and keeps it:
 * - while a submission is on its way, so the same click twice is one create;
 * - after an answer that never came (the action threw: applied or not, nobody
 *   knows), so sending again can't apply it twice;
 * - after an error the server answered (nothing was applied, the key is free)
 *   for as long as the form is sent again as it was.
 * It takes a new one after a success, and when the form sent has changed since
 * an error the server answered: that is another submission.
 */
export function useIdempotencyKey() {
  // Not state: a new key changes nothing on screen.
  const current = useRef<Attempt | null>(null);

  async function submit<S extends Answer>(submission: unknown, send: (idempotencyKey: string) => Promise<S>): Promise<S> {
    const sent = fingerprint(submission);
    let attempt = current.current;
    if (!attempt || (attempt.refused !== undefined && attempt.refused !== sent)) {
      attempt = current.current = { key: crypto.randomUUID() };
    }
    const answer = await send(attempt.key);
    // Unless another submission has moved on meanwhile (the same click twice, both answered).
    if (current.current === attempt) current.current = answer?.success ? null : { key: attempt.key, refused: sent };
    return answer;
  }

  return { submit };
}
