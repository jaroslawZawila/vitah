# ViTAH construction process (proceso de obra)

This is the real process a ViTAH house follows, from the client handing over their architect's
project to the keys and the warranty. It is built **only** from the material in this folder:

| Source | What it is | Used for |
|--------|------------|----------|
| `description` (WhatsApp with Ruben, 26/09/2026) | How the team works, and what the client and the staff should each see | The order of the stages; who sees what |
| `MEMORIA.pdf` | The architect's *Proyecto Básico y de Ejecución* (Castrillón, Asturias, march 2024): data, surfaces, construction system, CTE compliance | Stage 1: what the client delivers |
| `PreFRAMER_Castrillon_Asturias.pdf` | FRAMER budget **036/2026 Rev.3** for that project (a real case): revisions, chapter summary, detailed partidas, H0–H9 payment plan, exclusions, LOE warranties, handover documents, contract | Stages 2–9, the chapters, the partidas, the hitos |
| Image `…11.39.04` | §2 of that budget: *Resumen por capítulos* | **What the client sees in the app** |
| Image `…11.43.36` | §4 of that budget: *Plan de pagos por hitos H0–H9* | The payment milestones |
| Artifact [5R7E2WX8TmhF4HFDYx6iuG](https://claude.ai/artifact/5R7E2WX8TmhF4HFDYx6iuG) | Budget 36/2026 Rev.0, Zarzalejo (Madrid): the budget **model** Ruben called "el mejor que tengo" | The standard budget structure every project follows |

Ruben, in short:

> El cliente nos entrega el proyecto… y hacemos el estudio del proyecto. Realizamos el presupuesto de
> la ejecución de la casa. Las fases son el punto 2 […] esto es lo que tiene que ver el cliente en la
> app. Y nosotros vemos el punto 3 en la plataforma, porque es la descripción detallada de cada
> capítulo. Los hitos de pago para hacer la obra. Y al final se inicia la obra y se lleva el control
> […]. Cada presupuesto que se realiza se ajusta a este modelo y genera todos los datos al resto de
> la plataforma.

So the **budget is the backbone**. Its chapters are the phases the client follows, its partidas are
what the staff control, and its hitos are what the client pays. Nothing is a fixed template of made-up
phases. Every project has the chapters of its own budget (Castrillón has 17, Zarzalejo has 20).

---

## 1. People

| Role | Who (Castrillón case) | Where they work |
|------|----------------------|-----------------|
| **Promotor / cliente** | The homeowners, as *autopromotores* of their main home | Mobile app |
| **Constructor** (contratista principal) | FRAMER Steel Frame (Herrera de Camargo, Cantabria) | Portal (staff: admin / manager / viewer) |
| **Arquitecto autor del proyecto** | EAI Arquitectura S.L.P. | Outside the platform. Delivers the project |
| **Dirección Facultativa (DF)** | Architect + arquitecto técnico. Their technical criteria prevail (cl. 7ª) | Outside the platform. Signs the CFO |
| **Coordinador de Seguridad y Salud** | Budget partida 16.02 | Outside the platform |

---

## 2. The process at a glance

```
 PRE-OBRA ─────────────────────────────────────────────  OBRA ───────────────────────  POST-OBRA ──────
 1 Proyecto  2 Estudio  3 Presupuesto  4 Contrato + H0  5 Ingeniería   6 Ejecución     7 Recepción   8 Garantía
   recibido    técnico    (Rev.0…n)      señal 5 %        BIM+licencia   por capítulos   y entrega     LOE
                                                          H1 7 %         H2 … H8          H9 3 %       1/3/10 años
```

| # | Stage | Starts when | Ends when (evidence) | Hito |
|---|-------|-------------|----------------------|------|
| 1 | **Proyecto recibido** | The client hands over the *Proyecto Básico y de Ejecución* (memoria, plans, measurements / BC3) | The project documents are filed on the project | — |
| 2 | **Estudio del proyecto** | Documents received | *Justificación técnica* written: data, surfaces, conversion to Steel Frame, inconsistencies found | — |
| 3 | **Presupuesto** | Study done | The client accepts a revision (Rev.0 → Rev.n). Valid 90 days from issue | — |
| 4 | **Contrato y reserva** | Revision accepted | Contract signed and **H0** (5 %) invoiced. Locks the steel price and opens the BIM file and licence process | H0 |
| 5 | **Ingeniería BIM y licencia** | H0 | BIM model (*gemelo digital*), signed structural calculation, execution project and **Licencia Municipal de Obras** delivered | H1 |
| 6 | **Ejecución de obra** | *Acta de Inicio de Obras* (site handed over free of charges; the client's *seguro decenal* in place before foundations, cl. 10ª). Term 8–10 months | Every chapter at 100 % | H2 … H8 |
| 7 | **Recepción y entrega** | End of works notified | *Acta de Recepción* (art. 6 LOE; client has 30 days to accept), keys, CFO and handover documents | H9 |
| 8 | **Garantía** | Reception | 1 year finishes · 3 years habitability · 10 years structure (+2 years equipment) | — |

Stages 1–5 are sequential. Stage 6 is where the chapters run, several at once. Stages 7–8 close the file.

---

## 3. Stage by stage

### 1 · Proyecto recibido
The client (promotor) gives us their architect's *Proyecto Básico y de Ejecución*. In the real case
(`MEMORIA.pdf`) this is: general data (site, cadastral ref., promotor, architect), surfaces by use,
the descriptive memory, urban planning memory, construction memory (foundations, structure) and CTE
compliance, plus plans and the measurements (BC3). Zarzalejo lists "13 architecture plans, 4 structure,
19 installations and the measurements (without prices)".

*Platform:* staff create the project, attach the client and upload the project documents
(already possible in **Documentos**).

### 2 · Estudio del proyecto
We study the project and adapt it to FRAMER Steel Frame. The output is §1 of the budget model,
*Justificación técnica*:
- project data and site conditions (climate zone, radon zone, terrain),
- adopted surfaces (m² construidos / útiles),
- a table **"del sistema del proyecto al sistema FRAMER"**: element → what the project says → the Steel Frame solution,
- **incoherencias detectadas** in the documentation and how each was budgeted.

### 3 · Presupuesto (PEC, precio cerrado)
Every budget follows the **model** (Zarzalejo artifact). For now staff enter it in the portal. Later, AI will
generate it from the project. Its sections are:

| § | Section | Feeds in the platform |
|---|---------|-----------------------|
| cover | Nº / revision / promotor / site / reference project / m² / PEC / €/m²c / €/m²u | Project header |
| 1 | Justificación técnica (Rev.0) · *Resumen de revisiones* (Rev.n: what changed, old → new amount, reason) | Revision history |
| **2** | **Resumen por capítulos**: code, name, amount, % PEC, €/m²c. ★ = revised up, ✦ = new chapter | **App: the phases the client follows** |
| **3** | **Presupuesto detallado**: per chapter, partidas `cc.nn` with description, unit (m², m³, ml, ud, pa, lote), quantity, unit price, amount | **Portal: what staff control** |
| **4** | **Plan de pagos por hitos H0–H9**: %, amount, scope, billing moment | **App + portal: payments** |
| 5 | Gastos no incluidos (geotechnical study, fees ~8 % PEM, VAT, ICIO, seguro decenal, furniture…) | Shown with the budget |
| 6 | Garantías legales LOE | App: Garantía screen |
| 7 | Documentación técnica a entregar | H9 handover checklist |
| 8 | Contrato de obra: 16 clauses | Rules below |

Rules from the budgets:
- Unit prices already include overheads and profit, so every amount is PEC. VAT is **not** included:
  10 % for *autopromoción de vivienda habitual*.
- Budgets are revised (Castrillón Rev.2 → Rev.3: +28.704,32 €, caused by real BC3 data). Each revision
  records what changed and why. Only the **accepted** revision drives the works and the hitos.
- A chapter for unforeseen items is usual. Castrillón has *Cap.17 Partida alzada de remates y
  coordinación* = 5 % of the base PEC, and Zarzalejo has *Cap.20 Imprevistos* = 5 % of chapters 01–19.
- Chapters differ per project, and so do their order and numbering. The Castrillón summary lists 17 before 16.
  The platform keeps each project's own list and order.

### 4 · Contrato y reserva (H0)
The contract (§8) is signed against the accepted revision: closed price, H0–H9 payments by bank transfer
(Annex I), term 8–10 months from the *Acta de Inicio*. **H0 (5 %)** is invoiced at signature.

### 5 · Ingeniería BIM y licencia (H1)
Digital twin, structural calculation signed by a qualified engineer, execution project, workshop plans,
anchor layout plan, and the **Licencia Municipal de Obras**. **H1 (7 %)** is invoiced when the BIM model
and the licence are delivered. Before the foundations start, the client takes out the **seguro decenal**
(cl. 10ª, a precondition for starting). The term starts on the **Acta de Inicio de Obras**, once the
client hands over the site free of charges.

### 6 · Ejecución de obra: control
Work runs **by chapter**. Staff keep it under control **by partida** (§3):

- Each partida gets an **executed %** (0–100). Its executed amount = amount × %.
- **Chapter progress** = Σ executed amounts of its partidas ÷ chapter amount.
- **Overall progress** = Σ executed amounts ÷ PEC. This is the % the client sees.
- A chapter is *pendiente* (0 %), *en curso* (1–99 %) or *terminado* (100 %).

Each payment hito closes a set of chapters (see §4 below). When they are done, the hito is closed with an
**acta fotográfica de conformidad** (photos + scope + both parties' signature). The acta is signed by hand
outside the platform, and staff upload the signed PDF to the portal. Then:

```
 hito en curso → listo para acta → acta firmada → facturado → pagado
                   (its chapters       (promotor       (invoice      (≤ 5 business days
                    at 100 % + test)    + FRAMER)       issued)       after the acta)
```

Contract rules that apply during the works:
- **Changes** (cl. 5ª): any change to the quality specification that alters price or term needs a written
  *Anejo* signed by both parties **before** it is executed. It becomes a new budget revision.
- **Brands** (cl. 6ª) are binding: Mitsubishi Ecodan, Uponor PEX-a, Roca Hall, Niessen Arco / Simon, Weber.pral Finish,
  Thermochip, S350GD / Magnelis ZM310. A substitute needs written approval.
- **Delay** (cl. 4ª): 150 €/calendar day from the 15th day of delay, capped at 5 % of the price,
  **deducted from H9**. Ordinary rain in the north of Spain is not force majeure.
- **Termination** (cl. 14ª): by the builder if two consecutive due hitos are unpaid.
- Tests along the way: provisional watertightness (H4), full water network test (H5), systems tested (H7),
  quality control (concrete, steel, waterproofing, Blower Door), all in Cap.16.

### 7 · Recepción y entrega (H9)
The builder notifies the end of works. Reception is done with an **Acta de Recepción** (art. 6 LOE) with the
DF present, and the client has 30 days to accept or reject with reasons. **H9 (3 %)** is paid against the keys
and the CFO, minus any delay penalties. The handover documents (§7 of the budget) are:

- Certificado Final de Obra (CFO), stamped by the DF
- Libro del Edificio (minutes, list of installers, use and maintenance manual)
- Material traceability (steel S350GD / Magnelis, Thermochip, Weber.pral Finish)
- Blower Door test result
- Acoustic tests (DB-HR)
- Energy Efficiency Certificate
- Plumbing and drainage watertightness tests
- Radon protection verification (DB-HS 6)
- Acta de Recepción

### 8 · Garantía (LOE 38/1999)
| Period | Covers (Castrillón) |
|--------|---------------------|
| 1 year | Finishes: carpentry, monolayer mortar, exterior paint, floors and tiles |
| 3 years | Habitability: Thermochip envelope watertightness, ISOVER insulation, Ecodan heat pump, Uponor plumbing, VMC |
| 10 years | Structure: HA-25 slab + Steel Frame S350GD / Magnelis ZM310 |
| +2 years | Correct working of HVAC, plumbing and electrical equipment |

This is what the app's existing **Garantía** screen (`A-Warranty`) is for.

---

## 4. Payment milestones (hitos H0–H9)

The ten hitos are **standard**, but their % and scope are adjusted per project. Zarzalejo: "Frente a los
hitos estándar, H2 pasa a ser *cimentación y plataforma*… H4 baja al 14 % y H5 al 8 %". Amounts are
% × PEC, without VAT. The Castrillón Rev.3 figures:

| Hito | Name | % | Amount | Billed when | Chapters it closes* |
|------|------|---|--------|-------------|---------------------|
| H0 | Señal de reserva | 5 % | 22.410,25 € | Contract signed | — |
| H1 | Ingeniería BIM + proyecto + licencia | 7 % | 31.374,35 € | BIM model and licence delivered | partida 04.01 (Ingeniería BIM) |
| H2 | Cimentación completa | 12 % | 53.784,61 € | Slab and under-floor drainage finished | 01, 02, 03 |
| H3 | Estructura Steel Frame | 15 % | 67.230,76 € | Structure erected | 04 (04.02–04.06) |
| H4 | Envolvente estanca (Thermochip + carp. exterior) | 13 % | 58.266,66 € | House closed to water and air | 05, 07, 10 |
| H5 | Fontanería y saneamiento interior | 10 % | 44.820,51 € | Plumbing network tested | 12 |
| H6 | Electricidad y telecomunicaciones | 8 % | 35.856,40 € | Electrical board and circuits complete | 13 |
| H7 | Climatización: Ecodan + suelo radiante + VMC | 8 % | 35.856,40 € | HVAC systems tested | 14 |
| H8 | Acabados interiores + fachada + carp. interior | 19 % | 85.158,96 € | Interior and exterior finishes complete | 06, 08, 09, 11 |
| H9 | Liquidación final: entrega de llaves | 3 % | 13.446,15 € | Against keys and CFO | 15, 16, 17 + handover documents |
| | **Total** | **100 %** | **448.205,05 €** | Closed price · photo acta · pay within 5 business days | |

\* *The budgets do not state which chapters each hito closes. Staff set this per project. The mapping
above is the default, taken from each hito's "Alcance" text.*

The hito % are **not** chapter weights (H3 = 15 % while Cap.04 = 14,8 %; H0 and H1 are paid before
any work). Hitos measure payments. Chapters measure progress.

---

## 5. Who sees what

| | Client, **app** (Obra tab) | Staff, **portal** |
|---|---|---|
| Stage of the process (1–8) | ✔ which stage the project is in | ✔ and moves it forward |
| Phases (pre-construction + H2–H9) | ✔ the Obra tab, all on one screen | ✔ |
| Chapters (§2) | ✔ inside each phase: name, amount and % executed | ✔ |
| Partidas (§3) | ✘ ("nosotros vemos el punto 3") | ✔ edit budget, set executed % |
| Overall progress | ✔ | ✔ |
| Hitos (§4) | ✔ status, amount + VAT, due date, acta photos, signed acta and invoice (read-only) | ✔ prepare acta, upload the signed acta, upload invoice, register payment |
| Revisions | Accepted revision only | ✔ all, with change justification |
| Handover documents (§7) | ✔ in Documentos once delivered | ✔ checklist on H9 |
| Warranty (§6) | ✔ Garantía screen | ✔ |

---

## 6. Data the platform needs

One **budget** per project drives everything ("genera todos los datos al resto de la plataforma"):

```
project ─┬─ stage (1–8), acta de inicio date, planned end date
         ├─ budget revisions (n, date, status: draft | sent | accepted | superseded, change notes)
         │    └─ chapters (code, name, order, flag ★/✦)
         │         └─ partidas (code, description, unit, quantity, unit price) ─ executed %
         └─ hitos H0–H9 (%, name, scope, billing moment, linked chapters/partidas)
              └─ status, acta (photos, signed PDF, date), invoice (PDF), paid date
```

Derived, never stored: amounts (qty × price), chapter/overall %, hito amount (% × PEC), VAT, due date
(acta + 5 business days), days of delay and penalty.

> **Prod note:** the reverted obra slice (`ab6047b`, `4389e03`) created tables in prod through
> `packages/db/sql/2026-09-obra.sql` (`obras`, `budget_chapters`, `budget_lines`, …). They are still there.
> The new schema must reuse them additively or drop them on purpose, not collide with them.

---

## 7. Screens

Designs are on the canvas [ViTAH App Mockups](https://claude.ai/artifact/DjsuyQ9747VaRm7toZmpBj):
app screens in the Grafito language (`doc/mobile-app-design/`), portal screens in the current portal
look (`doc/platform-design/`).

| Screen | Surface | Shows |
|--------|---------|-------|
| `A-Progress`, tab **Obra** | App | One screen, no scroll: overall %, week, delivery, next payment, 9 phases |
| `A-Fase` | App | One phase: its budget chapters and %, photos, what closes it, its payment |
| `A-Obra-Pagos` | App | H0–H9 timeline: paid / to pay / next / pending, totals |
| `A-Hito` | App | One hito: scope, amount + VAT, due date, acta photos, signed acta, invoice |
| `P-Obra` | Portal | Project process stepper, KPIs, chapters with progress, next hito |
| `P-Presupuesto` | Portal | Revisions, §2 chapter summary, §3 partidas, change notes |
| `P-Capitulo` | Portal | One chapter's partidas with executed %: the site control |
| `P-Hitos` | Portal | H0–H9 with status pipeline, linked chapters' readiness |
| `P-Hito` | Portal | Acta de conformidad: checks, photos, signed acta, invoice, payment |

---

## 8. Decisions (27/09/2026)

1. **Site control** is *executed % per partida*, as described in §3.6. The missing 3-page control model
   changes nothing.
2. **Budgets:** in the future AI will generate each budget from the client's project, following the model.
   Until then staff enter and edit the budget in the portal (`P-Presupuesto`).
3. **Hito ↔ chapter mapping:** staff set it per project. The mapping in §4 is only the default.
4. **Acta de conformidad:** a manual process. It is signed outside the platform, then staff upload the signed
   PDF to the portal. The app only shows it.
5. **What the client sees:** what Ruben said, the §2 chapter summary. In the app each phase shows its
   chapters as §2 does (name and amount), plus their progress.
