import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ComponentProps, ReactNode } from "react";
import {
  CONTRACT_CLAUSES,
  CONTRACT_INTRO,
  HANDOVER_DOCUMENTS,
  LOE_FOOTNOTE,
  LOE_GUARANTEES,
} from "../budget-template-texts";
import { codeRange, type BudgetPdfKind } from "../contract";
import { ofBp, perM2Cents } from "../obra-calc";
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from "./fonts";
import { fill, money, num, pct, type BudgetPdfData } from "./format";

// ─── The budget PDF ───────────────────────────────────────────────────────────
// One document, two kinds: `general` (for the client: no line items, option
// totals only, no contract) and `detailed` (everything). Section by section
// it follows the template, features/budget/PreFRAMER_Caviedes_Valdadiga_V1.pdf.
// ─────────────────────────────────────────────────────────────────────────────

Font.register({
  family: "DejaVu Sans",
  fonts: [{ src: DEJAVU_SANS }, { src: DEJAVU_SANS_BOLD, fontWeight: "bold" }],
});
// Spanish words aren't hyphenated in the template; keep them whole.
Font.registerHyphenationCallback((word) => [word]);

const AMBER = "#E8961E";
const INK = "#0D0D0D";
const TEXT = "#2B2B2B";
const MUTED = "#666666";
const ROW = "#F5F5F5";
const RULE = "#E6E6E6";
const CREAM = "#FDF3E3";

const s = StyleSheet.create({
  page: { fontFamily: "DejaVu Sans", fontSize: 8.6, color: TEXT, paddingTop: 34, paddingBottom: 72, paddingHorizontal: 34 },
  // Line height is set per style, never on the page: inherited by the fixed
  // footer it compounds on every page (react-pdf).
  footer: { position: "absolute", bottom: 22, left: 34, right: 34, backgroundColor: INK, color: "#9A9A9A", fontSize: 6.6, textAlign: "center", paddingVertical: 6, paddingHorizontal: 12 },
  band: { backgroundColor: INK, color: AMBER, fontWeight: "bold", fontSize: 12, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 10, textTransform: "uppercase" },
  chapterBand: { backgroundColor: INK, color: AMBER, fontWeight: "bold", fontSize: 9.4, paddingVertical: 7, paddingHorizontal: 10, marginTop: 12, marginBottom: 6, textTransform: "uppercase" },
  note: { lineHeight: 1.45, backgroundColor: ROW, borderLeftWidth: 3, borderLeftColor: AMBER, paddingVertical: 6, paddingHorizontal: 10, color: MUTED, fontSize: 7.4, marginBottom: 6 },
  warm: { lineHeight: 1.45, backgroundColor: CREAM, borderLeftWidth: 3, borderLeftColor: AMBER, paddingVertical: 8, paddingHorizontal: 12, fontSize: 8.2, marginTop: 8 },
  th: { flexDirection: "row", backgroundColor: INK, color: AMBER, fontWeight: "bold", fontSize: 7, paddingVertical: 3, paddingHorizontal: 3 },
  tr: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: RULE, fontSize: 7.4, lineHeight: 1.35 },
  subtotal: { flexDirection: "row", backgroundColor: CREAM, fontWeight: "bold", fontSize: 7.6, paddingVertical: 3, paddingHorizontal: 3 },
  total: { flexDirection: "row", backgroundColor: AMBER, color: "#111111", fontWeight: "bold", fontSize: 10, paddingVertical: 4, paddingHorizontal: 4 },
  right: { textAlign: "right" },
  p: { textAlign: "justify", marginBottom: 6, fontSize: 8.6, lineHeight: 1.45 },
  bold: { fontWeight: "bold" },
  h3: { fontWeight: "bold", fontSize: 10.5, marginTop: 8, marginBottom: 4 },
  bullet: { flexDirection: "row", marginBottom: 4 },
  draft: { position: "absolute", top: 360, left: 60, fontSize: 90, color: "#E8961E", opacity: 0.12, fontWeight: "bold", transform: "rotate(-30deg)" },
});

/** A table column: width as a flex factor (or fixed points), alignment. */
type Col = { w: number; fixed?: boolean; right?: boolean };
const cell = (col: Col) => [col.fixed ? { width: col.w } : { flex: col.w }, col.right ? s.right : {}];

type PdfStyle = ComponentProps<typeof View>["style"];

function Row({ cols, values, style, odd }: { cols: Col[]; values: ReactNode[]; style: PdfStyle; odd?: boolean }) {
  return (
    <View style={[...[style].flat(), odd ? { backgroundColor: ROW } : {}] as PdfStyle} wrap={false}>
      {values.map((value, i) => (
        <Text key={i} style={[...cell(cols[i]!), { paddingRight: 4 }]}>
          {value}
        </Text>
      ))}
    </View>
  );
}

function Table({ cols, head, rows }: { cols: Col[]; head: string[]; rows: ReactNode[][] }) {
  return (
    <View>
      <Row cols={cols} values={head} style={s.th} />
      {rows.map((values, i) => (
        <Row key={i} cols={cols} values={values} style={s.tr} odd={i % 2 === 0} />
      ))}
    </View>
  );
}

function Band({ children, small }: { children: ReactNode; small?: boolean }) {
  return <Text style={small ? s.chapterBand : s.band}>{children}</Text>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={{ width: 10, fontSize: 8.6 }}>•</Text>
          <Text style={{ flex: 1, textAlign: "justify", fontSize: 8.6, lineHeight: 1.45 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Lead. Rest" with the lead in bold, as the template's bullets. */
function Lead({ title, text }: { title: string; text: string }) {
  return (
    <>
      <Text style={s.bold}>{title}. </Text>
      {text}
    </>
  );
}

function Footer({ d }: { d: BudgetPdfData }) {
  const { letterhead, revision } = d;
  const ref = revision.reference ?? "";
  return (
    <>
      <View style={s.footer} fixed>
        <Text>
          {letterhead.name} · Presupuesto N.º {ref}
          {d.site ? ` — ${d.site}` : ""}
        </Text>
        <Text>
          {[letterhead.address, letterhead.phone ? `Tel. ${letterhead.phone}` : "", `Presupuesto válido ${revision.conditions.validityDays} días desde emisión`]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
      {d.draft && (
        <Text style={s.draft} fixed>
          BORRADOR
        </Text>
      )}
    </>
  );
}

function Cover({ d }: { d: BudgetPdfData }) {
  const { revision, letterhead } = d;
  const c = revision.texts.cover;
  const rows: [string, ReactNode][] = [
    ["Presupuesto n.º", `${revision.reference ?? ""} — ${d.issuedLabel} · ${revision.number === 0 ? "Primera emisión" : `Revisión ${revision.number}`}`],
    ["Promotor", c.promoter],
    ["Emplazamiento", [c.site, c.cadastral].filter(Boolean).join("\n")],
    ["Superficies", c.surfaces],
    ["Programa", c.program],
    ["Base del presupuesto", c.basis],
    ["Alcance", c.scope],
    ["Sistema constructivo", c.system],
  ];
  return (
    <View>
      <View style={{ alignItems: "center", marginTop: 20 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: INK, borderWidth: 2.5, borderColor: AMBER, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: AMBER, fontWeight: "bold", fontSize: 15, letterSpacing: 1.5 }}>{letterhead.name.split(" ")[0]!.toUpperCase()}</Text>
          {letterhead.tagline ? <Text style={{ color: "#FFFFFF", fontSize: 4.6, letterSpacing: 1 }}>{letterhead.tagline.split("·")[0]!.trim().toUpperCase()}</Text> : null}
        </View>
        <Text style={{ fontWeight: "bold", fontSize: 17, letterSpacing: 5, marginTop: 12 }}>{letterhead.name.split(" ")[0]!.toUpperCase()}</Text>
        {letterhead.tagline ? <Text style={{ color: MUTED, fontSize: 7.4, marginTop: 2 }}>{letterhead.tagline.toUpperCase()}</Text> : null}
        {letterhead.address ? <Text style={{ color: MUTED, fontSize: 7.4 }}>{letterhead.address}</Text> : null}
      </View>
      <View style={{ borderTopWidth: 1.2, borderTopColor: AMBER, marginHorizontal: 36, marginVertical: 12 }} />
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontWeight: "bold", fontSize: 17 }}>PRESUPUESTO DE CONSTRUCCIÓN</Text>
        <Text style={{ fontWeight: "bold", fontSize: 9.4, color: AMBER, marginTop: 4 }}>VIVIENDA UNIFAMILIAR STEEL FRAME — SISTEMA FRAMER</Text>
        {d.site ? <Text style={{ fontWeight: "bold", fontSize: 9.4, color: MUTED, marginTop: 3 }}>{d.site}</Text> : null}
        {d.kind === "detailed" ? <Text style={{ fontSize: 7.4, color: MUTED, marginTop: 3 }}>PRESUPUESTO DETALLADO</Text> : null}
      </View>
      <View style={{ borderTopWidth: 1.2, borderTopColor: AMBER, marginHorizontal: 36, marginVertical: 12 }} />
      <View style={{ borderWidth: 0.5, borderColor: RULE }}>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <View key={label} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE }} wrap={false}>
              <Text style={{ width: 150, backgroundColor: ROW, fontWeight: "bold", padding: 6 }}>{label}</Text>
              <Text style={{ flex: 1, padding: 6 }}>{value}</Text>
            </View>
          ))}
      </View>
      <View style={{ backgroundColor: AMBER, padding: 12, marginTop: 14, alignItems: "center" }} wrap={false}>
        <Text style={{ fontWeight: "bold", fontSize: 12.5 }}>PRESUPUESTO DE EJECUCIÓN POR CONTRATA (PEC)</Text>
        <Text style={{ fontWeight: "bold", fontSize: 15, marginTop: 2 }}>{money(revision.totalCents)} €</Text>
        <Text style={{ fontSize: 7.4, marginTop: 2 }}>
          {[d.perBuilt ? `${money(d.perBuilt)} €/m² construido` : "", "Presupuesto sin IVA", `Válido ${revision.conditions.validityDays} días desde su emisión`]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  );
}

function Justification({ d }: { d: BudgetPdfData }) {
  const { texts } = d.revision;
  return (
    <View break>
      <Band>Justificación técnica de la adaptación al sistema Steel Frame</Band>
      {texts.justification.intro ? <Text style={s.p}>{texts.justification.intro}</Text> : null}
      {texts.justification.blocks.map((block, i) => (
        <Text key={i} style={s.p}>
          <Lead title={block.title} text={block.text} />
        </Text>
      ))}
      {texts.measurementCriterion ? (
        <>
          <Text style={s.h3}>Criterio de medición adoptado</Text>
          {texts.measurementCriterion.split(/\n\s*\n/).map((para, i) => (
            <Text key={i} style={s.p}>
              {para}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

const SUMMARY_COLS: Col[] = [{ w: 44, fixed: true }, { w: 1 }, { w: 78, fixed: true, right: true }, { w: 48, fixed: true, right: true }, { w: 48, fixed: true, right: true }];

function Summary({ d }: { d: BudgetPdfData }) {
  const { revision } = d;
  const vat = revision.vatCents;
  return (
    <View break>
      <Band>Resumen por capítulos — Presupuesto de ejecución por contrata (PEC)</Band>
      <Table
        cols={SUMMARY_COLS}
        head={["Cap.", "Denominación", "Importe PEC (€)", "% PEC", "€/m²c"]}
        rows={revision.chapters.map((c) => [
          `CAP ${c.code}`,
          c.name.toUpperCase(),
          money(c.totalCents),
          pct(c.shareBp),
          d.builtAreaCm2 ? money(perM2Cents(c.totalCents, d.builtAreaCm2)!) : "—",
        ])}
      />
      <Row
        cols={[{ w: 1 }, { w: 86, fixed: true, right: true }, { w: 62, fixed: true, right: true }, { w: 56, fixed: true, right: true }]}
        values={["TOTAL PEC (sin IVA)", money(revision.totalCents), "100,00 %", d.perBuilt ? money(d.perBuilt) : "—"]}
        style={s.total}
      />
      <Text style={[s.note, { marginTop: 8 }]}>
        Presupuesto de ejecución por contrata: <Text style={{ color: AMBER, fontWeight: "bold" }}>{money(revision.totalCents)} €</Text>
        {d.perBuilt ? ` · ${money(d.perBuilt)} €/m² construido` : ""}
        {d.perUseful ? ` · ${money(d.perUseful)} €/m² útil` : ""}. IVA del {pct(revision.vatRateBp, 0)} en autopromoción de vivienda habitual: {money(vat)} € →{" "}
        <Text style={{ color: AMBER, fontWeight: "bold" }}>{money(revision.totalCents + vat)} € con IVA</Text>.
      </Text>
      <View style={s.warm} wrap={false}>
        <Text style={s.p}>
          <Text style={s.bold}>Precio ofertado con precios unitarios cerrados y fondo de imprevistos incluido.</Text> Los precios unitarios de cada partida quedan cerrados y ya incorporan los gastos generales y el beneficio industrial del contratista: cada importe del cuadro anterior es, por tanto, presupuesto de ejecución por contrata.
        </Text>
        <Text style={{ textAlign: "justify" }}>
          El Capítulo 20, Imprevistos, es un fondo equivalente al <Text style={s.bold}>{pct(revision.contingencyBp, 0)} del importe de los capítulos 01 a 19</Text> ({money(d.contingencyBase)} €), ya incluido en el precio ofertado. Las desviaciones de medición se imputan prioritariamente a ese fondo y solo incrementan el precio total si su importe acumulado lo excede.
        </Text>
      </View>
      {d.kind === "general" && revision.options.length > 0 ? <OptionSummary d={d} /> : null}
    </View>
  );
}

function OptionSummary({ d }: { d: BudgetPdfData }) {
  return (
    <View wrap={false}>
      <Band small>Partidas opcionales — no incluidas en el PEC</Band>
      <Table
        cols={[{ w: 76, fixed: true }, { w: 1 }, { w: 80, fixed: true, right: true }]}
        head={["Código", "Opción", "Importe (€)"]}
        rows={d.revision.options.map((o) => [codeRange(o.lines), o.name, money(o.totalCents)])}
      />
      <Text style={[s.note, { marginTop: 6 }]}>Cada partida opcional se contrata solo si el promotor la acepta; su detalle figura en el presupuesto detallado.</Text>
    </View>
  );
}


const LINE_COLS: Col[] = [
  { w: 34, fixed: true },
  { w: 1 },
  { w: 20, fixed: true },
  { w: 38, fixed: true, right: true },
  { w: 46, fixed: true, right: true },
  { w: 54, fixed: true, right: true },
  { w: 34, fixed: true, right: true },
  { w: 34, fixed: true, right: true },
];

function Detailed({ d }: { d: BudgetPdfData }) {
  const { revision } = d;
  const per = (cents: number, area: number | null) => (area ? money(perM2Cents(cents, area)!) : "—");
  return (
    <View break>
      <Band>Presupuesto detallado de ejecución por contrata</Band>
      {revision.chapters.map((chapter) => (
        <View key={chapter.id}>
          <View wrap={false}>
            <Band small>
              Capítulo {chapter.code} — {chapter.name}
            </Band>
            {chapter.pdfNote ? <Text style={s.note}>{chapter.pdfNote}</Text> : null}
            <Row cols={LINE_COLS} values={["Código", "Descripción de la unidad de obra", "Ud.", "Cant.", "P.U. (€)", "Importe (€)", "€/m²c", "€/m²u"]} style={s.th} />
          </View>
          {chapter.lines.map((line, i) => (
            <Row
              key={line.id}
              cols={LINE_COLS}
              odd={i % 2 === 0}
              style={s.tr}
              values={[
                line.code,
                line.description,
                line.unit,
                num(line.quantity),
                money(line.unitPriceCents),
                money(line.amountCents),
                per(line.amountCents, d.builtAreaCm2),
                per(line.amountCents, d.usefulAreaCm2),
              ]}
            />
          ))}
          <Row
            cols={[{ w: 1 }, { w: 54, fixed: true, right: true }, { w: 34, fixed: true, right: true }, { w: 34, fixed: true, right: true }]}
            values={[`SUBTOTAL CAPÍTULO ${chapter.code}`, money(chapter.totalCents), per(chapter.totalCents, d.builtAreaCm2), per(chapter.totalCents, d.usefulAreaCm2)]}
            style={s.subtotal}
          />
        </View>
      ))}
      <Row
        cols={[{ w: 1 }, { w: 70, fixed: true, right: true }, { w: 44, fixed: true, right: true }, { w: 44, fixed: true, right: true }]}
        values={["TOTAL PRESUPUESTO DE EJECUCIÓN POR CONTRATA (sin IVA)", money(revision.totalCents), d.perBuilt ? money(d.perBuilt) : "—", d.perUseful ? money(d.perUseful) : "—"]}
        style={[s.total, { marginTop: 10 }]}
      />
    </View>
  );
}

const OPTION_COLS: Col[] = [{ w: 36, fixed: true }, { w: 1 }, { w: 22, fixed: true }, { w: 40, fixed: true, right: true }, { w: 52, fixed: true, right: true }, { w: 64, fixed: true, right: true }];

function OptionPages({ d }: { d: BudgetPdfData }) {
  return (
    <>
      {d.revision.options.map((option) => (
        <View key={option.id} break>
          <Band>
            Partida opcional — {option.name} (no incluida en el PEC)
          </Band>
          {option.pdfNote ? <Text style={s.p}>{option.pdfNote}</Text> : null}
          <Table
            cols={OPTION_COLS}
            head={["Código", "Descripción de la unidad de obra", "Ud.", "Cant.", "P.U. (€)", "Importe (€)"]}
            rows={option.lines.map((l) => [l.code, l.description, l.unit, num(l.quantity), money(l.unitPriceCents), money(l.amountCents)])}
          />
          <Row
            cols={[{ w: 1 }, { w: 80, fixed: true, right: true }]}
            values={[`TOTAL ${option.name.toUpperCase()} (sin IVA) — opcional, no incluida en el PEC`, money(option.totalCents)]}
            style={s.total}
          />
        </View>
      ))}
    </>
  );
}

function PaymentPlan({ d }: { d: BudgetPdfData }) {
  return (
    <View break>
      <Band>Plan de pagos por hitos de obra — H0 a H9</Band>
      <Table
        cols={[{ w: 24, fixed: true }, { w: 1 }, { w: 34, fixed: true, right: true }, { w: 66, fixed: true, right: true }, { w: 120, fixed: true }]}
        head={["Hito", "Denominación y alcance", "%", "Importe (€)", "Momento de facturación"]}
        rows={d.hitos.map((h) => [
          h.code,
          <>
            <Text style={s.bold}>{h.name}</Text>
            {h.scope ? `\n${h.scope}` : ""}
          </>,
          pct(h.pctBp, 0),
          money(ofBp(d.revision.totalCents, h.pctBp)),
          h.billingMoment,
        ])}
      />
      <Row
        cols={[{ w: 1 }, { w: 38, fixed: true, right: true }, { w: 70, fixed: true, right: true }, { w: 120, fixed: true }]}
        values={["TOTAL", "100 %", money(d.revision.totalCents), ""]}
        style={s.total}
      />
      <Text style={[s.note, { marginTop: 8 }]}>
        Precios unitarios cerrados y fondo de imprevistos incluido · Las partidas opcionales que acepte el promotor se suman al precio y se pagan con los mismos hitos · Acta fotográfica de conformidad en cada hito · Plazo de pago de 5 días hábiles desde la entrega del acta.
      </Text>
    </View>
  );
}

function Exclusions({ d }: { d: BudgetPdfData }) {
  const { texts } = d.revision;
  return (
    <View break>
      <Band>Gastos no incluidos en el presupuesto</Band>
      <Bullets items={texts.exclusions} />
      {texts.includes ? (
        <Text style={[s.note, { marginTop: 8 }]} wrap={false}>
          Este presupuesto <Text style={{ color: AMBER, fontWeight: "bold" }}>sí incluye</Text> {texts.includes}
        </Text>
      ) : null}
    </View>
  );
}

function Guarantees() {
  return (
    <View break>
      <Band>Garantías legales — Ley de Ordenación de la Edificación (LOE 38/1999)</Band>
      <Table cols={[{ w: 90, fixed: true }, { w: 1 }]} head={["Período", "Alcance"]} rows={LOE_GUARANTEES.map((g) => [g.period, g.scope])} />
      <Text style={[s.note, { marginTop: 8 }]}>{LOE_FOOTNOTE}</Text>
      <View style={{ marginTop: 16 }}>
        <Band>Documentación técnica a entregar con la vivienda</Band>
        <Bullets items={HANDOVER_DOCUMENTS} />
      </View>
    </View>
  );
}

function Revisions({ d }: { d: BudgetPdfData }) {
  if (d.history.length < 2) return null;
  return (
    <View wrap={false} style={{ marginTop: 16 }}>
      <Band>Resumen de revisiones</Band>
      <Table
        cols={[{ w: 44, fixed: true }, { w: 64, fixed: true }, { w: 1 }, { w: 80, fixed: true, right: true }]}
        head={["Rev.", "Fecha", "Cambios", "PEC (€)"]}
        rows={d.history.map((h) => [`Rev.${h.number}`, h.date, h.number === 0 ? "Primera emisión" : (h.reason ?? ""), money(h.totalCents)])}
      />
    </View>
  );
}

function Contract({ d }: { d: BudgetPdfData }) {
  const values = d.contractValues;
  return (
    <View break>
      <Band>Contrato de obra — condiciones generales</Band>
      <Text style={[s.p, { fontSize: 8.4 }]}>{fill(CONTRACT_INTRO, values)}</Text>
      {CONTRACT_CLAUSES.map((clause, i) => (
        <View key={i}>
          <Text style={{ color: AMBER, fontWeight: "bold", fontSize: 9.4, marginTop: 6, marginBottom: 3 }}>
            Cláusula {i + 1}ª. — {clause.title}
          </Text>
          <Text style={[s.p, { fontSize: 7.4 }]}>{fill(clause.text, values)}</Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", marginTop: 48 }} wrap={false}>
        {[
          ["EL CONTRATISTA", d.letterhead.name, "Firma y sello"],
          ["EL PROMOTOR", values.promoter ?? "", "Firma"],
        ].map((lines, i) => (
          <View key={i} style={{ flex: 1, marginHorizontal: 8, borderTopWidth: 0.8, borderTopColor: TEXT, paddingTop: 6, alignItems: "center" }}>
            {lines.map((line, j) => (
              <Text key={j} style={{ fontSize: 8.4, lineHeight: 1.8 }}>
                {line}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <Text style={{ textAlign: "center", marginTop: 16, fontSize: 9 }}>
        En {d.revision.conditions.signingPlace || "______________"}, a ______ de _________________ de {d.year}.
      </Text>
    </View>
  );
}

function Annex({ d }: { d: BudgetPdfData }) {
  const annex = d.revision.texts.annex;
  if (annex.length === 0) return null;
  return (
    <View break>
      <Band>Anexo — Observaciones técnicas y puntos a cerrar con la Dirección Facultativa</Band>
      <Bullets items={annex.map((a) => <Lead key={a.id} title={a.title} text={a.text} />)} />
    </View>
  );
}

export function BudgetPdf({ d }: { d: BudgetPdfData }) {
  const detailed = d.kind === "detailed";
  return (
    <Document
      title={`Presupuesto ${d.revision.reference ?? ""} Rev.${d.revision.number} ${detailed ? "detallado" : "general"}`}
      author={d.letterhead.name}
      language="es"
    >
      <Page size="A4" style={s.page}>
        <Footer d={d} />
        <Cover d={d} />
        <Justification d={d} />
        <Summary d={d} />
        {detailed ? <Detailed d={d} /> : null}
        {detailed ? <OptionPages d={d} /> : null}
        <PaymentPlan d={d} />
        <Exclusions d={d} />
        <Guarantees />
        <Revisions d={d} />
        {detailed ? <Contract d={d} /> : null}
        <Annex d={d} />
      </Page>
    </Document>
  );
}

export type { BudgetPdfKind };
