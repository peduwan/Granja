import express from "express";
import path from "path";
import crypto from "crypto";
import QRCode from "qrcode";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { executeAeatSubmission, AeatFlowControlManager } from "./src/fiscal/aeatTransport";
import { AeatCertificateProvider } from "./src/fiscal/aeatCertificateProvider";
import { emitFiscalInvoice, emitFiscalAnulacion } from "./src/fiscal/emissionService";
import { BackendFiscalCustody } from "./src/fiscal/backendCustodyRepository";
import { verifyFiscalRecordHash } from "./src/fiscal/hashService";
import { createFiscalSubmission, resolveRecordOutboxState } from "./src/fiscal/submissionService";
import {
  executeAuthoritativeOutboxSubmission,
  collectEligibleOutboxRecordsForObligado,
  FiscalSubmissionHttpError
} from "./src/fiscal/outboxBatchProcessor";
import { FiscalRecord, FiscalConfiguration } from "./src/fiscal/types";
import { createDefaultFiscalConfiguration } from "./src/fiscal/modelTransformers";
import { getAeatSoapEndpoint } from "./src/fiscal/aeatEndpoints";
import {
  requireFiscalAuthMiddleware,
  assertObligadoAuthorized,
  FiscalAuthenticatedRequest
} from "./src/fiscal/backendAuth";

dotenv.config();

// AUTORIDAD FISCAL DISTRIBUIDA EN SERVIDOR:
// El servidor real opera con autoridad Firestore obligatoria de forma predeterminada
if (!process.env.FISCAL_COORDINATOR_MODE) {
  process.env.FISCAL_COORDINATOR_MODE = 'firestore';
}

const app = express();
const PORT = 3000;

app.use(express.json());

// Inicialización diferida de Gemini SDK
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

// Endpoint de salud
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", aiEnabled: Boolean(process.env.GEMINI_API_KEY) });
});

// Parser heurístico de contingencia (si no hay clave Gemini, alta demanda 503 o fallo de red)
function normalizarTextoEspanolANumeros(texto: string): string {
  let t = texto.toLowerCase();

  const mapa: Record<string, number> = {
    'cero': 0, 'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4,
    'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    'dieciséis': 16, 'dieciseis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19,
    'veinte': 20, 'veintiuno': 21, 'veintidós': 22, 'veintidos': 22, 'veintitrés': 23, 'veintitres': 23,
    'veinticuatro': 24, 'veinticinco': 25, 'veintiséis': 26, 'veintiseis': 26, 'veintisiete': 27,
    'veintiocho': 28, 'veintinueve': 29, 'treinta': 30, 'cuarenta': 40, 'cincuenta': 50,
    'sesenta': 60, 'setenta': 70, 'ochenta': 80, 'noventa': 90,
    'cien': 100, 'ciento': 100, 'doscientos': 200, 'doscientas': 200,
    'trescientos': 300, 'trescientas': 300, 'cuatrocientos': 400, 'cuatrocientas': 400,
    'quinientos': 500, 'quinientas': 500, 'seiscientos': 600, 'seiscientas': 600,
    'setecientos': 700, 'setecientas': 700, 'ochocientos': 800, 'ochocientas': 800,
    'novecientos': 900, 'novecientas': 900
  };

  // Normalizar construcciones de miles: ej. "dos mil seiscientos cincuenta", "mil cuatrocientos"
  t = t.replace(/\b(un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)?\s*mil\s*(doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|ciento|cien|\d+)?/gi, (match, miles, resto) => {
    let cantMiles = 1;
    if (miles) {
      if (mapa[miles.toLowerCase()] !== undefined) cantMiles = mapa[miles.toLowerCase()];
      else if (!isNaN(parseInt(miles, 10))) cantMiles = parseInt(miles, 10);
    }
    let cantResto = 0;
    if (resto) {
      if (mapa[resto.toLowerCase()] !== undefined) cantResto = mapa[resto.toLowerCase()];
      else if (!isNaN(parseInt(resto, 10))) cantResto = parseInt(resto, 10);
    }
    return ` ${cantMiles * 1000 + cantResto} `;
  });

  // Reemplazar decenas y unidades tipo "treinta y cinco"
  t = t.replace(/\b(treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+y\s+(un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, (_, dec, uni) => {
    const d = mapa[dec.toLowerCase()] || 0;
    const u = mapa[uni.toLowerCase()] || 0;
    return ` ${d + u} `;
  });

  // Reemplazar palabras sueltas restantes
  for (const [palabra, valor] of Object.entries(mapa)) {
    const reg = new RegExp(`\\b${palabra}\\b`, 'gi');
    t = t.replace(reg, ` ${valor} `);
  }

  return t;
}

function fallbackParsePuesta(texto: string, naves: Array<{ id: string; codigo: string; nombre: string }>) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

  // Buscar nave
  let naveId = naves[0]?.id || "";
  for (const n of naves) {
    if (
      t.includes(n.codigo.toLowerCase()) ||
      t.includes(n.nombre.toLowerCase()) ||
      (n.nombre.toLowerCase().includes("nave 1") && (t.includes("nave 1") || t.includes("nave uno"))) ||
      (n.nombre.toLowerCase().includes("nave 2") && (t.includes("nave 2") || t.includes("nave dos")))
    ) {
      naveId = n.id;
      break;
    }
  }

  // Extraer números
  const extraerNumeroCerca = (palabrasClave: string[]): number | null => {
    for (const kw of palabrasClave) {
      const regex = new RegExp(`(?:${kw})\\D*?(\\d[\\d\\.\\s,]*)`, "i");
      const match = t.match(regex);
      if (match) {
        const num = parseInt(match[1].replace(/[\.,\s]/g, ""), 10);
        if (!isNaN(num)) return num;
      }
      // También al revés: "20 rotos"
      const revRegex = new RegExp(`(\\d[\\d\\.\\s,]*)\\D*?(?:${kw})`, "i");
      const revMatch = t.match(revRegex);
      if (revMatch) {
        const num = parseInt(revMatch[1].replace(/[\.,\s]/g, ""), 10);
        if (!isNaN(num)) return num;
      }
    }
    return null;
  };

  let total = extraerNumeroCerca(["recogid", "huevos", "total", "puest"]) || 0;
  const rotos = extraerNumeroCerca(["roto", "rotos", "fisur", "cascad"]) || 0;
  const sucios = extraerNumeroCerca(["sucio", "sucios", "manchad"]) || 0;
  const descarte = extraerNumeroCerca(["descarte", "defect", "deforme"]) || 0;

  const xl = extraerNumeroCerca(["xl", "super"]) || null;
  const l = extraerNumeroCerca(["l ", "grandes"]) || null;
  const m = extraerNumeroCerca(["m ", "medianos"]) || null;
  const s = extraerNumeroCerca(["s ", "pequeñ"]) || null;

  // Si no se dictó el total pero sí calibres o mermas, el total es la suma
  const totalMermas = rotos + sucios + descarte;
  const totalCalibres = (xl || 0) + (l || 0) + (m || 0) + (s || 0);
  if (total === 0 && (totalCalibres > 0 || totalMermas > 0)) {
    total = totalCalibres + totalMermas;
  }

  const naveEncontrada = naves.find(n => n.id === naveId);
  const nombreNave = naveEncontrada?.nombre || "Nave 1";

  return {
    naveId,
    totalRecogida: total,
    rotos,
    sucios,
    descarte,
    xl,
    l,
    m,
    s,
    observaciones: `Dictado por voz: "${texto}"`,
    resumen: `${nombreNave}: ${total.toLocaleString()} huevos recogidos (${rotos} rotos, ${sucios} sucios, ${descarte} descarte)`
  };
}

// Endpoint para interpretar dictado de voz de Puesta Diaria
app.post("/api/interpretar-puesta-voz", async (req, res) => {
  const { texto, naves = [] } = req.body;

  if (!texto || typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ error: "El texto de voz es obligatorio" });
  }

  const ai = getGeminiClient();

  if (!ai) {
    // Fallback determinista seguro sin IA
    const resultadoLocal = fallbackParsePuesta(texto, naves);
    return res.json({
      metodo: "heuristico_local",
      datos: resultadoLocal
    });
  }

  const navesDesc = naves.map((n: any) => `- ID: "${n.id}", Código: "${n.codigo}", Nombre: "${n.nombre}"`).join("\n");

  const prompt = `Eres el asistente de inteligencia de voz para operarios en una granja avícola.
El operario acaba de dictar el parte de puesta diaria. Tu tarea es extraer con precisión los datos numéricos y de nave.

Naves disponibles en la granja:
${navesDesc}

Texto dictado por el operario:
"${texto}"

Reglas:
1. Identifica a cuál de las naves disponibles se refiere el operario (ej. "nave 1", "campero", "ecológica", etc.). Si no la menciona, usa la primera nave disponible.
2. Extrae la cantidad total de huevos recogidos (ej. "dos mil cuatrocientos" = 2400).
3. Extrae las mermas de recogida si las menciona: rotos, sucios, descarte morfológico. Si no menciona alguna merma, indícala como 0.
4. Si menciona calibres clasificados (XL, L, M, S), extrae sus cantidades numéricas. Si no los desglosa, pon null o no los fuerces.
5. Genera un resumen claro en lenguaje coloquial amigable para confirmar con el operario.`;

  // Cascada de modelos ante picos de demanda o disponibilidad
  const modelsToTry = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              naveId: { type: Type.STRING, description: "El ID exacto de la nave identificada" },
              totalRecogida: { type: Type.NUMBER, description: "Total de huevos recogidos" },
              rotos: { type: Type.NUMBER, description: "Huevos rotos o cascados" },
              sucios: { type: Type.NUMBER, description: "Huevos sucios o manchados" },
              descarte: { type: Type.NUMBER, description: "Huevos descartados" },
              xl: { type: Type.NUMBER, nullable: true, description: "Calibre XL si se especificó" },
              l: { type: Type.NUMBER, nullable: true, description: "Calibre L si se especificó" },
              m: { type: Type.NUMBER, nullable: true, description: "Calibre M si se especificó" },
              s: { type: Type.NUMBER, nullable: true, description: "Calibre S si se especificó" },
              observaciones: { type: Type.STRING, description: "Cualquier incidencia adicional mencionada" },
              resumen: { type: Type.STRING, description: "Breve frase resumen para confirmación visual" }
            },
            required: ["naveId", "totalRecogida", "rotos", "sucios", "descarte", "resumen"]
          }
        }
      });

      const parsedJson = JSON.parse(response.text || "{}");
      return res.json({
        metodo: "gemini_ai",
        modelo: modelName,
        datos: parsedJson
      });
    } catch (_err) {
      // Continuar con el siguiente modelo de la lista sin registrar error ruidoso
      continue;
    }
  }

  // Si todos los modelos de IA tuvieron alta demanda 503, recuperación limpia e inmediata con parser determinista
  const resultadoFallback = fallbackParsePuesta(texto, naves);
  return res.json({
    metodo: "fallback_recuperacion",
    datos: resultadoFallback
  });
});

// Parser determinista para Envasado y Multilote
function fallbackParseEnvasado(
  texto: string,
  lotes: Array<{ id: string; codigoLote: string; nombreNave: string; huevosDisponibles: number }>,
  formatos: Array<{ id: string; nombre: string; cantidadHuevos: number }>
) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

  // 1. Detectar Formato
  let formatoSeleccionado = formatos[0];
  if (t.includes("media docena") || t.includes("6 huevos") || t.includes("seis huevos")) {
    const fmt6 = formatos.find(f => f.cantidadHuevos === 6);
    if (fmt6) formatoSeleccionado = fmt6;
  } else if (t.includes("bandeja") || t.includes("maple") || t.includes("30 huevos") || t.includes("treinta huevos")) {
    const fmt30 = formatos.find(f => f.cantidadHuevos === 30);
    if (fmt30) formatoSeleccionado = fmt30;
  } else if (t.includes("10 huevos") || t.includes("diez huevos")) {
    const fmt10 = formatos.find(f => f.cantidadHuevos === 10);
    if (fmt10) formatoSeleccionado = fmt10;
  } else {
    // Por defecto docena si está disponible
    const fmt12 = formatos.find(f => f.cantidadHuevos === 12);
    if (fmt12) formatoSeleccionado = fmt12;
  }

  const huevosTotalesEnvase = formatoSeleccionado?.cantidadHuevos || 12;

  // 2. Detectar "Máximo posible"
  const maximoPosible = Boolean(
    t.includes("maximo") ||
    t.includes("máximo") ||
    t.includes("todo") ||
    t.includes("lo que de") ||
    t.includes("hasta que se acabe") ||
    t.includes("agotar")
  );

  // 3. Detectar Cantidad de Estuches
  let cantidadEstuches: number | null = null;
  const matchEstuches =
    t.match(/(?:envasar|hacer|producir|preparar)?\s*(\d+)\s*(?:estuches|docenas|medias docenas|bandejas|cajas|paquetes|uds|unidades)/i) ||
    t.match(/(\d+)\s*(?:estuches|docenas|medias docenas|bandejas|cajas|paquetes)/i);

  if (matchEstuches) {
    cantidadEstuches = parseInt(matchEstuches[1], 10);
  } else if (!maximoPosible) {
    // Buscar cualquier primer número antes de mencionar naves o huevos
    const primerNum = t.match(/\b(\d+)\b/);
    if (primerNum) {
      const n = parseInt(primerNum[1], 10);
      if (n > 0 && n <= 5000) cantidadEstuches = n;
    }
  }

  // 4. Identificar Lotes mencionados
  const lotesDetectados: Array<{ lote: typeof lotes[0]; huevosMencionados?: number }> = [];

  for (const lote of lotes) {
    const cod = lote.codigoLote.toLowerCase();
    const nom = lote.nombreNave.toLowerCase();
    const nave1Match = nom.includes("nave 1") && (t.includes("nave 1") || t.includes("nave uno"));
    const nave2Match = nom.includes("nave 2") && (t.includes("nave 2") || t.includes("nave dos"));
    const nave3Match = nom.includes("nave 3") && (t.includes("nave 3") || t.includes("nave tres"));

    if (t.includes(cod) || t.includes(nom) || nave1Match || nave2Match || nave3Match) {
      // Buscar si antes o después de la mención del lote hay un número de huevos específico
      // ej: "8 huevos de la nave 1", "6 de nave 2", "nave 1 con 4 huevos"
      let huevosAsignados: number | undefined;
      const regexHuevos = new RegExp(`(\\d+)\\s*(?:huevos)?\\s*(?:de|del|con)?\\s*(?:la\\s*)?(?:${nom}|${cod}|nave 1|nave 2|nave 3)`, "i");
      const matchH = t.match(regexHuevos);
      if (matchH) {
        huevosAsignados = parseInt(matchH[1], 10);
      } else {
        const regexRev = new RegExp(`(?:${nom}|${cod}|nave 1|nave 2|nave 3)\\D*?(\\d+)\\s*huevos`, "i");
        const matchRev = t.match(regexRev);
        if (matchRev) {
          huevosAsignados = parseInt(matchRev[1], 10);
        }
      }

      lotesDetectados.push({ lote, huevosMencionados: huevosAsignados });
    }
  }

  // Si no se detectó ningún lote, tomar los primeros disponibles con stock
  let lotesFinales: Array<{ lote: typeof lotes[0]; huevosMencionados?: number }> = lotesDetectados.length > 0
    ? lotesDetectados
    : lotes.slice(0, 1).map(l => ({ lote: l, huevosMencionados: undefined }));

  // REGLA SANITARIA: En un estuche NUNCA se mezclan huevos de distintas naves.
  // Si se detectaron lotes de naves distintas, conservar solo los que pertenezcan a la nave del primer lote.
  if (lotesFinales.length > 1) {
    const primeraNave = lotesFinales[0].lote.nombreNave;
    lotesFinales = lotesFinales.filter(lf => lf.lote.nombreNave === primeraNave);
  }

  // 5. Configurar asignaciones (huevos por estuche)
  const asignaciones: Array<{ lotePuestaId: string; huevosPorEstuche: number }> = [];

  if (lotesFinales.length === 1) {
    // Un solo lote
    const l0 = lotesFinales[0];
    const n = cantidadEstuches || 1;
    const maxAporte = Math.floor((l0.lote.huevosDisponibles || 0) / n);
    const hPorEst = l0.huevosMencionados !== undefined
      ? l0.huevosMencionados
      : Math.min(huevosTotalesEnvase, maxAporte > 0 ? maxAporte : (l0.lote.huevosDisponibles || huevosTotalesEnvase));

    asignaciones.push({
      lotePuestaId: l0.lote.id,
      huevosPorEstuche: Math.min(huevosTotalesEnvase, hPorEst)
    });
  } else if (lotesFinales.length >= 2) {
    // Multilote
    const esPartesIguales = t.includes("mitad") || t.includes("partes iguales") || t.includes("a partes iguales") || t.includes("50%");
    const esCompletar = t.includes("complet") || t.includes("gastando") || t.includes("lo que queda") || t.includes("resto");

    if (lotesFinales[0].huevosMencionados !== undefined && lotesFinales[1].huevosMencionados !== undefined) {
      // Reparto explícito dictado por el operario (ej. "8 de nave 1 y 4 de nave 2")
      asignaciones.push({
        lotePuestaId: lotesFinales[0].lote.id,
        huevosPorEstuche: lotesFinales[0].huevosMencionados
      });
      asignaciones.push({
        lotePuestaId: lotesFinales[1].lote.id,
        huevosPorEstuche: lotesFinales[1].huevosMencionados
      });
    } else if (esPartesIguales) {
      // Reparto a partes iguales
      const mitad = Math.floor(huevosTotalesEnvase / 2);
      asignaciones.push({
        lotePuestaId: lotesFinales[0].lote.id,
        huevosPorEstuche: mitad
      });
      asignaciones.push({
        lotePuestaId: lotesFinales[1].lote.id,
        huevosPorEstuche: huevosTotalesEnvase - mitad
      });
    } else if (esCompletar) {
      // Gastar lote 1 y completar con lote 2
      const n = cantidadEstuches || 1;
      const dispLote1 = lotesFinales[0].lote.huevosDisponibles || 0;
      const aporte1 = Math.min(huevosTotalesEnvase - 1, Math.floor(dispLote1 / n));
      const aporte2 = huevosTotalesEnvase - aporte1;

      asignaciones.push({
        lotePuestaId: lotesFinales[0].lote.id,
        huevosPorEstuche: Math.max(1, aporte1)
      });
      asignaciones.push({
        lotePuestaId: lotesFinales[1].lote.id,
        huevosPorEstuche: Math.max(1, aporte2)
      });
    } else {
      // Si se dictaron 2 lotes sin desglose numérico, partir equitativamente
      const mitad = Math.floor(huevosTotalesEnvase / 2);
      asignaciones.push({
        lotePuestaId: lotesFinales[0].lote.id,
        huevosPorEstuche: mitad
      });
      asignaciones.push({
        lotePuestaId: lotesFinales[1].lote.id,
        huevosPorEstuche: huevosTotalesEnvase - mitad
      });
    }
  }

  // 6. Mermas de Envasado
  const extraerNumeroCerca = (palabrasClave: string[]): number => {
    for (const kw of palabrasClave) {
      const r1 = new RegExp(`(?:${kw})\\D*?(\\d+)`, "i");
      const m1 = t.match(r1);
      if (m1) return parseInt(m1[1], 10);
      const r2 = new RegExp(`(\\d+)\\D*?(?:${kw})`, "i");
      const m2 = t.match(r2);
      if (m2) return parseInt(m2[1], 10);
    }
    return 0;
  };

  const rotos = extraerNumeroCerca(["roto", "rotos", "cascad", "rotura"]);
  const descarte = extraerNumeroCerca(["descarte", "descartados", "sucios", "no aptos", "deforme"]);

  const descAsig = asignaciones
    .map(a => {
      const l = lotes.find(x => x.id === a.lotePuestaId);
      return `${a.huevosPorEstuche} huevos de ${l?.nombreNave || "Lote"}`;
    })
    .join(" + ");

  const resumen = `${cantidadEstuches ? `${cantidadEstuches} estuches` : (maximoPosible ? "Máximo posible" : "Envasado")} de ${formatoSeleccionado.nombre} (${descAsig})${rotos > 0 ? `, con ${rotos} rotos` : ""}${descarte > 0 ? ` y ${descarte} descartes` : ""}.`;

  return {
    formatoId: formatoSeleccionado.id,
    cantidadEstuches,
    maximoPosible,
    asignaciones,
    mermasRotos: rotos,
    mermasDescarte: descarte,
    motivoMerma: rotos > 0 ? "Merma dictada por voz en envasado" : "",
    notas: `Dictado por voz: "${texto}"`,
    resumen
  };
}

// Endpoint para interpretar dictado de voz de Envasado (incluido Multilote)
app.post("/api/interpretar-envasado-voz", async (req, res) => {
  const { texto, lotes = [], formatos = [] } = req.body;

  if (!texto || typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ error: "El texto de voz es obligatorio" });
  }

  const ai = getGeminiClient();

  if (!ai) {
    const resultadoLocal = fallbackParseEnvasado(texto, lotes, formatos);
    return res.json({
      metodo: "heuristico_local",
      datos: resultadoLocal
    });
  }

  const formatosDesc = formatos.map((f: any) => `- ID: "${f.id}", Nombre: "${f.nombre}", Capacidad: ${f.cantidadHuevos} huevos`).join("\n");
  const lotesDesc = lotes.map((l: any) => `- ID: "${l.id}", Lote: "${l.codigoLote}", Nave: "${l.nombreNave}", Huevos disponibles: ${l.huevosDisponibles}, Fecha puesta: ${l.fechaPuesta || ""}`).join("\n");

  const prompt = `Eres el asistente experto de inteligencia de voz para operarios en la sala de clasificación y envasado de una granja avícola.
El operario acaba de dictar por voz una orden de envasado (puede ser de un solo lote o MULTILOTE con 2 o más lotes en el mismo estuche).
Tu tarea es interpretar con máxima precisión todos los parámetros para rellenar el formulario de envasado.

Formatos comerciales disponibles:
${formatosDesc}

Lotes de puesta origen con stock disponibles:
${lotesDesc}

Texto dictado por el operario:
"${texto}"

INSTRUCCIONES CLAVE:
1. REGLA SANITARIA ESTRICTA DE LA EXPLOTACIÓN: En un estuche NUNCA se mezclan huevos de distintas naves. Todas las asignaciones deben pertenecer OBLIGATORIAMENTE a la MISMA NAVE (pueden ser distintos lotes/fechas de recogida de esa misma nave). Si el operario menciona distintas naves por error, usa únicamente los lotes de la primera nave mencionada y acláralo en el resumen.
2. formatoId: Identifica el formato comercial deseado (ej. docena = 12 huevos, media docena = 6 huevos, bandeja/maple = 30 huevos). Selecciona el ID exacto de la lista de formatos disponibles.
3. cantidadEstuches: Cantidad numérica de estuches/paquetes a producir (ej. "50 docenas" -> 50, "veinte estuches" -> 20). Si el operario dice "el máximo posible", "todo", "hasta que se acabe", o "lo que dé", pon cantidadEstuches como null y marca maximoPosible en true.
4. maximoPosible: true si el operario pide producir el máximo estuches con el stock disponible.
5. asignaciones (MULTILOTE): Array de objetos { lotePuestaId, huevosPorEstuche }.
   - MUY IMPORTANTE: La suma de todos los "huevosPorEstuche" en las asignaciones DEBE ser igual a la capacidad de huevos del formato seleccionado (por ejemplo, 12 para una docena, 6 para media docena, etc.).
   - Prioriza siempre el lote más antiguo (FIFO) para que se agote primero.
   - Caso 1: Lote único dictado -> Un único elemento en asignaciones con huevosPorEstuche = capacidad del formato.
   - Caso 2: Reparto explícito de lotes de la misma nave -> Asignar según lo solicitado.
   - Caso 3: A partes iguales entre lotes de la misma nave -> Repartir a partes iguales.
   - Caso 4: Completar o gastar -> Asigna al lote más antiguo el máximo que permite su stock para los estuches indicados y el resto a otro lote de la misma nave para completar el estuche.
6. mermasRotos: Cantidad de huevos rotos o cascados durante el envasado (0 si no se menciona).
7. mermasDescarte: Cantidad de huevos descartados o sucios (0 si no se menciona).
8. motivoMerma: Breve motivo si lo comenta (ej. "rotos en clasificadora").
9. notas: Breve nota con el dictado original.
10. resumen: Frase resumen clara y amigable en español confirmando exactamente la orden interpretada.`;

  const modelsToTry = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              formatoId: { type: Type.STRING, description: "ID exacto del formato comercial seleccionado" },
              cantidadEstuches: { type: Type.NUMBER, nullable: true, description: "Cantidad de estuches a producir o null si es maximoPosible" },
              maximoPosible: { type: Type.BOOLEAN, description: "True si el operario solicita producir el máximo posible" },
              asignaciones: {
                type: Type.ARRAY,
                description: "Composición de lotes por estuche. La suma de huevosPorEstuche debe igualar la capacidad del envase.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lotePuestaId: { type: Type.STRING, description: "ID del lote de puesta origen" },
                    huevosPorEstuche: { type: Type.NUMBER, description: "Cantidad exacta de huevos de este lote en cada estuche" }
                  },
                  required: ["lotePuestaId", "huevosPorEstuche"]
                }
              },
              mermasRotos: { type: Type.NUMBER, description: "Huevos rotos en manipulación o empaque" },
              mermasDescarte: { type: Type.NUMBER, description: "Huevos descartados por peso o defectos" },
              motivoMerma: { type: Type.STRING, description: "Motivo de la merma si se menciona" },
              notas: { type: Type.STRING, description: "Notas o dictado" },
              resumen: { type: Type.STRING, description: "Resumen cordial para confirmación visual del operario" }
            },
            required: ["formatoId", "maximoPosible", "asignaciones", "mermasRotos", "mermasDescarte", "resumen"]
          }
        }
      });

      const parsedJson = JSON.parse(response.text || "{}");
      return res.json({
        metodo: "gemini_ai",
        modelo: modelName,
        datos: parsedJson
      });
    } catch (_err) {
      continue;
    }
  }

  const resultadoFallback = fallbackParseEnvasado(texto, lotes, formatos);
  return res.json({
    metodo: "fallback_recuperacion",
    datos: resultadoFallback
  });
});

// Parser determinista de respaldo para Ventas (Albaranes y Facturas)
function fallbackParseVenta(
  texto: string,
  clientes: Array<{ id: string; nombre: string; cifNif: string }>,
  lotesEnvasados: Array<{
    id: string;
    codigoLoteEnvasado: string;
    formatoId: string;
    nombreFormato: string;
    estuchesDisponibles: number;
    codigoLotePuesta?: string;
    nombreNave?: string;
    precioVenta?: number;
  }>,
  formatos: Array<{ id: string; nombre: string; cantidadHuevos: number; precioVenta: number }>,
  tipoDocActual: string = 'albaran'
) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

  // 1. Tipo de Documento
  let tipoDocumento: 'albaran' | 'factura_directa' = (tipoDocActual === 'factura_directa' ? 'factura_directa' : 'albaran');
  if (t.includes('factura') || t.includes('facturar') || t.includes('venta directa')) {
    tipoDocumento = 'factura_directa';
  } else if (t.includes('albaran') || t.includes('albarán') || t.includes('entrega') || t.includes('remito')) {
    tipoDocumento = 'albaran';
  }

  // 2. Cliente
  let clienteEncontrado = clientes[0];
  let mejorPuntuacionCliente = 0;

  for (const c of clientes) {
    const nombreC = c.nombre.toLowerCase();
    const cifC = (c.cifNif || '').toLowerCase();
    let puntos = 0;

    if (t.includes(nombreC)) {
      puntos += 10;
    } else {
      const palabras = nombreC.split(/\s+/).filter(p => p.length > 3 && !['para', 'los', 'las', 'del', 'sociedad', 'hermanos', 'restaurante', 'bar'].includes(p));
      for (const p of palabras) {
        if (t.includes(p)) puntos += 3;
      }
    }

    if (cifC && t.includes(cifC)) {
      puntos += 15;
    }

    if (puntos > mejorPuntuacionCliente) {
      mejorPuntuacionCliente = puntos;
      clienteEncontrado = c;
    }
  }

  // 3. Forma de Pago (si es factura)
  let formaPago: 'transferencia' | 'efectivo' | 'recibo_bancario' | 'bizum' | 'pagare' = 'transferencia';
  if (t.includes('contado') || t.includes('efectivo') || t.includes('mano') || t.includes('metalico') || t.includes('metálico')) {
    formaPago = 'efectivo';
  } else if (t.includes('bizum')) {
    formaPago = 'bizum';
  } else if (t.includes('pagare') || t.includes('pagaré')) {
    formaPago = 'pagare';
  } else if (t.includes('domicili') || t.includes('banco directo') || t.includes('recibo')) {
    formaPago = 'recibo_bancario';
  } else if (t.includes('transferencia')) {
    formaPago = 'transferencia';
  }

  // 4. Extraer precio unitario si se menciona en el texto
  let precioMencionado: number | null = null;
  const matchPrecio =
    t.match(/a\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros|euro)?(?:\s*cada\s*uno|\s*el\s*estuche|\s*unidad|\s*la\s*docena)?/i) ||
    t.match(/precio\s*(?:de)?\s*(\d+(?:[.,]\d+)?)/i);

  if (matchPrecio) {
    const numStr = matchPrecio[1].replace(',', '.');
    const p = parseFloat(numStr);
    if (!isNaN(p) && p > 0 && p < 100) {
      precioMencionado = p;
    }
  }

  // 5. Extraer cantidad de estuches
  let cantidadDetectada = 10;
  const matchCant =
    t.match(/(\d+)\s*(?:estuches|docenas|medias docenas|bandejas|cajas|paquetes|uds|unidades)/i) ||
    t.match(/(?:enviar|entregar|vender|facturar|poner)\s*(\d+)/i);

  if (matchCant) {
    const c = parseInt(matchCant[1], 10);
    if (c > 0) cantidadDetectada = c;
  } else {
    const primerNum = t.match(/\b(\d+)\b/);
    if (primerNum) {
      const c = parseInt(primerNum[1], 10);
      if (c > 0 && c <= 2000) cantidadDetectada = c;
    }
  }

  // 6. Seleccionar Lote(s) Envasado(s)
  const lotesConStock = lotesEnvasados.filter(l => l.estuchesDisponibles > 0);
  const poolLotes = lotesConStock.length > 0 ? lotesConStock : lotesEnvasados;

  let loteSeleccionado = poolLotes[0];

  // Buscar formato específico (ej. docena, media docena, bandeja)
  if (t.includes('media docena') || t.includes('6 huevos')) {
    const lMatch = poolLotes.find(l => (l.nombreFormato || '').toLowerCase().includes('media') || (l.nombreFormato || '').includes('6'));
    if (lMatch) loteSeleccionado = lMatch;
  } else if (t.includes('bandeja') || t.includes('maple') || t.includes('30 huevos')) {
    const lMatch = poolLotes.find(l => (l.nombreFormato || '').toLowerCase().includes('bandeja') || (l.nombreFormato || '').includes('30'));
    if (lMatch) loteSeleccionado = lMatch;
  } else if (t.includes('docena') || t.includes('12 huevos')) {
    const lMatch = poolLotes.find(l => (l.nombreFormato || '').toLowerCase().includes('docena') && !(l.nombreFormato || '').toLowerCase().includes('media'));
    if (lMatch) loteSeleccionado = lMatch;
  }

  // Buscar coincidencia por nave o código
  for (const l of poolLotes) {
    const codPuesta = (l.codigoLotePuesta || '').toLowerCase();
    const nomNave = (l.nombreNave || '').toLowerCase();
    const codEnv = (l.codigoLoteEnvasado || '').toLowerCase();
    if ((nomNave && t.includes(nomNave)) || (codPuesta && t.includes(codPuesta)) || (codEnv && t.includes(codEnv))) {
      loteSeleccionado = l;
      break;
    }
  }

  // Determinar precio final
  const formatoAsoc = formatos.find(f => f.id === loteSeleccionado?.formatoId);
  const precioFinal = precioMencionado !== null
    ? precioMencionado
    : (loteSeleccionado?.precioVenta || formatoAsoc?.precioVenta || 2.50);

  const lineas = loteSeleccionado ? [{
    loteEnvasadoId: loteSeleccionado.id,
    cantidadEstuches: cantidadDetectada,
    precioUnitario: precioFinal
  }] : [];

  const tipoLabel = tipoDocumento === 'albaran' ? 'Albarán' : 'Factura Directa';
  const clienteNombre = clienteEncontrado ? clienteEncontrado.nombre : 'Cliente seleccionado';
  const formatoNombre = loteSeleccionado?.nombreFormato || 'Estuches';
  const subtotalEst = (cantidadDetectada * precioFinal).toFixed(2);

  const resumen = `${tipoLabel} para ${clienteNombre}: ${cantidadDetectada} ${formatoNombre} a ${precioFinal.toFixed(2)} €/ud (Subtotal: ${subtotalEst} €)${tipoDocumento === 'factura_directa' ? ` · Pago: ${formaPago}` : ''}.`;

  return {
    tipoDocumento,
    clienteId: clienteEncontrado?.id || '',
    formaPago,
    lineas,
    notas: `Dictado por voz: "${texto}"`,
    resumen
  };
}

// Endpoint para interpretar dictado de voz de Ventas (Albaranes y Facturas)
app.post("/api/interpretar-venta-voz", async (req, res) => {
  const { texto, clientes = [], lotesEnvasados = [], formatos = [], tipoDocActual = 'albaran' } = req.body;

  if (!texto || typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ error: "El texto de voz es obligatorio" });
  }

  const ai = getGeminiClient();

  if (!ai) {
    const resultadoLocal = fallbackParseVenta(texto, clientes, lotesEnvasados, formatos, tipoDocActual);
    return res.json({
      metodo: "heuristico_local",
      datos: resultadoLocal
    });
  }

  const clientesDesc = clientes.map((c: any) => `- ID: "${c.id}", Nombre: "${c.nombre}", CIF: "${c.cifNif || ''}", Recargo Eq: ${c.recargoEquivalencia ? 'Sí' : 'No'}`).join("\n");
  const lotesDesc = lotesEnvasados.map((l: any) => `- ID: "${l.id}", Formato: "${l.nombreFormato || ''}", Lote Envasado: "${l.codigoLoteEnvasado || ''}", Lote Puesta: "${l.codigoLotePuesta || ''}", Nave: "${l.nombreNave || ''}", Estuches disponibles: ${l.estuchesDisponibles}, Precio base: ${l.precioVenta || 2.50} €`).join("\n");
  const formatosDesc = formatos.map((f: any) => `- ID: "${f.id}", Nombre: "${f.nombre}", Capacidad: ${f.cantidadHuevos} huevos, Precio recomendado: ${f.precioVenta} €`).join("\n");

  const prompt = `Eres el asistente experto de inteligencia de voz para el departamento de ventas, expediciones y facturación de una explotación avícola.
El usuario dicta por micrófono una orden para emitir un ALBARÁN de entrega o una FACTURA DIRECTA a un cliente.

Tu misión es interpretar con máxima precisión todos los parámetros para rellenar el formulario de venta sin errores.

Tipo de documento actual en la pantalla: "${tipoDocActual}"

Clientes registrados en el catálogo:
${clientesDesc}

Partidas de lotes envasados disponibles en almacén:
${lotesDesc}

Formatos comerciales:
${formatosDesc}

Texto dictado por el usuario:
"${texto}"

INSTRUCCIONES CLAVE:
1. tipoDocumento: 'albaran' si menciona "albarán", "albaran", "entrega", "albaranes"; 'factura_directa' si menciona "factura", "facturar", "venta directa". Si no especifica ninguno de los dos términos, mantén "${tipoDocActual}".
2. clienteId: Identifica al cliente destinatario exacto comparando el texto con la lista de clientes. Devuelve su ID exacto. Si no coincide con ninguno, usa el primer cliente disponible.
3. formaPago: En caso de factura, identifica la forma de pago mencionada: 'transferencia' (por defecto), 'efectivo' (si dice efectivo, contado, metálico), 'recibo_bancario' (si dice recibo o domiciliado), 'bizum', o 'pagare'. Si es albarán, pon 'transferencia'.
4. lineas: Array de partidas a vender/expedir { loteEnvasadoId, cantidadEstuches, precioUnitario }.
   - loteEnvasadoId: ID exacto del lote envasado que mejor coincida con el formato (docena, media docena, bandeja de 30) o con el lote/nave mencionado. Prioriza lotes con estuches disponibles > 0.
   - cantidadEstuches: Número entero de estuches a expedir (ej: "veinte docenas" -> 20, "50 estuches" -> 50).
   - precioUnitario: Precio numérico por estuche en euros (ej: "a 2,70 euros" -> 2.70, "a tres euros" -> 3.00). Si el usuario no menciona precio explícito en el dictado, usa el precio recomendado del lote o del formato comercial.
   - Si el dictado incluye múltiples productos (ej. "20 docenas camperas y 10 bandejas de 30"), genera una línea por cada producto.
5. notas: Observaciones o notas adicionales indicadas (ej. "entrega en muelle 2", "urgente por la mañana").
6. resumen: Una frase concisa, cordial y profesional en español resumiendo el documento interpretado (cliente, tipo, líneas, precio y forma de pago).`;

  const modelsToTry = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tipoDocumento: { type: Type.STRING, enum: ["albaran", "factura_directa"], description: "Tipo de documento: albaran o factura_directa" },
              clienteId: { type: Type.STRING, description: "ID del cliente destinatario en el catálogo" },
              formaPago: { type: Type.STRING, enum: ["transferencia", "efectivo", "recibo_bancario", "bizum", "pagare"], description: "Forma de pago acordada" },
              lineas: {
                type: Type.ARRAY,
                description: "Líneas de producto a incluir en el documento",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    loteEnvasadoId: { type: Type.STRING, description: "ID del lote envasado" },
                    cantidadEstuches: { type: Type.NUMBER, description: "Cantidad de estuches a vender" },
                    precioUnitario: { type: Type.NUMBER, description: "Precio unitario por estuche en euros" }
                  },
                  required: ["loteEnvasadoId", "cantidadEstuches", "precioUnitario"]
                }
              },
              notas: { type: Type.STRING, description: "Notas adicionales o dictado original" },
              resumen: { type: Type.STRING, description: "Resumen claro en español confirmando la operación" }
            },
            required: ["tipoDocumento", "clienteId", "formaPago", "lineas", "resumen"]
          }
        }
      });

      const parsedJson = JSON.parse(response.text || "{}");
      return res.json({
        metodo: "gemini_ai",
        modelo: modelName,
        datos: parsedJson
      });
    } catch (_err) {
      continue;
    }
  }

  const resultadoFallback = fallbackParseVenta(texto, clientes, lotesEnvasados, formatos, tipoDocActual);
  return res.json({
    metodo: "fallback_recuperacion",
    datos: resultadoFallback
  });
});

// --- ENDPOINTS FASE 3.1.3: AUTORIDAD FISCAL, CUSTODIA Y TRANSPORTE AEAT ---

// 1. Emisión de Factura Fiscal con autoridad exclusiva en backend
app.post("/api/fiscal/emit-invoice", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const { invoiceDraft, fiscalConfig, obligadoTributarioId, nifEmisor } = req.body;
    if (!invoiceDraft) {
      return res.status(400).json({ error: "Faltan datos obligatorios: invoiceDraft es requerido." });
    }

    const rawNif = (obligadoTributarioId || nifEmisor || fiscalConfig?.nifEmisor || fiscalConfig?.obligadoTributarioId || "").trim().toUpperCase();
    if (!rawNif || rawNif === 'ES_UNKNOWN' || rawNif === 'B12345678') {
      return res.status(400).json({ error: "NIF de emisor obligatorio y válido requerido (prohibido vacío, B12345678 o ES_UNKNOWN)." });
    }

    // Validación de identidad y autorización estricta del obligado tributario
    let verifiedObligado = '';
    try {
      verifiedObligado = assertObligadoAuthorized(req.fiscalUser!, rawNif);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    if (!invoiceDraft.numeroFactura || !invoiceDraft.fecha) {
      return res.status(400).json({ error: "numeroFactura y fecha de expedición son obligatorios." });
    }

    // AUTORIDAD EXCLUSIVA DE SERVIDOR (P1):
    // La configuración fiscal se genera autoritativamente en el backend.
    // El cliente NO puede forzar modoFiscal, versionEspecificacion, sistemaInformatico ni remisionAutomatica.
    const serverFiscalConfig = createDefaultFiscalConfiguration({
      nif: verifiedObligado,
      nombreRazon: (req.body.nombreRazon || invoiceDraft.emisorNombre || 'Gestión Avícola AgroTech Software S.L.').trim()
    });

    const result = await emitFiscalInvoice({
      invoiceDraft,
      fiscalConfig: serverFiscalConfig,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    return res.json({
      success: true,
      invoice: result.invoice,
      fiscalRecord: result.fiscalRecord,
      fiscalRecordRef: result.fiscalRecordRef
    });
  } catch (err: any) {
    console.error("Error en emisión fiscal backend:", err);
    return res.status(500).json({ error: err.message || "Error al emitir factura fiscal en backend" });
  }
});

// 2. Emisión de Anulación Fiscal con autoridad exclusiva en backend
app.post("/api/fiscal/emit-anulacion", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const { facturaAnulada, fiscalConfig, obligadoTributarioId, nifEmisor } = req.body;
    if (!facturaAnulada) {
      return res.status(400).json({ error: "Faltan datos obligatorios: facturaAnulada es requerida." });
    }

    const rawObligado = (obligadoTributarioId || nifEmisor || fiscalConfig?.obligadoTributarioId || fiscalConfig?.nifEmisor || "").trim().toUpperCase();
    if (!rawObligado || rawObligado === 'ES_UNKNOWN') {
      return res.status(400).json({ error: "obligadoTributarioId obligatorio y no puede ser ES_UNKNOWN." });
    }

    let verifiedObligado = '';
    try {
      verifiedObligado = assertObligadoAuthorized(req.fiscalUser!, rawObligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    const serverFiscalConfig = createDefaultFiscalConfiguration({
      nif: verifiedObligado,
      nombreRazon: (req.body.nombreRazon || 'Gestión Avícola AgroTech Software S.L.').trim()
    });

    const result = await emitFiscalAnulacion({
      facturaAnulada,
      fiscalConfig: serverFiscalConfig,
      obligadoTributarioId: verifiedObligado,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    return res.json({
      success: true,
      fiscalRecord: result.fiscalRecord,
      fiscalRecordRef: result.fiscalRecordRef
    });
  } catch (err: any) {
    console.error("Error en anulación fiscal backend:", err);
    return res.status(500).json({ error: err.message || "Error al anular factura fiscal en backend" });
  }
});

// 3. Consulta de registros en custodia de backend
app.get("/api/fiscal/records", requireFiscalAuthMiddleware, (req: FiscalAuthenticatedRequest, res) => {
  const obligado = typeof req.query.obligado === 'string' ? req.query.obligado : undefined;
  if (obligado) {
    try {
      assertObligadoAuthorized(req.fiscalUser!, obligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }
  } else if (!req.fiscalUser!.isOwner) {
    return res.status(403).json({ error: "Debe especificar un parámetro 'obligado' autorizado." });
  }
  const records = BackendFiscalCustody.getAllFiscalRecords(obligado);
  res.json({ records, count: records.length });
});

app.get("/api/fiscal/records/:id", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  const record = await BackendFiscalCustody.getFiscalRecordByIdAsync(req.params.id);
  if (!record) {
    return res.status(404).json({ error: `FiscalRecord '${req.params.id}' no encontrado en custodia de backend.` });
  }
  try {
    assertObligadoAuthorized(req.fiscalUser!, record.obligadoTributarioId);
  } catch (authErr: any) {
    return res.status(authErr.statusCode || 403).json({ error: authErr.message });
  }
  res.json(record);
});

// 4. Estado de certificado (exclusivamente información pública sin secretos)
app.get("/api/fiscal/cert-status", (_req, res) => {
  res.json({
    available: AeatCertificateProvider.hasCertificate(),
    environment: process.env.AEAT_ENVIRONMENT || 'testing',
    transportMode: process.env.AEAT_TRANSPORT_MODE || (AeatCertificateProvider.hasCertificate() ? 'real' : 'mock')
  });
});

function getServerFiscalConfig(record: FiscalRecord): FiscalConfiguration {
  const isProdEnv = process.env.AEAT_ENVIRONMENT === 'produccion' || process.env.AEAT_ENVIRONMENT === 'production';
  const entornoAeat = isProdEnv ? 'produccion' : 'pruebas';
  const hasCert = AeatCertificateProvider.hasCertificate();
  const endpointUrl = getAeatSoapEndpoint(isProdEnv ? 'production' : 'test');

  return {
    obligadoTributarioId: record.obligadoTributarioId,
    nifEmisor: record.emisor.nif,
    nombreRazonEmisor: record.emisor.nombreRazon,
    modalidad: 'VERI_FACTU',
    entornoAeat,
    versionEspecificacion: '1.0',
    sistemaInformatico: {
      nombreRazon: 'Gestión Avícola Software S.L.',
      nif: 'B99999999',
      nombreSistemaInformatico: 'Gestión Avícola SIF',
      idSistemaInformatico: '01',
      version: '1.0.0',
      numeroInstalacion: 'INST-001',
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N'
    },
    remisionAutomatica: true,
    reintentosMaximos: 3,
    minutosEntreReintentos: 5,
    transporte: {
      endpointUrl,
      timeoutMs: 30000,
      certificadoConfigurado: hasCert
    },
    certificadoConfigurado: hasCert,
    fechaActivacion: new Date().toISOString()
  };
}

// 5. Remisión a AEAT (unitaria 1 registro o por lote 1..1000 registros + Outbox)
// con verificación criptográfica estricta, cerrojo distribuido con heartbeat y control de flujo AEAT.
// Exige fiscalRecordId, fiscalRecordIds (1..1000) o batchFromOutbox preexistentes en custodia de backend.
const handleAuthoritativeFiscalSubmit = async (req: FiscalAuthenticatedRequest, res: express.Response) => {
  try {
    // SEGURIDAD ESTRICTA: El cliente NO tiene autoridad sobre el XML, el endpoint, las cabeceras,
    // el transporte ni la configuración. Se aceptan ÚNICAMENTE 'fiscalRecordId', 'fiscalRecordIds' (1..1000)
    // o 'batchFromOutbox' + 'obligadoTributarioId' + 'maxBatchSize'.
    // Cualquier 'submission', 'config', 'options' o 'endpointOverride' enviado por el cliente es totalmente ignorado.
    const {
      fiscalRecordId,
      fiscalRecordIds,
      batchFromOutbox,
      obligadoTributarioId,
      maxBatchSize
    } = req.body || {};

    const result = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId,
      fiscalRecordIds,
      batchFromOutbox: Boolean(batchFromOutbox),
      obligadoTributarioId,
      maxBatchSize: maxBatchSize !== undefined ? Number(maxBatchSize) : undefined,
      actor: {
        tipo: 'USER',
        id: req.fiscalUser?.uid,
        email: req.fiscalUser?.email,
        nombre: req.fiscalUser?.email || 'AuthenticatedOperator'
      },
      authorizeObligadoFn: (obligadoId: string) => {
        assertObligadoAuthorized(req.fiscalUser!, obligadoId);
      }
    });

    return res.json(result);
  } catch (err: any) {
    if (err instanceof FiscalSubmissionHttpError) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        ...(err.details || {})
      });
    }
    if (err?.statusCode === 403 || err?.statusCode === 401) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Error en remisión AEAT backend:", err.message);
    const statusCode = err?.statusCode === 409 || err?.code === 'CONCURRENT_SEND_LOCKED' ? 409 : 500;
    return res.status(statusCode).json({
      error: statusCode === 409 ? "Conflicto de concurrencia en remisión AEAT" : "Error en el transporte AEAT",
      message: err.message
    });
  }
};

app.post("/api/fiscal/submit", requireFiscalAuthMiddleware, handleAuthoritativeFiscalSubmit);
app.post("/api/fiscal/submit/batch", requireFiscalAuthMiddleware, handleAuthoritativeFiscalSubmit);

// 6. Consulta autoritativa del estado Outbox y cola de registros pendientes de remisión por obligado
app.get("/api/fiscal/outbox/pending", requireFiscalAuthMiddleware, async (req: FiscalAuthenticatedRequest, res) => {
  try {
    const obligado = typeof req.query.obligado === 'string' ? req.query.obligado.trim() : '';
    if (!obligado) {
      return res.status(400).json({ error: "Parámetro 'obligado' obligatorio." });
    }
    try {
      assertObligadoAuthorized(req.fiscalUser!, obligado);
    } catch (authErr: any) {
      return res.status(authErr.statusCode || 403).json({ error: authErr.message });
    }

    const { eligibleRecords, statesByRecordId } = await collectEligibleOutboxRecordsForObligado(obligado, 1000);
    const allRecords = BackendFiscalCustody.getAllFiscalRecords(obligado);
    const summaryByRecord = allRecords.map(r => {
      const st = statesByRecordId.get(r.id) || resolveRecordOutboxState(r.id, BackendFiscalCustody.getFiscalSubmissions(r.id));
      return {
        fiscalRecordId: r.id,
        numeroFactura: r.factura.numeroFactura,
        tipoRegistro: r.tipoRegistro,
        status: st.status,
        isAccepted: st.isAccepted,
        isRejected: st.isRejected,
        isSending: st.isSending,
        isPendingOrRetryable: st.isPendingOrRetryable,
        totalAttempts: st.totalAttempts,
        csv: st.latestRecordResult?.csv || st.acceptedSubmission?.csv,
        codigoError: st.latestRecordResult?.codigoErrorRegistro
      };
    });

    return res.json({
      obligadoTributarioId: obligado,
      pendingCount: eligibleRecords.length,
      pendingRecordIds: eligibleRecords.map(r => r.id),
      recordsSummary: summaryByRecord
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 500).json({ error: err.message });
  }
});

// Vite middleware para dev y serving para producción
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !isHmrDisabled,
        watch: isHmrDisabled ? null : {}
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor Avícola ejecutándose en http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Error fatal iniciando el servidor Avícola:", err);
  process.exit(1);
});
