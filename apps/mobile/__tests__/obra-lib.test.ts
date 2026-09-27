import { api } from "../lib/api";
import { formatDayMonth, formatMoney, formatMonthYear, formatShare } from "../lib/format";
import { clearHitoFiles, openHitoFile } from "../lib/hito-files";
import { currentPhaseIndex, nextPayment, paidCount, phaseName } from "../lib/obra";
import { openPdf } from "../lib/open-pdf";
import { disk, downloads } from "../test-utils/expo-file-system";
import { obra } from "../test-utils/obra-fixture";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));
jest.mock("../lib/open-pdf", () => ({ openPdf: jest.fn() }));

describe("formatMoney", () => {
  it.each([
    [7_395_383, "es", "73.953,83 €"],
    [672_308, "es", "6723,08 €"],
    [44_820_503, "es", "448.205,03 €"],
    [5, "es", "0,05 €"],
    [7_395_383, "en", "€73,953.83"],
    [672_308, "en", "€6,723.08"],
    [-150_00, "es", "−150,00 €"],
  ] as const)("%i cents in %s → %s", (cents, language, text) => {
    expect(formatMoney(cents, language)).toBe(text);
  });
});

describe("date and share formats", () => {
  it("formats calendar dates and basis points", () => {
    expect(formatDayMonth("2026-10-01", "es")).toBe("1 oct");
    expect(formatMonthYear("2027-02-05", "es")).toBe("feb 2027");
    expect(formatMonthYear("2027-02-05", "en")).toBe("Feb 2027");
    expect(formatShare(1300, "es")).toBe("13 %");
    expect(formatShare(1926, "es")).toBe("19,26 %");
    expect(formatShare(1250, "en")).toBe("12.5 %");
  });
});

describe("obra helpers", () => {
  it("finds the current phase, the next payment and the paid count", () => {
    expect(currentPhaseIndex(obra)).toBe(2);
    // Once every phase is done, the last one.
    expect(currentPhaseIndex({ ...obra, currentPhaseKey: null })).toBe(3);
    expect(nextPayment(obra)?.code).toBe("H3");
    expect(paidCount(obra)).toBe(2);
    const t = (key: string) => (key === "obra.prePhase" ? "Proyecto y licencia" : key);
    expect(phaseName(obra.phases[0]!, t as never)).toBe("Proyecto y licencia");
    expect(phaseName(obra.phases[2]!, t as never)).toBe("Envolvente estanca");
  });
});

describe("api.getObra and hito files", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
    disk.clear();
    jest.mocked(openPdf).mockReset();
  });

  it("fetches the obra with the token", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ obra: null }), { status: 200 }));
    expect(await api.getObra("tok")).toEqual({ ok: true, data: { obra: null } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/mobile\/obra$/);
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("downloads a fresh copy of a hito's PDF and opens it", async () => {
    const seen: [string, Record<string, string> | undefined][] = [];
    downloads.handler = (url, headers) => {
      seen.push([url, headers]);
      return "%PDF-new";
    };

    await openHitoFile("tok", "h3", "invoice");

    expect(seen).toEqual([[expect.stringMatching(/\/api\/mobile\/obra\/hitos\/h3\/invoice$/), { Authorization: "Bearer tok" }]]);
    const opened = jest.mocked(openPdf).mock.calls[0]![0].uri;
    expect(opened).toMatch(/^file:\/\/\/cache-dir\/hito-files\/h3-invoice-\d+\.pdf$/);
    expect(disk.get(opened)).toBe("%PDF-new");
  });

  it("leaves no partial file when the download fails, and wipes all on sign-out", async () => {
    downloads.handler = () => {
      throw new Error("offline");
    };
    await expect(openHitoFile("tok", "h3", "acta")).rejects.toThrow("offline");
    expect([...disk.keys()]).toEqual([]);

    disk.set("file:///cache-dir/hito-files/h3-acta-1.pdf", "%PDF-");
    clearHitoFiles();
    expect(disk.size).toBe(0);
  });
});
