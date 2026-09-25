// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WizardStep } from "./types";
import { useWizard } from "./useWizard";

type Draft = { name: string; style: string };

const Noop = () => null;
const steps: WizardStep<Draft>[] = [
  {
    id: "name",
    titleKey: "name",
    Component: Noop,
    Summary: Noop,
    isComplete: (d) => d.name !== "",
    errorCodes: ["name_taken"],
  },
  { id: "style", titleKey: "style", Component: Noop, Summary: Noop, isComplete: (d) => d.style !== "" },
];

function setup() {
  return renderHook(() => useWizard(steps, { name: "", style: "" }));
}

describe("useWizard", () => {
  it("starts on the first step", () => {
    const { result } = setup();

    expect(result.current.position).toBe(0);
    expect(result.current.step?.id).toBe("name");
    expect(result.current.isFirst).toBe(true);
    expect(result.current.isReview).toBe(false);
  });

  it("does not move past an incomplete step", () => {
    const { result } = setup();

    act(() => result.current.next());

    expect(result.current.position).toBe(0);
  });

  it("merges draft updates and walks through to the review", () => {
    const { result } = setup();

    act(() => result.current.update({ name: "Casa" }));
    act(() => result.current.next());
    act(() => result.current.update({ style: "nordic" }));
    act(() => result.current.next());

    expect(result.current.draft).toEqual({ name: "Casa", style: "nordic" });
    expect(result.current.isReview).toBe(true);
    expect(result.current.step).toBeNull();
  });

  it("goes back and jumps only to reachable positions", () => {
    const { result } = setup();

    act(() => result.current.goTo(2));
    expect(result.current.position).toBe(0);

    act(() => result.current.update({ name: "Casa" }));
    act(() => result.current.goTo(1));
    expect(result.current.position).toBe(1);

    act(() => result.current.back());
    expect(result.current.position).toBe(0);
  });

  it("returns to the step that owns an error code", () => {
    const { result } = setup();
    act(() => result.current.update({ name: "Casa", style: "nordic" }));
    act(() => result.current.goTo(2));

    let matched = false;
    act(() => {
      matched = result.current.goToError("name_taken");
    });

    expect(matched).toBe(true);
    expect(result.current.position).toBe(0);
    act(() => {
      matched = result.current.goToError("unknown");
    });
    expect(matched).toBe(false);
  });
});
