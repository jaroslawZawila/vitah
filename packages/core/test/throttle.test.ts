import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, loginAttempts, sql } from "@repo/db";
import { resetDatabase } from "@repo/db/testing";
import { setSweepDraw, SWEEP_ONE_IN, type Random } from "../src/sweep";
import { countSignIn as countAttempt, overLimit as overKeyLimit, SIGN_IN_LIMITS, THROTTLE_WINDOW_MS, type ThrottleKey } from "../src/throttle";

// The counters of the sign-in throttle, without passwords: `fail` is an
// attempt whose password was wrong (or refused unchecked), `succeed` one whose
// password was right. @repo/auth's credentials tests run them with real ones.

const EMAIL = "ana@example.com";

// The attempt's draw for the sweep of expired windows (1 in SWEEP_ONE_IN).
const SWEEP: Random = () => 0;
const NO_SWEEP: Random = () => 1;
/** What the attempts below draw: set by each suite. */
let random = NO_SWEEP;

/** An attempt that draws `draw` for the sweep (./sweep.ts takes it from its module, not from its callers). */
function countSignIn(scope: string, email: string, ip: string | undefined, draw: Random = random) {
  setSweepDraw(draw);
  return countAttempt(scope, email, ip);
}

function overLimit(keys: ThrottleKey[], draw: Random = random) {
  setSweepDraw(draw);
  return overKeyLimit(keys);
}

/** Whether the attempt was let through to the password check. */
async function fail(ip: string | undefined, email = EMAIL, scope = "portal") {
  return !(await countSignIn(scope, email, ip, random)).blocked;
}

async function succeed(ip: string | undefined, email = EMAIL, scope = "portal") {
  const attempt = await countSignIn(scope, email, ip, random);
  if (!attempt.blocked) await attempt.succeeded();
  return !attempt.blocked;
}

async function failTimes(times: number, ip: string | undefined, email = EMAIL) {
  for (let i = 0; i < times; i++) await fail(ip, email);
}

const otherIp = (i: number) => `10.0.${i >> 8}.${i & 255}`;

/** What a counter holds: `kind` is pair, ip, email or noip, `parts` what its key is made of. */
async function failuresOf(kind: string, ...parts: string[]) {
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.key, `signin-${kind}:${JSON.stringify(parts)}`));
  return row?.failures ?? 0;
}

beforeEach(resetDatabase);
afterEach(() => setSweepDraw());

// The limits are the same whether an attempt sweeps or not.
describe.each([
  ["no attempt sweeping", NO_SWEEP],
  ["every attempt sweeping", SWEEP],
])("countSignIn, %s", (_name, draw) => {
  beforeEach(() => {
    random = draw;
  });

  it("lets an IP fail 10 times for an email, then refuses it, the right password included", async () => {
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp; i++) expect(await fail("6.6.6.6")).toBe(true);

    expect(await fail("6.6.6.6")).toBe(false);
    expect(await succeed("6.6.6.6")).toBe(false);
    // Only that IP for that email, in that scope.
    expect(await succeed("1.2.3.4")).toBe(true);
    expect(await fail("6.6.6.6", "bob@example.com")).toBe(true);
    expect(await fail("6.6.6.6", EMAIL, "mobile")).toBe(true);
  });

  it("refuses for the rest of the window only, however much the IP keeps trying", async () => {
    await failTimes(SIGN_IN_LIMITS.emailFromIp + 50, "6.6.6.6");
    expect(await succeed("6.6.6.6")).toBe(false);

    await db.update(loginAttempts).set({ windowStart: new Date(Date.now() - THROTTLE_WINDOW_MS - 1000) });

    expect(await succeed("6.6.6.6")).toBe(true);
  });

  it("never locks an email's owner out over failures from other IPs", async () => {
    // Well past the email's own limit, from addresses that each stay within theirs.
    const guessers = 2 * (SIGN_IN_LIMITS.email / SIGN_IN_LIMITS.emailFromIp);
    for (let i = 0; i < guessers; i++) await failTimes(SIGN_IN_LIMITS.emailFromIp, otherIp(i));

    expect(await succeed("1.2.3.4")).toBe(true);
    // And again: their own sign-ins don't add up either.
    expect(await succeed("1.2.3.4")).toBe(true);
  });

  it("gives each IP 3 failures instead of 10 while the email is under attack", async () => {
    await failTimes(2, "1.2.3.4");
    const guessers = SIGN_IN_LIMITS.email / SIGN_IN_LIMITS.emailFromIp + 1;
    for (let i = 0; i < guessers; i++) await failTimes(SIGN_IN_LIMITS.emailFromIp, otherIp(i));

    // A new guesser gets 3, not 10.
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIpUnderAttack; i++) expect(await fail("7.7.7.7")).toBe(true);
    expect(await fail("7.7.7.7")).toBe(false);
    // The owner had 2 of their own: one more, then they are over their own allowance.
    expect(await fail("1.2.3.4")).toBe(true);
    expect(await succeed("1.2.3.4")).toBe(false);
    // Other emails are not under attack.
    await failTimes(SIGN_IN_LIMITS.emailFromIp, "7.7.7.7", "bob@example.com");
    expect(await fail("7.7.7.7", "bob@example.com")).toBe(false);
  });

  it("refuses an IP altogether after 100 failures across emails", async () => {
    for (let i = 0; i < SIGN_IN_LIMITS.ip; i++) await fail("9.9.9.9", `guess-${i}@example.com`);

    expect(await succeed("9.9.9.9")).toBe(false);
    expect(await succeed("8.8.8.8")).toBe(true);
  });

  it("counts failures only: any number of right passwords from an IP is fine", async () => {
    for (let i = 0; i < SIGN_IN_LIMITS.ip + 5; i++) expect(await succeed("5.5.5.5")).toBe(true);

    expect(await db.select().from(loginAttempts)).toSatisfy((rows: { failures: number }[]) =>
      rows.every((row) => row.failures === 0),
    );
  });

  it("forgets an IP's failures for the email once it signs in, but not its guessing at others", async () => {
    await failTimes(SIGN_IN_LIMITS.emailFromIp - 1, "5.5.5.5");
    expect(await succeed("5.5.5.5")).toBe(true);
    await failTimes(SIGN_IN_LIMITS.emailFromIp - 1, "5.5.5.5");
    expect(await succeed("5.5.5.5")).toBe(true);

    // An account of its own doesn't buy an IP unlimited guesses elsewhere.
    for (let i = 0; i < SIGN_IN_LIMITS.ip; i++) {
      await fail("5.5.5.5", `guess-${i}@example.com`);
      if (i % 9 === 0) await succeed("5.5.5.5");
    }
    expect(await succeed("5.5.5.5")).toBe(false);
  });

  it("counts parallel attempts too", async () => {
    const results = await Promise.all(
      Array.from({ length: 3 * SIGN_IN_LIMITS.emailFromIp }, () => fail("7.7.7.7")),
    );

    expect(results.filter(Boolean)).toHaveLength(SIGN_IN_LIMITS.emailFromIp);
  });

  it("doesn't count an attempt the IP's own limit refused against the email: one address can't put it under attack", async () => {
    // Ten are checked; the other 140 are refused unchecked.
    await failTimes(SIGN_IN_LIMITS.email + 50, "6.6.6.6");

    expect(await failuresOf("email", "portal", EMAIL)).toBe(SIGN_IN_LIMITS.emailFromIp);
    // Everyone else still has their ten, not three.
    await failTimes(SIGN_IN_LIMITS.emailFromIp - 1, "7.7.7.7");
    expect(await succeed("7.7.7.7")).toBe(true);
  });

  it("doesn't count an attempt from an IP refused altogether against the email it names", async () => {
    for (let i = 0; i < SIGN_IN_LIMITS.ip; i++) await fail("9.9.9.9", `guess-${i}@example.com`);

    await failTimes(SIGN_IN_LIMITS.email + 5, "9.9.9.9");

    expect(await failuresOf("email", "portal", EMAIL)).toBe(0);
    expect(await failuresOf("email", "portal", "guess-0@example.com")).toBe(1);
  });

  it("counts only checked failures while the email is under attack too", async () => {
    const guessers = SIGN_IN_LIMITS.email / SIGN_IN_LIMITS.emailFromIp;
    for (let i = 0; i < guessers; i++) await failTimes(SIGN_IN_LIMITS.emailFromIp, otherIp(i));
    expect(await failuresOf("email", "portal", EMAIL)).toBe(SIGN_IN_LIMITS.email);

    // Three checked, seven refused.
    await failTimes(SIGN_IN_LIMITS.emailFromIp, "7.7.7.7");

    expect(await failuresOf("email", "portal", EMAIL)).toBe(SIGN_IN_LIMITS.email + SIGN_IN_LIMITS.emailFromIpUnderAttack);
  });

  it("without an IP, doesn't let ten junk attempts lock the owner out: the callers share the email-wide 100", async () => {
    await failTimes(SIGN_IN_LIMITS.emailFromIp + 5, undefined);
    expect(await succeed(undefined)).toBe(true);

    // The right password took only its own attempt back: the shared counter isn't the caller's to clear.
    expect(await failuresOf("noip", "portal", EMAIL)).toBe(SIGN_IN_LIMITS.emailFromIp + 5);
    await failTimes(SIGN_IN_LIMITS.email - SIGN_IN_LIMITS.emailFromIp - 5, undefined);
    expect(await succeed(undefined)).toBe(false);
    // That email, without an IP, and nobody else.
    expect(await succeed(undefined, "bob@example.com")).toBe(true);
    expect(await succeed(undefined, EMAIL, "mobile")).toBe(true);
    expect(await succeed("1.2.3.4")).toBe(true);
    // No per-IP row was ever written for them.
    expect((await db.select().from(loginAttempts)).filter((row) => /^signin-(pair|ip):/.test(row.key) && row.key.includes('""'))).toEqual([]);
  });

  it("without an IP, counts checked failures email-wide like any other, and refused ones not", async () => {
    await failTimes(SIGN_IN_LIMITS.email + 30, undefined);

    expect(await failuresOf("email", "portal", EMAIL)).toBe(SIGN_IN_LIMITS.email);
    // So the email is under attack for the callers that do have an IP: three each.
    await failTimes(SIGN_IN_LIMITS.emailFromIpUnderAttack, "7.7.7.7");
    expect(await succeed("7.7.7.7")).toBe(false);
  });

  it("can't be made to count against another email or IP by what is typed as the email", async () => {
    // Would-be spellings of the keys of (ana@example.com, 1.2.3.4).
    const forged = [
      `${EMAIL}:1.2.3.4`,
      `${EMAIL}","1.2.3.4`,
      `${EMAIL}","1.2.3.4"]`,
      `["portal","${EMAIL}","1.2.3.4"]`,
    ];
    for (const email of forged) {
      await failTimes(SIGN_IN_LIMITS.emailFromIp + 1, undefined, email);
      await failTimes(SIGN_IN_LIMITS.emailFromIp + 1, "6.6.6.6", email);
    }

    await failTimes(SIGN_IN_LIMITS.emailFromIp - 1, "1.2.3.4");
    expect(await succeed("1.2.3.4")).toBe(true);
  });

  it("takes an absurdly long email without failing", async () => {
    const email = `${"a".repeat(10_000)}@example.com`;

    expect(await fail("1.2.3.4", email)).toBe(true);
  });
});

describe("the sweep of expired windows", () => {
  const expired = () => new Date(Date.now() - THROTTLE_WINDOW_MS - 1000);
  const rows = (key: string) => db.select().from(loginAttempts).where(eq(loginAttempts.key, key));

  /** Two keys nobody is trying any more: one whose window ended, one still open. */
  async function leftovers() {
    await db.insert(loginAttempts).values([
      { key: "old", failures: 7, windowStart: expired() },
      { key: "open", failures: 7, windowStart: new Date() },
    ]);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the expired windows when an attempt draws it, and only those", async () => {
    await leftovers();

    expect((await countSignIn("portal", EMAIL, "1.2.3.4", SWEEP)).blocked).toBe(false);

    // Done by the time the attempt answers: nothing is left running behind it.
    expect(await rows("old")).toHaveLength(0);
    expect(await rows("open")).toHaveLength(1);
    expect(await db.select().from(loginAttempts)).toHaveLength(4);
  });

  it("sweeps for a throttled key of any kind", async () => {
    await leftovers();

    expect(await overLimit([{ key: "password:u-1", limit: 5 }], SWEEP)).toBe(false);

    expect(await rows("old")).toHaveLength(0);
  });

  it("is waited for: the attempt answers only once the sweep has finished", async () => {
    await leftovers();
    const realDelete = db.delete.bind(db);
    let finished = false;
    vi.spyOn(db, "delete").mockImplementation(((table: never) => {
      const query = realDelete(table);
      return {
        where: async (condition: never) => {
          await new Promise((done) => setTimeout(done, 150));
          await query.where(condition);
          finished = true;
        },
      };
    }) as never);

    await countSignIn("portal", EMAIL, "1.2.3.4", SWEEP);

    expect(finished).toBe(true);
  });

  it("leaves a row another statement holds for the next sweep, instead of waiting for it", async () => {
    await leftovers();
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    let locked = () => {};
    const isLocked = new Promise<void>((done) => (locked = done));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from login_attempts where key = 'old' for update`);
      locked();
      await held;
    });
    await isLocked;

    try {
      expect((await countSignIn("portal", EMAIL, "1.2.3.4", SWEEP)).blocked).toBe(false);
      expect(await rows("old")).toHaveLength(1);
    } finally {
      release();
      await holder;
    }

    await countSignIn("portal", EMAIL, "1.2.3.4", SWEEP);
    expect(await rows("old")).toHaveLength(0);
  });

  it("issues no delete on an attempt that doesn't draw it", async () => {
    await leftovers();
    const deletes = vi.spyOn(db, "delete");

    expect((await countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP)).blocked).toBe(false);
    expect(await overLimit([{ key: "password:u-1", limit: 5 }], NO_SWEEP)).toBe(false);

    expect(deletes).not.toHaveBeenCalled();
    expect(await rows("old")).toHaveLength(1);
  });

  it("is drawn by one attempt in 50", async () => {
    await leftovers();
    const deletes = vi.spyOn(db, "delete");

    await countSignIn("portal", EMAIL, "1.2.3.4", () => 1 / SWEEP_ONE_IN);
    expect(deletes).not.toHaveBeenCalled();
    await countSignIn("portal", EMAIL, "1.2.3.4", () => 1 / SWEEP_ONE_IN - 0.0001);
    expect(deletes).toHaveBeenCalledTimes(1);
    expect(SWEEP_ONE_IN).toBe(50);
  });

  it("never fails the attempt: a sweep that fails is logged", async () => {
    const boom = new Error("connection lost");
    vi.spyOn(db, "delete").mockReturnValue({ where: () => Promise.reject(boom) } as never);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await countSignIn("portal", EMAIL, "1.2.3.4", SWEEP)).blocked).toBe(false);

    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logged.mock.calls[0]![0] as string)).toMatchObject({
      level: "error",
      event: "throttle.sweep_failed",
      error: { message: "connection lost" },
    });
  });

  it("still counts on a key whose expired window was never swept", async () => {
    await db.insert(loginAttempts).values({ key: "password:u-1", failures: 99, windowStart: expired() });

    expect(await overLimit([{ key: "password:u-1", limit: 1 }], NO_SWEEP)).toBe(false);
    expect(await rows("password:u-1")).toMatchObject([{ failures: 1 }]);
  });
});

describe("the counters of a correct sign-in", () => {
  /** What Postgres answers the statement it aborts to break a deadlock, as the ORM hands it on. */
  const deadlock = () => new Error("Failed query", { cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }) });
  const logged = () => vi.mocked(console.error).mock.calls.map((call) => JSON.parse(call[0] as string) as { event: string });

  beforeEach(() => {
    random = NO_SWEEP;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never deadlock with failing attempts for the same email and IP, sweeps included", async () => {
    // Expired rows of the same keys' neighbours, so the sweeps have something to take.
    const expired = new Date(Date.now() - THROTTLE_WINDOW_MS - 1000);
    const errors: unknown[] = [];
    const settle = (attempt: Promise<unknown>) => attempt.catch((error: unknown) => errors.push(error));

    for (let round = 0; round < 100; round++) {
      await db
        .insert(loginAttempts)
        .values(Array.from({ length: 6 }, (_, i) => ({ key: `signin-old:${round}-${i}`, failures: 3, windowStart: expired })));
      random = round % 2 === 0 ? SWEEP : NO_SWEEP;
      await Promise.all([
        settle(succeed("1.2.3.4")),
        settle(fail("1.2.3.4")),
        settle(succeed("1.2.3.4")),
        settle(fail("1.2.3.4")),
        settle(fail("1.2.3.4", "bob@example.com")),
        settle(succeed("5.5.5.5")),
        settle(fail("5.5.5.5")),
        settle(succeed("1.2.3.4")),
      ]);
      // A fresh allowance for the next round: this is about locks, not limits.
      await db.delete(loginAttempts).where(eq(loginAttempts.key, `signin-pair:${JSON.stringify(["portal", EMAIL, "1.2.3.4"])}`));
    }

    expect(errors).toEqual([]);
    expect(logged()).toEqual([]);
  }, 60_000);

  it("are tried again when the database aborts the count, and the attempt is counted once", async () => {
    const realInsert = db.insert.bind(db);
    vi.spyOn(db, "insert")
      .mockImplementationOnce(() => {
        throw deadlock();
      })
      .mockImplementation(realInsert as never);

    expect(await fail("1.2.3.4")).toBe(true);

    expect(await failuresOf("pair", "portal", EMAIL, "1.2.3.4")).toBe(1);
    expect(await failuresOf("ip", "1.2.3.4")).toBe(1);
    expect(await failuresOf("email", "portal", EMAIL)).toBe(1);
    expect(logged()).toEqual([]);
  });

  it("let the sign-in through, logged, when the count is aborted twice", async () => {
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw deadlock();
    });

    const attempt = await countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP);
    expect(attempt.blocked).toBe(false);
    await expect(attempt.succeeded()).resolves.toBeUndefined();

    // The caller's own count, then the email's.
    expect(logged()).toMatchObject([
      { level: "error", event: "throttle.count_failed", error: { code: "40P01" } },
      { level: "error", event: "throttle.count_failed", error: { code: "40P01" } },
    ]);
  });

  it("still fail the attempt when the database can't count at all", async () => {
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("connection lost");
    });

    await expect(countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP)).rejects.toThrow("connection lost");
  });

  it("never fail it afterwards: counters that can't be put right are logged", async () => {
    await failTimes(3, "1.2.3.4");
    const attempt = await countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP);
    vi.spyOn(db, "update").mockImplementation(() => {
      throw deadlock();
    });

    await expect(attempt.succeeded()).resolves.toBeUndefined();

    expect(logged()).toMatchObject([{ level: "error", event: "throttle.success_failed", error: { code: "40P01" } }]);
  });

  it("take the rows of the one several-row statement in key order, whoever asks", async () => {
    const realInsert = db.insert.bind(db);
    const written: string[][] = [];
    vi.spyOn(db, "insert").mockImplementation(((table: never) => {
      const query = realInsert(table);
      return {
        values: (rows: { key: string }[]) => {
          written.push(rows.map((row) => row.key));
          return query.values(rows as never);
        },
      };
    }) as never);

    await fail("1.2.3.4");
    await overLimit([{ key: "b" }, { key: "c" }, { key: "a" }].map((k) => ({ ...k, limit: 5 })), NO_SWEEP);

    for (const keys of written) expect(keys).toEqual([...keys].sort());
    // The caller's own two rows at once; the email's by itself.
    expect(written.map((keys) => keys.length)).toEqual([2, 1, 3]);
  });

  it("write one row per statement once the password was right, the IP's pair first", async () => {
    const attempt = await countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP);
    const deletes = vi.spyOn(db, "delete");
    const updates = vi.spyOn(db, "update");

    await attempt.succeeded();

    expect(deletes).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(deletes.mock.invocationCallOrder[0]!).toBeLessThan(updates.mock.invocationCallOrder[0]!);
    expect(await db.select().from(loginAttempts)).toSatisfy((rows: { failures: number }[]) => rows.length === 2 && rows.every((row) => row.failures === 0));
  });
});

// The portal's two-step verification: the password was right, the code is still to come.
describe("an attempt withdrawn (right password, second step to come)", () => {
  beforeEach(() => {
    random = NO_SWEEP;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function withdraw(ip: string | undefined) {
    const attempt = await countSignIn("portal", EMAIL, ip, NO_SWEEP);
    if (!attempt.blocked) await attempt.withdrawn();
    return !attempt.blocked;
  }

  it("counts for nothing: any number of them leaves every counter where it was", async () => {
    await failTimes(3, "1.2.3.4");
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp + 5; i++) expect(await withdraw("1.2.3.4")).toBe(true);

    expect(await failuresOf("pair", "portal", EMAIL, "1.2.3.4")).toBe(3);
    expect(await failuresOf("ip", "1.2.3.4")).toBe(3);
    expect(await failuresOf("email", "portal", EMAIL)).toBe(3);
  });

  it("forgets nothing, unlike a sign-in that went through: failures before it still count", async () => {
    await failTimes(SIGN_IN_LIMITS.emailFromIp - 1, "1.2.3.4");
    expect(await withdraw("1.2.3.4")).toBe(true);
    expect(await fail("1.2.3.4")).toBe(true);

    // The tenth failure was the last allowed: withdrawing in between reset nothing.
    expect(await fail("1.2.3.4")).toBe(false);
    expect(await withdraw("1.2.3.4")).toBe(false);
  });

  it("without an IP, comes back off the counter those callers share and off the email's", async () => {
    await failTimes(2, undefined);
    await withdraw(undefined);

    expect(await failuresOf("noip", "portal", EMAIL)).toBe(2);
    expect(await failuresOf("email", "portal", EMAIL)).toBe(2);
  });

  it("writes one row per statement, and never fails the sign-in: counters that can't be put right are logged", async () => {
    const attempt = await countSignIn("portal", EMAIL, "1.2.3.4", NO_SWEEP);
    const updates = vi.spyOn(db, "update");
    await attempt.withdrawn();
    expect(updates).toHaveBeenCalledTimes(3);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    updates.mockImplementation(() => {
      throw new Error("connection lost");
    });
    await expect(attempt.withdrawn()).resolves.toBeUndefined();
    expect(JSON.parse(error.mock.calls[0]![0] as string)).toMatchObject({ level: "error", event: "throttle.withdraw_failed" });
  });
});
