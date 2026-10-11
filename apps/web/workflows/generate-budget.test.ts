import { beforeEach, describe, expect, it, vi } from "vitest";

// The pipeline is covered in packages/core; this covers how the run handles
// its steps' failures. Outside the Workflow runtime the directives are plain
// strings, so the run is an ordinary async function here.

vi.mock("@repo/core/budget-pipeline", () => {
  class GenerationStopped extends Error {}
  class GenerationFailed extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    GenerationStopped,
    GenerationFailed,
    prepareInputs: vi.fn(),
    extractProject: vi.fn(),
    generateGroup: vi.fn(),
    saveDraft: vi.fn(),
    failGeneration: vi.fn(),
    isFinal: (error: unknown) => error instanceof GenerationStopped || error instanceof GenerationFailed,
    failureOf: (error: Error & { code?: string }) => ({ code: error.code ?? "unexpected", message: error.message }),
  };
});
const pipeline = await import("@repo/core/budget-pipeline");
const { generateBudget } = await import("./generate-budget");

beforeEach(() => vi.clearAllMocks());

describe("generateBudget", () => {
  it("runs the steps in order, the first group before the others", async () => {
    await generateBudget("gen-1");

    expect(pipeline.prepareInputs).toHaveBeenCalledWith("gen-1");
    expect(pipeline.extractProject).toHaveBeenCalledWith("gen-1");
    expect(vi.mocked(pipeline.generateGroup).mock.calls.map(([, index]) => index)).toEqual([0, 1, 2, 3]);
    expect(pipeline.saveDraft).toHaveBeenCalledWith("gen-1");
    expect(pipeline.failGeneration).not.toHaveBeenCalled();
  });

  it("records a final failure with its own code and stops", async () => {
    vi.mocked(pipeline.extractProject).mockRejectedValueOnce(new pipeline.GenerationFailed("too_many_pages"));

    await generateBudget("gen-1");

    expect(vi.mocked(pipeline.failGeneration).mock.calls[0]).toEqual(["gen-1", "too_many_pages", "too_many_pages"]);
    expect(pipeline.generateGroup).not.toHaveBeenCalled();
  });

  it("records nothing of its own when the run was cancelled", async () => {
    vi.mocked(pipeline.prepareInputs).mockRejectedValueOnce(new pipeline.GenerationStopped());

    await generateBudget("gen-1");

    // Only the closing "unexpected", which core ignores for a cancelled run.
    expect(vi.mocked(pipeline.failGeneration).mock.calls.map(([, code]) => code)).toEqual(["unexpected"]);
    expect(pipeline.extractProject).not.toHaveBeenCalled();
  });

  it("calls anything else unexpected", async () => {
    vi.mocked(pipeline.saveDraft).mockRejectedValueOnce(new Error("connection reset"));

    await generateBudget("gen-1");

    expect(pipeline.failGeneration).toHaveBeenCalledWith("gen-1", "unexpected", "connection reset");
  });
});
