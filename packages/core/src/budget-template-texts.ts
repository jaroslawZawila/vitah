// Company-wide fixed texts of the FRAMER budget: the standard sections printed in every budget PDF
// (guarantees, handover documents and the contract's general conditions), generalised from the
// template PreFRAMER_Caviedes_Valdadiga_V1.pdf. `{placeholders}` are filled per project: {contractor},
// {promoter}, {site}, {basis}, {price}, {term}, {penalty}, {mediator} and {jurisdiction}.

export const LOE_GUARANTEES: { period: string; scope: string }[] = [
  {
    period: "1 año",
    scope:
      "Defectos de acabado y remates estéticos: carpintería, revestimientos exteriores, pintura, solados y alicatados.",
  },
  {
    period: "3 años",
    scope:
      "Elementos de habitabilidad: estanqueidad de la envolvente Thermochip y de la cubierta, aislamientos, climatización, ventilación y fontanería.",
  },
  {
    period: "10 años",
    scope:
      "Garantía decenal frente a vicios o defectos estructurales que comprometan la resistencia mecánica y la estabilidad del edificio: cimentación, forjados, muros portantes y estructura de cubierta en acero galvanizado S350GD Z275, ejecutados en su totalidad por FRAMER. Vida útil del acero galvanizado superior a 100 años.",
  },
];

export const LOE_FOOTNOTE =
  "Adicionalmente, garantía de 2 años para el correcto funcionamiento de los equipos de climatización, ventilación, fontanería y electricidad instalados, conforme a las condiciones de sus fabricantes.";

export const HANDOVER_DOCUMENTS: string[] = [
  "Certificado Final de Obra (CFO) visado por la Dirección Facultativa.",
  "Libro del Edificio: actas de obra, listado de industriales, fichas técnicas de materiales y Manual de Uso y Mantenimiento.",
  "Gemelo Digital BIM as-built y cálculo estructural visado de la estructura Steel Frame, con los planos de taller de la perfilería.",
  "Trazabilidad de materiales: certificados del acero S350GD Z275, de los paneles Thermochip y de la carpintería, con marcado CE y declaración de prestaciones.",
  "Resultado de la prueba de estanqueidad al aire Blower Door conforme a UNE-EN ISO 9972, e informe de termografía de la envolvente.",
  "Informe de ensayos acústicos conforme al DB-HR.",
  "Certificado de Eficiencia Energética del edificio terminado (RD 390/2021).",
  "Actas de las pruebas de estanqueidad de las redes de fontanería y saneamiento, y del equilibrado hidráulico y de caudales de ventilación.",
  "Documentación de verificación del sistema de protección frente al gas radón (DB-HS 6), cuando sea exigible, con la medición posterior a la finalización de la obra.",
  "Certificados y boletines de las instalaciones eléctrica y térmica y, en su caso, de las demás instalaciones ejecutadas.",
];

export const CONTRACT_INTRO =
  "Entre las partes:\n\nCONTRATISTA: {contractor}.\n\nPROMOTOR: {promoter}, con DNI ____________, en calidad de autopromotor de vivienda habitual.\n\nSe formaliza el presente Contrato de Obra sujeto a las siguientes cláusulas:";

export const CONTRACT_CLAUSES: { title: string; text: string }[] = [
  {
    title: "Objeto del Contrato",
    text: "El presente contrato tiene por objeto la ejecución de las obras de construcción de una vivienda unifamiliar aislada industrializada mediante el sistema Steel Frame de acero ligero galvanizado, en {site}, conforme al {basis} y a la Memoria de Calidades aprobada por ambas partes, con la adaptación al sistema Steel Frame descrita en el apartado de Justificación Técnica de este presupuesto. El alcance comprende desde el movimiento de tierras hasta la entrega de llaves, en los términos descritos en el presupuesto. Las partidas opcionales solo forman parte del objeto del contrato cuando hayan sido aceptadas por el PROMOTOR; las no aceptadas quedan excluidas y solo podrán incorporarse mediante anejo firmado por ambas partes. Las mediciones del presupuesto se verificarán y ajustarán conforme a la Cláusula 5ª.",
  },
  {
    title: "Precio y Forma de Pago",
    text: "El precio ofertado, calculado con precios unitarios cerrados sobre las mediciones del presupuesto, asciende a {price}, IVA no incluido. Dicho importe incluye el fondo de Imprevistos previsto en el presupuesto y las partidas opcionales aceptadas por el PROMOTOR. El IVA aplicable es del 10 % en régimen de autopromoción de vivienda habitual (Art. 91.Uno.3.º LIVA). Los pagos se realizarán mediante transferencia bancaria según el Plan de Pagos por Hitos H0–H9 recogido en el Anexo I del presente contrato. Cada hito se facturará una vez documentado fotográficamente y firmada el acta de conformidad por ambas partes. El PROMOTOR dispondrá de 5 días hábiles desde la entrega del acta para efectuar el pago. El cuadro de precios unitarios por capítulo se incorpora como Anexo II y forma parte inseparable de este contrato.",
  },
  {
    title: "Plazo de Ejecución",
    text: "El plazo de ejecución se estima en {term}, condicionado a la obtención de la Licencia Municipal de Obras y, en su caso, de las autorizaciones administrativas exigibles. El plazo comenzará a computarse en la fecha en que el PROMOTOR haga entrega de la parcela libre de cargas y con acceso garantizado para el camión de transporte de la estructura y los medios de elevación. Las causas de fuerza mayor (fenómenos meteorológicos de carácter extraordinario debidamente documentados, huelgas del sector, desabastecimiento de materiales certificado por el proveedor) podrán suspender el cómputo del plazo, previa notificación escrita en un plazo máximo de 48 horas desde la aparición de la causa. En ningún caso se considerará causa de fuerza mayor la simple lluvia en el contexto climático habitual de la zona.",
  },
  {
    title: "Penalizaciones por Retraso",
    text: "En caso de retraso imputable al CONTRATISTA en la entrega de la obra sobre la fecha pactada, se aplicará una penalización de {penalty}. Superado este límite, el PROMOTOR podrá optar entre resolver el contrato con devolución de las cantidades pagadas por trabajos no ejecutados o exigir el cumplimiento forzoso. Las penalizaciones serán descontadas del importe del Hito H9 (liquidación final).",
  },
  {
    title:
      "Liquidación por Mediciones Reales, Modificaciones del Proyecto y Obras Extra",
    text: "Las cantidades de cada partida del presupuesto se verificarán y cerrarán definitivamente con el replanteo y con el modelo BIM del Hito H1. Las desviaciones entre las mediciones del presupuesto y las mediciones reales certificadas por la Dirección Facultativa se imputarán prioritariamente a la partida de Imprevistos, incluida en el precio contratado, aplicando en todo caso los mismos precios unitarios pactados en el Anexo II. Dichas desviaciones únicamente producirán incremento del precio total cuando su importe acumulado exceda el de la partida de Imprevistos, y solo por la parte que exceda. Cualquier modificación sobre la Memoria de Calidades o el proyecto aprobado que altere el alcance, el precio o el plazo más allá de dicha cobertura deberá acordarse por escrito mediante anejo firmado por ambas partes antes de su ejecución. El CONTRATISTA no ejecutará ningún trabajo adicional sin autorización escrita previa del PROMOTOR. Los precios de las unidades no contempladas se fijarán de mutuo acuerdo, tomando como referencia el Anexo II y, en su defecto, el banco de precios de la construcción de la comunidad autónoma de la obra vigente en la fecha del encargo adicional.",
  },
  {
    title: "Materiales, Calidades y Marcas Especificadas",
    text: "Los materiales, marcas y modelos recogidos en la Memoria de Calidades y en el presupuesto son vinculantes. En caso de desabastecimiento o discontinuación de un producto por parte del fabricante, el CONTRATISTA propondrá por escrito una alternativa técnicamente equivalente o superior para aprobación del PROMOTOR y de la Dirección Facultativa, sin que el cambio genere variación de precio salvo sobrecoste objetivo demostrable. Quedan expresamente nombradas las marcas y sistemas de la Memoria de Calidades y del presupuesto, salvo acuerdo escrito en contrario.",
  },
  {
    title: "Dirección Facultativa",
    text: "Las obras se ejecutarán bajo la Dirección Facultativa del arquitecto y del arquitecto técnico designados por el PROMOTOR, ambos con sus atribuciones según la LOE 38/1999. El CONTRATISTA acatará las instrucciones de la Dirección Facultativa en todo lo relativo a la correcta interpretación del proyecto. En caso de discrepancia sobre aspectos técnicos, prevalecerá el criterio de la Dirección Facultativa. La adaptación al sistema Steel Frame, incluido el recálculo estructural visado que el CONTRATISTA entrega en el Hito H1, requerirá la conformidad expresa de la Dirección Facultativa y su incorporación documental al proyecto.",
  },
  {
    title: "Seguridad y Salud",
    text: "El CONTRATISTA asumirá la condición de Contratista Principal a efectos de la Ley 31/1995 de PRL y del RD 1627/1997 sobre Seguridad y Salud en las obras de construcción. Designará un Recurso Preventivo permanente en obra durante las fases de especial riesgo, con particular atención a los trabajos de montaje de la estructura y de la cubierta. El incumplimiento de las medidas del Plan de Seguridad y Salud podrá ser causa de paralización de los trabajos por la Dirección Facultativa o la Coordinación de Seguridad, sin que ello genere derecho a reclamación por parte del CONTRATISTA.",
  },
  {
    title: "Subcontratación",
    text: "El CONTRATISTA podrá subcontratar parcialmente la obra de acuerdo con la Ley 32/2006 reguladora de la subcontratación en el sector de la construcción. En ningún caso podrá subcontratar la totalidad de la obra. El CONTRATISTA responderá solidariamente frente al PROMOTOR de los trabajos ejecutados por sus subcontratistas como si los hubiera realizado directamente.",
  },
  {
    title: "Seguros y Responsabilidad Civil",
    text: "El CONTRATISTA mantendrá durante toda la duración de la obra un Seguro de Responsabilidad Civil de Explotación con cobertura mínima de 600.000 € por siniestro, y un Seguro de Accidentes de Convenio para todos sus trabajadores. En cuanto al Seguro Decenal de Daños Estructurales, el PROMOTOR declara actuar como autopromotor individual de una única vivienda unifamiliar para uso propio, supuesto en el que el Art. 19.1.c) de la LOE 38/1999 exime de la obligación de suscribirlo. Esta exención decae si la vivienda se transmite por acto inter vivos dentro de los 10 años siguientes a la finalización de la obra. Si el PROMOTOR optara voluntariamente por no acogerse a la exención, deberá contratar el Seguro Decenal antes del inicio de la cimentación, sin que dicha contratación sea a cargo del CONTRATISTA.",
  },
  {
    title: "Recepción de la Obra",
    text: "La recepción de la obra se realizará mediante Acta de Recepción conforme al Art. 6 de la LOE, con intervención de la Dirección Facultativa. El PROMOTOR dispondrá de 30 días naturales desde la comunicación de fin de obra para pronunciarse sobre la aceptación o el rechazo motivado. Los defectos de terminación no impeditivos para el uso de la vivienda no serán impedimento para la recepción, siempre que el CONTRATISTA se obligue por escrito a su subsanación en un plazo máximo de 30 días.",
  },
  {
    title: "Garantías Legales — LOE",
    text: "El CONTRATISTA asume las garantías establecidas en la Ley 38/1999 de Ordenación de la Edificación: (a) 1 año para defectos de acabado y remates estéticos; (b) 3 años para elementos que afecten a la habitabilidad (estanqueidad de la envolvente, instalaciones, aislamiento térmico y acústico); (c) 10 años de garantía decenal frente a vicios o defectos estructurales que comprometan la resistencia mecánica y la estabilidad del edificio, comprendiendo la cimentación, los forjados y la estructura Steel Frame. Adicionalmente, el CONTRATISTA garantiza un período de 2 años para el correcto funcionamiento de los equipos de climatización, ventilación, fontanería y electricidad instalados.",
  },
  {
    title: "Documentación Técnica y Entrega del Edificio",
    text: "La entrega definitiva del edificio incluirá obligatoriamente: Certificado Final de Obra visado por la Dirección Facultativa; Libro del Edificio completo; Gemelo Digital BIM as-built y cálculo estructural visado; trazabilidad de materiales con certificados del acero S350GD Z275 y de los paneles Thermochip; resultado de la prueba Blower Door conforme a UNE-EN ISO 9972 e informe de termografía; ensayos acústicos DB-HR; Certificado de Eficiencia Energética; actas de las pruebas de estanqueidad de fontanería y saneamiento; documentación de verificación del sistema frente al radón (DB-HS 6) con su medición posterior, cuando sea exigible; y boletines y certificados de las instalaciones ejecutadas.",
  },
  {
    title: "Resolución del Contrato",
    text: "Serán causas de resolución a instancia del PROMOTOR: el abandono injustificado de la obra por parte del CONTRATISTA durante más de 15 días hábiles consecutivos; la declaración de concurso de acreedores del CONTRATISTA; la reiteración, en más de tres ocasiones, en el incumplimiento de las instrucciones de la Dirección Facultativa; y el incumplimiento del Plan de Pagos en condiciones que generen deuda superior al 15 % del precio total. Serán causas de resolución a instancia del CONTRATISTA: el impago por el PROMOTOR de dos hitos consecutivos vencidos y documentados.",
  },
  {
    title: "Protección de Datos",
    text: "El tratamiento de datos personales derivado del presente contrato se realizará conforme al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD). Los datos de ambas partes se tratarán exclusivamente para la gestión de la relación contractual y no serán cedidos a terceros salvo obligación legal. Los sistemas de videovigilancia que, en su caso, se instalen en la parcela serán responsabilidad del PROMOTOR desde la recepción de la obra, correspondiéndole el cumplimiento de la normativa aplicable en materia de señalización y tratamiento de imágenes.",
  },
  {
    title: "Jurisdicción y Resolución de Conflictos",
    text: "Las partes acuerdan intentar resolver cualquier discrepancia derivada del presente contrato mediante mediación, designando como mediador preferente al {mediator} o entidad de mediación equivalente. Si la mediación fracasara, las partes se someten expresamente a la jurisdicción de los Juzgados y Tribunales de {jurisdiction}, con renuncia expresa a cualquier otro fuero que pudiera corresponderles.",
  },
];
