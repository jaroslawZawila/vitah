import type { MobilePhoto } from "@repo/core/contract";
import { groupByWeek } from "../lib/photo-weeks";

const photo = (id: string, uploadedAt: string): MobilePhoto => ({
  id,
  caption: null,
  sizeBytes: 1,
  uploadedAt,
});

describe("groupByWeek", () => {
  it("groups photos by ISO week, newest week first, keeping their order", () => {
    const weeks = groupByWeek([
      photo("a", "2026-09-24T10:00:00.000Z"), // Thu, week 39
      photo("b", "2026-09-21T08:00:00.000Z"), // Mon, week 39
      photo("c", "2026-09-08T10:00:00.000Z"), // Tue, week 37
    ]);

    expect(weeks).toEqual([
      {
        key: "2026-W39",
        week: 39,
        photos: [expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })],
      },
      {
        key: "2026-W37",
        week: 37,
        photos: [expect.objectContaining({ id: "c" })],
      },
    ]);
  });

  it("uses Spain's calendar day", () => {
    // Sunday 23:30 UTC is already Monday — the next week — in Madrid.
    const [week] = groupByWeek([photo("a", "2026-09-20T23:30:00.000Z")]);
    expect(week?.week).toBe(39);
  });

  it("keeps the same week number of different years apart", () => {
    const weeks = groupByWeek([
      photo("a", "2027-09-22T10:00:00.000Z"),
      photo("b", "2026-09-23T10:00:00.000Z"),
    ]);
    expect(weeks.map((w) => w.key)).toEqual(["2027-W38", "2026-W39"]);
  });

  it("puts the first days of January in the previous year's last week when ISO does", () => {
    const [week] = groupByWeek([photo("a", "2027-01-01T12:00:00.000Z")]);
    expect(week?.key).toBe("2026-W53");
  });

  it("returns no weeks without photos", () => {
    expect(groupByWeek([])).toEqual([]);
  });
});
