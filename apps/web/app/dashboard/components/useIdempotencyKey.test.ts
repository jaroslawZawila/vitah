// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIdempotencyKey } from "./useIdempotencyKey";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Submits through the hook and tells which key the action was sent. */
function setup() {
  const { result, rerender } = renderHook(() => useIdempotencyKey());
  const keys: string[] = [];
  const submit = (submission: unknown, answer: { success?: boolean; error?: string } | null | Error = { success: true }) =>
    act(() =>
      result.current.submit(submission, async (idempotencyKey) => {
        keys.push(idempotencyKey);
        if (answer instanceof Error) throw answer;
        return answer;
      }),
    );
  return { keys, submit, rerender, result };
}

describe("useIdempotencyKey", () => {
  it("gives the action a UUID, and answers what the action answered", async () => {
    const { keys, submit } = setup();
    expect(await submit({ amount: 1 }, { success: true })).toEqual({ success: true });
    expect(await submit({ amount: 1 }, { error: "exceeds_amount" })).toEqual({ error: "exceeds_amount" });
    expect(keys[0]).toMatch(UUID);
  });

  it("takes a new key after a success: the next submission is another create", async () => {
    const { keys, submit } = setup();
    await submit({ amount: 1 });
    await submit({ amount: 1 });
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("keeps the key across re-renders and for the same form sent again after an error", async () => {
    const { keys, submit, rerender } = setup();
    await submit({ amount: 1 }, { error: "exceeds_amount" });
    rerender();
    await submit({ amount: 1 }, { error: "exceeds_amount" });
    await submit({ amount: 1 }, null);
    await submit({ amount: 1 });
    expect(new Set(keys).size).toBe(1);
  });

  it("takes a new key when the form has changed since an error the server answered", async () => {
    const { keys, submit } = setup();
    await submit({ amount: 1, file: new File(["a"], "a.pdf", { lastModified: 1 }) }, { error: "invalid_input" });
    await submit({ amount: 2, file: new File(["a"], "a.pdf", { lastModified: 1 }) }, { error: "invalid_input" });
    // The same fields with another file is another submission too.
    await submit({ amount: 2, file: new File(["bb"], "b.pdf", { lastModified: 2 }) }, { error: "invalid_input" });
    // And unchanged, the same one.
    await submit({ amount: 2, file: new File(["bb"], "b.pdf", { lastModified: 2 }) });
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).toBe(keys[2]);
  });

  it("keeps the key when no answer came, even if the form changes: the server tells whether it was applied", async () => {
    const { keys, submit } = setup();
    await expect(submit({ amount: 1 }, new Error("network"))).rejects.toThrow("network");
    await submit({ amount: 2 }, { error: "idempotency_key_reused" });
    expect(keys[1]).toBe(keys[0]);
    // Refused now, as it stands; changed again, it is a new submission.
    await submit({ amount: 2 }, { error: "idempotency_key_reused" });
    await submit({ amount: 3 });
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("sends the same key for the same click twice, and a new one once both are answered", async () => {
    const { keys, result } = setup();
    const answers: ((answer: { success: boolean }) => void)[] = [];
    const send = vi.fn((idempotencyKey: string) => {
      keys.push(idempotencyKey);
      return new Promise<{ success: boolean }>((resolve) => answers.push(resolve));
    });

    const both = Promise.all([result.current.submit({ amount: 1 }, send), result.current.submit({ amount: 1 }, send)]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    answers.forEach((answer) => answer({ success: true }));
    await both;

    const next = result.current.submit({ amount: 1 }, send);
    answers[2]!({ success: true });
    await next;
    expect(keys[2]).not.toBe(keys[0]);
  });
});
