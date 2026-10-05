/**
 * SUITE DE TESTS FUNCIONALES END-TO-END (E2E): FACTURAS RECTIFICATIVAS Y ANULACIONES
 *
 * Verifica rigurosamente de extremo a extremo toda la cadena fiscal:
 *   UI (buildRectificativaFacturaFromUiState / ModalFacturaRectificativa)
 *    ↓
 *   Factura rectificativa (modelo comercial enriquecido)
 *    ↓
 *   emitFiscalInvoice / emitFiscalAnulacion -> FiscalRecord inmutable
 *    ↓
 *   Huella SHA-256 canónica (calculateAltaHash / verifyFiscalRecordHash) + Encadenamiento (verifyFiscalRecordChain)
 *    ↓
 *   Generación XML oficial (buildAeatVerifactuXml)
 *    ↓
 *   Validación XSD oficial real con motor libxml2-wasm (validateXmlAgainstOfficialXsd)
 *    ↓
 *   Remisión Outbox autoritativa (executeAuthoritativeOutboxSubmission)
 *    ↓
 *   Respuesta SOAP AEAT y correlación por registro (ACCEPTED, ACCEPTED_WITH_ERRORS, PARTIALLY_ACCEPTED, REJECTED)
 *
 * Variantes cubiertas:
 * 1. R1 por diferencias ('I') - Anulación económica total (-100%) desde UI.
 * 2. R1 por diferencias ('I') - Rectificación parcial con Recargo de Equivalencia negativo desde UI.
 * 3. R1 por sustitución ('S') - Rectificación parcial y Anulación total a 0,00 € con ImporteRectificacion.
 * 4. R2 (Concurso acreedores), R3 (Deudas incobrables) y R4 (Resto de causas) en modalidades 'I' y 'S'.
 * 5. R5 (Rectificativa en facturas simplificadas F2 sin destinatario) en modalidades 'I' y 'S'.
 * 6. Rectificativa de múltiples facturas originales (<sf:FacturasRectificadas> múltiple) + destinatario extranjero IDOtro.
 * 7. Rechazo funcional AEAT (REJECTED) -> Bloqueo 409 -> Subsanación (<sf:Subsanacion>S</sf:Subsanacion>) -> Aceptación.
 * 8. Cadena mixta completa (F1 + R1..R5 + RegistroAnulacion) remitida en lote Outbox con correlación individual.
 */

import assert from 'node:assert';
import { Factura } from '../src/types';
import {
  FiscalConfiguration,
  FiscalRecord
} from '../src/fiscal/types';
import {
  createDefaultFiscalConfiguration,
  createFiscalRecordFromInvoice
} from '../src/fiscal/modelTransformers';
import {
  buildRectificativaFacturaFromUiState,
  inferDefaultClaveRectificativa,
  DEFAULT_MOTIVO_BY_CLAVE,
  ClaveTipoFacturaRectificativaAEAT
} from '../src/fiscal/rectificativaUiBuilder';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion,
  resetFiscalQueue
} from '../src/fiscal/emissionService';
import {
  verifyFiscalRecordHash,
  verifyFiscalRecordChain
} from '../src/fiscal/hashService';
import {
  buildAeatVerifactuXml
} from '../src/fiscal/aeatVerifactuXmlBuilder';
import {
  validateXmlAgainstOfficialXsd
} from '../src/fiscal/aeatXsdValidatorNode';
import {
  executeAuthoritativeOutboxSubmission,
  collectEligibleOutboxRecordsForObligado,
  FiscalSubmissionHttpError
} from '../src/fiscal/outboxBatchProcessor';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';
import { resetFiscalOutbox } from '../src/fiscal/submissionService';
import { AeatFlowControlManager } from '../src/fiscal/aeatTransport';
import { MockAeatTransport } from '../src/fiscal/mockAeatTransport';
import { AeatCertificateProvider } from '../src/fiscal/aeatCertificateProvider';

console.log('========================================================================');
console.log('  EJECUTANDO SUITE E2E: FACTURAS RECTIFICATIVAS Y ANULACIONES (AEAT)');
console.log('========================================================================');

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

const OBLIGADO_NIF = 'B85858585';
const fiscalConfig: FiscalConfiguration = createDefaultFiscalConfiguration({
  nif: OBLIGADO_NIF,
  nombreRazon: 'Granja Avícola El Valle S.L.'
});

async function resetTestEnvironment() {
  BackendFiscalCustody.resetCustody();
  CloudDistributedChainCoordinator.resetCloudState();
  CloudDistributedChainCoordinator.setMode('simulator');
  resetFiscalQueue();
  resetFiscalOutbox();
  AeatFlowControlManager.reset();
}

function createOriginalF1Invoice(overrides?: Partial<Factura>): Factura {
  return {
    id: 'inv-orig-f1-001',
    numeroFactura: 'FAC-2026-0101',
    fecha: '2026-10-15',
    clienteId: 'cli-01',
    clienteNombre: 'Supermercados Delicias S.A.',
    clienteCif: 'A87654321',
    clienteDireccion: 'Calle Mayor 10, Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [
      {
        id: 'lin-orig-1',
        loteEnvasadoId: 'lote-env-01',
        codigoLoteEnvasado: 'ENV-2026-10',
        formatoId: 'fmt-caja-L',
        nombreFormato: 'Huevos camperos clase L (Cajas 30 docenas)',
        cantidadEstuches: 10,
        precioUnitario: 100,
        subtotal: 1000,
        fechaConsumoPreferente: '2026-11-14',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 1000,
      porcentajeIva: 4,
      cuotaIva: 40,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 1040
    },
    estadoPago: 'pagada',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-10-15T09:00:00+02:00',
    tipoFactura: 'F1',
    esRectificativa: false,
    ...overrides
  };
}

async function main() {
  // ---------------------------------------------------------------------------
  // 1. E2E R1 POR DIFERENCIAS ('I') - ANULACIÓN ECONÓMICA TOTAL DESDE UI
  // ---------------------------------------------------------------------------
  await runTest("1: E2E UI -> R1 por diferencias ('I', anulación económica total -100%) -> FiscalRecord -> Hash -> XML -> XSD -> Submission -> AEAT ACCEPTED", async () => {
    await resetTestEnvironment();

    // 1.1 Emitir factura original F1
    const origF1 = createOriginalF1Invoice();
    const emittedOrig = await emitFiscalInvoice({
      invoiceDraft: origF1,
      fiscalConfig
    });

    // 1.2 Construir borrador de Factura Rectificativa desde el estado de UI (ModalFacturaRectificativa)
    const rectInvoiceDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      existingInvoices: [emittedOrig.invoice],
      fecha: '2026-10-20',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Error en tarifa aplicada en pedido completo'
    });

    assert.strictEqual(rectInvoiceDraft.esRectificativa, true);
    assert.strictEqual(rectInvoiceDraft.tipoFactura, 'R1');
    assert.strictEqual(rectInvoiceDraft.tipoRectificativa, 'por_diferencias');
    assert.strictEqual(rectInvoiceDraft.totales.baseImponible, -1000);
    assert.strictEqual(rectInvoiceDraft.totales.cuotaIva, -40);
    assert.strictEqual(rectInvoiceDraft.totales.totalDocumento, -1040);
    assert.strictEqual(rectInvoiceDraft.importeRectificacion, undefined, 'Por diferencias no debe tener importeRectificacion');
    assert.strictEqual(rectInvoiceDraft.facturasRectificadas?.length, 1);
    assert.strictEqual(rectInvoiceDraft.facturasRectificadas?.[0].numeroFactura, 'FAC-2026-0101');

    // 1.3 Emitir FiscalRecord a través del servicio autoritativo de emisión
    const emittedRect = await emitFiscalInvoice({
      invoiceDraft: rectInvoiceDraft,
      fiscalConfig
    });
    const recR1 = emittedRect.fiscalRecord;

    assert.strictEqual(recR1.factura.tipoFactura, 'R1');
    assert.ok(recR1.datosRectificativa, 'FiscalRecord debe incluir datosRectificativa');
    assert.strictEqual(recR1.datosRectificativa?.tipoRectificativa, 'I');
    assert.strictEqual(recR1.datosRectificativa?.importeRectificacion, undefined);
    assert.strictEqual(recR1.datosRectificativa?.facturasRectificadas.length, 1);
    assert.strictEqual(recR1.datosRectificativa?.facturasRectificadas[0].numeroFactura, 'FAC-2026-0101');
    assert.strictEqual(recR1.datosRectificativa?.facturasRectificadas[0].idEmisorFactura, OBLIGADO_NIF);

    // 1.4 Verificar huella SHA-256 y encadenamiento con la factura F1 original
    const hashVerif = await verifyFiscalRecordHash(recR1);
    assert.strictEqual(hashVerif.valid, true, `Hash inválido en R1(I): ${hashVerif.reason}`);
    assert.ok(
      recR1.huella.cadenaTextoCanonico.includes('TipoFactura=R1&CuotaTotal=-40.00&ImporteTotal=-1040.00'),
      `Cadena canónica inesperada: ${recR1.huella.cadenaTextoCanonico}`
    );
    assert.strictEqual(recR1.encadenamiento.primerRegistro, false);
    assert.strictEqual(recR1.encadenamiento.registroAnterior?.huella, emittedOrig.fiscalRecord.huella.hash);

    const chainVerif = await verifyFiscalRecordChain([emittedOrig.fiscalRecord, recR1]);
    assert.strictEqual(chainVerif.valid, true, `Cadena rota: ${chainVerif.reason}`);

    // 1.5 Generar XML oficial y validar contra XSD oficial (libxml2-wasm)
    const xml = buildAeatVerifactuXml(recR1);
    assert.ok(xml.includes('<sf:TipoFactura>R1</sf:TipoFactura>'));
    assert.ok(xml.includes('<sf:TipoRectificativa>I</sf:TipoRectificativa>'));
    assert.ok(xml.includes('<sf:FacturasRectificadas>'));
    assert.ok(xml.includes('<sf:NumSerieFactura>FAC-2026-0101</sf:NumSerieFactura>'));
    assert.ok(xml.includes('<sf:FechaExpedicionFactura>15-10-2026</sf:FechaExpedicionFactura>'));
    assert.ok(!xml.includes('<sf:ImporteRectificacion>'));
    assert.ok(xml.includes('<sf:BaseImponibleOimporteNoSujeto>-1000.00</sf:BaseImponibleOimporteNoSujeto>'));
    assert.ok(xml.includes('<sf:CuotaTotal>-40.00</sf:CuotaTotal>'));
    assert.ok(xml.includes('<sf:ImporteTotal>-1040.00</sf:ImporteTotal>'));

    const xsdReport = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(xsdReport.valid, true, `Fallo XSD en R1(I): ${xsdReport.errors.join('; ')}`);
    assert.strictEqual(xsdReport.engine, 'libxml2-wasm');

    // 1.6 Remitir a AEAT mediante Outbox y verificar respuesta ACCEPTED
    AeatFlowControlManager.reset();
    const submitRes = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: recR1.id,
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });

    assert.strictEqual(submitRes.submission?.estado, 'ACCEPTED');
    assert.ok(submitRes.submission?.csv, 'Debe devolver CSV de aceptación AEAT');
    assert.strictEqual(submitRes.recordResult?.fiscalRecordId, recR1.id);
    assert.strictEqual(submitRes.recordResult?.estado, 'ACCEPTED');
  });

  // ---------------------------------------------------------------------------
  // 2. E2E R1 POR DIFERENCIAS ('I') CON RECARGO DE EQUIVALENCIA NEGATIVO
  // ---------------------------------------------------------------------------
  await runTest("2: E2E UI -> R1 por diferencias ('I', rectificación parcial con Recargo de Equivalencia negativo) -> FiscalRecord -> Hash -> XML -> XSD -> Submission", async () => {
    await resetTestEnvironment();

    const origWithRecargo = createOriginalF1Invoice({
      id: 'inv-orig-recargo-001',
      numeroFactura: 'FAC-2026-0102',
      clienteRecargoEquivalencia: true,
      totales: {
        baseImponible: 500,
        porcentajeIva: 4,
        cuotaIva: 20,
        aplicaRecargo: true,
        porcentajeRecargo: 0.5,
        cuotaRecargo: 2.5,
        totalDocumento: 522.5
      }
    });

    const emittedOrig = await emitFiscalInvoice({
      invoiceDraft: origWithRecargo,
      fiscalConfig
    });

    // En la UI el usuario selecciona rectificación parcial por diferencias y abona 2 cajas (-200 € base)
    const rectDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      existingInvoices: [emittedOrig.invoice],
      fecha: '2026-10-21',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '02',
      motivoTexto: 'Devolución de 2 cajas dañadas en transporte',
      lineasEditadas: [
        {
          ...emittedOrig.invoice.lineas[0],
          id: 'rect-lin-partial-1',
          cantidadEstuches: -2,
          precioUnitario: 100,
          subtotal: -200
        }
      ]
    });

    assert.strictEqual(rectDraft.totales.baseImponible, -200);
    assert.strictEqual(rectDraft.totales.cuotaIva, -8);
    assert.strictEqual(rectDraft.totales.aplicaRecargo, true);
    assert.strictEqual(rectDraft.totales.porcentajeRecargo, 0.5);
    assert.strictEqual(rectDraft.totales.cuotaRecargo, -1);
    assert.strictEqual(rectDraft.totales.totalDocumento, -209);

    const emittedRect = await emitFiscalInvoice({
      invoiceDraft: rectDraft,
      fiscalConfig
    });
    const rec = emittedRect.fiscalRecord;

    // Verificar que el recargo negativo NO se pierde en desgloseIVA
    assert.strictEqual(rec.desgloseTributario.desgloseIVA.length, 1);
    assert.strictEqual(rec.desgloseTributario.desgloseIVA[0].tipoRecargoEquivalencia, 0.5);
    assert.strictEqual(rec.desgloseTributario.desgloseIVA[0].cuotaRecargoEquivalencia, -1);
    assert.strictEqual(rec.desgloseTributario.cuotaRecargoTotal, -1);

    // CuotaTotal = cuotaIva (-8) + cuotaRecargo (-1) = -9.00
    assert.ok(
      rec.huella.cadenaTextoCanonico.includes('TipoFactura=R1&CuotaTotal=-9.00&ImporteTotal=-209.00'),
      `Cadena canónica debe incluir CuotaTotal=-9.00: ${rec.huella.cadenaTextoCanonico}`
    );

    const xml = buildAeatVerifactuXml(rec);
    assert.ok(xml.includes('<sf:TipoRecargoEquivalencia>0.50</sf:TipoRecargoEquivalencia>'));
    assert.ok(xml.includes('<sf:CuotaRecargoEquivalencia>-1.00</sf:CuotaRecargoEquivalencia>'));
    assert.ok(xml.includes('<sf:CuotaTotal>-9.00</sf:CuotaTotal>'));
    assert.ok(xml.includes('<sf:ImporteTotal>-209.00</sf:ImporteTotal>'));

    const xsdReport = validateXmlAgainstOfficialXsd(xml);
    assert.strictEqual(xsdReport.valid, true, `Fallo XSD en R1(I) con recargo negativo: ${xsdReport.errors.join('; ')}`);

    AeatFlowControlManager.reset();
    const submitRes = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: rec.id,
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });
    assert.strictEqual(submitRes.submission?.estado, 'ACCEPTED');
  });

  // ---------------------------------------------------------------------------
  // 3. E2E R1 POR SUSTITUCIÓN ('S') - PARCIAL Y ANULACIÓN A 0,00 € DESDE UI
  // ---------------------------------------------------------------------------
  await runTest("3: E2E UI -> R1 por sustitución ('S', parcial con nuevos importes y anulación a 0.00 €) con ImporteRectificacion -> Hash -> XML -> XSD -> Submission", async () => {
    await resetTestEnvironment();

    const orig = createOriginalF1Invoice({
      id: 'inv-orig-sust-001',
      numeroFactura: 'FAC-2026-0103',
      clienteRecargoEquivalencia: true,
      totales: {
        baseImponible: 1000,
        porcentajeIva: 4,
        cuotaIva: 40,
        aplicaRecargo: true,
        porcentajeRecargo: 0.5,
        cuotaRecargo: 5,
        totalDocumento: 1045
      }
    });
    const emittedOrig = await emitFiscalInvoice({ invoiceDraft: orig, fiscalConfig });

    // 3.A: Sustitución parcial (el importe definitivo pasa a ser 8 cajas = 800 € base)
    const rectSustParcialDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      existingInvoices: [emittedOrig.invoice],
      numeroFacturaOverride: 'R-2026-0001',
      fecha: '2026-10-22',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_sustitucion',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Sustitución de factura por ajuste definitivo a 8 cajas',
      lineasEditadas: [
        {
          ...emittedOrig.invoice.lineas[0],
          id: 'rect-sust-lin-1',
          cantidadEstuches: 8,
          precioUnitario: 100,
          subtotal: 800
        }
      ]
    });

    assert.strictEqual(rectSustParcialDraft.tipoRectificativa, 'por_sustitucion');
    assert.deepStrictEqual(rectSustParcialDraft.importeRectificacion, {
      baseRectificada: 1000,
      cuotaRectificada: 40,
      cuotaRecargoRectificado: 5
    });
    assert.strictEqual(rectSustParcialDraft.totales.baseImponible, 800);
    assert.strictEqual(rectSustParcialDraft.totales.cuotaIva, 32);
    assert.strictEqual(rectSustParcialDraft.totales.cuotaRecargo, 4);
    assert.strictEqual(rectSustParcialDraft.totales.totalDocumento, 836);

    const emittedSustParcial = await emitFiscalInvoice({
      invoiceDraft: rectSustParcialDraft,
      fiscalConfig
    });
    const recSustParcial = emittedSustParcial.fiscalRecord;

    assert.strictEqual(recSustParcial.datosRectificativa?.tipoRectificativa, 'S');
    assert.deepStrictEqual(recSustParcial.datosRectificativa?.importeRectificacion, {
      baseRectificada: 1000,
      cuotaRectificada: 40,
      cuotaRecargoRectificado: 5
    });

    const xmlSustParcial = buildAeatVerifactuXml(recSustParcial);
    assert.ok(xmlSustParcial.includes('<sf:TipoRectificativa>S</sf:TipoRectificativa>'));
    assert.ok(xmlSustParcial.includes('<sf:ImporteRectificacion>'));
    assert.ok(xmlSustParcial.includes('<sf:BaseRectificada>1000.00</sf:BaseRectificada>'));
    assert.ok(xmlSustParcial.includes('<sf:CuotaRectificada>40.00</sf:CuotaRectificada>'));
    assert.ok(xmlSustParcial.includes('<sf:CuotaRecargoRectificado>5.00</sf:CuotaRecargoRectificado>'));
    assert.ok(xmlSustParcial.includes('<sf:CuotaTotal>36.00</sf:CuotaTotal>'));
    assert.ok(xmlSustParcial.includes('<sf:ImporteTotal>836.00</sf:ImporteTotal>'));

    const xsdSustParcial = validateXmlAgainstOfficialXsd(xmlSustParcial);
    assert.strictEqual(xsdSustParcial.valid, true, `Fallo XSD en R1(S) parcial: ${xsdSustParcial.errors.join('; ')}`);

    // 3.B: Sustitución en modo anulación total (nuevo importe definitivo = 0,00 €, informando ImporteRectificacion original)
    const rectSustCeroDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      existingInvoices: [emittedOrig.invoice, emittedSustParcial.invoice],
      numeroFacturaOverride: 'R-2026-0002',
      fecha: '2026-10-22',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_sustitucion',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Sustitución total a importe 0,00 €'
    });

    assert.strictEqual(rectSustCeroDraft.totales.baseImponible, 0);
    assert.strictEqual(rectSustCeroDraft.totales.cuotaIva, 0);
    assert.strictEqual(rectSustCeroDraft.totales.cuotaRecargo, 0);
    assert.strictEqual(rectSustCeroDraft.totales.totalDocumento, 0);
    assert.strictEqual(rectSustCeroDraft.importeRectificacion?.baseRectificada, 1000);
    assert.strictEqual(rectSustCeroDraft.importeRectificacion?.cuotaRectificada, 40);

    const emittedSustCero = await emitFiscalInvoice({
      invoiceDraft: rectSustCeroDraft,
      fiscalConfig
    });
    const xmlSustCero = buildAeatVerifactuXml(emittedSustCero.fiscalRecord);
    assert.ok(xmlSustCero.includes('<sf:CuotaRecargoEquivalencia>0.00</sf:CuotaRecargoEquivalencia>'));
    assert.ok(xmlSustCero.includes('<sf:CuotaTotal>0.00</sf:CuotaTotal>'));
    assert.ok(xmlSustCero.includes('<sf:ImporteTotal>0.00</sf:ImporteTotal>'));

    const xsdSustCero = validateXmlAgainstOfficialXsd(xmlSustCero);
    assert.strictEqual(xsdSustCero.valid, true, `Fallo XSD en R1(S) a 0.00: ${xsdSustCero.errors.join('; ')}`);

    AeatFlowControlManager.reset();
    const submitRes = await executeAuthoritativeOutboxSubmission({
      fiscalRecordIds: [recSustParcial.id, emittedSustCero.fiscalRecord.id],
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });
    assert.strictEqual(submitRes.submission?.estado, 'ACCEPTED');
    assert.strictEqual(submitRes.cantidadRegistros, 2);
  });

  // ---------------------------------------------------------------------------
  // 4. E2E R2, R3 Y R4 EN AMBAS MODALIDADES ('I' Y 'S') DESDE UI
  // ---------------------------------------------------------------------------
  await runTest("4: E2E UI -> R2 (Concurso Art. 80.3), R3 (Incobrables Art. 80.4) y R4 (Resto causas) en modalidades 'I' y 'S' -> Hash -> XML -> XSD -> Submission", async () => {
    await resetTestEnvironment();

    const orig = createOriginalF1Invoice({
      id: 'inv-orig-r234',
      numeroFactura: 'FAC-2026-0200'
    });
    const emittedOrig = await emitFiscalInvoice({ invoiceDraft: orig, fiscalConfig });

    const claves: ClaveTipoFacturaRectificativaAEAT[] = ['R2', 'R3', 'R4'];
    const emittedRecords: FiscalRecord[] = [emittedOrig.fiscalRecord];

    for (const clave of claves) {
      for (const mecanismo of ['por_diferencias', 'por_sustitucion'] as const) {
        const expectedCode = mecanismo === 'por_diferencias' ? 'I' : 'S';
        const numFac = `R-${clave}-${expectedCode}-2026`;

        const draft = buildRectificativaFacturaFromUiState({
          facturaOriginal: emittedOrig.invoice,
          numeroFacturaOverride: numFac,
          fecha: '2026-10-23',
          modo: 'rectificacion_parcial',
          tipoRectificativa: mecanismo,
          claveTipoFactura: clave,
          codigoMotivo: DEFAULT_MOTIVO_BY_CLAVE[clave],
          motivoTexto: `Rectificación reglamentaria ${clave} (${expectedCode})`,
          lineasEditadas: [
            {
              ...emittedOrig.invoice.lineas[0],
              id: `lin-${clave}-${expectedCode}`,
              cantidadEstuches: mecanismo === 'por_diferencias' ? -3 : 7,
              precioUnitario: 100,
              subtotal: mecanismo === 'por_diferencias' ? -300 : 700
            }
          ]
        });

        const emitted = await emitFiscalInvoice({
          invoiceDraft: draft,
          fiscalConfig
        });
        const rec = emitted.fiscalRecord;
        emittedRecords.push(rec);

        assert.strictEqual(rec.factura.tipoFactura, clave);
        assert.strictEqual(rec.datosRectificativa?.tipoRectificativa, expectedCode);
        if (expectedCode === 'S') {
          assert.strictEqual(rec.datosRectificativa?.importeRectificacion?.baseRectificada, 1000);
          assert.strictEqual(rec.datosRectificativa?.importeRectificacion?.cuotaRectificada, 40);
        } else {
          assert.strictEqual(rec.datosRectificativa?.importeRectificacion, undefined);
        }

        const hashCheck = await verifyFiscalRecordHash(rec);
        assert.strictEqual(hashCheck.valid, true, `Hash inválido en ${clave}(${expectedCode})`);

        const xml = buildAeatVerifactuXml(rec);
        assert.ok(xml.includes(`<sf:TipoFactura>${clave}</sf:TipoFactura>`));
        assert.ok(xml.includes(`<sf:TipoRectificativa>${expectedCode}</sf:TipoRectificativa>`));

        const xsdReport = validateXmlAgainstOfficialXsd(xml);
        assert.strictEqual(
          xsdReport.valid,
          true,
          `XSD falló en ${clave}(${expectedCode}): ${xsdReport.errors.join('; ')}`
        );
      }
    }

    // Verificar integridad de toda la cadena de 7 registros (F1 + 6 rectificativas)
    const chainCheck = await verifyFiscalRecordChain(emittedRecords);
    assert.strictEqual(chainCheck.valid, true, `Cadena rota en R2..R4: ${chainCheck.reason}`);

    // Drenar todo el Outbox en un único lote SOAP y verificar aceptación AEAT
    AeatFlowControlManager.reset();
    const outboxSubmit = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: OBLIGADO_NIF,
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });

    assert.strictEqual(outboxSubmit.submission?.estado, 'ACCEPTED');
    assert.strictEqual(outboxSubmit.cantidadRegistros, 7);
    assert.strictEqual(outboxSubmit.resultadosIndividuales?.every(r => r.estado === 'ACCEPTED'), true);
  });

  // ---------------------------------------------------------------------------
  // 5. E2E R5 RECTIFICATIVA SIMPLIFICADA (SIN DESTINATARIOS) EN 'I' Y 'S' DESDE UI
  // ---------------------------------------------------------------------------
  await runTest("5: E2E UI -> R5 (Factura rectificativa en facturas simplificadas F2 sin destinatario) en modalidades 'I' y 'S' -> Hash -> XML -> XSD -> Submission", async () => {
    await resetTestEnvironment();

    const origF2 = createOriginalF1Invoice({
      id: 'inv-orig-f2-001',
      numeroFactura: 'SIMP-2026-0050',
      tipoFactura: 'F2',
      clienteCif: '',
      clienteNombre: 'Consumidor Final Tienda Granja',
      totales: {
        baseImponible: 100,
        porcentajeIva: 4,
        cuotaIva: 4,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 104
      }
    });

    const emittedF2 = await emitFiscalInvoice({ invoiceDraft: origF2, fiscalConfig });

    // La inferencia por defecto de la UI debe seleccionar automáticamente 'R5' para una factura F2
    const inferredClave = inferDefaultClaveRectificativa(emittedF2.invoice);
    assert.strictEqual(inferredClave, 'R5', 'La UI debe inferir R5 para facturas simplificadas F2');

    // Además, si alguien intenta usar R1 sin NIF ni IDOtro, la UI debe bloquearlo
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: emittedF2.invoice,
          fecha: '2026-10-24',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R1',
          codigoMotivo: '01',
          motivoTexto: 'Intento inválido de R1 sin NIF'
        }),
      /exige identificación fiscal del destinatario/
    );

    // 5.A: R5 por diferencias ('I')
    const draftR5I = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedF2.invoice,
      numeroFacturaOverride: 'R5-I-2026-001',
      fecha: '2026-10-24',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_diferencias',
      codigoMotivo: '02',
      motivoTexto: 'Devolución de compra en tienda física'
    });

    assert.strictEqual(draftR5I.tipoFactura, 'R5');
    assert.strictEqual(draftR5I.clienteCif, '');

    const emittedR5I = await emitFiscalInvoice({ invoiceDraft: draftR5I, fiscalConfig });
    const recR5I = emittedR5I.fiscalRecord;

    assert.strictEqual(recR5I.factura.tipoFactura, 'R5');
    assert.strictEqual(recR5I.destinatario, undefined, 'R5 no debe tener destinatario en FiscalRecord');
    assert.strictEqual(recR5I.factura.facturaSimplificadaArt7273, 'S');
    assert.strictEqual(recR5I.factura.facturaSinIdentifDestinatarioArt61d, 'S');
    assert.strictEqual(recR5I.datosRectificativa?.tipoRectificativa, 'I');

    const xmlR5I = buildAeatVerifactuXml(recR5I);
    assert.ok(xmlR5I.includes('<sf:TipoFactura>R5</sf:TipoFactura>'));
    assert.ok(xmlR5I.includes('<sf:TipoRectificativa>I</sf:TipoRectificativa>'));
    assert.ok(!xmlR5I.includes('<sf:Destinatarios>'), 'R5 no puede incluir bloque <sf:Destinatarios>');
    assert.strictEqual(validateXmlAgainstOfficialXsd(xmlR5I).valid, true);

    // 5.B: R5 por sustitución ('S')
    const draftR5S = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedF2.invoice,
      numeroFacturaOverride: 'R5-S-2026-002',
      fecha: '2026-10-24',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_sustitucion',
      codigoMotivo: '01',
      motivoTexto: 'Corrección de ticket simplificado por sustitución',
      lineasEditadas: [
        {
          ...emittedF2.invoice.lineas[0],
          id: 'lin-r5-s',
          cantidadEstuches: 1,
          precioUnitario: 50,
          subtotal: 50
        }
      ]
    });

    const emittedR5S = await emitFiscalInvoice({ invoiceDraft: draftR5S, fiscalConfig });
    const recR5S = emittedR5S.fiscalRecord;

    assert.strictEqual(recR5S.factura.tipoFactura, 'R5');
    assert.strictEqual(recR5S.datosRectificativa?.tipoRectificativa, 'S');
    assert.deepStrictEqual(recR5S.datosRectificativa?.importeRectificacion, {
      baseRectificada: 100,
      cuotaRectificada: 4
    });

    const xmlR5S = buildAeatVerifactuXml(recR5S);
    assert.ok(xmlR5S.includes('<sf:TipoFactura>R5</sf:TipoFactura>'));
    assert.ok(xmlR5S.includes('<sf:TipoRectificativa>S</sf:TipoRectificativa>'));
    assert.ok(xmlR5S.includes('<sf:ImporteRectificacion>'));
    assert.ok(!xmlR5S.includes('<sf:Destinatarios>'));
    assert.strictEqual(validateXmlAgainstOfficialXsd(xmlR5S).valid, true);

    AeatFlowControlManager.reset();
    const submitRes = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: OBLIGADO_NIF,
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });
    assert.strictEqual(submitRes.submission?.estado, 'ACCEPTED');
    assert.strictEqual(submitRes.cantidadRegistros, 3);
  });

  // ---------------------------------------------------------------------------
  // 6. E2E MÚLTIPLES FACTURAS RECTIFICADAS + DESTINATARIO EXTRANJERO (IDOtro)
  // ---------------------------------------------------------------------------
  await runTest("6: E2E UI -> Rectificativa que rectifica múltiples facturas originales (<sf:FacturasRectificadas> múltiple) con destinatario extranjero IDOtro", async () => {
    await resetTestEnvironment();

    const orig1 = createOriginalF1Invoice({
      id: 'inv-fr-1',
      numeroFactura: 'FAC-2026-0301',
      fecha: '2026-10-10',
      clienteCif: '',
      clienteNombre: 'Marché Avicole Lyon SAS',
      clienteIdOtro: {
        codigoPais: 'FR',
        idType: '02',
        id: 'FR99887766554'
      },
      totales: {
        baseImponible: 1000,
        porcentajeIva: 4,
        cuotaIva: 40,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 1040
      }
    });

    const orig2 = createOriginalF1Invoice({
      id: 'inv-fr-2',
      numeroFactura: 'FAC-2026-0302',
      fecha: '2026-10-12',
      clienteCif: '',
      clienteNombre: 'Marché Avicole Lyon SAS',
      clienteIdOtro: {
        codigoPais: 'FR',
        idType: '02',
        id: 'FR99887766554'
      },
      totales: {
        baseImponible: 500,
        porcentajeIva: 4,
        cuotaIva: 20,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 520
      }
    });

    const emitted1 = await emitFiscalInvoice({ invoiceDraft: orig1, fiscalConfig });
    const emitted2 = await emitFiscalInvoice({ invoiceDraft: orig2, fiscalConfig });

    // Construir rectificativa R1 por sustitución que rectifica simultáneamente FAC-2026-0301 y FAC-2026-0302
    const multiRectDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emitted1.invoice,
      facturasAdicionalesRectificadas: [emitted2.invoice],
      numeroFacturaOverride: 'R-MULTI-2026-001',
      fecha: '2026-10-25',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_sustitucion',
      claveTipoFactura: 'R1',
      codigoMotivo: '03',
      motivoTexto: 'Rappel por volumen acumulado sobre dos facturas del mes',
      lineasEditadas: [
        {
          ...emitted1.invoice.lineas[0],
          id: 'lin-multi-sust',
          cantidadEstuches: 12,
          precioUnitario: 100,
          subtotal: 1200
        }
      ]
    });

    // La suma automática de BaseRectificada (1000 + 500 = 1500) y CuotaRectificada (40 + 20 = 60)
    assert.deepStrictEqual(multiRectDraft.importeRectificacion, {
      baseRectificada: 1500,
      cuotaRectificada: 60
    });
    assert.strictEqual(multiRectDraft.facturasRectificadas?.length, 2);

    const emittedMulti = await emitFiscalInvoice({ invoiceDraft: multiRectDraft, fiscalConfig });
    const recMulti = emittedMulti.fiscalRecord;

    assert.strictEqual(recMulti.datosRectificativa?.facturasRectificadas.length, 2);
    assert.strictEqual(recMulti.datosRectificativa?.facturasRectificadas[0].numeroFactura, 'FAC-2026-0301');
    assert.strictEqual(recMulti.datosRectificativa?.facturasRectificadas[1].numeroFactura, 'FAC-2026-0302');
    assert.strictEqual(recMulti.destinatario?.idOtro?.codigoPais, 'FR');
    assert.strictEqual(recMulti.destinatario?.idOtro?.id, 'FR99887766554');

    const xmlMulti = buildAeatVerifactuXml(recMulti);
    assert.ok(xmlMulti.includes('<sf:NumSerieFactura>FAC-2026-0301</sf:NumSerieFactura>'));
    assert.ok(xmlMulti.includes('<sf:NumSerieFactura>FAC-2026-0302</sf:NumSerieFactura>'));
    assert.ok(xmlMulti.includes('<sf:BaseRectificada>1500.00</sf:BaseRectificada>'));
    assert.ok(xmlMulti.includes('<sf:CuotaRectificada>60.00</sf:CuotaRectificada>'));
    assert.ok(xmlMulti.includes('<sf:IDOtro>'));

    const xsdMulti = validateXmlAgainstOfficialXsd(xmlMulti);
    assert.strictEqual(xsdMulti.valid, true, `Fallo XSD en multi-rectificativa: ${xsdMulti.errors.join('; ')}`);

    AeatFlowControlManager.reset();
    const submitRes = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: recMulti.id,
      internalTestOptions: { mockScenario: 'ACCEPTANCE' }
    });
    assert.strictEqual(submitRes.submission?.estado, 'ACCEPTED');
  });

  // ---------------------------------------------------------------------------
  // 7. E2E RECHAZO FUNCIONAL AEAT DE RECTIFICATIVA -> BLOQUEO 409 -> SUBSANACIÓN
  // ---------------------------------------------------------------------------
  await runTest("7: E2E Rectificativa rechazada por AEAT (REJECTED) bloquea reenvío ciego (409) y permite Subsanación reglamentaria (<sf:Subsanacion>S</sf:Subsanacion>)", async () => {
    await resetTestEnvironment();

    const orig = createOriginalF1Invoice({
      id: 'inv-orig-subsanacion',
      numeroFactura: 'FAC-2026-0401'
    });
    const emittedOrig = await emitFiscalInvoice({ invoiceDraft: orig, fiscalConfig });

    const rectDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      numeroFacturaOverride: 'R-2026-0401',
      fecha: '2026-10-26',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Rectificación inicial con rechazo simulado en AEAT'
    });
    const emittedRect = await emitFiscalInvoice({ invoiceDraft: rectDraft, fiscalConfig });

    // 7.1 Enviar y recibir REJECTED funcional de AEAT
    AeatFlowControlManager.reset();
    const rejectedSubmit = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: emittedRect.fiscalRecord.id,
      internalTestOptions: { mockScenario: 'FUNCTIONAL_REJECTION' }
    });
    assert.strictEqual(rejectedSubmit.submission?.estado, 'REJECTED');
    assert.strictEqual(rejectedSubmit.recordResult?.estado, 'REJECTED');

    // 7.2 Verificar que reintentar el mismo registro rechazado lanza 409 REJECTED_REQUIRES_SUBSANACION
    AeatFlowControlManager.reset();
    await assert.rejects(
      async () => {
        await executeAuthoritativeOutboxSubmission({
          fiscalRecordId: emittedRect.fiscalRecord.id,
          internalTestOptions: { mockScenario: 'ACCEPTANCE' }
        });
      },
      (err: any) =>
        err instanceof FiscalSubmissionHttpError &&
        err.statusCode === 409 &&
        err.code === 'REJECTED_REQUIRES_SUBSANACION'
    );

    // 7.3 Emitir nuevo registro de Subsanación de la rectificativa con subsanacion='S' y rechazoPrevio='X'
    const subsanacionDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedOrig.invoice,
      idOverride: 'inv-rect-subsanada-0401',
      numeroFacturaOverride: 'R-2026-0401',
      fecha: '2026-10-26',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Subsanación tras rechazo funcional previo en AEAT',
      subsanacion: 'S',
      rechazoPrevio: 'X',
      refExterna: 'SUBS-R-2026-0401'
    });

    const emittedSubsanacion = await emitFiscalInvoice({
      invoiceDraft: subsanacionDraft,
      fiscalConfig
    });
    const recSub = emittedSubsanacion.fiscalRecord;

    assert.strictEqual(recSub.factura.subsanacion, 'S');
    assert.strictEqual(recSub.factura.rechazoPrevio, 'X');
    assert.strictEqual(recSub.factura.refExterna, 'SUBS-R-2026-0401');

    const xmlSub = buildAeatVerifactuXml(recSub);
    assert.ok(xmlSub.includes('<sf:Subsanacion>S</sf:Subsanacion>'));
    assert.ok(xmlSub.includes('<sf:RechazoPrevio>X</sf:RechazoPrevio>'));
    assert.ok(xmlSub.includes('<sf:RefExterna>SUBS-R-2026-0401</sf:RefExterna>'));

    const xsdSub = validateXmlAgainstOfficialXsd(xmlSub);
    assert.strictEqual(xsdSub.valid, true, `Fallo XSD en rectificativa subsanada: ${xsdSub.errors.join('; ')}`);

    AeatFlowControlManager.reset();
    const acceptedWithErrorsRes = await executeAuthoritativeOutboxSubmission({
      fiscalRecordId: recSub.id,
      internalTestOptions: { mockScenario: 'ACCEPTANCE_WITH_WARNINGS' }
    });
    assert.strictEqual(acceptedWithErrorsRes.submission?.estado, 'ACCEPTED_WITH_ERRORS');
    assert.strictEqual(acceptedWithErrorsRes.recordResult?.estado, 'ACCEPTED_WITH_ERRORS');
  });

  // ---------------------------------------------------------------------------
  // 8. E2E CADENA MIXTA: F1 + RECTIFICATIVA R1 + REGISTRO DE ANULACIÓN EN BATCH
  // ---------------------------------------------------------------------------
  await runTest("8: E2E Cadena mixta (F1 + Factura Rectificativa R1 + RegistroAnulacion) -> Encadenamiento -> XML Batch -> XSD -> Respuesta AceptadaConErrores", async () => {
    await resetTestEnvironment();

    // 8.1 Emitir F1 #1 y F1 #2
    const f1A = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({ id: 'inv-mix-1', numeroFactura: 'FAC-2026-0501' }),
      fiscalConfig
    });
    const f1B = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({ id: 'inv-mix-2', numeroFactura: 'FAC-2026-0502' }),
      fiscalConfig
    });

    // 8.2 Emitir Rectificativa R1 sobre F1 #1
    const rectF1A = await emitFiscalInvoice({
      invoiceDraft: buildRectificativaFacturaFromUiState({
        facturaOriginal: f1A.invoice,
        numeroFacturaOverride: 'R-2026-0501',
        fecha: '2026-10-27',
        modo: 'anulacion_total',
        tipoRectificativa: 'por_diferencias',
        claveTipoFactura: 'R1',
        codigoMotivo: '01',
        motivoTexto: 'Abono total de FAC-2026-0501'
      }),
      fiscalConfig
    });

    // 8.3 Emitir RegistroAnulacion sobre F1 #2
    const anulF1B = await emitFiscalAnulacion({
      obligadoTributarioId: OBLIGADO_NIF,
      fiscalConfig,
      facturaAnulada: {
        numeroFactura: f1B.invoice.numeroFactura,
        fechaExpedicion: f1B.invoice.fecha,
        motivoAnulacion: 'Factura emitida por error a cliente equivocado'
      }
    });

    const chainRecords = [
      f1A.fiscalRecord,
      f1B.fiscalRecord,
      rectF1A.fiscalRecord,
      anulF1B.fiscalRecord
    ];

    const chainVerif = await verifyFiscalRecordChain(chainRecords);
    assert.strictEqual(chainVerif.valid, true, `Cadena mixta inválida: ${chainVerif.reason}`);

    // Validar el XML conjunto de los 4 registros (3 RegistroAlta + 1 RegistroAnulacion) contra XSD oficial
    const batchXml = buildAeatVerifactuXml(chainRecords);
    assert.ok(batchXml.includes('<sf:RegistroAlta>'));
    assert.ok(batchXml.includes('<sf:RegistroAnulacion>'));
    const batchXsd = validateXmlAgainstOfficialXsd(batchXml);
    assert.strictEqual(batchXsd.valid, true, `Fallo XSD en lote mixto: ${batchXsd.errors.join('; ')}`);

    // Enviar lote con overrides por línea (3 primeros Correcto, 4º AceptadoConErrores)
    AeatFlowControlManager.reset();
    const batchSubmit = await executeAuthoritativeOutboxSubmission({
      batchFromOutbox: true,
      obligadoTributarioId: OBLIGADO_NIF,
      internalTestOptions: {
        mockLineOverrides: {
          [f1A.fiscalRecord.id]: { estadoRegistro: 'Correcto' },
          [f1B.fiscalRecord.id]: { estadoRegistro: 'Correcto' },
          [rectF1A.fiscalRecord.id]: { estadoRegistro: 'Correcto' },
          [anulF1B.fiscalRecord.id]: {
            estadoRegistro: 'AceptadoConErrores',
            codigoError: '2005',
            descripcionError: 'Aviso no bloqueante en anulación'
          }
        }
      }
    });

    assert.strictEqual(batchSubmit.submission?.estado, 'ACCEPTED_WITH_ERRORS');
    assert.strictEqual(batchSubmit.cantidadRegistros, 4);
    assert.strictEqual(batchSubmit.resultadosIndividuales?.[2].numeroFactura, 'R-2026-0501');
    assert.strictEqual(batchSubmit.resultadosIndividuales?.[2].estado, 'ACCEPTED');
    assert.strictEqual(batchSubmit.resultadosIndividuales?.[3].numeroFactura, 'FAC-2026-0502');
    assert.strictEqual(batchSubmit.resultadosIndividuales?.[3].estado, 'ACCEPTED_WITH_ERRORS');

    // Verificar que el Outbox ya no tiene registros pendientes (todos en estado terminal aceptado)
    const remainingOutbox = await collectEligibleOutboxRecordsForObligado(OBLIGADO_NIF);
    assert.strictEqual(remainingOutbox.totalPendingCount, 0);
  });

  // ---------------------------------------------------------------------------
  // 9. P1: FECHAOPERACION REGLAMENTARIA EN RECTIFICATIVA SIMPLE Y MÚLTIPLE
  // ---------------------------------------------------------------------------
  await runTest("9: [P1] FechaOperacion reglamentaria en rectificativas (única factura con fecha operación distinta y múltiples facturas escogiendo la más reciente)", async () => {
    await resetTestEnvironment();

    // 9.A: Única factura con fecha expedición 20/10/2026 y fecha operación 05/10/2026
    const origSingle = createOriginalF1Invoice({
      id: 'inv-fop-single',
      numeroFactura: 'FAC-2026-0901',
      fecha: '2026-10-20',
      fechaOperacion: '2026-10-05'
    });
    const emittedSingleOrig = await emitFiscalInvoice({ invoiceDraft: origSingle, fiscalConfig });
    assert.strictEqual(emittedSingleOrig.fiscalRecord.factura.fechaOperacion, '2026-10-05');

    // Emitir rectificativa R1 en fecha 25/10/2026 -> FechaOperacion debe ser 05/10/2026
    const rectSingleDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: emittedSingleOrig.invoice,
      numeroFacturaOverride: 'R-FOP-2026-001',
      fecha: '2026-10-25',
      modo: 'anulacion_total',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Rectificación verificando FechaOperacion de factura original (05/10/2026)'
    });
    assert.strictEqual(
      rectSingleDraft.fechaOperacion,
      '2026-10-05',
      'La Factura rectificativa debe conservar la FechaOperacion de la operación original (2026-10-05)'
    );

    const emittedRectSingle = await emitFiscalInvoice({ invoiceDraft: rectSingleDraft, fiscalConfig });
    assert.strictEqual(emittedRectSingle.fiscalRecord.factura.fechaOperacion, '2026-10-05');

    const xmlSingle = buildAeatVerifactuXml(emittedRectSingle.fiscalRecord);
    assert.ok(
      xmlSingle.includes('<sf:FechaOperacion>05-10-2026</sf:FechaOperacion>'),
      'El XML de la rectificativa debe incluir <sf:FechaOperacion>05-10-2026</sf:FechaOperacion>'
    );
    const xsdSingle = validateXmlAgainstOfficialXsd(xmlSingle);
    assert.strictEqual(xsdSingle.valid, true, `XSD inválido en rectificativa con FechaOperacion: ${xsdSingle.errors.join('; ')}`);

    // 9.B: Múltiples facturas rectificadas:
    // Factura A -> fecha operación 01/10/2026
    // Factura B -> fecha operación 15/10/2026 (LA MÁS RECIENTE)
    // Factura C -> fecha operación 10/10/2026
    const facA = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({
        id: 'inv-fop-a',
        numeroFactura: 'FAC-2026-0910',
        fecha: '2026-10-03',
        fechaOperacion: '2026-10-01'
      }),
      fiscalConfig
    });
    const facB = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({
        id: 'inv-fop-b',
        numeroFactura: 'FAC-2026-0911',
        fecha: '2026-10-18',
        fechaOperacion: '2026-10-15'
      }),
      fiscalConfig
    });
    const facC = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({
        id: 'inv-fop-c',
        numeroFactura: 'FAC-2026-0912',
        fecha: '2026-10-12',
        fechaOperacion: '2026-10-10'
      }),
      fiscalConfig
    });

    const rectMultiDraft = buildRectificativaFacturaFromUiState({
      facturaOriginal: facA.invoice,
      facturasAdicionalesRectificadas: [facB.invoice, facC.invoice],
      numeroFacturaOverride: 'R-FOP-MULTI-001',
      fecha: '2026-10-28',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '03',
      motivoTexto: 'Rappel trimestral sobre 3 facturas con selección de FechaOperacion más reciente (15/10/2026)',
      lineasEditadas: [
        {
          ...facA.invoice.lineas[0],
          id: 'lin-fop-multi',
          cantidadEstuches: -1,
          precioUnitario: 150,
          subtotal: -150
        }
      ]
    });

    assert.strictEqual(
      rectMultiDraft.fechaOperacion,
      '2026-10-15',
      'En rectificativa múltiple, FechaOperacion debe ser la fecha más reciente de las facturas rectificadas (2026-10-15)'
    );

    const emittedRectMulti = await emitFiscalInvoice({ invoiceDraft: rectMultiDraft, fiscalConfig });
    assert.strictEqual(emittedRectMulti.fiscalRecord.factura.fechaOperacion, '2026-10-15');

    const xmlMulti = buildAeatVerifactuXml(emittedRectMulti.fiscalRecord);
    assert.ok(
      xmlMulti.includes('<sf:FechaOperacion>15-10-2026</sf:FechaOperacion>'),
      'El XML de la rectificativa múltiple debe incluir <sf:FechaOperacion>15-10-2026</sf:FechaOperacion>'
    );
    const xsdMulti = validateXmlAgainstOfficialXsd(xmlMulti);
    assert.strictEqual(xsdMulti.valid, true, `XSD inválido en rectificativa múltiple: ${xsdMulti.errors.join('; ')}`);
  });

  // ---------------------------------------------------------------------------
  // 10. P1: PROTECCIÓN ESTRICTA DE R5 FRENTE A FACTURAS NO SIMPLIFICADAS (F1)
  // ---------------------------------------------------------------------------
  await runTest("10: [P1] Prohibición simétrica y estricta de emitir R5 sobre factura ordinaria F1 (con destinatario o Art. 6.1.d) en UI, Transformador y Backend Custody", async () => {
    await resetTestEnvironment();

    const origF1 = createOriginalF1Invoice({
      id: 'inv-f1-no-r5',
      numeroFactura: 'FAC-2026-1001',
      tipoFactura: 'F1',
      clienteCif: 'B99887766',
      clienteNombre: 'Distribuciones Avícolas del Norte S.L.'
    });
    const emittedF1 = await emitFiscalInvoice({ invoiceDraft: origF1, fiscalConfig });

    // 10.1: UI Builder rechaza R5 sobre una factura F1 con destinatario
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: emittedF1.invoice,
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R5',
          codigoMotivo: '01',
          motivoTexto: 'Intento ilegal de emitir R5 sobre factura completa F1'
        }),
      /Violación normativa AEAT \(R5\)/,
      'buildRectificativaFacturaFromUiState debe rechazar R5 sobre una factura F1'
    );

    // 10.2: ModelTransformer rechaza R5 si la factura trae destinatario identificado (clienteCif)
    assert.throws(
      () =>
        createFiscalRecordFromInvoice(
          {
            ...emittedF1.invoice,
            id: 'inv-forged-r5-with-cif',
            numeroFactura: 'R-FORGED-001',
            esRectificativa: true,
            tipoFactura: 'R5',
            claveTipoFactura: 'R5',
            tipoRectificativa: 'por_diferencias',
            claveTipoRectificativa: 'I',
            facturaRectificadaNumero: emittedF1.invoice.numeroFactura,
            facturaRectificadaFecha: emittedF1.invoice.fecha
          },
          fiscalConfig,
          emittedF1.fiscalRecord
        ),
      /Violación normativa AEAT \(R5\)/,
      'createFiscalRecordFromInvoice debe rechazar R5 con NIF de destinatario'
    );

    // 10.3: EmissionService (Custodia Backend) rechaza R5 sobre FAC-2026-1001 aunque el payload omita el NIF del cliente
    await assert.rejects(
      async () => {
        await emitFiscalInvoice({
          invoiceDraft: {
            ...emittedF1.invoice,
            id: 'inv-forged-r5-no-cif',
            numeroFactura: 'R-FORGED-002',
            clienteCif: '',
            esRectificativa: true,
            tipoFactura: 'R5',
            claveTipoFactura: 'R5',
            tipoRectificativa: 'por_diferencias',
            claveTipoRectificativa: 'I',
            facturaRectificadaNumero: emittedF1.invoice.numeroFactura,
            facturaRectificadaFecha: emittedF1.invoice.fecha
          },
          fiscalConfig
        });
      },
      /RECHAZO_RECTIFICATIVA_R5_ORIGEN_NO_SIMPLIFICADA/,
      'emitFiscalInvoice debe verificar en custodia que la factura rectificada F1 no puede rectificarse con R5'
    );
  });

  // ---------------------------------------------------------------------------
  // 11. P1: NUMERACIÓN DE RECTIFICATIVAS BAJO AUTORIDAD BACKEND (SERIE R-YYYY-NNNN)
  // ---------------------------------------------------------------------------
  await runTest("11: [P1] Numeración de rectificativas bajo autoridad backend: previene colisiones multi-sesión cuando el cliente tiene estado local desactualizado", async () => {
    await resetTestEnvironment();

    const orig = await emitFiscalInvoice({
      invoiceDraft: createOriginalF1Invoice({
        id: 'inv-orig-num-auth',
        numeroFactura: 'FAC-2026-1100',
        fecha: '2026-10-10'
      }),
      fiscalConfig
    });

    // Sesión A emite la primera rectificativa sin override manual (existingInvoices vacío) -> Backend asigna R-2026-0001
    const draft1 = buildRectificativaFacturaFromUiState({
      facturaOriginal: orig.invoice,
      existingInvoices: [],
      fecha: '2026-10-20',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '01',
      motivoTexto: 'Primera rectificativa desde Sesión A',
      lineasEditadas: [
        {
          ...orig.invoice.lineas[0],
          id: 'lin-auth-1',
          cantidadEstuches: -1,
          precioUnitario: 100,
          subtotal: -100
        }
      ]
    });
    assert.strictEqual(draft1.numeracionAutoritativaBackend, true);

    const emitted1 = await emitFiscalInvoice({ invoiceDraft: draft1, fiscalConfig });
    assert.strictEqual(emitted1.fiscalRecord.factura.numeroFactura, 'R-2026-0001');
    assert.strictEqual(emitted1.invoice.numeroFactura, 'R-2026-0001');

    // Sesión B tiene estado local obsoleto (existingInvoices: [], por lo que su borrador sugiere de nuevo 'R-2026-0001')
    const draft2StaleClient = buildRectificativaFacturaFromUiState({
      facturaOriginal: orig.invoice,
      existingInvoices: [], // Cliente desincronizado que desconoce R-2026-0001
      fecha: '2026-10-21',
      modo: 'rectificacion_parcial',
      tipoRectificativa: 'por_diferencias',
      claveTipoFactura: 'R1',
      codigoMotivo: '02',
      motivoTexto: 'Segunda rectificativa desde Sesión B con caché local vacía',
      lineasEditadas: [
        {
          ...orig.invoice.lineas[0],
          id: 'lin-auth-2',
          cantidadEstuches: -2,
          precioUnitario: 100,
          subtotal: -200
        }
      ]
    });
    // El borrador local calculó R-2026-0001 porque existingInvoices estaba vacío
    assert.strictEqual(draft2StaleClient.numeroFactura, 'R-2026-0001');

    // Al pasar por emitFiscalInvoice, la autoridad backend detecta R-2026-0001 en custodia y asigna R-2026-0002 bajo lock
    const emitted2 = await emitFiscalInvoice({ invoiceDraft: draft2StaleClient, fiscalConfig });
    assert.strictEqual(
      emitted2.fiscalRecord.factura.numeroFactura,
      'R-2026-0002',
      'El backend debe asignar autoritativamente R-2026-0002 evitando la colisión con R-2026-0001'
    );
    assert.strictEqual(emitted2.invoice.numeroFactura, 'R-2026-0002');
    assert.ok(
      emitted2.fiscalRecord.qr?.url.includes('numserie=R-2026-0002'),
      'El QR sellado debe contener el número autoritativo asignado por el backend (R-2026-0002)'
    );

    const hashVerif2 = await verifyFiscalRecordHash(emitted2.fiscalRecord);
    assert.strictEqual(hashVerif2.valid, true, 'La huella SHA-256 debe haberse calculado con el número autoritativo R-2026-0002');

    // Consultar el siguiente número autoritativo desde BackendFiscalCustody -> R-2026-0003
    const nextAuthNum = await BackendFiscalCustody.getNextRectificativaNumeroAsync(OBLIGADO_NIF, '2026-10-22');
    assert.strictEqual(nextAuthNum, 'R-2026-0003');
  });

  // ---------------------------------------------------------------------------
  // 12. P2: INTEGRIDAD DE REFERENCIAS RECTIFICADAS Y COHERENCIA CODIGOMOTIVO <-> R1..R4
  // ---------------------------------------------------------------------------
  await runTest("12: [P2] Rechazo fail-closed de FacturasRectificadas duplicadas o de otro emisor, y coherencia estricta entre codigoMotivo y R1/R2/R3/R4", async () => {
    await resetTestEnvironment();

    const orig = createOriginalF1Invoice({
      id: 'inv-orig-p2',
      numeroFactura: 'FAC-2026-1201',
      fecha: '2026-10-10'
    });

    // 12.1: Factura duplicada en facturasAdicionalesRectificadas -> Rechazo fail-closed
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: orig,
          facturasAdicionalesRectificadas: [orig], // Duplicada con facturaOriginal
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R1',
          codigoMotivo: '01',
          motivoTexto: 'Intento con factura rectificada duplicada'
        }),
      /Factura rectificada duplicada/,
      'Debe rechazar referencias duplicadas dentro de FacturasRectificadas'
    );

    // 12.2: Factura adicional de otro NIF emisor distinto al obligado tributario -> Rechazo fail-closed
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: orig,
          facturasAdicionalesRectificadas: [
            {
              numeroFactura: 'FAC-OTRO-001',
              fecha: '2026-10-11',
              idEmisorFactura: 'B99999999' // Distinto de B12345678
            }
          ],
          nifEmisor: OBLIGADO_NIF,
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R1',
          codigoMotivo: '01',
          motivoTexto: 'Intento con factura de otro obligado tributario'
        }),
      /Violación de obligado tributario en FacturasRectificadas/,
      'Debe rechazar facturas rectificadas de otro NIF emisor'
    );

    // 12.3: Incoherencia entre codigoMotivo y claveTipoFactura:
    // - codigoMotivo '04' (Concurso Art. 80.3 -> R2) con R1 -> Rechazo
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: orig,
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R1',
          codigoMotivo: '04',
          motivoTexto: 'Motivo de concurso 04 con clave R1 incoherente'
        }),
      /Incoherencia normativa entre TipoFactura/,
      'Debe rechazar motivo 04 (R2) cuando se selecciona clave R1'
    );

    // - codigoMotivo '06' (Incobrables Art. 80.4 -> R3) con R2 -> Rechazo
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: orig,
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R2',
          codigoMotivo: '06',
          motivoTexto: 'Motivo de incobrables 06 con clave R2 incoherente'
        }),
      /Incoherencia normativa entre TipoFactura/,
      'Debe rechazar motivo 06 (R3) cuando se selecciona clave R2'
    );

    // - codigoMotivo '01' (Art. 80.1/2 -> R1) con R4 -> Rechazo
    assert.throws(
      () =>
        buildRectificativaFacturaFromUiState({
          facturaOriginal: orig,
          fecha: '2026-10-26',
          modo: 'anulacion_total',
          tipoRectificativa: 'por_diferencias',
          claveTipoFactura: 'R4',
          codigoMotivo: '01',
          motivoTexto: 'Motivo 01 con clave R4 incoherente'
        }),
      /Incoherencia normativa entre TipoFactura/,
      'Debe rechazar motivo 01 (R1) cuando se selecciona clave R4'
    );
  });

  // ---------------------------------------------------------------------------
  // 13. P2: TRANSPORTE SOAP REAL (transportMode='real') + VALIDACIÓN XSD DE PETICIÓN Y RESPUESTA
  // ---------------------------------------------------------------------------
  await runTest("13: [P2] E2E Transporte SOAP real (transportMode: 'real') con verificación de sobre SOAP 1.1, validación XSD de Suministro y de RespuestaSuministro.xsd", async () => {
    await resetTestEnvironment();

    // Configurar certificado mTLS de pruebas en memoria para habilitar el transporte SOAP real
    process.env.AEAT_CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END CERTIFICATE-----';
    process.env.AEAT_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCtest\n-----END PRIVATE KEY-----';

    try {
      const orig = await emitFiscalInvoice({
        invoiceDraft: createOriginalF1Invoice({
          id: 'inv-soap-real-orig',
          numeroFactura: 'FAC-2026-1301',
          fecha: '2026-10-10',
          fechaOperacion: '2026-10-08'
        }),
        fiscalConfig
      });

      const rectDraft = buildRectificativaFacturaFromUiState({
        facturaOriginal: orig.invoice,
        fecha: '2026-10-27',
        modo: 'anulacion_total',
        tipoRectificativa: 'por_diferencias',
        claveTipoFactura: 'R1',
        codigoMotivo: '01',
        motivoTexto: 'Rectificativa remitida por transporte SOAP 1.1 real'
      });
      const emittedRect = await emitFiscalInvoice({ invoiceDraft: rectDraft, fiscalConfig });

      let capturedSoapUrl = '';
      let capturedSoapHeaders: Record<string, string> = {};
      let capturedSoapEnvelopeRequest = '';
      let capturedSoapResponseBody = '';

      const realSoapServerInterceptor: typeof fetch = async (input: any, init?: any) => {
        capturedSoapUrl = String(input);
        capturedSoapHeaders = (init?.headers || {}) as Record<string, string>;
        capturedSoapEnvelopeRequest = String(init?.body || '');

        capturedSoapResponseBody = MockAeatTransport.generateMockResponseBody('ACCEPTANCE', {
          nifEmisor: OBLIGADO_NIF,
          tiempoEsperaEnvio: 60,
          records: [
            {
              nifEmisor: OBLIGADO_NIF,
              numSerie: orig.fiscalRecord.factura.numeroFactura,
              fechaExpedicion: orig.fiscalRecord.factura.fechaExpedicion,
              operacion: 'Alta',
              estadoRegistro: 'Correcto'
            },
            {
              nifEmisor: OBLIGADO_NIF,
              numSerie: emittedRect.fiscalRecord.factura.numeroFactura,
              fechaExpedicion: emittedRect.fiscalRecord.factura.fechaExpedicion,
              operacion: 'Alta',
              estadoRegistro: 'Correcto'
            }
          ]
        });

        return new Response(capturedSoapResponseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/xml; charset=utf-8' }
        });
      };

      AeatFlowControlManager.reset();
      const realSubmitRes = await executeAuthoritativeOutboxSubmission({
        batchFromOutbox: true,
        obligadoTributarioId: OBLIGADO_NIF,
        internalTestOptions: {
          transportMode: 'real',
          customFetch: realSoapServerInterceptor
        }
      });

      // 1. Verificar estructura SOAP 1.1 de salida y extraer <sfLR:RegFactuSistemaFacturacion>
      assert.ok(
        capturedSoapEnvelopeRequest.includes('<soapenv:Envelope') &&
          capturedSoapEnvelopeRequest.includes('<soapenv:Body>'),
        'El transporte real debe envolver el XML fiscal en un sobre SOAP 1.1 <soapenv:Envelope>'
      );
      const bodyMatch = capturedSoapEnvelopeRequest.match(
        /<sfLR:RegFactuSistemaFacturacion[\s\S]*<\/sfLR:RegFactuSistemaFacturacion>/
      );
      assert.ok(bodyMatch, 'El cuerpo SOAP debe contener <sfLR:RegFactuSistemaFacturacion>');

      // 2. Validar el payload XML extraído del sobre SOAP contra los XSD oficiales de Suministro AEAT
      const reqXsdReport = validateXmlAgainstOfficialXsd(bodyMatch[0]);
      assert.strictEqual(
        reqXsdReport.valid,
        true,
        `El XML dentro del sobre SOAP real no superó SuministroLR.xsd: ${reqXsdReport.errors.join('; ')}`
      );
      assert.ok(
        bodyMatch[0].includes('<sf:FechaOperacion>08-10-2026</sf:FechaOperacion>'),
        'El sobre SOAP real debe transportar <sf:FechaOperacion>08-10-2026</sf:FechaOperacion>'
      );

      // 3. Validar la respuesta SOAP 1.1 oficial AEAT contra RespuestaSuministro.xsd
      const respBodyMatch = capturedSoapResponseBody.match(
        /<sfR:RespuestaRegFactuSistemaFacturacion[\s\S]*<\/sfR:RespuestaRegFactuSistemaFacturacion>/
      );
      assert.ok(respBodyMatch, 'La respuesta SOAP debe contener <sfR:RespuestaRegFactuSistemaFacturacion>');
      const respXsdReport = validateXmlAgainstOfficialXsd(
        respBodyMatch[0],
        'docs/fiscal/xsd/RespuestaSuministro.xsd'
      );
      assert.strictEqual(
        respXsdReport.valid,
        true,
        `La respuesta SOAP AEAT no superó RespuestaSuministro.xsd: ${respXsdReport.errors.join('; ')}`
      );

      assert.ok(
        capturedSoapUrl.includes('aeat.es') || capturedSoapUrl.includes('agenciatributaria.gob.es'),
        `Debe invocar el endpoint oficial AEAT (recibido: ${capturedSoapUrl})`
      );
      assert.ok(
        (capturedSoapHeaders['Content-Type'] || '').includes('text/xml'),
        'Debe enviar cabecera SOAP Content-Type: text/xml'
      );
      assert.strictEqual(realSubmitRes.submission?.estado, 'ACCEPTED');
      assert.strictEqual(realSubmitRes.cantidadRegistros, 2);
      assert.strictEqual(realSubmitRes.submission?.csv, 'CSV-AEAT-1234567890ABCDEF');
      assert.strictEqual(realSubmitRes.resultadosIndividuales?.length, 2);
      assert.strictEqual(realSubmitRes.resultadosIndividuales?.[1].numeroFactura, 'R-2026-0001');
      assert.strictEqual(realSubmitRes.resultadosIndividuales?.[1].estado, 'ACCEPTED');
    } finally {
      delete process.env.AEAT_CERT_PEM;
      delete process.env.AEAT_KEY_PEM;
    }
  });

  await resetTestEnvironment();

  console.log('========================================================================');
  console.log(`  RESULTADO SUITE E2E RECTIFICATIVAS Y ANULACIONES: ${passed}/${total} TESTS OK`);
  console.log('========================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
