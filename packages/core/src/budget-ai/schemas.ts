import * as z from "zod/v4";

// ─── What the AI returns ──────────────────────────────────────────────────────
// Structured outputs (Claude's `output_config.format`) for the two kinds of
// call in features/budget/PROMPTS_IA.md §1: step 1 reads the project, steps
// 2–5 write each group of chapters' lines. Field names follow the prompts
// (Spanish) so the model sees the same words in both.
// ─────────────────────────────────────────────────────────────────────────────

const num = z.number();

/** Step 1: the project's data, surfaces, counts, measurements and the PDF texts. */
export const ProjectExtraction = z.object({
  datos: z.object({
    cliente: z.string(),
    ubicacion: z.string(),
    municipio: z.string(),
    provincia: z.string(),
    refCatastral: z.string(),
    arquitecto: z.string(),
    tipologia: z.string(),
    plantas: num,
    m2c: num,
    m2u: num,
    parcela: num,
  }),
  superficies: z.object({
    planta: z.array(z.object({ nombre: z.string(), m2c: num })),
    fachada: num,
    huecos: num,
    cubierta: num,
    perimetro: num,
    forjados: num,
    terrazas: num,
  }),
  recuento: z.object({
    ventanas: num,
    puertasExt: num,
    puertasInt: num,
    banos: num,
    aseos: num,
    dormitorios: num,
  }),
  sistema: z.string(),
  mediciones: z.array(z.object({ concepto: z.string(), ud: z.string(), cantidad: num, fuente: z.string() })),
  incoherencias: z.array(z.object({ titulo: z.string(), texto: z.string() })),
  supuestos: z.array(z.object({ titulo: z.string(), texto: z.string() })),
  // What the PDF prints (template PreFRAMER_Caviedes_Valdadiga_V1.pdf).
  portada: z.object({
    programa: z.string(),
    base: z.string(),
    alcance: z.string(),
    sistemaConstructivo: z.string(),
  }),
  justificacion: z.object({
    intro: z.string(),
    apartados: z.array(z.object({ titulo: z.string(), texto: z.string() })),
  }),
  criterioMedicion: z.string(),
  notasCapitulo: z.array(z.object({ cod: z.string(), nota: z.string() })),
  noIncluido: z.array(z.string()),
});
export type ProjectExtraction = z.infer<typeof ProjectExtraction>;

/** Steps 2–5: one group of chapters' lines. */
export const ChapterLines = z.object({
  capitulos: z.array(
    z.object({
      cod: z.string(),
      partidas: z.array(
        z.object({
          cod: z.string(),
          desc: z.string(),
          ud: z.string(),
          med: num,
          pu: num,
          fuente: z.enum(["base", "estimado"]),
          nota: z.string(),
        }),
      ),
    }),
  ),
});
export type ChapterLines = z.infer<typeof ChapterLines>;
