import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";
import { aiUsage, db } from "@repo/db";

// ─── Claude ───────────────────────────────────────────────────────────────────
// The one place core talks to the Claude API (ANTHROPIC_API_KEY): uploads to
// the Files API and structured calls, each logged with its tokens and cost in
// `ai_usage`. Tests replace this module with a fake.
// ─────────────────────────────────────────────────────────────────────────────

export const MODELS = {
  reader: "claude-opus-5-5",
  writer: "claude-sonnet-5-5",
  /** Quick, cheap checks: the purchase documents' review. */
  checker: "claude-haiku-4-5-20251001",
} as const;
export type Model = (typeof MODELS)[keyof typeof MODELS];

/** US dollars per million tokens (platform.claude.com pricing, 2026-09). */
const PRICES: Record<Model, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** A call's cost in millionths of a dollar. */
export function costMicroUsd(model: Model, usage: Usage) {
  const p = PRICES[model];
  return Math.round(
    usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite,
  );
}

/** Who a call is for, for the usage log. */
export type CallContext = {
  tenantId: string;
  userId: string | null;
  projectId: string;
  /** The budget run it is part of; none for a purchase document's review. */
  generationId: string | null;
  purpose: string;
};

/** Why a call gave no usable answer; none of these are worth retrying as is. */
export class ClaudeError extends Error {
  constructor(
    readonly code: "refused" | "truncated" | "invalid_output" | "too_many_pages" | "bad_request",
    message: string,
  ) {
    super(message);
  }
}

let client: Anthropic | undefined;
const claude = () => (client ??= new Anthropic());

/** Uploads a file to the Files API; returns its id. */
export async function uploadFile(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const file = await claude().files.upload({ file: await toFile(bytes, name, { type: contentType }) });
  return file.id;
}

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/**
 * One request whose answer must match `schema`. Streams (inputs and answers
 * are long), lets Claude think adaptively at `effort`, and falls back to
 * another model on a policy refusal. API errors the SDK couldn't retry
 * (rate limits, overload) are thrown as they are, for the caller to retry.
 */
export async function structuredCall<T>(
  options: {
    model: Model;
    system: string;
    content: ContentBlock[];
    schema: z.ZodType<T>;
    /** How hard it thinks; omitted for a model without effort control (Haiku). */
    effort?: "low" | "medium" | "high";
    maxTokens?: number;
    /** Another model on a policy refusal (default); off for a quick check. */
    fallback?: boolean;
  },
  context: CallContext,
): Promise<T> {
  let message;
  try {
    message = await claude()
      .beta.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens ?? 64_000,
        system: options.system,
        messages: [{ role: "user", content: options.content }],
        output_config: { ...(options.effort ? { effort: options.effort } : {}), format: zodOutputFormat(options.schema) },
        ...(options.fallback === false ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      })
      .finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) {
      const tooLong = /page|too large|too long|prompt is too long/i.test(error.message);
      throw new ClaudeError(tooLong ? "too_many_pages" : "bad_request", error.message);
    }
    throw error;
  }

  await db.insert(aiUsage).values({
    tenantId: context.tenantId,
    userId: context.userId,
    projectId: context.projectId,
    generationId: context.generationId,
    purpose: context.purpose,
    model: options.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    costMicroUsd: costMicroUsd(options.model, message.usage),
  });

  if (message.stop_reason === "refusal") throw new ClaudeError("refused", "Claude declined the request");
  if (message.stop_reason === "max_tokens") throw new ClaudeError("truncated", "The answer was cut off");
  const parsed = message.parsed_output as T | null | undefined;
  if (parsed == null) throw new ClaudeError("invalid_output", "The answer didn't match the expected format");
  return parsed;
}
