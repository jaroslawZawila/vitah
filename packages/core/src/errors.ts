/**
 * Domain error with a stable machine-readable `code` (used as an i18n key by
 * clients) and the HTTP status the API layer should respond with.
 */
export class CoreError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "CoreError";
  }
}

export const notFound = () => new CoreError("not_found", 404);
export const forbidden = () => new CoreError("forbidden", 403);
export const invalid = (code = "invalid_input") => new CoreError(code, 400);
