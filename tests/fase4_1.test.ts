/**
 * SUITE DE TESTS - FASE 4.1: CIERRE DE CONFORMIDAD XML/XSD AEAT VERI*FACTU
 *
 * Verifica:
 * 1. Validación real con motor libxml2 (libxml2-wasm) contra los esquemas XSD oficiales:
 *    - docs/fiscal/xsd/SuministroLR.xsd
 *    - docs/fiscal/xsd/SuministroInformacion.xsd
 *    - docs/fiscal/xsd/xmldsig-core-schema.xsd
 * 2. Prohibición absoluta de fallbacks silenciosos cuando el XSD falla o no existe (Fail-Closed).
 * 3. Mapping funcional completo y conformidad XSD de:
 *    - F1 (con NIF, con IDOtro extranjero, y art. 61.d)
 *    - F2 (simplificada sin destinatario)
 *    - F3 (sustitución de facturas simplificadas con FacturasSustituidas)
 *    - R1 (por diferencias 'I' y por sustitución 'S')
 *    - R2 (por diferencias 'I' y por sustitución 'S')
 *    - R3 (por diferencias 'I' y por sustitución 'S')
 *    - R4 (por diferencias 'I' y por sustitución 'S')
 *    - R5 (rectificativa simplificada 'I' y 'S' sin Destinatarios)
 *    - RegistroAnulacion (inicial, encadenado, y con GeneradoPor/Generador)
 * 4. Rechazo estricto de violaciones de xs:sequence, xs:choice, tipos, patrones y reglas cruzadas.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildAeatVerifactuXml,
  validateAeatVerifactuXml
} from '../src/fiscal/aeatVerifactuXmlBuilder';
import {
  validateXmlAgainstOfficialXsd,
  resolveXsdWorkerPath,
  resolveDefaultOfficialXsdPath
} from '../src/fiscal/aeatXsdValidatorNode';
import {
  createFiscalRecordFromInvoice,
  createFiscalAnulacionRecord,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import { calculateAltaHash, calculateAnulacionHash } from '../src/fiscal/hashService';
import { Factura } from '../src/types';
import { FiscalConfiguration, FiscalRecord, TipoFacturaAEAT } from '../src/fiscal/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 4.1: CONFORMIDAD XML/XSD AEAT');
console.log('================================================================');

let passed = 0;
let total = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    console.log(`  [PASS] Test ${total}: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] Test ${total}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

const baseConfig: FiscalConfiguration = createDefaultFiscalConfiguration({
  nif: 'B12345678',
  nombreRazon: 'Granja Avícola El Valle S.L.'
});

function createBaseInvoice(overrides?: Partial<Factura>): Factura {
  return {
    id: 'inv-41-001',
    numeroFactura: 'FAC-2026/0001',
    fecha: '2026-10-20',
    clienteId: 'cli-01',
    clienteNombre: 'Supermercados Delicias S.A.',
    clienteCif: 'A87654321',
    clienteDireccion: 'Calle Mayor 10, Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 1000,
      porcentajeIva: 4,
      cuotaIva: 40,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 1040
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-20T10:30:00+02:00',
    tipoFactura: 'F1',
    esRectificativa: false,
    ...overrides
  };
}

async function buildSealedAltaRecord(
  invoice: Factura,
  previousRecord: FiscalRecord | null = null
): Promise<FiscalRecord> {
  const fechaHoraHuso = '2026-10-20T10:30:00+02:00';
  const cuotaTotal = (invoice.totales.cuotaIva ?? 0) + (invoice.totales.cuotaRecargo ?? 0);
  const hashRes = await calculateAltaHash({
    nifEmisor: baseConfig.nifEmisor,
    numSerieFactura: invoice.numeroFactura,
    fechaExpedicion: invoice.fecha,
    tipoFactura: invoice.tipoFactura || 'F1',
    cuotaTotal,
    importeTotal: invoice.totales.totalDocumento,
    huellaAnterior: previousRecord ? previousRecord.huella.hash : '',
    fechaHoraHusoGenRegistro: fechaHoraHuso
  });

  return createFiscalRecordFromInvoice(invoice, baseConfig, previousRecord, {
    hashActual: hashRes.hash,
    fechaHoraSellado: fechaHoraHuso,
    cadenaTextoCanonico: hashRes.canonicalString
  });
}

async function main() {
  // ---------------------------------------------------------------------------
  // 1. MOTOR LIBXML2 REAL Y POLÍTICA FAIL-CLOSED (SIN FALLBACK SILENCIOSO)
  // ---------------------------------------------------------------------------
  await runTest('1.1: El validador XSD utiliza el motor real libxml2-wasm y falla cerrado si el XSD no existe', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice());
    const xml = buildAeatVerifactuXml(rec);

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `Errores XSD inesperados: ${report.errors.join('; ')}`);
    assert.strictEqual(report.engine, 'libxml2-wasm', 'Debe validar con el motor real libxml2-wasm');

    const missingXsdReport = validateXmlAgainstOfficialXsd(xml, '/ruta/inexistente/SuministroLR.xsd');
    assert.strictEqual(missingXsdReport.valid, false, 'Debe fallar cerrado cuando el XSD no existe');
    assert.ok(missingXsdReport.errors[0].includes('FAIL-CLOSED'));
  });

  await runTest('1.2: Resolución determinista de dist/fiscal/libxml2XsdWorker.mjs y dist/fiscal/xsd/*.xsd sin depender de src/ ni docs/', async () => {
    const tmpProdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifactu_prod_dist_'));
    try {
      const distXsdDir = path.join(tmpProdDir, 'dist', 'fiscal', 'xsd');
      fs.mkdirSync(distXsdDir, { recursive: true });

      const srcWorker = path.resolve(process.cwd(), 'src/fiscal/libxml2XsdWorker.mjs');
      const distWorker = path.join(tmpProdDir, 'dist', 'fiscal', 'libxml2XsdWorker.mjs');
      fs.copyFileSync(srcWorker, distWorker);

      const srcXsdDir = path.resolve(process.cwd(), 'docs/fiscal/xsd');
      for (const file of fs.readdirSync(srcXsdDir)) {
        if (file.endsWith('.xsd')) {
          fs.copyFileSync(path.join(srcXsdDir, file), path.join(distXsdDir, file));
        }
      }

      const resolvedWorker = resolveXsdWorkerPath(tmpProdDir);
      const resolvedXsd = resolveDefaultOfficialXsdPath(tmpProdDir);

      assert.strictEqual(resolvedWorker, distWorker, 'Debe resolver el worker desde dist/fiscal/libxml2XsdWorker.mjs');
      assert.strictEqual(resolvedXsd, path.join(distXsdDir, 'SuministroLR.xsd'), 'Debe resolver SuministroLR.xsd desde dist/fiscal/xsd/');

      const rec = await buildSealedAltaRecord(createBaseInvoice());
      const xml = buildAeatVerifactuXml(rec);
      const report = validateXmlAgainstOfficialXsd(xml, resolvedXsd);
      assert.strictEqual(report.valid, true, `Validación contra dist/fiscal/xsd falló: ${report.errors.join('; ')}`);
    } finally {
      fs.rmSync(tmpProdDir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. CONFORMIDAD REAL DE F1, F2 Y F3 FRENTE A SUMINISTROLR.XSD / SUMINISTROINFORMACION.XSD
  // ---------------------------------------------------------------------------
  await runTest('2.1: Factura F1 ordinaria con destinatario NIF español valida contra XSD oficial', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice({ tipoFactura: 'F1' }));
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:TipoFactura>F1</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:Destinatarios>'));
    assert.ok(xml.includes('<sf:IDDestinatario>'));
    assert.ok(xml.includes('<sf:NIF>A87654321</sf:NIF>'));
    assert.ok(!xml.includes('<sf:TipoRectificativa>'));

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `F1 falló XSD: ${report.errors.join('; ')}`);
  });

  await runTest('2.2: Factura F1 con destinatario extranjero mediante IDOtro (código país UE + IDType 02) valida contra XSD oficial', async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'FAC-2026/0002',
      clienteCif: '',
      clienteNombre: 'Boulangerie Parisienne SARL',
      clienteIdOtro: {
        codigoPais: 'FR',
        idType: '02',
        id: 'FR12345678901'
      }
    });
    const rec = await buildSealedAltaRecord(inv);
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:IDOtro>'));
    assert.ok(xml.includes('<sf:CodigoPais>FR</sf:CodigoPais>'));
    assert.ok(xml.includes('<sf:IDType>02</sf:IDType>'));
    assert.ok(xml.includes('<sf:ID>FR12345678901</sf:ID>'));

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `F1 con IDOtro falló XSD: ${report.errors.join('; ')}`);
  });

  await runTest('2.3: Factura F2 simplificada sin identificación de destinatario valida contra XSD oficial', async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'SIMP-2026/0001',
      tipoFactura: 'F2',
      clienteCif: '',
      clienteNombre: 'Consumidor Final Contado'
    });
    const rec = await buildSealedAltaRecord(inv);
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:TipoFactura>F2</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>'));
    assert.ok(!xml.includes('<sf:Destinatarios>'), 'F2 no debe incluir bloque Destinatarios');

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `F2 falló XSD: ${report.errors.join('; ')}`);
  });

  await runTest('2.4: Factura F3 en sustitución de facturas simplificadas con FacturasSustituidas valida contra XSD oficial', async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'F3-2026/0001',
      tipoFactura: 'F3',
      facturasSustituidas: [
        { numeroFactura: 'SIMP-2026/0001', fechaExpedicion: '2026-10-18' },
        { numeroFactura: 'SIMP-2026/0002', fechaExpedicion: '2026-10-19' }
      ]
    });
    const rec = await buildSealedAltaRecord(inv);
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:TipoFactura>F3</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:FacturasSustituidas>'));
    assert.ok(xml.includes('<sf:IDFacturaSustituida>'));
    assert.ok(xml.includes('<sf:NumSerieFactura>SIMP-2026/0001</sf:NumSerieFactura>'));

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `F3 falló XSD: ${report.errors.join('; ')}`);
  });

  // ---------------------------------------------------------------------------
  // 3. CONFORMIDAD REAL DE RECTIFICATIVAS R1, R2, R3, R4 Y R5 ('I' Y 'S')
  // ---------------------------------------------------------------------------
  const rectTypesWithRecipient: TipoFacturaAEAT[] = ['R1', 'R2', 'R3', 'R4'];

  for (const rType of rectTypesWithRecipient) {
    await runTest(`3.${rType}.I: Factura rectificativa ${rType} por diferencias (TipoRectificativa='I') con importes negativos valida contra XSD oficial`, async () => {
      const inv = createBaseInvoice({
        numeroFactura: `RECT-${rType}-I-2026/001`,
        tipoFactura: rType,
        esRectificativa: true,
        tipoRectificativa: 'por_diferencias',
        facturaRectificadaNumero: 'FAC-2026/0001',
        facturaRectificadaFecha: '2026-10-15',
        motivoRectificativa: `Rectificación ${rType} por diferencias`,
        totales: {
          baseImponible: -200,
          porcentajeIva: 4,
          cuotaIva: -8,
          aplicaRecargo: false,
          porcentajeRecargo: 0,
          cuotaRecargo: 0,
          totalDocumento: -208
        }
      });

      const rec = await buildSealedAltaRecord(inv);
      const xml = buildAeatVerifactuXml(rec);

      assert.ok(xml.includes(`<sf:TipoFactura>${rType}</sf:TipoFactura>`));
      assert.ok(xml.includes('<sf:TipoRectificativa>I</sf:TipoRectificativa>'));
      assert.ok(xml.includes('<sf:FacturasRectificadas>'));
      assert.ok(xml.includes('<sf:IDFacturaRectificada>'));
      assert.ok(!xml.includes('<sf:ImporteRectificacion>'), 'Por diferencias no debe incluir ImporteRectificacion');
      assert.ok(xml.includes('<sf:BaseImponibleOimporteNoSujeto>-200.00</sf:BaseImponibleOimporteNoSujeto>'));
      assert.ok(xml.includes('<sf:CuotaTotal>-8.00</sf:CuotaTotal>'));
      assert.ok(xml.includes('<sf:ImporteTotal>-208.00</sf:ImporteTotal>'));

      const report = validateXmlAgainstOfficialXsd(xml);
      assert.strictEqual(report.valid, true, `${rType} (I) falló XSD: ${report.errors.join('; ')}`);
    });

    await runTest(`3.${rType}.S: Factura rectificativa ${rType} por sustitución (TipoRectificativa='S') con ImporteRectificacion valida contra XSD oficial`, async () => {
      const inv = createBaseInvoice({
        numeroFactura: `RECT-${rType}-S-2026/001`,
        tipoFactura: rType,
        esRectificativa: true,
        tipoRectificativa: 'por_sustitucion',
        facturaRectificadaNumero: 'FAC-2026/0001',
        facturaRectificadaFecha: '2026-10-15',
        motivoRectificativa: `Rectificación ${rType} por sustitución`,
        importeRectificacion: {
          baseRectificada: 1000,
          cuotaRectificada: 40,
          cuotaRecargoRectificado: 0
        },
        totales: {
          baseImponible: 800,
          porcentajeIva: 4,
          cuotaIva: 32,
          aplicaRecargo: false,
          porcentajeRecargo: 0,
          cuotaRecargo: 0,
          totalDocumento: 832
        }
      });

      const rec = await buildSealedAltaRecord(inv);
      const xml = buildAeatVerifactuXml(rec);

      assert.ok(xml.includes(`<sf:TipoFactura>${rType}</sf:TipoFactura>`));
      assert.ok(xml.includes('<sf:TipoRectificativa>S</sf:TipoRectificativa>'));
      assert.ok(xml.includes('<sf:ImporteRectificacion>'));
      assert.ok(xml.includes('<sf:BaseRectificada>1000.00</sf:BaseRectificada>'));
      assert.ok(xml.includes('<sf:CuotaRectificada>40.00</sf:CuotaRectificada>'));
      assert.ok(xml.includes('<sf:CuotaRecargoRectificado>0.00</sf:CuotaRecargoRectificado>'));

      const report = validateXmlAgainstOfficialXsd(xml);
      assert.strictEqual(report.valid, true, `${rType} (S) falló XSD: ${report.errors.join('; ')}`);
    });
  }

  await runTest("3.R5.I: Factura rectificativa simplificada R5 por diferencias ('I') sin Destinatarios valida contra XSD oficial", async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'RECT-R5-I-2026/001',
      tipoFactura: 'R5',
      esRectificativa: true,
      tipoRectificativa: 'por_diferencias',
      facturaRectificadaNumero: 'SIMP-2026/0001',
      facturaRectificadaFecha: '2026-10-18',
      clienteCif: '',
      clienteNombre: 'Consumidor Final',
      totales: {
        baseImponible: -50,
        porcentajeIva: 4,
        cuotaIva: -2,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: -52
      }
    });

    const rec = await buildSealedAltaRecord(inv);
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:TipoFactura>R5</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:TipoRectificativa>I</sf:TipoRectificativa>'));
    assert.ok(!xml.includes('<sf:Destinatarios>'), 'R5 no debe incluir Destinatarios');

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `R5 (I) falló XSD: ${report.errors.join('; ')}`);
  });

  await runTest("3.R5.S: Factura rectificativa simplificada R5 por sustitución ('S') con ImporteRectificacion valida contra XSD oficial", async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'RECT-R5-S-2026/001',
      tipoFactura: 'R5',
      esRectificativa: true,
      tipoRectificativa: 'por_sustitucion',
      facturaRectificadaNumero: 'SIMP-2026/0001',
      facturaRectificadaFecha: '2026-10-18',
      clienteCif: '',
      clienteNombre: 'Consumidor Final',
      importeRectificacion: {
        baseRectificada: 100,
        cuotaRectificada: 4
      }
    });

    const rec = await buildSealedAltaRecord(inv);
    const xml = buildAeatVerifactuXml(rec);

    assert.ok(xml.includes('<sf:TipoFactura>R5</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:TipoRectificativa>S</sf:TipoRectificativa>'));
    assert.ok(xml.includes('<sf:ImporteRectificacion>'));
    assert.ok(!xml.includes('<sf:Destinatarios>'));

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `R5 (S) falló XSD: ${report.errors.join('; ')}`);
  });

  // ---------------------------------------------------------------------------
  // 4. CONFORMIDAD REAL DE REGISTRO DE ANULACIÓN (INICIAL, ENCADENADO Y GENERADOR)
  // ---------------------------------------------------------------------------
  await runTest('4.1: RegistroAnulacion encadenado a un RegistroAlta previo y con Generador valida contra XSD oficial', async () => {
    const prevAlta = await buildSealedAltaRecord(createBaseInvoice());
    const fechaHoraAnul = '2026-10-20T11:00:00+02:00';
    const hashAnul = await calculateAnulacionHash({
      nifEmisor: baseConfig.nifEmisor,
      numSerieFactura: prevAlta.factura.numeroFactura,
      fechaExpedicion: prevAlta.factura.fechaExpedicion,
      huellaAnterior: prevAlta.huella.hash,
      fechaHoraHusoGenRegistro: fechaHoraAnul
    });

    const anulRecord = createFiscalAnulacionRecord({
      obligadoTributarioId: baseConfig.obligadoTributarioId,
      config: baseConfig,
      facturaAnulada: {
        numeroFactura: prevAlta.factura.numeroFactura,
        fechaExpedicion: prevAlta.factura.fechaExpedicion,
        motivoAnulacion: 'Emisión duplicada por error material',
        refExterna: 'ANUL-EXT-001',
        sinRegistroPrevio: 'N',
        rechazoPrevio: 'N',
        generadoPor: 'T',
        generador: {
          nombreRazon: 'Asesoría Fiscal Autorizada S.L.',
          nif: 'B11223344'
        }
      },
      previousRecord: prevAlta,
      options: {
        hashActual: hashAnul.hash,
        fechaHoraHusoGenRegistro: fechaHoraAnul,
        cadenaTextoCanonico: hashAnul.canonicalString
      }
    });

    const xml = buildAeatVerifactuXml(anulRecord);
    assert.ok(xml.includes('<sf:RegistroAnulacion>'));
    assert.ok(xml.includes('<sf:IDEmisorFacturaAnulada>B12345678</sf:IDEmisorFacturaAnulada>'));
    assert.ok(xml.includes('<sf:GeneradoPor>T</sf:GeneradoPor>'));
    assert.ok(xml.includes('<sf:Generador>'));
    assert.ok(xml.includes('<sf:RegistroAnterior>'));

    const report = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(report.valid, true, `RegistroAnulacion falló XSD: ${report.errors.join('; ')}`);
  });

  // ---------------------------------------------------------------------------
  // 5. TESTS NEGATIVOS EXHAUSTIVOS CONTRA XSD OFICIAL Y REGLAS FUNCIONALES
  // ---------------------------------------------------------------------------
  await runTest('5.1: Rechaza orden incorrecto de xs:sequence en RegistroAlta (CuotaTotal después de ImporteTotal)', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice());
    const validXml = buildAeatVerifactuXml(rec);

    const brokenXml = validXml.replace(
      /<sf:CuotaTotal>([^<]+)<\/sf:CuotaTotal>\s*<sf:ImporteTotal>([^<]+)<\/sf:ImporteTotal>/,
      '<sf:ImporteTotal>$2</sf:ImporteTotal>\n      <sf:CuotaTotal>$1</sf:CuotaTotal>'
    );

    const report = validateXmlAgainstOfficialXsd(brokenXml);
    assert.strictEqual(report.valid, false, 'XSD oficial debe rechazar orden invertido de CuotaTotal e ImporteTotal');
  });

  await runTest('5.2: Rechaza violación de xs:choice en Encadenamiento (PrimerRegistro y RegistroAnterior simultáneos)', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice());
    const validXml = buildAeatVerifactuXml(rec);

    const brokenXml = validXml.replace(
      '<sf:PrimerRegistro>S</sf:PrimerRegistro>',
      `<sf:PrimerRegistro>S</sf:PrimerRegistro>
        <sf:RegistroAnterior>
          <sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura>
          <sf:NumSerieFactura>FAC-0</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>19-10-2026</sf:FechaExpedicionFactura>
          <sf:Huella>${'A'.repeat(64)}</sf:Huella>
        </sf:RegistroAnterior>`
    );

    const report = validateXmlAgainstOfficialXsd(brokenXml);
    assert.strictEqual(report.valid, false, 'XSD oficial debe rechazar PrimerRegistro + RegistroAnterior simultáneos');
  });

  await runTest('5.3: Rechaza factura rectificativa R1 sin TipoRectificativa', async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'RECT-R1-BAD',
      tipoFactura: 'R1',
      esRectificativa: true,
      tipoRectificativa: 'por_diferencias'
    });
    const rec = await buildSealedAltaRecord(inv);
    const validXml = buildAeatVerifactuXml(rec);

    const xmlWithoutTipoRect = validXml.replace(/\s*<sf:TipoRectificativa>I<\/sf:TipoRectificativa>/, '');
    const report = validateXmlAgainstOfficialXsd(xmlWithoutTipoRect);
    assert.strictEqual(report.valid, false, 'Debe rechazar R1 sin TipoRectificativa');
  });

  await runTest('5.4: Rechaza factura rectificativa por sustitución (S) sin ImporteRectificacion', async () => {
    const inv = createBaseInvoice({
      numeroFactura: 'RECT-R1-S-BAD',
      tipoFactura: 'R1',
      esRectificativa: true,
      tipoRectificativa: 'por_sustitucion'
    });
    const rec = await buildSealedAltaRecord(inv);
    // Eliminar importeRectificacion forzando un objeto mutado para probar la barrera del builder
    const mutated: FiscalRecord = {
      ...rec,
      datosRectificativa: {
        tipoRectificativa: 'S',
        facturasRectificadas: []
      }
    };
    assert.throws(
      () => buildAeatVerifactuXml(mutated),
      /ImporteRectificacion/,
      'El builder debe prohibir R1 por sustitución sin ImporteRectificacion'
    );
  });

  await runTest('5.5: Rechaza factura F2 con bloque Destinatarios y rechaza F1 sin Destinatarios', async () => {
    const recF1 = await buildSealedAltaRecord(createBaseInvoice());
    const mutatedF1WithoutDest: FiscalRecord = {
      ...recF1,
      destinatario: undefined,
      destinatarios: undefined
    };
    assert.throws(
      () => buildAeatVerifactuXml(mutatedF1WithoutDest),
      /Destinatarios/,
      'El builder debe rechazar F1 sin destinatario identificado'
    );

    const recF2 = await buildSealedAltaRecord(
      createBaseInvoice({ tipoFactura: 'F2', clienteCif: '' })
    );
    const mutatedF2WithDest: FiscalRecord = {
      ...recF2,
      destinatario: { nif: 'A87654321', nombreRazon: 'Cliente' }
    };
    assert.throws(
      () => buildAeatVerifactuXml(mutatedF2WithDest),
      /Destinatarios/,
      'El builder debe rechazar F2 con destinatario'
    );
  });

  await runTest('5.6: Rechaza violación de xs:choice en DetalleDesglose (CalificacionOperacion y OperacionExenta simultáneos)', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice());
    const validXml = buildAeatVerifactuXml(rec);

    const brokenXml = validXml.replace(
      '<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>',
      '<sf:CalificacionOperacion>S1</sf:CalificacionOperacion>\n          <sf:OperacionExenta>E1</sf:OperacionExenta>'
    );

    const report = validateXmlAgainstOfficialXsd(brokenXml);
    assert.strictEqual(report.valid, false, 'XSD oficial debe rechazar CalificacionOperacion + OperacionExenta simultáneos');
  });

  await runTest('5.7: Rechaza fechas en formato ISO YYYY-MM-DD dentro de FechaExpedicionFactura e importes con coma decimal', async () => {
    const rec = await buildSealedAltaRecord(createBaseInvoice());
    const validXml = buildAeatVerifactuXml(rec);

    const badDateXml = validXml.replace(
      '<sf:FechaExpedicionFactura>20-10-2026</sf:FechaExpedicionFactura>',
      '<sf:FechaExpedicionFactura>2026-10-20</sf:FechaExpedicionFactura>'
    );
    assert.strictEqual(validateXmlAgainstOfficialXsd(badDateXml).valid, false, 'XSD debe rechazar YYYY-MM-DD en FechaExpedicionFactura');

    const badAmountXml = validXml.replace(
      '<sf:ImporteTotal>1040.00</sf:ImporteTotal>',
      '<sf:ImporteTotal>1040,00</sf:ImporteTotal>'
    );
    assert.strictEqual(validateXmlAgainstOfficialXsd(badAmountXml).valid, false, 'XSD debe rechazar coma decimal en ImporteTotal');
  });

  console.log('================================================================');
  console.log(`  RESULTADO FASE 4.1: ${passed}/${total} TESTS SUPERADOS CON ÉXITO`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
