/**
 * ENRUTADOR MODULAR DE PROCESAMIENTO POR VOZ E IA (H5 & B4)
 *
 * Desacoplamiento de server.ts conforme a la arquitectura modular de la Fase 4.
 * Endpoints protegidos por voiceProtectionMiddleware (30 req/min, 200/día, 1MB payload).
 */

import express from 'express';
import { Type } from '@google/genai';
import { getGeminiClient } from '../services/geminiService';
import { voiceProtectionMiddleware } from '../fiscal/voiceProtection';

export const voiceRouter = express.Router();

// Parser heurístico de contingencia (si no hay clave Gemini, alta demanda 503 o fallo de red)
export function normalizarTextoEspanolANumeros(texto: string): string {
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

export function fallbackParsePuesta(texto: string, naves: Array<{ id: string; codigo: string; nombre: string }>) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

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

  const extraerNumeroCerca = (palabrasClave: string[]): number | null => {
    for (const kw of palabrasClave) {
      const regex = new RegExp(`(?:${kw})\\D*?(\\d[\\d\\.\\s,]*)`, "i");
      const match = t.match(regex);
      if (match) {
        const num = parseInt(match[1].replace(/[\.,\s]/g, ""), 10);
        if (!isNaN(num)) return num;
      }
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

export function fallbackParseEnvasado(texto: string, lotes: any[], formatos: any[]) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

  let formatoSeleccionado = formatos[0] || { id: "fmt-1", nombre: "Estuche Docena", cantidadHuevos: 12 };
  for (const f of formatos) {
    if (t.includes(f.nombre.toLowerCase()) || (f.cantidadHuevos === 12 && (t.includes("docena") || t.includes("docenas")))) {
      formatoSeleccionado = f;
      break;
    }
  }

  let cantidadEstuches = 0;
  let maximoPosible = false;

  if (t.includes("máximo") || t.includes("maximo") || t.includes("todo") || t.includes("todos") || t.includes("lo que dé") || t.includes("lo que de")) {
    maximoPosible = true;
  } else {
    const matchEstuches = t.match(/(\d+)\s*(?:estuches|cajas|paquetes|unidades|docenas|bandejas)/);
    if (matchEstuches) {
      cantidadEstuches = parseInt(matchEstuches[1], 10);
    } else {
      const matchSoloNumero = t.match(/\b(\d+)\b/);
      if (matchSoloNumero) {
        cantidadEstuches = parseInt(matchSoloNumero[1], 10);
      }
    }
  }

  const lotesDisponibles = lotes.filter(l => (l.huevosDisponibles || 0) > 0);
  const asignaciones: Array<{ lotePuestaId: string; huevosPorEstuche: number }> = [];

  if (lotesDisponibles.length > 0) {
    const l1 = lotesDisponibles[0];
    asignaciones.push({
      lotePuestaId: l1.id,
      huevosPorEstuche: formatoSeleccionado.cantidadHuevos
    });
  }

  const extraerNumeroCerca = (palabrasClave: string[]): number => {
    for (const kw of palabrasClave) {
      const regex = new RegExp(`(?:${kw})\\D*?(\\d+)`, "i");
      const match = t.match(regex);
      if (match) return parseInt(match[1], 10);
      const revRegex = new RegExp(`(\\d+)\\D*?(?:${kw})`, "i");
      const revMatch = t.match(revRegex);
      if (revMatch) return parseInt(revMatch[1], 10);
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

export function fallbackParseVenta(texto: string, clientes: any[], lotesEnvasados: any[], formatos: any[], tipoDocActual: string) {
  const normalizado = normalizarTextoEspanolANumeros(texto);
  const t = normalizado.toLowerCase();

  let tipoDocumento = tipoDocActual || 'albaran';
  if (t.includes('factura') || t.includes('facturar') || t.includes('venta directa')) {
    tipoDocumento = 'factura_directa';
  } else if (t.includes('albarán') || t.includes('albaran') || t.includes('entrega')) {
    tipoDocumento = 'albaran';
  }

  let clienteSeleccionado = clientes[0] || { id: 'cli-1', nombre: 'Cliente General' };
  for (const c of clientes) {
    if (t.includes(c.nombre.toLowerCase())) {
      clienteSeleccionado = c;
      break;
    }
  }

  let formaPago = 'transferencia';
  if (t.includes('efectivo') || t.includes('contado') || t.includes('metálico') || t.includes('metalico')) {
    formaPago = 'efectivo';
  } else if (t.includes('bizum')) {
    formaPago = 'bizum';
  } else if (t.includes('recibo') || t.includes('domiciliado')) {
    formaPago = 'recibo_bancario';
  } else if (t.includes('pagaré') || t.includes('pagare')) {
    formaPago = 'pagare';
  }

  let cantidad = 10;
  const matchCant = t.match(/(\d+)\s*(?:estuches|docenas|cajas|bandejas|unidades)/);
  if (matchCant) {
    cantidad = parseInt(matchCant[1], 10);
  } else {
    const matchNum = t.match(/\b(\d+)\b/);
    if (matchNum) {
      cantidad = parseInt(matchNum[1], 10);
    }
  }

  let precio = 2.50;
  const matchPrecio = t.match(/(?:a|precio)?\s*(\d+[\.,]\d{1,2})\s*(?:€|euros)?/);
  if (matchPrecio) {
    precio = parseFloat(matchPrecio[1].replace(',', '.'));
  }

  const loteSeleccionado = lotesEnvasados.find(l => (l.estuchesDisponibles || 0) > 0) || lotesEnvasados[0] || { id: 'lote-1' };
  const lineas = [
    {
      loteEnvasadoId: loteSeleccionado.id,
      cantidadEstuches: cantidad,
      precioUnitario: precio
    }
  ];

  const resumen = `${tipoDocumento === 'albaran' ? 'Albarán' : 'Factura directa'} para ${clienteSeleccionado.nombre}: ${cantidad} estuches a ${precio.toFixed(2)} € (Pago: ${formaPago}).`;

  return {
    tipoDocumento,
    clienteId: clienteSeleccionado.id,
    formaPago,
    lineas,
    notas: `Dictado por voz: "${texto}"`,
    resumen
  };
}

// 1. Endpoint Puesta Diaria
voiceRouter.post(
  ["/interpretar-puesta-voz", "/interpretar-puesta", "/api/interpretar-puesta-voz", "/api/interpretar-puesta"],
  voiceProtectionMiddleware,
  async (req: any, res) => {
    const { texto, naves = [] } = req.body;

    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({ error: "El texto de voz es obligatorio" });
    }

    const ai = getGeminiClient();

    if (!ai) {
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
5. Genera un resumen claro en español en una frase corta para confirmación por audio.`;

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
                naveId: { type: Type.STRING, description: "ID exacto de la nave identificada" },
                totalRecogida: { type: Type.NUMBER, description: "Total de huevos recogidos" },
                rotos: { type: Type.NUMBER, description: "Huevos rotos o fisurados" },
                sucios: { type: Type.NUMBER, description: "Huevos sucios" },
                descarte: { type: Type.NUMBER, description: "Huevos descartados por defecto morfológico" },
                xl: { type: Type.NUMBER, nullable: true },
                l: { type: Type.NUMBER, nullable: true },
                m: { type: Type.NUMBER, nullable: true },
                s: { type: Type.NUMBER, nullable: true },
                observaciones: { type: Type.STRING },
                resumen: { type: Type.STRING, description: "Resumen verbal conciso en español" }
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
        continue;
      }
    }

    const resultadoFallback = fallbackParsePuesta(texto, naves);
    return res.json({
      metodo: "fallback_recuperacion",
      datos: resultadoFallback
    });
  }
);

// 2. Endpoint Envasado
voiceRouter.post(
  ["/interpretar-envasado-voz", "/interpretar-recogida", "/interpretar-envasado", "/api/interpretar-envasado-voz", "/api/interpretar-recogida", "/api/interpretar-envasado"],
  voiceProtectionMiddleware,
  async (req: any, res) => {
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
El operario acaba de dictar por voz una partida de envasado (puede ser monolote o multilote).
Tu misión es interpretar con máxima precisión el formato de envase, los lotes de puesta utilizados y las unidades producidas o mermas.

Formatos comerciales disponibles:
${formatosDesc}

Lotes de puesta disponibles en almacén con saldo de huevos:
${lotesDesc}

Texto dictado por el operario:
"${texto}"`;

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
                formatoId: { type: Type.STRING },
                cantidadEstuches: { type: Type.NUMBER },
                maximoPosible: { type: Type.BOOLEAN },
                asignaciones: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      lotePuestaId: { type: Type.STRING },
                      huevosPorEstuche: { type: Type.NUMBER }
                    },
                    required: ["lotePuestaId", "huevosPorEstuche"]
                  }
                },
                mermasRotos: { type: Type.NUMBER },
                mermasDescarte: { type: Type.NUMBER },
                motivoMerma: { type: Type.STRING },
                notas: { type: Type.STRING },
                resumen: { type: Type.STRING }
              },
              required: ["formatoId", "cantidadEstuches", "maximoPosible", "asignaciones", "mermasRotos", "mermasDescarte", "resumen"]
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
  }
);

// 3. Endpoint Ventas
voiceRouter.post(
  ["/interpretar-venta-voz", "/interpretar-voz", "/api/interpretar-venta-voz", "/api/interpretar-voz"],
  voiceProtectionMiddleware,
  async (req: any, res) => {
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
Texto dictado por el usuario:
"${texto}"`;

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
                tipoDocumento: { type: Type.STRING, enum: ["albaran", "factura_directa"] },
                clienteId: { type: Type.STRING },
                formaPago: { type: Type.STRING, enum: ["transferencia", "efectivo", "recibo_bancario", "bizum", "pagare"] },
                lineas: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      loteEnvasadoId: { type: Type.STRING },
                      cantidadEstuches: { type: Type.NUMBER },
                      precioUnitario: { type: Type.NUMBER }
                    },
                    required: ["loteEnvasadoId", "cantidadEstuches", "precioUnitario"]
                  }
                },
                notas: { type: Type.STRING },
                resumen: { type: Type.STRING }
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
  }
);
