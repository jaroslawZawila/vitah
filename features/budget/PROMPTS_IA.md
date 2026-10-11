# Integración de IA (Claude API) · Instrucciones exactas

La IA se llama **siempre desde el servidor** (nunca con la clave en el navegador) usando la API de Claude (Anthropic).
Documentación: https://platform.claude.com/docs/en/build-with-claude/pdf-support y https://platform.claude.com/docs/en/models/overview

## Modelos (IDs vigentes a 10/2026; confirmar en la documentación al implantar)

| Uso | Modelo | Motivo |
|---|---|---|
| Presupuesto · paso 1 (leer proyecto y planos) | `claude-opus-5-5` | Razonamiento complejo y lectura visual de planos |
| Presupuesto · pasos 2–5 (partidas por capítulos) | `claude-sonnet-5-5` | Equilibrio velocidad / calidad |
| Clasificar documentos (facturas, albaranes, fotos, certificados) | `claude-sonnet-5-5` (o `claude-haiku-5-5` si el volumen es alto) | Extracción rápida |

Parámetros orientativos: `max_tokens` 16000 en presupuestos, 4000 en clasificación. Respuesta en JSON: pedir "Responde SOLO con JSON" y validar con un esquema (zod/pydantic). Si el JSON no valida, reintentar una vez pidiendo corrección; si vuelve a fallar, mostrar error al usuario.

## Cómo enviar los documentos

- **PDF**: bloque `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":...}}` (o Files API con `file_id` para archivos grandes). Claude lee el texto y ve cada página como imagen, así que **los planos en PDF se envían enteros**; no hace falta renderizar páginas como en el prototipo. Límites: 32 MB por petición y hasta 600 páginas (100 si el contexto es menor de 1M). Poner el documento antes del texto.
- **Fotos**: bloque `image` (JPEG/PNG/WebP), reducidas a ~2000 px de lado.
- **Excel / BC3**: convertir a texto (CSV por hoja; BC3 parseado con una librería FIEBDC-3) antes de enviar. Los .xlsx/.docx no se admiten como documento.
- Proyectos de más de 32 MB: dividir (memoria, planos, mediciones) o subir con Files API.

---

## 1. Presupuesto automático

### Paso 1 · Datos del proyecto (`claude-opus-5-5`, con los PDF/imagenes de planos, proyecto básico, de ejecución y mediciones)

```
Eres el técnico de presupuestos de FRAMER, constructora de viviendas industrializadas con estructura Steel Frame (perfiles S350GD Magnelis, paneles Thermochip, aerotermia, suelo radiante, VMC). Lee la documentación de este proyecto y las imágenes de sus planos y extrae los datos para presupuestarlo.
Responde SOLO con JSON con esta forma:
{"datos":{"cliente":"","ubicacion":"","municipio":"","provincia":"","refCatastral":"","arquitecto":"","tipologia":"","plantas":0,"m2c":0,"m2u":0,"parcela":0},
 "superficies":{"planta":[{"nombre":"","m2c":0}],"fachada":0,"huecos":0,"cubierta":0,"perimetro":0,"forjados":0,"terrazas":0},
 "recuento":{"ventanas":0,"puertasExt":0,"puertasInt":0,"banos":0,"aseos":0,"dormitorios":0},
 "sistema":"resumen del sistema constructivo y calidades del proyecto en 5-8 líneas",
 "mediciones":[{"concepto":"","ud":"","cantidad":0,"fuente":"plano/medición/estimado"}],
 "incoherencias":["contradicciones entre documentos"],"supuestos":["datos que faltan y cómo se han supuesto"]}
Usa 0 o "" cuando un dato no aparezca y explícalo en supuestos. No inventes nombres ni referencias.
```

### Pasos 2–5 · Partidas (`claude-sonnet-5-5`), una llamada por grupo de capítulos
Grupos: `01–05`, `06–10`, `11–15`, `16–19`. Se adjunta la base de precios **filtrada** a esos capítulos (formato `código | descripción | ud | P.U.`) y el JSON del paso 1. `{CALIDAD}` = "Memoria de calidades FRAMER estándar" o "Respetar las calidades del proyecto".

```
Eres el técnico de presupuestos de FRAMER Steel Frame. Con los datos del proyecto, genera las partidas de los capítulos {LISTA_CAPÍTULOS}, adaptando el proyecto al sistema FRAMER ({CALIDAD}).
Reglas:
- Usa las partidas de la BASE DE PRECIOS FRAMER 2026 siempre que encajen, con su código, unidad y P.U. (los P.U. ya incluyen gastos generales y beneficio; no añadas nada).
- Las mediciones salen de los datos, superficies y mediciones del proyecto. Si estimas una medición, dilo en "nota".
- Si hace falta una partida que no está en la base, créala con código del capítulo y .9x (p. ej. 06.91), P.U. de mercado razonable y "fuente":"estimado".
- No incluyas imprevistos (el capítulo 20 se calcula aparte). Un capítulo puede quedar sin partidas si el proyecto no lo necesita.
Responde SOLO con JSON: {"capitulos":[{"cod":"01","partidas":[{"cod":"01.02","desc":"","ud":"m2","med":0,"pu":0,"fuente":"base|estimado","nota":""}]}]}
DATOS DEL PROYECTO (JSON): {JSON_PASO_1}
MEDICIONES DEL PROYECTO (extracto): {TEXTO_MEDICIONES}
BASE DE PRECIOS (código | descripción | ud | P.U. €):
{BASE_FILTRADA}
```

### Post-proceso (en código, no en la IA)
- Descartar partidas con medición o P.U. ≤ 0. Marcar `estimado=true` si `fuente="estimado"`.
- Importe de cada capítulo = Σ medición × P.U. Capítulo 20 (imprevistos) = 5 % de la suma de 01–19.
- Guardar como presupuesto `borrador`, revisión "Rev. 0 · IA", con `notas` = incoherencias + supuestos + sistema, y `ia_datos` = JSON del paso 1.
- Archivar los documentos subidos y vincularlos al presupuesto.
- Ejecutar como **tarea en segundo plano** (cola) con progreso visible: tarda varios minutos.

---

## 2. Subir y clasificar documentos (`claude-sonnet-5-5`)

Se adjunta el archivo (PDF o imagen) y un **contexto** generado en servidor con lo que el usuario puede ver:
- `OBRA {id} | {nombre} | cliente …` con sus capítulos y partidas (`partida {id} {código} {descripción}`), solo obras en ejecución.
- `PROVEEDOR {id} | {nombre} | CIF | tipo | documentos: …`
- `TRABAJADOR {id} | {nombre} | {empresa}`
- `PEDIDOS Y ALBARANES ABIERTOS:` `RECIBIDO {id} | proveedor | nº | obra cap | concepto | importe`

```
Eres el asistente administrativo de FRAMER (constructora Steel Frame). Te paso un archivo subido por el equipo ({NOMBRE_ARCHIVO}). Identifica qué es y dónde debe colocarse en la plataforma.
Tipos: factura_proveedor, albaran, foto_obra (foto o vídeo del avance de una obra), documento_proveedor (certificado AEAT, Seguridad Social, REA, seguro RC, TC2, reconocimiento médico, formación PRL, EPIs…), documento_obra (licencia, actas, libros, certificados de obra, ensayos…), otro.
Usa SOLO ids que aparezcan en el CONTEXTO. Si dudas, deja el id vacío y explícalo en "dudas".
Responde SOLO con JSON:
{"tipo":"","resumen":"una frase","confianza":0.0,"obra":"id o vacío","cap":"01-20 o vacío","partida":"id o vacío","proveedor":{"id":"","nombre":"","cif":"","tipo":"Subcontrata|Proveedor de material|Servicios técnicos"},"trabajador":"id o vacío",
"numero":"","fecha":"AAAA-MM-DD","base":0,"iva":"10|21|isp|0","ret":0,"total":0,"vence":"AAAA-MM-DD o vacío","albaranesRelacionados":["ids de albaranes abiertos que cubre la factura"],
"lineas":[{"concepto":"","importe":0,"cap":"","partida":""}],"documento":{"nombre":"nombre del documento tal como aparece en la lista del proveedor/trabajador u obra","caduca":"AAAA-MM-DD o vacío"},
"foto":{"pie":"descripción breve y neutra","hito":"H0-H9 o vacío"},"dudas":[]}
CONTEXTO:
{CONTEXTO}
```

### Reglas obligatorias
- **Nada se guarda sin confirmación humana**: la IA rellena una ficha editable; el usuario corrige y pulsa «Confirmar, colocar y archivar».
- Validar en servidor que los ids devueltos existen y que el usuario tiene permiso sobre esa obra.
- Al confirmar: guardar el archivo en el almacenamiento, crear proveedor si es nuevo, crear albarán / factura recibida (agrupando albaranes marcados) / evidencia / documento con caducidad, y registrar en `archivos` con el texto «Colocado en: …».
- Vídeos: no se envían a la IA (clasificación manual) salvo que se extraiga un fotograma.

## Coste y control
- Cada llamada se registra (usuario, tokens de entrada/salida, coste) en una tabla `ia_uso`, con límite mensual configurable por empresa.
- Texto de PDF: ~1.500–3.000 tokens por página más las imágenes de cada página.
- RGPD: los documentos contienen datos personales (DNI, nóminas). Revisar las condiciones de tratamiento de datos de la API y documentarlo en el registro de actividades.
