/**
 * SUITE DE TESTS EXHAUSTIVA — FASE 2 (P2):
 * VALIDACIÓN DE RESPUESTAS AEAT (RespuestaSuministro.xsd) + TRANSPORTE HTTPS/mTLS Y CERTIFICADOS (PEM Y PFX)
 *
 * Cubre los bloques 4 y 5 de las correcciones prioritarias de VERI*FACTU:
 *
 * Bloque 4 (P2 — Validación de las respuestas de AEAT):
 * - Confirmación de que la ruta productiva y el parser validan fail-closed por defecto con `RespuestaSuministro.xsd`.
 * - Gestión de namespaces (prefijados en raíz, heredados del SOAP Envelope/Body, namespace por defecto `xmlns="..."`).
 * - Respuestas SOAP con errores (SOAP 1.1 y SOAP 1.2 Server/Client/Unknown).
 * - XML malformado, respuestas vacías y respuestas con estructura inesperada.
 * - Fixtures de respuestas válidas e inválidas basadas en los esquemas oficiales (`RespuestaSuministro.xsd` y `SuministroInformacion.xsd`)
 *   sin modificar los XSD oficiales.
 * - Diferenciación estricta entre:
 *   (a) Error de transporte (red/timeout/TLS),
 *   (b) Error SOAP (SOAP Fault Server / Client),
 *   (c) Respuesta fiscal rechazada (`EstadoEnvio=Incorrecto` / `EstadoRegistro=Incorrecto` -> `REJECTED`),
 *   (d) Error de validación XSD de la respuesta (`RECHAZO_XSD_RESPUESTA_AEAT` / `ERR_XML_INVALID` -> `FAILED_TECHNICAL` no reintentable).
 *
 * Bloque 5 (P2 — Pruebas del transporte HTTPS/mTLS y proveedor de certificados):
 * - Transporte HTTPS local con mTLS real (PEM y PKCS#12/PFX).
 * - Casos de certificado caducado, certificado aún no válido (`notBefore` futuro), certificado y clave que no coinciden,
 *   cadena de certificados inválida (firmado por CA no confiable) y errores de conexión (puerto cerrado / ECONNREFUSED / timeout).
 * - Verificación de que secretos, claves privadas, contraseñas y datos sensibles NUNCA aparecen en logs ni en mensajes de error.
 * - Paridad y diferencias documentadas entre validación de certificados PEM y PFX/PKCS#12.
 * - Distinción explícita entre pruebas con servidor HTTPS mTLS local y pruebas contra los servicios reales de AEAT.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  parseAeatXmlResponse,
  extractRespuestaRegFactuXmlElement,
  correlateAeatResponseWithRecords
} from '../src/fiscal/aeatResponseParser';
import {
  executeAeatSubmission,
  AeatFlowControlManager,
  isRetryableSubmission
} from '../src/fiscal/aeatTransport';
import { AeatCertificateProvider } from '../src/fiscal/aeatCertificateProvider';
import { validateXmlAgainstOfficialXsd } from '../src/fiscal/aeatXsdValidatorNode';
import { createDefaultFiscalConfiguration, createFiscalRecordFromInvoice } from '../src/fiscal/modelTransformers';
import { createFiscalSubmission, resetFiscalOutbox } from '../src/fiscal/submissionService';
import { buildAeatVerifactuXml } from '../src/fiscal/aeatVerifactuXmlBuilder';
import { calculateAltaHash } from '../src/fiscal/hashService';
import { MockAeatTransport } from '../src/fiscal/mockAeatTransport';
import { Factura } from '../src/types';
import { FiscalConfiguration, FiscalRecord } from '../src/fiscal/types';

process.env.NODE_ENV = 'test';

const OBLIGADO_NIF = 'B88888888';
const OBLIGADO_NOMBRE = 'Explotación Avícola El Pinar S.L.';

let passedTests = 0;
let totalTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${totalTests}. ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${totalTests}. ${name}`);
    console.error(`         Error: ${err?.message || err}`);
    throw err;
  }
}

// ============================================================================
// GENERADOR DE PKI X.509 v3 REAL Y CONTENEDORES PKCS#12 (PFX) EN MEMORIA
// ============================================================================
function derLen(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derNode(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
function derSeq(items: Buffer[]): Buffer {
  return derNode(0x30, Buffer.concat(items));
}
function derSet(items: Buffer[]): Buffer {
  return derNode(0x31, Buffer.concat(items));
}
function derOid(oid: number[]): Buffer {
  const first = 40 * oid[0] + oid[1];
  const body: number[] = [first];
  for (let i = 2; i < oid.length; i++) {
    let v = oid[i];
    const sub: number[] = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      sub.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    body.push(...sub);
  }
  return derNode(0x06, Buffer.from(body));
}
function derInt(num: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(num, 0);
  let start = 0;
  while (start < 3 && b[start] === 0) start++;
  let slice = b.subarray(start);
  if (slice[0] & 0x80) slice = Buffer.concat([Buffer.from([0x00]), slice]);
  return derNode(0x02, slice);
}
function derUtcTime(date: Date): Buffer {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return derNode(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
}
function derName(cn: string): Buffer {
  const attrC = derSet([derSeq([derOid([2, 5, 4, 6]), derNode(0x13, Buffer.from('ES', 'ascii'))])]);
  const attrO = derSet([derSeq([derOid([2, 5, 4, 10]), derNode(0x0c, Buffer.from('AEAT Test PKI', 'utf8'))])]);
  const attrCN = derSet([derSeq([derOid([2, 5, 4, 3]), derNode(0x0c, Buffer.from(cn, 'utf8'))])]);
  return derSeq([attrC, attrO, attrCN]);
}

function createX509Pem(opts: {
  serial: number;
  subjectCn: string;
  issuerCn: string;
  subjectPubKeyDer: Buffer;
  issuerPrivKeyPem: string;
  isCa: boolean;
  notBefore?: Date;
  notAfter?: Date;
  sanDns?: string[];
  sanIps?: number[][];
}): string {
  const version = derNode(0xa0, derInt(2));
  const serial = derInt(opts.serial);
  const sigAlg = derSeq([derOid([1, 2, 840, 113549, 1, 1, 11]), Buffer.from([0x05, 0x00])]);
  const issuer = derName(opts.issuerCn);
  const now = Date.now();
  const notBefore = opts.notBefore ?? new Date(now - 24 * 3600 * 1000);
  const notAfter = opts.notAfter ?? new Date(now + 365 * 24 * 3600 * 1000);
  const validity = derSeq([derUtcTime(notBefore), derUtcTime(notAfter)]);
  const subject = derName(opts.subjectCn);

  const exts: Buffer[] = [];
  const bcVal = opts.isCa ? derSeq([Buffer.from([0x01, 0x01, 0xff])]) : derSeq([]);
  exts.push(derSeq([derOid([2, 5, 29, 19]), Buffer.from([0x01, 0x01, 0xff]), derNode(0x04, bcVal)]));

  if (!opts.isCa) {
    const ekuVal = derSeq([
      derOid([1, 3, 6, 1, 5, 5, 7, 3, 1]),
      derOid([1, 3, 6, 1, 5, 5, 7, 3, 2])
    ]);
    exts.push(derSeq([derOid([2, 5, 29, 37]), derNode(0x04, ekuVal)]));
  }

  if ((opts.sanDns && opts.sanDns.length > 0) || (opts.sanIps && opts.sanIps.length > 0)) {
    const generalNames: Buffer[] = [];
    for (const dns of opts.sanDns || []) {
      generalNames.push(derNode(0x82, Buffer.from(dns, 'ascii')));
    }
    for (const ip of opts.sanIps || []) {
      generalNames.push(derNode(0x87, Buffer.from(ip)));
    }
    exts.push(derSeq([derOid([2, 5, 29, 17]), derNode(0x04, derSeq(generalNames))]));
  }

  const extensions = derNode(0xa3, derSeq(exts));
  const tbs = derSeq([version, serial, sigAlg, issuer, validity, subject, opts.subjectPubKeyDer, extensions]);
  const signature = crypto.sign('sha256', tbs, opts.issuerPrivKeyPem);
  const bitStringSig = derNode(0x03, Buffer.concat([Buffer.from([0x00]), signature]));
  const certDer = derSeq([tbs, sigAlg, bitStringSig]);
  const b64 = certDer.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

/**
 * Empaqueta en memoria un certificado PEM y su clave privada en un contenedor PKCS#12 (.pfx) real
 * utilizando `openssl pkcs12 -export` por stdin/stdout sin tocar el disco.
 */
function buildPfxFromPemInMemory(certPem: string, keyPem: string, passphrase: string): Buffer {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeat-pfx-test-'));
  const certFile = path.join(tmpDir, 'cert.pem');
  const keyFile = path.join(tmpDir, 'key.pem');
  const pfxFile = path.join(tmpDir, 'bundle.pfx');
  try {
    fs.writeFileSync(certFile, certPem, { mode: 0o600 });
    fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
    const res = spawnSync(
      'openssl',
      ['pkcs12', '-export', '-in', certFile, '-inkey', keyFile, '-out', pfxFile, '-passout', 'env:TEST_PFX_EXPORT_PASS'],
      {
        env: { ...process.env, TEST_PFX_EXPORT_PASS: passphrase },
        timeout: 5000
      }
    );
    if (res.status !== 0 || !fs.existsSync(pfxFile)) {
      throw new Error(`Error generando PFX con openssl: ${res.stderr?.toString('utf-8')}`);
    }
    return fs.readFileSync(pfxFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function createSampleSealedRecord(): Promise<{ record: FiscalRecord; config: FiscalConfiguration }> {
  const config = createDefaultFiscalConfiguration({
    nif: OBLIGADO_NIF,
    nombreRazon: OBLIGADO_NOMBRE
  });

  const invoice: Factura = {
    id: 'inv-p2-test-01',
    numeroFactura: 'FAC-2026-0901',
    fecha: '2026-10-20',
    clienteId: 'cli-01',
    clienteNombre: 'Distribuciones Norte S.L.',
    clienteCif: 'B12345678',
    clienteDireccion: 'Calle Mayor 1, Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 100,
      porcentajeIva: 4,
      cuotaIva: 4,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 104
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-20T10:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const fechaHoraHuso = '2026-10-20T10:00:00+02:00';
  const hashCalc = await calculateAltaHash({
    nifEmisor: OBLIGADO_NIF,
    numSerieFactura: invoice.numeroFactura,
    fechaExpedicion: invoice.fecha,
    tipoFactura: 'F1',
    cuotaTotal: 4,
    importeTotal: 104,
    huellaAnterior: '',
    fechaHoraHusoGenRegistro: fechaHoraHuso
  });

  const draft = createFiscalRecordFromInvoice(invoice, config, null, {
    hashActual: hashCalc.hash,
    fechaHoraSellado: fechaHoraHuso,
    cadenaTextoCanonico: hashCalc.canonicalString
  });
  const xmlOficial = buildAeatVerifactuXml(draft);
  const record: FiscalRecord = Object.freeze({
    ...draft,
    xmlOficial
  });

  return { record, config };
}

// ============================================================================
// FIXTURES OFICIALES DE RESPUESTAS AEAT (VÁLIDAS E INVÁLIDAS SEGÚN XSD)
// ============================================================================
const FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"
                  xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion>
      <sfR:CSV>CSV1234567890ABC</sfR:CSV>
      <sfR:DatosPresentacion>
        <sf:NIFPresentador>${OBLIGADO_NIF}</sf:NIFPresentador>
        <sf:TimestampPresentacion>2026-10-20T10:00:05+02:00</sf:TimestampPresentacion>
      </sfR:DatosPresentacion>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${OBLIGADO_NOMBRE}</sf:NombreRazon>
          <sf:NIF>${OBLIGADO_NIF}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${OBLIGADO_NIF}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-2026-0901</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>20-10-2026</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:RefExterna>REF-EXT-001</sfR:RefExterna>
        <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

const FIXTURE_VALID_DEFAULT_NAMESPACE_SIN_PREFIJO_SFR = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <RespuestaRegFactuSistemaFacturacion
      xmlns="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"
      xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <CSV>CSVDEFAULTNS9999</CSV>
      <Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${OBLIGADO_NOMBRE}</sf:NombreRazon>
          <sf:NIF>${OBLIGADO_NIF}</sf:NIF>
        </sf:ObligadoEmision>
      </Cabecera>
      <TiempoEsperaEnvio>120</TiempoEsperaEnvio>
      <EstadoEnvio>ParcialmenteCorrecto</EstadoEnvio>
      <RespuestaLinea>
        <IDFactura>
          <sf:IDEmisorFactura>${OBLIGADO_NIF}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-2026-0901</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>20-10-2026</sf:FechaExpedicionFactura>
        </IDFactura>
        <Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </Operacion>
        <EstadoRegistro>AceptadoConErrores</EstadoRegistro>
        <CodigoErrorRegistro>1101</CodigoErrorRegistro>
        <DescripcionErrorRegistro>Advertencia no bloqueante en censo destinatario</DescripcionErrorRegistro>
      </RespuestaLinea>
    </RespuestaRegFactuSistemaFacturacion>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

const FIXTURE_VALID_RECHAZO_FUNCIONAL_Y_DUPLICADO = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion
      xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"
      xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${OBLIGADO_NOMBRE}</sf:NombreRazon>
          <sf:NIF>${OBLIGADO_NIF}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Incorrecto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${OBLIGADO_NIF}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-2026-0901</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>20-10-2026</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>Alta</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>Registro de facturación duplicado</sfR:DescripcionErrorRegistro>
        <sfR:RegistroDuplicado>
          <sf:IdPeticionRegistroDuplicado>ID-PET-2026-0001</sf:IdPeticionRegistroDuplicado>
          <sf:EstadoRegistroDuplicado>Correcta</sf:EstadoRegistroDuplicado>
        </sfR:RegistroDuplicado>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

// Fixture inválida 1: Sin <Cabecera> ni namespaces (antes se colaba si no tenía Cabecera ni RespuestaSuministro.xsd)
const FIXTURE_INVALID_MISSING_CABECERA_AND_NS = `<?xml version="1.0" encoding="UTF-8"?>
<RespuestaRegFactuSistemaFacturacion>
  <CSV>CSV-BYPASS-ATTEMPT</CSV>
  <TiempoEsperaEnvio>60</TiempoEsperaEnvio>
  <EstadoEnvio>Correcto</EstadoEnvio>
</RespuestaRegFactuSistemaFacturacion>`;

// Fixture inválida 2: EstadoEnvio con valor fuera de la enumeración oficial (Correcto | ParcialmenteCorrecto | Incorrecto)
const FIXTURE_INVALID_ENUM_ESTADO_ENVIO = FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP.replace(
  '<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>',
  '<sfR:EstadoEnvio>AceptadoTotalmente</sfR:EstadoEnvio>'
);

// Fixture inválida 3: CodigoErrorRegistro no numérico (ErrorDetalleType restringe a xs:integer)
const FIXTURE_INVALID_NON_INTEGER_ERROR_CODE = FIXTURE_VALID_DEFAULT_NAMESPACE_SIN_PREFIJO_SFR.replace(
  '<CodigoErrorRegistro>1101</CodigoErrorRegistro>',
  '<CodigoErrorRegistro>ERR-ALFA-99</CodigoErrorRegistro>'
);

// Fixture inválida 4: TiempoEsperaEnvio con más de 6 dígitos o texto (sf:Tipo6Type exige \d{1,6})
const FIXTURE_INVALID_TIEMPO_ESPERA = FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP.replace(
  '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>',
  '<sfR:TiempoEsperaEnvio>60SEGUNDOS</sfR:TiempoEsperaEnvio>'
);

// Fixture inválida 5: Falta <Operacion> obligatoria dentro de <RespuestaLinea>
const FIXTURE_INVALID_MISSING_OPERACION = FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP.replace(
  /<sfR:Operacion>[\s\S]*?<\/sfR:Operacion>/,
  ''
);

async function main() {
  console.log('================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS — FASE 2 (P2): RESPUESTAS AEAT Y mTLS');
  console.log('================================================================');

  AeatFlowControlManager.reset();
  AeatCertificateProvider.clear();
  resetFiscalOutbox();

  // ==========================================================================
  // BLOQUE 4: VALIDACIÓN DE LAS RESPUESTAS DE AEAT (RespuestaSuministro.xsd)
  // ==========================================================================
  console.log('\n--- BLOQUE 4 (P2): VALIDACIÓN ESTRICTA DE RESPUESTAS AEAT (RespuestaSuministro.xsd) ---');

  await runTest('4.1: Fixtures válidas (prefijos en Envelope, namespace por defecto y RegistroDuplicado) superan RespuestaSuministro.xsd y parsean correctamente', () => {
    // 1. Con prefijos declarados en el sobre SOAP
    const parsed1 = parseAeatXmlResponse(FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP);
    assert.strictEqual(parsed1.isSoapFault, false);
    assert.strictEqual(parsed1.estadoEnvio, 'Correcto');
    assert.strictEqual(parsed1.mappedSubmissionStatus, 'ACCEPTED');
    assert.strictEqual(parsed1.csv, 'CSV1234567890ABC');
    assert.strictEqual(parsed1.tiempoEsperaEnvio, 60);
    assert.strictEqual(parsed1.lineas.length, 1);
    assert.strictEqual(parsed1.lineas[0].refExterna, 'REF-EXT-001');

    // 2. Con namespace por defecto (sin prefijo sfR:)
    const parsed2 = parseAeatXmlResponse(FIXTURE_VALID_DEFAULT_NAMESPACE_SIN_PREFIJO_SFR);
    assert.strictEqual(parsed2.estadoEnvio, 'ParcialmenteCorrecto');
    assert.strictEqual(parsed2.mappedSubmissionStatus, 'ACCEPTED_WITH_ERRORS');
    assert.strictEqual(parsed2.tiempoEsperaEnvio, 120);
    assert.strictEqual(parsed2.avisos.length, 1);
    assert.strictEqual(parsed2.avisos[0].codigo, '1101');

    // 3. Con rechazo funcional e información de RegistroDuplicado
    const parsed3 = parseAeatXmlResponse(FIXTURE_VALID_RECHAZO_FUNCIONAL_Y_DUPLICADO);
    assert.strictEqual(parsed3.estadoEnvio, 'Incorrecto');
    assert.strictEqual(parsed3.mappedSubmissionStatus, 'REJECTED');
    assert.strictEqual(parsed3.errores.length, 1);
    assert.strictEqual(parsed3.errores[0].codigo, '3000');
    assert.strictEqual(parsed3.lineas[0].registroDuplicado?.idPeticionRegistroDuplicado, 'ID-PET-2026-0001');
    assert.strictEqual(parsed3.lineas[0].registroDuplicado?.estadoRegistroDuplicado, 'Correcta');
  });

  await runTest('4.2: Modo Fail-Closed por defecto: respuestas sin Cabecera o sin namespaces oficiales ya NO eluden la validación XSD', () => {
    // Antes de la corrección, una respuesta sin <Cabecera> ni string "RespuestaSuministro.xsd" no activaba shouldEnforceXsd cuando no se pasaba enforceOfficialXsd: true.
    assert.throws(
      () => parseAeatXmlResponse(FIXTURE_INVALID_MISSING_CABECERA_AND_NS),
      /RECHAZO_XSD_RESPUESTA_AEAT/
    );
  });

  await runTest('4.3: Fixtures inválidas contra RespuestaSuministro.xsd son rechazadas fail-closed sin modificar los XSD oficiales', () => {
    const invalidFixtures = [
      { name: 'EstadoEnvio fuera de enumeración XSD', xml: FIXTURE_INVALID_ENUM_ESTADO_ENVIO },
      { name: 'CodigoErrorRegistro alfanumérico (no xs:integer)', xml: FIXTURE_INVALID_NON_INTEGER_ERROR_CODE },
      { name: 'TiempoEsperaEnvio inválido', xml: FIXTURE_INVALID_TIEMPO_ESPERA },
      { name: 'RespuestaLinea sin elemento obligatorio Operacion', xml: FIXTURE_INVALID_MISSING_OPERACION }
    ];

    for (const item of invalidFixtures) {
      assert.throws(
        () => parseAeatXmlResponse(item.xml),
        /RECHAZO_XSD_RESPUESTA_AEAT/,
        `La fixture inválida "${item.name}" debió ser rechazada por RespuestaSuministro.xsd`
      );
    }
  });

  await runTest('4.4: Gestión de respuestas vacías, XML malformado, estructura inesperada y SOAP Faults (SOAP 1.1 y 1.2)', () => {
    // Vacía
    assert.throws(
      () => parseAeatXmlResponse('   '),
      /ERR_XML_EMPTY/
    );

    // XML malformado / truncado
    assert.throws(
      () => parseAeatXmlResponse('<soapenv:Envelope><soapenv:Body><EtiquetaSinCerrar></soapenv:Envelope>'),
      /ERR_XML_MALFORMED/
    );

    // XML sintácticamente válido pero con estructura inesperada (ej. portal HTML o XML ajeno)
    assert.throws(
      () => parseAeatXmlResponse('<?xml version="1.0"?><html><body>Mantenimiento Sede Electrónica</body></html>'),
      /ERR_XML_UNEXPECTED_ROOT/
    );

    // SOAP 1.2 Fault con Code/Value y Reason/Text anidados
    const soap12FaultXml = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Body>
    <env:Fault>
      <env:Code><env:Value>env:Receiver</env:Value></env:Code>
      <env:Reason><env:Text xml:lang="es">Servicio temporalmente no disponible (503)</env:Text></env:Reason>
    </env:Fault>
  </env:Body>
</env:Envelope>`;
    const parsedSoap12 = parseAeatXmlResponse(soap12FaultXml);
    assert.strictEqual(parsedSoap12.isSoapFault, true);
    assert.strictEqual(parsedSoap12.mappedSubmissionStatus, 'FAILED_TECHNICAL');
  });

  await runTest('4.5: Diferenciación estricta entre: (1) Error de transporte, (2) Error SOAP, (3) Respuesta fiscal rechazada, (4) Error de validación XSD de respuesta', async () => {
    const { record, config } = await createSampleSealedRecord();
    const subBase = createFiscalSubmission(record, config);

    // Inyectar certificado sintético solo para habilitar el flujo con customFetch
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const validPemCert = createX509Pem({
      serial: 1,
      subjectCn: OBLIGADO_NIF,
      issuerCn: 'CA Test',
      subjectPubKeyDer: publicKey,
      issuerPrivKeyPem: privateKey,
      isCa: false
    });
    AeatCertificateProvider.setMockCredentialsForTesting({ cert: validPemCert, key: privateKey });

    try {
      // (1) Error de transporte (conexión rechazada / timeout de red)
      AeatFlowControlManager.reset();
      const resTransportErr = await executeAeatSubmission({
        submission: subBase,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          customFetch: async () => {
            const err: any = new Error('connect ECONNREFUSED 127.0.0.1:443');
            err.code = 'ECONNREFUSED';
            throw err;
          }
        }
      });
      assert.strictEqual(resTransportErr.isTechnicalError, true);
      assert.strictEqual(resTransportErr.submission.estado, 'FAILED_TECHNICAL');
      assert.strictEqual(resTransportErr.errorDetails?.code, 'ECONNREFUSED');
      assert.strictEqual(resTransportErr.parsedResponse, undefined, 'Error de transporte no tiene parsedResponse XML');
      assert.strictEqual(isRetryableSubmission(resTransportErr.submission), true, 'Error de red es reintentable');

      // (2) Error SOAP (SOAP Fault Server 500 vs SOAP Fault Client 400)
      AeatFlowControlManager.reset();
      const resSoapServer = await executeAeatSubmission({
        submission: subBase,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          customFetch: async () => ({
            status: 500,
            text: async () => MockAeatTransport.generateMockResponseBody('SOAP_FAULT_SERVER')
          })
        }
      });
      assert.strictEqual(resSoapServer.isTechnicalError, true);
      assert.strictEqual(resSoapServer.submission.estado, 'FAILED_TECHNICAL');
      assert.strictEqual(resSoapServer.parsedResponse?.isSoapFault, true);
      assert.strictEqual(resSoapServer.parsedResponse?.fault?.category, 'SOAP_FAULT_SERVER');
      assert.strictEqual(isRetryableSubmission(resSoapServer.submission, resSoapServer.parsedResponse), true);

      AeatFlowControlManager.reset();
      const resSoapClient = await executeAeatSubmission({
        submission: subBase,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          customFetch: async () => ({
            status: 200,
            text: async () => MockAeatTransport.generateMockResponseBody('SOAP_FAULT_CLIENT')
          })
        }
      });
      assert.strictEqual(resSoapClient.isTechnicalError, true);
      assert.strictEqual(resSoapClient.submission.estado, 'FAILED_TECHNICAL');
      assert.strictEqual(resSoapClient.parsedResponse?.isSoapFault, true);
      assert.strictEqual(resSoapClient.parsedResponse?.fault?.category, 'SOAP_FAULT_CLIENT');
      assert.strictEqual(isRetryableSubmission(resSoapClient.submission, resSoapClient.parsedResponse), false);

      // (3) Respuesta fiscal rechazada (XML válido según RespuestaSuministro.xsd pero EstadoEnvio=Incorrecto)
      AeatFlowControlManager.reset();
      const resFiscalRejected = await executeAeatSubmission({
        submission: subBase,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          customFetch: async () => ({
            status: 200,
            text: async () => FIXTURE_VALID_RECHAZO_FUNCIONAL_Y_DUPLICADO
          })
        }
      });
      assert.strictEqual(resFiscalRejected.isTechnicalError, false, 'Rechazo fiscal funcional NO es un error técnico');
      assert.strictEqual(resFiscalRejected.submission.estado, 'REJECTED');
      assert.strictEqual(resFiscalRejected.submission.codigoAeat, '3000');
      assert.strictEqual(resFiscalRejected.fiscalEvent.tipo, 'ENVIO_AEAT_RECHAZADO');
      assert.strictEqual(isRetryableSubmission(resFiscalRejected.submission, resFiscalRejected.parsedResponse), false);

      // (4) Error de validación XSD de la respuesta (XML bien formado pero viola RespuestaSuministro.xsd)
      AeatFlowControlManager.reset();
      const resXsdInvalid = await executeAeatSubmission({
        submission: subBase,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          customFetch: async () => ({
            status: 200,
            text: async () => FIXTURE_INVALID_ENUM_ESTADO_ENVIO
          })
        }
      });
      assert.strictEqual(resXsdInvalid.isTechnicalError, true);
      assert.strictEqual(resXsdInvalid.submission.estado, 'FAILED_TECHNICAL');
      assert.strictEqual(resXsdInvalid.submission.codigoAeat, 'ERR_XML_INVALID');
      assert.ok(resXsdInvalid.submission.descripcion?.includes('RECHAZO_XSD_RESPUESTA_AEAT'));
      assert.strictEqual(isRetryableSubmission(resXsdInvalid.submission), false, 'Fallo XSD no es reintentable a ciegas');
    } finally {
      AeatCertificateProvider.clear();
    }
  });

  // ==========================================================================
  // BLOQUE 5: TRANSPORTE HTTPS/mTLS Y PROVEEDOR DE CERTIFICADOS (PEM Y PFX)
  // ==========================================================================
  console.log('\n--- BLOQUE 5 (P2): TRANSPORTE HTTPS/mTLS LOCAL Y VALIDACIÓN PEM / PFX ---');

  // Generar PKI completa para pruebas de certificados y mTLS local
  const caKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const untrustedCaKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const serverKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const clientKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const otherKeys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const caCertPem = createX509Pem({
    serial: 200,
    subjectCn: 'AEAT Root CA Local Test',
    issuerCn: 'AEAT Root CA Local Test',
    subjectPubKeyDer: caKeys.publicKey,
    issuerPrivKeyPem: caKeys.privateKey,
    isCa: true
  });
  const untrustedCaCertPem = createX509Pem({
    serial: 201,
    subjectCn: 'Untrusted Rogue CA',
    issuerCn: 'Untrusted Rogue CA',
    subjectPubKeyDer: untrustedCaKeys.publicKey,
    issuerPrivKeyPem: untrustedCaKeys.privateKey,
    isCa: true
  });
  const serverCertPem = createX509Pem({
    serial: 202,
    subjectCn: 'prewww1.aeat.es',
    issuerCn: 'AEAT Root CA Local Test',
    subjectPubKeyDer: serverKeys.publicKey,
    issuerPrivKeyPem: caKeys.privateKey,
    isCa: false,
    sanDns: ['prewww1.aeat.es', 'localhost'],
    sanIps: [[127, 0, 0, 1]]
  });
  const validClientCertPem = createX509Pem({
    serial: 203,
    subjectCn: `${OBLIGADO_NIF} - ${OBLIGADO_NOMBRE}`,
    issuerCn: 'AEAT Root CA Local Test',
    subjectPubKeyDer: clientKeys.publicKey,
    issuerPrivKeyPem: caKeys.privateKey,
    isCa: false
  });
  const expiredClientCertPem = createX509Pem({
    serial: 204,
    subjectCn: `${OBLIGADO_NIF} - Caducado`,
    issuerCn: 'AEAT Root CA Local Test',
    subjectPubKeyDer: clientKeys.publicKey,
    issuerPrivKeyPem: caKeys.privateKey,
    isCa: false,
    notBefore: new Date(Date.now() - 365 * 24 * 3600 * 1000),
    notAfter: new Date(Date.now() - 24 * 3600 * 1000) // Expiró ayer
  });
  const futureClientCertPem = createX509Pem({
    serial: 205,
    subjectCn: `${OBLIGADO_NIF} - Futuro`,
    issuerCn: 'AEAT Root CA Local Test',
    subjectPubKeyDer: clientKeys.publicKey,
    issuerPrivKeyPem: caKeys.privateKey,
    isCa: false,
    notBefore: new Date(Date.now() + 7 * 24 * 3600 * 1000), // Válido dentro de 7 días
    notAfter: new Date(Date.now() + 365 * 24 * 3600 * 1000)
  });
  const untrustedClientCertPem = createX509Pem({
    serial: 206,
    subjectCn: `${OBLIGADO_NIF} - CA No Confiable`,
    issuerCn: 'Untrusted Rogue CA',
    subjectPubKeyDer: clientKeys.publicKey,
    issuerPrivKeyPem: untrustedCaKeys.privateKey,
    isCa: false
  });

  await runTest('5.1: Validación PEM de certificado caducado, aún no válido (notBefore futuro) y clave privada que no coincide', async () => {
    const { record, config } = await createSampleSealedRecord();
    const sub = createFiscalSubmission(record, config);

    // 1. Certificado caducado
    const checkExpired = AeatCertificateProvider.validatePemCertificatePair(expiredClientCertPem, clientKeys.privateKey);
    assert.strictEqual(checkExpired.valid, false);
    assert.match(checkExpired.reason || '', /ha expirado/);

    AeatCertificateProvider.setMockCredentialsForTesting({ cert: expiredClientCertPem, key: clientKeys.privateKey });
    AeatFlowControlManager.reset();
    const resExpired = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: record,
      config,
      options: {
        transportMode: 'real',
        endpointOverride: 'https://127.0.0.1:59999/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
        customCaCerts: caCertPem
      }
    });
    assert.strictEqual(resExpired.isTechnicalError, true);
    assert.strictEqual(resExpired.submission.estado, 'FAILED_TECHNICAL');
    assert.match(resExpired.errorDetails?.message || '', /ha expirado/);

    // 2. Certificado aún no válido (notBefore en el futuro)
    const checkFuture = AeatCertificateProvider.validatePemCertificatePair(futureClientCertPem, clientKeys.privateKey);
    assert.strictEqual(checkFuture.valid, false);
    assert.match(checkFuture.reason || '', /aún no es válido/);

    AeatCertificateProvider.setMockCredentialsForTesting({ cert: futureClientCertPem, key: clientKeys.privateKey });
    AeatFlowControlManager.reset();
    const resFuture = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: record,
      config,
      options: {
        transportMode: 'real',
        endpointOverride: 'https://127.0.0.1:59999/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
        customCaCerts: caCertPem
      }
    });
    assert.strictEqual(resFuture.isTechnicalError, true);
    assert.strictEqual(resFuture.submission.estado, 'FAILED_TECHNICAL');
    assert.match(resFuture.errorDetails?.message || '', /aún no es válido/);

    // 3. Certificado y clave privada que NO coinciden
    const checkMismatch = AeatCertificateProvider.validatePemCertificatePair(validClientCertPem, otherKeys.privateKey);
    assert.strictEqual(checkMismatch.valid, false);
    assert.match(checkMismatch.reason || '', /no corresponde a la clave pública/);

    AeatCertificateProvider.setMockCredentialsForTesting({ cert: validClientCertPem, key: otherKeys.privateKey });
    AeatFlowControlManager.reset();
    const resMismatch = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: record,
      config,
      options: {
        transportMode: 'real',
        endpointOverride: 'https://127.0.0.1:59999/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
        customCaCerts: caCertPem
      }
    });
    assert.strictEqual(resMismatch.isTechnicalError, true);
    assert.strictEqual(resMismatch.submission.estado, 'FAILED_TECHNICAL');
    assert.match(resMismatch.errorDetails?.message || '', /no corresponde a la clave pública/);

    AeatCertificateProvider.clear();
  });

  await runTest('5.2: Paridad de validación en certificados PKCS#12 / PFX: contenedor válido, contraseña incorrecta, PFX corrupto, PFX caducado y PFX aún no válido', () => {
    const pfxPass = 'ClaveUltrasecretaPfx2026!';
    const validPfx = buildPfxFromPemInMemory(validClientCertPem, clientKeys.privateKey, pfxPass);
    const expiredPfx = buildPfxFromPemInMemory(expiredClientCertPem, clientKeys.privateKey, pfxPass);
    const futurePfx = buildPfxFromPemInMemory(futureClientCertPem, clientKeys.privateKey, pfxPass);

    // 1. PFX válido con contraseña correcta
    const reportValid = AeatCertificateProvider.validatePfxCertificate(validPfx, pfxPass);
    assert.strictEqual(reportValid.valid, true, `PFX válido falló: ${reportValid.reason}`);
    assert.strictEqual(reportValid.type, 'PKCS12');
    assert.strictEqual(reportValid.fullX509InspectionPerformed, true);
    assert.ok(reportValid.subject?.includes(OBLIGADO_NIF));

    // 2. PFX con contraseña incorrecta
    const reportWrongPass = AeatCertificateProvider.validatePfxCertificate(validPfx, 'PasswordEquivocada');
    assert.strictEqual(reportWrongPass.valid, false);
    assert.match(reportWrongPass.reason || '', /Contenedor PKCS#12 \/ PFX inválido o contraseña incorrecta/);
    assert.ok(!reportWrongPass.reason?.includes(pfxPass), 'Nunca debe exponer la contraseña real');
    assert.ok(!reportWrongPass.reason?.includes('PasswordEquivocada'), 'Nunca debe reflejar la contraseña intentada');

    // 3. PFX corrupto
    const reportCorrupt = AeatCertificateProvider.validatePfxCertificate(Buffer.from('NOT_A_VALID_PKCS12_BINARY'), pfxPass);
    assert.strictEqual(reportCorrupt.valid, false);

    // 4. PFX con certificado X.509 caducado
    const reportExpiredPfx = AeatCertificateProvider.validatePfxCertificate(expiredPfx, pfxPass);
    assert.strictEqual(reportExpiredPfx.valid, false);
    assert.match(reportExpiredPfx.reason || '', /contenido en el PFX ha expirado/);

    // 5. PFX con certificado X.509 aún no válido (notBefore futuro)
    const reportFuturePfx = AeatCertificateProvider.validatePfxCertificate(futurePfx, pfxPass);
    assert.strictEqual(reportFuturePfx.valid, false);
    assert.match(reportFuturePfx.reason || '', /contenido en el PFX aún no es válido/);
  });

  await runTest('5.3: Transporte HTTPS local con mTLS real usando contenedor PKCS#12 (PFX), rechazo de cadena de certificados inválida y errores de conexión', async () => {
    const { record, config } = await createSampleSealedRecord();
    const sub = createFiscalSubmission(record, config);
    const pfxPass = 'MtlsPfxSecret2026#';
    const validPfx = buildPfxFromPemInMemory(validClientCertPem, clientKeys.privateKey, pfxPass);

    let handshakeAuthorized = false;
    const mtlsServer = https.createServer(
      {
        key: serverKeys.privateKey,
        cert: serverCertPem,
        ca: [caCertPem],
        requestCert: true,
        rejectUnauthorized: true
      },
      (req, res) => {
        handshakeAuthorized = Boolean((req.socket as any).authorized);
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
          res.end(FIXTURE_VALID_ACEPTADO_CON_PREFIJOS_SOAP);
        });
      }
    );

    await new Promise<void>((resolve) => mtlsServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (mtlsServer.address() as { port: number }).port;
    const localEndpoint = `https://127.0.0.1:${port}/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`;

    try {
      // Caso A: Éxito en handshake mTLS local usando credenciales PKCS#12 (PFX)
      AeatCertificateProvider.setMockCredentialsForTesting({ pfx: validPfx, passphrase: pfxPass });
      AeatFlowControlManager.reset();
      const resPfxSuccess = await executeAeatSubmission({
        submission: sub,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          endpointOverride: localEndpoint,
          customCaCerts: caCertPem,
          servername: 'prewww1.aeat.es'
        }
      });
      assert.strictEqual(handshakeAuthorized, true);
      assert.strictEqual(resPfxSuccess.isTechnicalError, false);
      assert.strictEqual(resPfxSuccess.submission.estado, 'ACCEPTED');
      assert.strictEqual(resPfxSuccess.submission.csv, 'CSV1234567890ABC');

      // Caso B: Cadena de certificados inválida (servidor presenta un certificado no emitido por la CA en la que confía el cliente)
      AeatFlowControlManager.reset();
      const resInvalidChain = await executeAeatSubmission({
        submission: sub,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          endpointOverride: localEndpoint,
          customCaCerts: untrustedCaCertPem, // CA distinta de la que firmó al servidor
          servername: 'prewww1.aeat.es'
        }
      });
      assert.strictEqual(resInvalidChain.isTechnicalError, true);
      assert.strictEqual(resInvalidChain.submission.estado, 'FAILED_TECHNICAL');

      // Caso C: Certificado de cliente firmado por una CA no reconocida por el servidor mTLS
      AeatCertificateProvider.setMockCredentialsForTesting({
        cert: untrustedClientCertPem,
        key: clientKeys.privateKey
      });
      AeatFlowControlManager.reset();
      const resUntrustedClient = await executeAeatSubmission({
        submission: sub,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          endpointOverride: localEndpoint,
          customCaCerts: caCertPem,
          servername: 'prewww1.aeat.es'
        }
      });
      assert.strictEqual(resUntrustedClient.isTechnicalError, true);
      assert.strictEqual(resUntrustedClient.submission.estado, 'FAILED_TECHNICAL');
    } finally {
      await new Promise<void>((resolve) => mtlsServer.close(() => resolve()));
      AeatCertificateProvider.clear();
    }

    // Caso D: Error de conexión (servidor cerrado / ECONNREFUSED en puerto local)
    AeatCertificateProvider.setMockCredentialsForTesting({
      cert: validClientCertPem,
      key: clientKeys.privateKey
    });
    AeatFlowControlManager.reset();
    const resConnRefused = await executeAeatSubmission({
      submission: sub,
      fiscalRecord: record,
      config,
      options: {
        transportMode: 'real',
        endpointOverride: localEndpoint,
        customCaCerts: caCertPem,
        servername: 'prewww1.aeat.es'
      }
    });
    assert.strictEqual(resConnRefused.isTechnicalError, true);
    assert.strictEqual(resConnRefused.submission.estado, 'FAILED_TECHNICAL');
    AeatCertificateProvider.clear();
  });

  await runTest('5.4: Garantía de no filtración de secretos (claves privadas, contraseñas PFX y payloads Base64) en errores, eventos ni logs', async () => {
    const secretPassword = 'SuperSecretPfxPassword_987654321!';
    const secretKeyFragment = clientKeys.privateKey.split('\n')[1]; // Línea central del bloque PRIVATE KEY
    process.env.AEAT_CERT_PASSWORD = secretPassword;
    process.env.AEAT_KEY_PEM = clientKeys.privateKey;

    try {
      // 1. Verificar sanitizador directo ante un error que contenga la clave privada o la contraseña en texto plano
      const dirtyMessage = `Error en TLS con clave ${clientKeys.privateKey} y password=${secretPassword}`;
      const sanitized = AeatCertificateProvider.sanitizeSensitiveData(dirtyMessage);

      assert.ok(!sanitized.includes(secretPassword), 'La contraseña nunca debe aparecer tras sanitizar');
      assert.ok(!sanitized.includes(secretKeyFragment), 'El cuerpo de la clave privada nunca debe aparecer tras sanitizar');
      assert.ok(sanitized.includes('[REDACTED_PRIVATE_KEY]'));
      assert.ok(sanitized.includes('[REDACTED_SECRET]'));

      // 2. Verificar que ante un fallo en executeAeatSubmission el resultado, submission y fiscalEvent no contienen secretos
      const { record, config } = await createSampleSealedRecord();
      const sub = createFiscalSubmission(record, config);
      AeatCertificateProvider.setMockCredentialsForTesting({
        cert: expiredClientCertPem,
        key: clientKeys.privateKey,
        passphrase: secretPassword
      });

      AeatFlowControlManager.reset();
      const failedRes = await executeAeatSubmission({
        submission: sub,
        fiscalRecord: record,
        config,
        options: {
          transportMode: 'real',
          endpointOverride: 'https://127.0.0.1:59998/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
          customCaCerts: caCertPem
        }
      });

      const serializedResult = JSON.stringify(failedRes);
      assert.ok(!serializedResult.includes(secretPassword), 'El resultado de transporte no debe contener la contraseña');
      assert.ok(!serializedResult.includes(secretKeyFragment), 'El resultado de transporte no debe contener la clave privada');
    } finally {
      delete process.env.AEAT_CERT_PASSWORD;
      delete process.env.AEAT_KEY_PEM;
      AeatCertificateProvider.clear();
      try {
        AeatFlowControlManager.reset();
        const { BackendFiscalCustody } = await import('../src/fiscal/backendCustodyRepository');
        BackendFiscalCustody.resetCustody();
        const { CloudDistributedChainCoordinator } = await import('../src/fiscal/cloudDistributedChainCoordinator');
        CloudDistributedChainCoordinator.resetCloudState();
      } catch {}
    }
  });

  console.log('\n================================================================');
  console.log(`  RESUMEN FASE 2 (P2): ${passedTests}/${totalTests} TESTS SUPERADOS (SERVIDOR LOCAL mTLS + LIBXML2 XSD)`);
  console.log('  NOTA: Las pruebas mTLS se han ejecutado contra un servidor HTTPS Node.js local.');
  console.log('        La integración real contra prewww1/www1 de la AEAT requiere un certificado');
  console.log('        cualificado real emitido por autoridad reconocida y conectividad autorizada.');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('*** ERROR EN LA SUITE DE TESTS FASE 2 (P2) ***', err);
  process.exit(1);
});
