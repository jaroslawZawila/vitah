// Just enough SQL lexing to tell whether a migration file has transaction
// control of its own (`BEGIN;` … `COMMIT;`), and to split it into its
// statements, without being fooled by the `BEGIN` of a `DO $$ … $$` block, a
// string or a comment.

/**
 * `sql` with every comment, string, quoted identifier and dollar-quoted body
 * blanked out (same length, so offsets still match).
 */
export function maskSql(sql: string): string {
  const out = sql.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (two === "/*") {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        const pair = sql.slice(j, j + 2);
        if (pair === "/*") {
          depth++;
          j += 2;
        } else if (pair === "*/") {
          depth--;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i]!;
      // E'…' strings escape with a backslash too.
      const escapes = quote === "'" && /[eE]/.test(sql[i - 1] ?? "") && !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === quote && sql[j + 1] === quote) j += 2;
        else if (sql[j] === quote) break;
        else j++;
      }
      j = Math.min(j + 1, n);
      blank(i, j);
      i = j;
    } else if (sql[i] === "$" && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80))?.[0];
      if (!tag) {
        i++;
        continue;
      }
      const close = sql.indexOf(tag, i + tag.length);
      const stop = close === -1 ? n : close + tag.length;
      blank(i, stop);
      i = stop;
    } else i++;
  }
  return out.join("");
}

export type Statement = {
  /** The statement as written, without its `;`. */
  text: string;
  /** Where it starts in the file (an offset into the text). */
  start: number;
  /** The same with comments, strings and dollar-quoted bodies blanked: what to match keywords against. */
  masked: string;
};

/**
 * The file's statements, in order: split at each `;` that isn't inside a
 * comment, a string or a dollar-quoted body. The body of a SQL-standard
 * function (`BEGIN ATOMIC … END`) has `;` of its own and stays in one piece.
 * Empty statements (blank, or only comments) are left out.
 */
export function splitStatements(sql: string): Statement[] {
  const masked = maskSql(sql);
  const statements: Statement[] = [];
  let start = 0;
  let inBody = false;
  const close = (end: number) => {
    const piece = masked.slice(start, end);
    if (piece.trim() !== "") statements.push({ text: sql.slice(start, end), start, masked: piece });
    start = end + 1;
  };
  let from = 0;
  for (;;) {
    const at = masked.indexOf(";", from);
    if (at === -1) break;
    const piece = masked.slice(from, at);
    if (inBody) {
      // The body ends at its own `END;`.
      if (/^\s*END\s*$/i.test(piece)) {
        inBody = false;
        close(at);
      }
    } else if (/\bBEGIN\s+ATOMIC\b/i.test(piece)) inBody = true;
    else close(at);
    from = at + 1;
  }
  close(masked.length);
  return statements;
}

/** A statement that opens or ends a transaction. `ROLLBACK TO` a savepoint doesn't. */
const TRANSACTION_CONTROL =
  /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT)\b(?!\s+(?:(?:WORK|TRANSACTION)\s+)?TO\b)/i;

/**
 * The file's first statement that opens or ends a transaction (`BEGIN`,
 * `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`), and its line; or
 * null. Comments, strings, `DO $$ … $$` blocks and `BEGIN ATOMIC` bodies don't count.
 */
export function transactionControl(sql: string): { keyword: string; line: number } | null {
  for (const statement of splitStatements(sql)) {
    const match = TRANSACTION_CONTROL.exec(statement.masked);
    if (!match) continue;
    const at = statement.start + match[0].length - match[0].trimStart().length;
    return { keyword: match[1]!.replace(/\s+/g, " ").toUpperCase(), line: sql.slice(0, at).split("\n").length };
  }
  return null;
}

/**
 * Whether the file has transaction control of its own at statement level
 * (a `BEGIN`, or a stray `COMMIT` that would end a transaction wrapped around
 * it).
 */
export function hasOwnTransaction(sql: string): boolean {
  return transactionControl(sql) !== null;
}

/** The first line of a migration that must not be wrapped in a transaction. */
export const NO_TRANSACTION_DIRECTIVE = "-- migrate: no-transaction";

/** Whether the file says so on its first line (and only there: further down it is a comment like any other). */
export function declaresNoTransaction(sql: string): boolean {
  const firstLine = sql.replace(/^\uFEFF/, "").split("\n", 1)[0] ?? "";
  return /^--\s*migrate:\s*no-transaction\s*$/.test(firstLine);
}
