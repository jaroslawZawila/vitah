import { afterEach, describe, expect, it, vi } from "vitest";
import { perIpLimiter, readCapped } from "./public-report";

afterEach(() => {
  vi.useRealTimers();
});

/** How many of `addresses` requests, one per address, the limiter lets through. */
const through = (allowed: (ip: string) => boolean, addresses: string[]) => addresses.filter((ip) => allowed(ip)).length;

const fresh = (count: number, prefix = "2001:db8::") => Array.from({ length: count }, (_, i) => `${prefix}${i.toString(16)}`);

describe("perIpLimiter", () => {
  it("lets each address through up to its limit in a window, then again in the next", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const allowed = perIpLimiter({ windowMs: 60_000, perIp: 3, all: 100 });

    expect(Array.from({ length: 5 }, () => allowed("203.0.113.1"))).toEqual([true, true, true, false, false]);
    expect(allowed("203.0.113.2")).toBe(true);

    vi.setSystemTime(Date.now() + 60_000);
    expect(allowed("203.0.113.1")).toBe(true);
  });

  it("caps the instance whatever the addresses", () => {
    const allowed = perIpLimiter({ windowMs: 60_000, perIp: 3, all: 5 });
    expect(through(allowed, fresh(50))).toBe(5);
  });

  it("keeps the instance's cap when a caller rotating addresses fills the table and it is forgotten", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const allowed = perIpLimiter({ windowMs: 60_000, perIp: 3, all: 5, maxTracked: 10 });

    // Twenty times the table's size in fresh addresses (an IPv6 range is enough): the table is cleared again and again.
    expect(through(allowed, fresh(200))).toBe(5);
    expect(through(allowed, fresh(200, "2001:db8:1::"))).toBe(0);

    // The next window lets the instance through again.
    vi.setSystemTime(Date.now() + 60_000);
    expect(through(allowed, fresh(20, "2001:db8:2::"))).toBe(5);
  });

  it("counts toward the instance only what an address's own window let through", () => {
    const allowed = perIpLimiter({ windowMs: 60_000, perIp: 2, all: 5 });

    // One address refused over and over uses two of the five.
    for (let i = 0; i < 100; i++) allowed("198.51.100.1");
    expect(through(allowed, fresh(10))).toBe(3);
  });
});

describe("readCapped", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/csp-report", { method: "POST", body, headers });

  it("reads a body up to the size", async () => {
    expect(await readCapped(post("hello"), 5)).toBe("hello");
  });

  it("stops at a body over the size, or one that says it is", async () => {
    expect(await readCapped(post("hello!"), 5)).toBeNull();
    expect(await readCapped(post("hi", { "content-length": "999" }), 5)).toBeNull();
  });
});
