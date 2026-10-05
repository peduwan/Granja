/**
 * VALIDADOR NORMATIVO XSD REAL PARA ENTORNO NODE.JS / BACKEND (FASE 4.1)
 *
 * Utiliza libxml2 real (libxml2-wasm / xmllint) para validar el XML contra los esquemas XSD oficiales
 * de la Agencia Estatal de Administración Tributaria (AEAT):
 * - SuministroLR.xsd
 * - SuministroInformacion.xsd
 * - xmldsig-core-schema.xsd
 *
 * POLÍTICA FAIL-CLOSED ESTRICTA:
 * - Prohibido cualquier fallback silencioso a validadores sintácticos en memoria si el motor XSD
 *   o los archivos .xsd oficiales no están disponibles o fallan.
 * - Resolución determinista tanto en desarrollo (src/ y docs/) como en artefactos empaquetados
 *   de producción (dist/fiscal/libxml2XsdWorker.mjs y dist/fiscal/xsd/*.xsd).
 * - Tras superar la validación formal W3C XSD 1.0 en libxml2, aplica además las restricciones
 *   funcionales cruzadas de la Orden HAC/1177/2024 (coherencia TipoFactura <-> TipoRectificativa,
 *   ImporteRectificacion, Destinatarios, FacturasSustituidas, Tercero y Generador).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import { XMLParser } from 'fast-xml-parser';

export interface XmlValidationReport {
  valid: boolean;
  errors: string[];
  engine?: string;
}

function getModuleDir(): string {
  try {
    if (typeof __dirname === 'string' && __dirname) {
      return __dirname;
    }
  } catch {}
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * Resuelve de forma determinista la ruta del worker libxml2 tanto en el build de producción
 * (`dist/fiscal/libxml2XsdWorker.mjs`) como en desarrollo (`src/fiscal/libxml2XsdWorker.mjs`).
 */
export function resolveXsdWorkerPath(baseDir: string = process.cwd()): string {
  const modDir = getModuleDir();
  const candidates = [
    path.resolve(baseDir, 'dist/fiscal/libxml2XsdWorker.mjs'),
    path.resolve(modDir, 'fiscal/libxml2XsdWorker.mjs'),
    path.resolve(modDir, 'libxml2XsdWorker.mjs'),
    path.resolve(baseDir, 'src/fiscal/libxml2XsdWorker.mjs')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * Resuelve de forma determinista el esquema oficial SuministroLR.xsd tanto en el build de
 * producción (`dist/fiscal/xsd/SuministroLR.xsd`) como en desarrollo (`docs/fiscal/xsd/SuministroLR.xsd`).
 */
export function resolveDefaultOfficialXsdPath(baseDir: string = process.cwd()): string {
  const modDir = getModuleDir();
  const candidates = [
    path.resolve(baseDir, 'dist/fiscal/xsd/SuministroLR.xsd'),
    path.resolve(modDir, 'fiscal/xsd/SuministroLR.xsd'),
    path.resolve(modDir, 'xsd/SuministroLR.xsd'),
    path.resolve(baseDir, 'docs/fiscal/xsd/SuministroLR.xsd')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

let xsdWorker: Worker | null = null;
let xsdWorkerResolvedPath: string | null = null;

function getOrCreateXsdWorker(): Worker {
  const workerPath = resolveXsdWorkerPath();
  if (!fs.existsSync(workerPath)) {
    throw new Error(`No se encontró el worker de validación XSD libxml2 en '${workerPath}'.`);
  }
  if (xsdWorker && xsdWorkerResolvedPath === workerPath) {
    return xsdWorker;
  }
  const worker = new Worker(workerPath);
  worker.unref();
  worker.on('error', () => {
    xsdWorker = null;
    xsdWorkerResolvedPath = null;
  });
  worker.on('exit', () => {
    xsdWorker = null;
    xsdWorkerResolvedPath = null;
  });
  xsdWorker = worker;
  xsdWorkerResolvedPath = workerPath;
  return worker;
}

/**
 * Validaciones semánticas cruzadas exigidas por la Orden HAC/1177/2024 y el documento
 * de validaciones AEAT VERI*FACTU que el estándar W3C XSD 1.0 no puede expresar por sí solo
 * debido a que los elementos condicionales tienen minOccurs="0" en SuministroInformacion.xsd.
 */
function validateAeatCrossFieldRules(xmlString: string): string[] {
  const errors: string[] = [];
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: false,
      trimValues: true,
      parseTagValue: false
    });
    const parsed = parser.parse(xmlString);
    const root = parsed?.['sfLR:RegFactuSistemaFacturacion'];
    if (!root) return errors;

    let registros = root['sfLR:RegistroFactura'];
    if (!registros) return errors;
    if (!Array.isArray(registros)) {
      registros = [registros];
    }

    for (let i = 0; i < registros.length; i++) {
      const reg = registros[i];
      const alta = reg?.['sf:RegistroAlta'];
      const anulacion = reg?.['sf:RegistroAnulacion'];

      if (alta) {
        const tipoFactura = String(alta['sf:TipoFactura'] || '');
        const isRectificativa = ['R1', 'R2', 'R3', 'R4', 'R5'].includes(tipoFactura);
        const isSimplified = tipoFactura === 'F2' || tipoFactura === 'R5';
        const tipoRect = alta['sf:TipoRectificativa'] ? String(alta['sf:TipoRectificativa']) : undefined;
        const hasImporteRect = Boolean(alta['sf:ImporteRectificacion']);
        const hasFacturasRect = Boolean(alta['sf:FacturasRectificadas']);
        const hasFacturasSust = Boolean(alta['sf:FacturasSustituidas']);
        const hasDestinatarios = Boolean(alta['sf:Destinatarios']);
        const sinIdentifArt61d = String(alta['sf:FacturaSinIdentifDestinatarioArt61d'] || 'N');

        if (isRectificativa) {
          if (!tipoRect) {
            errors.push(`RegistroAlta #${i + 1}: TipoFactura '${tipoFactura}' requiere obligatoriamente '<sf:TipoRectificativa>' ('S' o 'I').`);
          } else if (tipoRect === 'S' && !hasImporteRect) {
            errors.push(`RegistroAlta #${i + 1}: TipoFactura '${tipoFactura}' por sustitución (TipoRectificativa='S') requiere obligatoriamente '<sf:ImporteRectificacion>'.`);
          } else if (tipoRect === 'I' && hasImporteRect) {
            errors.push(`RegistroAlta #${i + 1}: TipoFactura '${tipoFactura}' por diferencias (TipoRectificativa='I') no permite incluir '<sf:ImporteRectificacion>'.`);
          }
        } else {
          if (tipoRect || hasImporteRect || hasFacturasRect) {
            errors.push(`RegistroAlta #${i + 1}: TipoFactura '${tipoFactura}' no es rectificativa y no puede incluir TipoRectificativa, FacturasRectificadas ni ImporteRectificacion.`);
          }
        }

        if (hasFacturasSust && tipoFactura !== 'F3') {
          errors.push(`RegistroAlta #${i + 1}: '<sf:FacturasSustituidas>' solo está permitido para TipoFactura 'F3' (actual: '${tipoFactura}').`);
        }

        if (isSimplified) {
          if (hasDestinatarios) {
            errors.push(`RegistroAlta #${i + 1}: Las facturas simplificadas ('${tipoFactura}') no permiten bloque '<sf:Destinatarios>'.`);
          }
        } else {
          const allowNoRecipient = tipoFactura === 'F1' && sinIdentifArt61d === 'S';
          if (!hasDestinatarios && !allowNoRecipient) {
            errors.push(`RegistroAlta #${i + 1}: TipoFactura '${tipoFactura}' requiere obligatoriamente '<sf:Destinatarios>' con al menos un '<sf:IDDestinatario>'.`);
          }
        }

        const emitidaPor = alta['sf:EmitidaPorTerceroODestinatario'];
        if (emitidaPor === 'T' && !alta['sf:Tercero']) {
          errors.push(`RegistroAlta #${i + 1}: Cuando EmitidaPorTerceroODestinatario es 'T', el bloque '<sf:Tercero>' es obligatorio.`);
        }
      }

      if (anulacion) {
        const genPor = anulacion['sf:GeneradoPor'];
        if ((genPor === 'D' || genPor === 'T') && !anulacion['sf:Generador']) {
          errors.push(`RegistroAnulacion #${i + 1}: Cuando GeneradoPor es '${genPor}', el bloque '<sf:Generador>' es obligatorio.`);
        }
      }
    }
  } catch (err: any) {
    errors.push(`Error en validación cruzada AEAT: ${err?.message || String(err)}`);
  }
  return errors;
}

/**
 * Valida un documento XML contra los esquemas XSD oficiales de la AEAT (SuministroLR.xsd,
 * SuministroInformacion.xsd y xmldsig-core-schema.xsd) utilizando el motor real libxml2.
 *
 * FAIL-CLOSED: Si el archivo XSD no existe o el motor libxml2 falla, devuelve valid: false.
 * Nunca degrada ni hace fallback a validadores simulados.
 */
export function validateXmlAgainstOfficialXsd(
  xmlString: string,
  xsdFilePath?: string
): XmlValidationReport {
  if (!xmlString || typeof xmlString !== 'string' || xmlString.trim() === '') {
    return {
      valid: false,
      errors: ['El documento XML está vacío o no es una cadena válida.'],
      engine: 'libxml2-wasm'
    };
  }

  const schemaPath = xsdFilePath
    ? (xsdFilePath === 'RESPUESTA'
        ? path.join(path.dirname(resolveDefaultOfficialXsdPath()), 'RespuestaSuministro.xsd')
        : path.resolve(xsdFilePath))
    : resolveDefaultOfficialXsdPath();

  if (!fs.existsSync(schemaPath)) {
    return {
      valid: false,
      errors: [`FAIL-CLOSED: No se encontró el archivo de esquema oficial XSD en '${schemaPath}'.`],
      engine: 'libxml2-wasm'
    };
  }

  const xsdDir = path.dirname(schemaPath);
  const infoXsdPath = path.join(xsdDir, 'SuministroInformacion.xsd');
  const dsigXsdPath = path.join(xsdDir, 'xmldsig-core-schema.xsd');
  if (path.basename(schemaPath) === 'SuministroLR.xsd') {
    if (!fs.existsSync(infoXsdPath) || !fs.existsSync(dsigXsdPath)) {
      return {
        valid: false,
        errors: [
          `FAIL-CLOSED: Faltan esquemas XSD importados requeridos ('SuministroInformacion.xsd' o 'xmldsig-core-schema.xsd') en '${xsdDir}'.`
        ],
        engine: 'libxml2-wasm'
      };
    }
  }

  let xsdReport: XmlValidationReport;
  try {
    const worker = getOrCreateXsdWorker();
    const sharedBuf = new SharedArrayBuffer(4);
    const signal = new Int32Array(sharedBuf);
    const { port1, port2 } = new MessageChannel();

    worker.postMessage(
      {
        xmlString,
        schemaPath,
        signal,
        port: port2
      },
      [port2]
    );

    const waitResult = Atomics.wait(signal, 0, 0, 15000);
    if (waitResult === 'timed-out') {
      port1.close();
      xsdWorker = null;
      xsdWorkerResolvedPath = null;
      return {
        valid: false,
        errors: ['FAIL-CLOSED: Timeout ejecutando validación XSD oficial con motor libxml2.'],
        engine: 'libxml2-wasm'
      };
    }

    const msg = receiveMessageOnPort(port1);
    port1.close();

    if (!msg || !msg.message) {
      return {
        valid: false,
        errors: ['FAIL-CLOSED: El motor libxml2 no devolvió respuesta de validación XSD.'],
        engine: 'libxml2-wasm'
      };
    }

    xsdReport = msg.message as XmlValidationReport;
  } catch (err: any) {
    return {
      valid: false,
      errors: [`FAIL-CLOSED: Error crítico invocando el motor XSD oficial libxml2: ${err?.message || String(err)}`],
      engine: 'libxml2-wasm'
    };
  }

  if (!xsdReport.valid) {
    return xsdReport;
  }

  // Aplicar reglas semánticas cruzadas adicionales de VERI*FACTU sobre el XML de Suministro ya validado por XSD
  if (path.basename(schemaPath) !== 'RespuestaSuministro.xsd') {
    const crossFieldErrors = validateAeatCrossFieldRules(xmlString);
    if (crossFieldErrors.length > 0) {
      return {
        valid: false,
        errors: crossFieldErrors,
        engine: xsdReport.engine || 'libxml2-wasm'
      };
    }
  }

  return {
    valid: true,
    errors: [],
    engine: xsdReport.engine || 'libxml2-wasm'
  };
}

export const validateAeatXmlAgainstXsd = validateXmlAgainstOfficialXsd;
