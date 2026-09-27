# Portal design: obra, presupuesto and pagos

Staff screens for the construction process described in
`features/construction_process/PROCESS.md`. They extend the **current portal look** (dark sidebar with the
project's sub-tabs, white top bar, `--admin-bg` canvas, white cards with a `#e0ded8` border, olive
accents, Geist). They do not introduce a new theme.

- **Live canvas:** https://claude.ai/artifact/DjsuyQ9747VaRm7toZmpBj (row "Portal — obra, presupuesto y pagos")
- Sample data is the real Castrillón budget 036/2026 Rev.3. Progress, dates and payment states are a
  made-up mid-construction snapshot (week 21 of 40, H3 invoiced, H4 in progress).
- The mockups are drawn at desktop width (1440). Build them mobile-first as the rest of `apps/web`: tables
  become stacked rows under 768 px, and touch targets stay at 44 px.

| File | Screen | Sidebar tab | Shows |
|------|--------|-------------|-------|
| `P-Obra.dc.html` | Obra | Proyectos › Obra | Process stepper (8 stages), KPIs (executed, collected, term, next hito), chapter table with progress |
| `P-Capitulo.dc.html` | Control de capítulo | Proyectos › Obra | One chapter's partidas with executed % inputs, chapter %, its hito's readiness, chapter photos |
| `P-Presupuesto.dc.html` | Presupuesto | Proyectos › Presupuesto | Revisions, PEC/VAT/surfaces/ratios, changes vs previous revision, chapters › partidas (editable), §4–§8 links |
| `P-Hitos.dc.html` | Pagos | Proyectos › Pagos | Collected / invoiced / to invoice, H0–H9 table with the chapters each hito closes and its state |
| `P-Hito.dc.html` | Hito y acta | Proyectos › Pagos | State pipeline, conditions, acta photos + signed acta, invoice, register payment |

Project sub-tabs become: General · Obra · Presupuesto · Pagos · Documentos · Fotos.
