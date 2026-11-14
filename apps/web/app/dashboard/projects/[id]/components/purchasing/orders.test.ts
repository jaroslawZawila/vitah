import { describe, expect, it } from "vitest";
import { orders } from "../../../../../../test/purchasing-fixture";
import { NO_ORDER_FILTER, contractedCents, filterOrders, groupCounts, orderGroup, toCsv } from "./orders";

describe("Compras list rules", () => {
  it("groups orders as open, not sent, closed or cancelled", () => {
    expect(orderGroup("pending")).toBe("pending");
    expect(orderGroup("ordered")).toBe("open");
    expect(orderGroup("in_transit")).toBe("open");
    expect(orderGroup("contracted")).toBe("open");
    expect(orderGroup("delivered")).toBe("done");
    expect(orderGroup("finished")).toBe("done");
    expect(orderGroup("cancelled")).toBe("cancelled");
    expect(groupCounts(orders)).toEqual({ all: 5, open: 2, pending: 1, done: 1, cancelled: 1 });
  });

  it("counts only placed orders as contracted", () => {
    // 3.120 + 7.300 + 19.860: the pending and the cancelled one don't count.
    expect(contractedCents(orders)).toBe(312_000 + 730_000 + 1_986_000);
  });

  it("filters by the pending order's creation day when it has no order date", () => {
    const filter = { ...NO_ORDER_FILTER, from: "2026-10-10" };
    expect(filterOrders(orders, filter).map((o) => o.number)).toEqual([56]);
  });

  it("writes CSV cells quoted only when they need it", () => {
    expect(toCsv(["a", "b"], [["x;y", 'dijo "sí"'], ["z", 3]], (row) => row)).toBe('a;b\r\n"x;y";"dijo ""sí"""\r\nz;3');
    // Never run as a formula by the spreadsheet; numbers stay numbers.
    expect(toCsv(["a", "b"], [['=HYPERLINK("x")', -5]], (row) => row)).toBe('a;b\r\n"\'=HYPERLINK(""x"")";-5');
  });
});
