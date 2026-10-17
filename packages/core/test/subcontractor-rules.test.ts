import { describe, expect, it } from "vitest";
import {
  MANDATORY_COMPANY_REQUIREMENTS,
  SUBCONTRACTOR_REQUIREMENTS,
  addMonths,
  alertDays,
  companyStatus,
  daysBetween,
  defaultExpiry,
  docState,
  isValidCif,
  isValidDni,
  isValidNie,
  lowPermanentShare,
  maskIdNumber,
  normalizeIdNumber,
  provinceForPostalCode,
  requiredTrainings,
  workerAccess,
  type DocFacts,
  type WorkerAccessInput,
} from "../src/contract";
import { todayInSpain } from "../src/obra-calc";

// The pure CAE rules (src/subcontractor-rules.ts): no database.

const TODAY = "2026-10-17";
const valid: DocFacts = { status: "validated", expiresAt: null };
const validUntil = (expiresAt: string): DocFacts => ({ status: "validated", expiresAt });
const docs = (entries: Record<string, DocFacts>) => new Map(Object.entries(entries));
const allCompanyDocs = () => docs(Object.fromEntries(MANDATORY_COMPANY_REQUIREMENTS.map((r) => [r.id, valid])));

describe("requirements", () => {
  it("have stable, unique ids", () => {
    const ids = SUBCONTRACTOR_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MANDATORY_COMPANY_REQUIREMENTS.map((r) => r.id)).toEqual([
      "rea_subcontrata",
      "cert_aeat_contratistas",
      "cert_tgss",
      "poliza_rc_subcontrata",
      "concierto_spa",
      "evaluacion_riesgos",
      "rnt_mensual",
    ]);
  });

  it("expire after their validity from the issue date", () => {
    expect(defaultExpiry("rea_subcontrata", "2025-05-12")).toBe("2028-05-12");
    expect(defaultExpiry("cert_aeat_contratistas", "2025-10-09")).toBe("2026-10-09");
    expect(defaultExpiry("cert_tgss", "2026-10-16")).toBe("2026-11-16");
    expect(defaultExpiry("evaluacion_riesgos", "2026-01-14")).toBeNull();
  });

  it("clamps to the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("warn a week before for monthly documents, a month before for the rest", () => {
    expect(alertDays("cert_tgss")).toBe(7);
    expect(alertDays("rnt_mensual")).toBe(7);
    expect(alertDays("poliza_rc_subcontrata")).toBe(30);
  });
});

describe("docState", () => {
  it("is missing without a document", () => {
    expect(docState("cert_tgss", undefined, TODAY)).toEqual({ state: "missing", daysLeft: null });
  });

  it("counts down inside the alert window", () => {
    expect(docState("poliza_rc_subcontrata", validUntil("2026-11-04"), TODAY)).toEqual({
      state: "expiring",
      daysLeft: 18,
    });
    expect(docState("poliza_rc_subcontrata", validUntil("2026-11-17"), TODAY).state).toBe("validated");
    // Monthly: 18 days out is not yet a warning.
    expect(docState("cert_tgss", validUntil("2026-11-04"), TODAY).state).toBe("validated");
  });

  it("is valid through its expiry date, expired the day after", () => {
    expect(docState("cert_aeat_contratistas", validUntil(TODAY), TODAY)).toEqual({ state: "expiring", daysLeft: 0 });
    expect(docState("cert_aeat_contratistas", validUntil("2026-10-09"), TODAY)).toEqual({
      state: "expired",
      daysLeft: -8,
    });
  });

  it("expires an upload still waiting for validation too", () => {
    expect(docState("cert_tgss", { status: "uploaded", expiresAt: "2026-10-01" }, TODAY).state).toBe("expired");
  });

  it("keeps requested, rejected and not-applicable as they are", () => {
    for (const status of ["requested", "rejected", "not_applicable"] as const) {
      expect(docState("doc_maquinaria", { status, expiresAt: "2026-01-01" }, TODAY).state).toBe(status);
    }
  });
});

describe("companyStatus", () => {
  it("is apta with every mandatory document validated and in date", () => {
    expect(companyStatus(allCompanyDocs(), TODAY)).toEqual({ status: "apta", expired: [], pending: [] });
  });

  it("is pendiente while something is missing or awaiting validation", () => {
    const map = allCompanyDocs();
    map.delete("evaluacion_riesgos");
    map.set("poliza_rc_subcontrata", { status: "uploaded", expiresAt: "2027-01-31" });
    expect(companyStatus(map, TODAY)).toEqual({
      status: "pendiente",
      expired: [],
      pending: ["poliza_rc_subcontrata", "evaluacion_riesgos"],
    });
  });

  it("is bloqueada once a mandatory document expires, whatever else is missing", () => {
    const map = allCompanyDocs();
    map.set("cert_aeat_contratistas", validUntil("2026-10-09"));
    map.delete("rnt_mensual");
    expect(companyStatus(map, TODAY)).toMatchObject({ status: "bloqueada", expired: ["cert_aeat_contratistas"] });
  });

  it("ignores optional documents", () => {
    const map = allCompanyDocs();
    map.set("doc_maquinaria", validUntil("2025-01-01"));
    expect(companyStatus(map, TODAY).status).toBe("apta");
  });

  it("is apta while a document is only expiring", () => {
    const map = allCompanyDocs();
    map.set("poliza_rc_subcontrata", validUntil("2026-11-04"));
    expect(companyStatus(map, TODAY).status).toBe("apta");
  });
});

describe("workerAccess", () => {
  const ready = () =>
    docs({
      alta_ss: valid,
      tpc: validUntil("2029-01-01"),
      aptitud_medica: validUntil("2027-06-06"),
      entrega_epis: valid,
      info_riesgos: valid,
    });
  const access = (input: Partial<WorkerAccessInput> = {}) =>
    workerAccess({ company: "apta", docs: ready(), roles: [], today: TODAY, ...input });
  const failing = (result: ReturnType<typeof workerAccess>) =>
    result.checks.filter((c) => !c.ok).map((c) => [c.rule, c.reasons]);

  it("lets in a worker who meets all six rules", () => {
    const result = access();
    expect(result.status).toBe("ok");
    expect(result.checks.map((c) => c.rule)).toEqual(["company", "social_security", "training", "medical", "ppe", "tasks"]);
  });

  it("is pending while the company is", () => {
    expect(access({ company: "pendiente" })).toMatchObject({ status: "pending" });
    expect(failing(access({ company: "pendiente" }))).toEqual([["company", [{ code: "company_pending" }]]]);
  });

  it("is blocked while the company is", () => {
    expect(access({ company: "bloqueada" }).status).toBe("blocked");
  });

  it("accepts the 8 h + trade training instead of a TPC", () => {
    const map = ready();
    map.delete("tpc");
    expect(failing(access({ docs: map }))).toEqual([["training", [{ code: "tpc_or_training" }]]]);
    map.set("formacion_prl_inicial", valid);
    map.set("formacion_prl_oficio", valid);
    expect(access({ docs: map }).status).toBe("ok");
  });

  it("blocks on an expired TPC without the training", () => {
    const map = ready();
    map.set("tpc", validUntil("2026-09-30"));
    const result = access({ docs: map });
    expect(result.status).toBe("blocked");
    expect(failing(result)).toEqual([["training", [{ code: "expired", requirementId: "tpc" }]]]);
  });

  it("accepts a signed waiver instead of the medical", () => {
    const map = ready();
    map.set("aptitud_medica", validUntil("2026-09-30"));
    expect(access({ docs: map }).status).toBe("blocked");
    map.set("renuncia_vigilancia_salud", valid);
    expect(access({ docs: map }).status).toBe("ok");
  });

  it("says what is missing, and that an upload still needs validating", () => {
    const map = ready();
    map.delete("entrega_epis");
    map.set("info_riesgos", { status: "uploaded", expiresAt: null });
    expect(failing(access({ docs: map }))).toEqual([
      [
        "ppe",
        [
          { code: "missing", requirementId: "entrega_epis" },
          { code: "not_validated", requirementId: "info_riesgos" },
        ],
      ],
    ]);
    expect(access({ docs: map }).status).toBe("pending");
  });

  it("asks a recurso preventivo for the 60 h course and an operator for the machine training", () => {
    expect(failing(access({ roles: ["preventive_resource", "machine_operator"] }))).toEqual([
      [
        "tasks",
        [
          { code: "missing", requirementId: "formacion_nivel_basico_60h" },
          { code: "missing", requirementId: "formacion_maquinaria" },
        ],
      ],
    ]);
  });

  it("checks the obra: PSS adhesion, book entry and the chapters' trainings", () => {
    const obra = { pssAdhesion: undefined, bookEntry: false, chapterCodes: ["05", "10"] };
    expect(failing(access({ obra }))).toEqual([
      ["company", [{ code: "missing", requirementId: "adhesion_pss" }, { code: "book_missing" }]],
      ["tasks", [{ code: "missing", requirementId: "formacion_altura" }]],
    ]);
    const map = ready();
    map.set("formacion_altura", valid);
    expect(access({ docs: map, obra: { pssAdhesion: valid, bookEntry: true, chapterCodes: ["05"] } }).status).toBe("ok");
  });

  it("lists each training once", () => {
    expect(requiredTrainings(["preventive_resource"], ["03", "05", "06"])).toEqual([
      "formacion_nivel_basico_60h",
      "formacion_altura",
      "formacion_andamios",
    ]);
  });
});

describe("identity numbers", () => {
  it("checks DNI letters", () => {
    expect(isValidDni("72145836B")).toBe(true);
    expect(isValidDni("72145836C")).toBe(false);
    expect(isValidDni("7214583B")).toBe(false);
  });

  it("checks NIE letters", () => {
    expect(isValidNie("X1234567L")).toBe(true);
    expect(isValidNie("X1234567T")).toBe(false);
    expect(isValidNie("Y0000000Z")).toBe(true);
  });

  it("checks CIF control characters by entity type", () => {
    expect(isValidCif("B39123450")).toBe(true);
    expect(isValidCif("B39123451")).toBe(false);
    expect(isValidCif("B39654322")).toBe(true);
    // Public bodies (P, Q, S…) end in a letter.
    expect(isValidCif("Q2826000H")).toBe(true);
    expect(isValidCif("Q28260008")).toBe(false);
    expect(isValidCif("I39123450")).toBe(false);
  });

  it("normalizes separators and case", () => {
    expect(normalizeIdNumber(" b-39.123 450 ")).toBe("B39123450");
  });

  it("masks for lists", () => {
    expect(maskIdNumber("72145836B")).toBe("72•••836B");
    expect(maskIdNumber("X1234567L")).toBe("X•••567L");
    expect(maskIdNumber("B39123450")).toBe("B39•••450");
  });
});

describe("Ley 32/2006", () => {
  it("warns under 30 % permanent", () => {
    expect(lowPermanentShare(12, 3)).toBe(true);
    expect(lowPermanentShare(10, 3)).toBe(false);
    expect(lowPermanentShare(null, 3)).toBeNull();
  });
});

describe("regions", () => {
  it("derives the province and REA region from the postal code", () => {
    expect(provinceForPostalCode("39300")).toEqual({ province: "Cantabria", region: "cantabria" });
    expect(provinceForPostalCode("33001")).toEqual({ province: "Asturias", region: "asturias" });
    expect(provinceForPostalCode("01001")).toEqual({ province: "Álava", region: "pais_vasco" });
    expect(provinceForPostalCode("52001")).toEqual({ province: "Melilla", region: "melilla" });
    expect(provinceForPostalCode("53001")).toBeNull();
    expect(provinceForPostalCode("3930")).toBeNull();
  });
});

describe("dates", () => {
  it("uses Spain's calendar day", () => {
    // 23:30 UTC on 31 Dec is already New Year's Day in Madrid.
    expect(todayInSpain(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(daysBetween("2026-10-17", "2026-11-04")).toBe(18);
  });
});
