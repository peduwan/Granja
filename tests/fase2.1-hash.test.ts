import assert from 'node:assert';
import {
  Factura,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration
} from '../src/types';
import {
  formatImporteFiscal,
  formatFechaExpedicionFiscal,
  formatFechaHoraHusoGenRegistro,
  buildCanonicalAltaString,
  buildCanonicalAnulacionString,
  calculateSha256,
  calculateAltaHash,
  calculateAnulacionHash,
  verifyFiscalRecordHash,
  verifyFiscalRecordChain,
  validatePreviousRecordRequirement
} from '../src/fiscal/hashService';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { emitFiscalInvoice, resetFiscalQueue } from '../src/fiscal/emissionService';

console.log('================================================================');
console.log('  SUITE DE TESTS - FASE 2.1: HASH Y ENCADENAMIENTO OFICIAL SIF  ');
console.log('  (Orden HAC/1177/2024 / Real Decreto 1007/2023 / Veri*Factu)   ');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error(`         Error: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  // -----------------------------------------------------------------------------
  // Test 1: Vector de prueba conocido e independiente (Alta y Anulación)
  // -----------------------------------------------------------------------------
  await runTest('Test 1 — Vector de prueba conocido independiente (Cotejo externo SHA-256)', async () => {
    // Vector Alta (Primer registro):
    // Entrada:
    // IDEmisorFactura=B12345678
    // NumSerieFactura=FAC-2026-0001
    // FechaExpedicionFactura=24-09-2026
    // TipoFactura=F1
    // CuotaTotal=4.00
    // ImporteTotal=104.00
    // Huella=
    // FechaHoraHusoGenRegistro=2026-09-24T12:00:00+02:00
    const canonicalExpectedAlta =
      'IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026-0001&FechaExpedicionFactura=24-09-2026&TipoFactura=F1&CuotaTotal=4.00&ImporteTotal=104.00&Huella=&FechaHoraHusoGenRegistro=2026-09-24T12:00:00+02:00';

    // Hash independiente precalculado externamente (FIPS 180-4 SHA-256):
    const expectedHashAlta = '7D58E76F2B2CE4EB8802523F4E96AB0F0C8A843ED14E9DC2E67C1B6E0FD40314';

    const resAlta = await calculateAltaHash({
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-2026-0001',
      fechaExpedicion: '2026-09-24', // Acepta YYYY-MM-DD y normaliza a 24-09-2026
      tipoFactura: 'F1',
      cuotaTotal: 4,
      importeTotal: 104,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    });

    assert.strictEqual(resAlta.canonicalString, canonicalExpectedAlta, 'La cadena canónica de alta debe coincidir exactamente');
    assert.strictEqual(resAlta.hash, expectedHashAlta, 'El hash SHA-256 de alta debe coincidir con el vector externo');

    // Vector Anulación (Registro encadenado al anterior):
    const canonicalExpectedAnulacion =
      `IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026-0001&FechaExpedicionFactura=24-09-2026&Huella=${expectedHashAlta}&FechaHoraHusoGenRegistro=2026-09-24T12:05:00+02:00`;
    const expectedHashAnulacion = '6692FEAE8581792C70710415EF2F55A6F672EC88914CC1BB3A2BD713FC0F8FFF';

    const resAnulacion = await calculateAnulacionHash({
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-2026-0001',
      fechaExpedicion: '24-09-2026',
      huellaAnterior: expectedHashAlta,
      fechaHoraHusoGenRegistro: '2026-09-24T12:05:00+02:00'
    });

    assert.strictEqual(resAnulacion.canonicalString, canonicalExpectedAnulacion, 'La cadena canónica de anulación debe coincidir exactamente');
    assert.strictEqual(resAnulacion.hash, expectedHashAnulacion, 'El hash SHA-256 de anulación debe coincidir con el vector externo');
  });

  // -----------------------------------------------------------------------------
  // Test 2: Determinismo estricto
  // -----------------------------------------------------------------------------
  await runTest('Test 2 — Determinismo criptográfico independiente del entorno o locale', async () => {
    const input = {
      nifEmisor: 'A99887766',
      numSerieFactura: 'SERIE-B/2026/99',
      fechaExpedicion: '2026-10-15',
      tipoFactura: 'F1',
      cuotaTotal: '21.00',
      importeTotal: '121.00',
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-10-15T10:30:00+02:00'
    };

    const hash1 = await calculateAltaHash(input);
    const hash2 = await calculateAltaHash(input);
    const hash3 = await calculateAltaHash({ ...input });

    assert.strictEqual(hash1.hash, hash2.hash);
    assert.strictEqual(hash2.hash, hash3.hash);
    assert.strictEqual(hash1.canonicalString, hash2.canonicalString);
  });

  // -----------------------------------------------------------------------------
  // Test 3: Cambio de NIF altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 3 — Modificar el NIF emisor altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4,
      importeTotal: 104,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, nifEmisor: 'B87654321' });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 4: Cambio de número / serie altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 4 — Modificar el número y serie altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4,
      importeTotal: 104,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, numSerieFactura: 'FAC-02' });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 5: Cambio de fecha de expedición altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 5 — Modificar la fecha de expedición altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4,
      importeTotal: 104,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, fechaExpedicion: '2026-09-25' });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 6: Cambio de tipo de factura altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 6 — Modificar el tipo de factura (F1 -> F2) altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4,
      importeTotal: 104,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, tipoFactura: 'F2' });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 7: Cambio de cuota total altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 7 — Modificar la cuota total altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4.00,
      importeTotal: 104.00,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, cuotaTotal: 4.50 });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 8: Cambio de importe total altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 8 — Modificar el importe total altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4.00,
      importeTotal: 104.00,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({ ...base, importeTotal: 105.00 });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 9: Cambio de huella anterior altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 9 — Modificar la huella anterior altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-02',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4.00,
      importeTotal: 104.00,
      huellaAnterior: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fechaHoraHusoGenRegistro: '2026-09-24T12:05:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({
      ...base,
      huellaAnterior: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 10: Cambio de FechaHoraHusoGenRegistro altera la huella
  // -----------------------------------------------------------------------------
  await runTest('Test 10 — Modificar FechaHoraHusoGenRegistro altera la huella', async () => {
    const base = {
      nifEmisor: 'B12345678',
      numSerieFactura: 'FAC-01',
      fechaExpedicion: '2026-09-24',
      tipoFactura: 'F1',
      cuotaTotal: 4.00,
      importeTotal: 104.00,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:00+02:00'
    };

    const res1 = await calculateAltaHash(base);
    const res2 = await calculateAltaHash({
      ...base,
      fechaHoraHusoGenRegistro: '2026-09-24T12:00:01+02:00'
    });

    assert.notStrictEqual(res1.hash, res2.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 11: Primer registro de alta no inventa huella anterior ficticia
  // -----------------------------------------------------------------------------
  await runTest('Test 11 — El primer registro de la cadena no inventa huella anterior ficticia', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({
      nif: 'B12345678',
      nombreRazon: 'Granja Test S.L.'
    });

    const draft: Factura = {
      id: 'fac-first-01',
      numeroFactura: 'FAC-2026-0001',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'Cliente 1',
      clienteCif: 'B11111111',
      clienteDireccion: 'Madrid',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const res = await emitFiscalInvoice({
      invoiceDraft: draft,
      fiscalConfig: config,
      previousRecordRef: null,
      persistRecordFn: async () => true
    });

    assert.strictEqual(res.fiscalRecord.encadenamiento.primerRegistro, true);
    assert.strictEqual(res.fiscalRecord.encadenamiento.registroAnterior, undefined);
    assert.ok(
      res.fiscalRecord.huella.cadenaTextoCanonico.includes('&Huella=&'),
      'La cadena canónica oficial del primer registro debe tener el campo Huella vacío (&Huella=&)'
    );
  });

  // -----------------------------------------------------------------------------
  // Test 12: Segundo registro encadena con hash del primero
  // -----------------------------------------------------------------------------
  await runTest('Test 12 — Segundo registro encadena estrictamente con hash(A)', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({
      nif: 'B12345678',
      nombreRazon: 'Granja Test S.L.'
    });

    const draftA: Factura = {
      id: 'fac-chain-A',
      numeroFactura: 'FAC-2026-0001',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'Cliente 1',
      clienteCif: 'B11111111',
      clienteDireccion: 'Madrid',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const draftB: Factura = {
      ...draftA,
      id: 'fac-chain-B',
      numeroFactura: 'FAC-2026-0002'
    };

    const resA = await emitFiscalInvoice({
      invoiceDraft: draftA,
      fiscalConfig: config,
      previousRecordRef: null,
      persistRecordFn: async () => true
    });

    const resB = await emitFiscalInvoice({
      invoiceDraft: draftB,
      fiscalConfig: config,
      previousRecordRef: resA.fiscalRecordRef,
      persistRecordFn: async () => true
    });

    assert.strictEqual(resB.fiscalRecord.encadenamiento.primerRegistro, false);
    assert.strictEqual(resB.fiscalRecord.encadenamiento.registroAnterior?.huella, resA.fiscalRecord.huella.hash);
    assert.ok(resB.fiscalRecord.huella.cadenaTextoCanonico.includes(`&Huella=${resA.fiscalRecord.huella.hash}&`));
  });

  // -----------------------------------------------------------------------------
  // Test 13: Cadena completa de tres registros (A -> B -> C)
  // -----------------------------------------------------------------------------
  await runTest('Test 13 — Cadena secuencial de tres registros (A -> B -> C) validada globalmente', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({
      nif: 'B12345678',
      nombreRazon: 'Granja Test S.L.'
    });

    const baseDraft: Factura = {
      id: 'f-1',
      numeroFactura: 'FAC-01',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'Cliente 1',
      clienteCif: 'B11111111',
      clienteDireccion: 'Madrid',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 50, porcentajeIva: 4, cuotaIva: 2, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 52 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const rA = await emitFiscalInvoice({ invoiceDraft: baseDraft, fiscalConfig: config, previousRecordRef: null, persistRecordFn: async () => true });
    const rB = await emitFiscalInvoice({ invoiceDraft: { ...baseDraft, id: 'f-2', numeroFactura: 'FAC-02' }, fiscalConfig: config, persistRecordFn: async () => true });
    const rC = await emitFiscalInvoice({ invoiceDraft: { ...baseDraft, id: 'f-3', numeroFactura: 'FAC-03' }, fiscalConfig: config, persistRecordFn: async () => true });

    const chainResult = await verifyFiscalRecordChain([rA.fiscalRecord, rB.fiscalRecord, rC.fiscalRecord]);

    assert.strictEqual(chainResult.valid, true, `La cadena A->B->C debe ser válida: ${chainResult.reason}`);
    assert.strictEqual(chainResult.totalRecords, 3);
  });

  // -----------------------------------------------------------------------------
  // Test 14: Cadenas independientes por obligadoTributarioId
  // -----------------------------------------------------------------------------
  await runTest('Test 14 — Cadenas criptográficas independientes entre Empresa A y Empresa B', async () => {
    resetFiscalQueue();
    const configA = createDefaultFiscalConfiguration({ nif: 'A11111111', nombreRazon: 'Empresa A S.A.' });
    const configB = createDefaultFiscalConfiguration({ nif: 'B22222222', nombreRazon: 'Empresa B S.L.' });

    const draftA1: Factura = {
      id: 'f-a1',
      numeroFactura: 'A-01',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'C1',
      clienteCif: 'B99999999',
      clienteDireccion: 'Toledo',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const resA1 = await emitFiscalInvoice({ invoiceDraft: draftA1, fiscalConfig: configA, persistRecordFn: async () => true });
    const resB1 = await emitFiscalInvoice({ invoiceDraft: { ...draftA1, id: 'f-b1', numeroFactura: 'B-01' }, fiscalConfig: configB, persistRecordFn: async () => true });
    const resA2 = await emitFiscalInvoice({ invoiceDraft: { ...draftA1, id: 'f-a2', numeroFactura: 'A-02' }, fiscalConfig: configA, persistRecordFn: async () => true });

    // A2 encadena con A1
    assert.strictEqual(resA2.fiscalRecord.encadenamiento.registroAnterior?.huella, resA1.fiscalRecord.huella.hash);
    // B1 no encadena con A1
    assert.strictEqual(resB1.fiscalRecord.encadenamiento.primerRegistro, true);
    assert.strictEqual(resB1.fiscalRecord.encadenamiento.registroAnterior, undefined);
  });

  // -----------------------------------------------------------------------------
  // Test 15: Concurrencia de 3 emisiones simultáneas (X -> A -> B -> C)
  // -----------------------------------------------------------------------------
  await runTest('Test 15 — Concurrencia: Tres emisiones simultáneas se serializan en una única cadena sin bifurcaciones', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({ nif: 'B12345678', nombreRazon: 'Granja Concurrente S.L.' });

    const d1: Factura = {
      id: 'f-conc-1',
      numeroFactura: 'CONC-01',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'C1',
      clienteCif: 'B99999999',
      clienteDireccion: 'Toledo',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 10, porcentajeIva: 4, cuotaIva: 0.4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 10.4 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const d2: Factura = { ...d1, id: 'f-conc-2', numeroFactura: 'CONC-02' };
    const d3: Factura = { ...d1, id: 'f-conc-3', numeroFactura: 'CONC-03' };

    // Ejecutar 3 emisiones concurrentes
    const [res1, res2, res3] = await Promise.all([
      emitFiscalInvoice({ invoiceDraft: d1, fiscalConfig: config, persistRecordFn: async () => true }),
      emitFiscalInvoice({ invoiceDraft: d2, fiscalConfig: config, persistRecordFn: async () => true }),
      emitFiscalInvoice({ invoiceDraft: d3, fiscalConfig: config, persistRecordFn: async () => true })
    ]);

    const records = [res1.fiscalRecord, res2.fiscalRecord, res3.fiscalRecord];
    // Ordenar por orden cronológico de generación
    records.sort((a, b) => new Date(a.fechaHoraHusoGenRegistro).getTime() - new Date(b.fechaHoraHusoGenRegistro).getTime());

    // Verificar que la cadena completa es lineal y válida
    const chainCheck = await verifyFiscalRecordChain(records);
    assert.strictEqual(chainCheck.valid, true, `La cadena concurrente debe ser lineal y continua: ${chainCheck.reason}`);
    assert.strictEqual(records[0].encadenamiento.primerRegistro, true);
    assert.strictEqual(records[1].encadenamiento.registroAnterior?.huella, records[0].huella.hash);
    assert.strictEqual(records[2].encadenamiento.registroAnterior?.huella, records[1].huella.hash);
  });

  // -----------------------------------------------------------------------------
  // Test 16: Detección de manipulación de datos (importeTotal)
  // -----------------------------------------------------------------------------
  await runTest('Test 16 — Detección inmediata de manipulación de importeTotal vía verifyFiscalRecordHash', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({ nif: 'B12345678', nombreRazon: 'Granja Test S.L.' });

    const draft: Factura = {
      id: 'f-tamper-1',
      numeroFactura: 'FAC-TAMPER-01',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'C1',
      clienteCif: 'B99999999',
      clienteDireccion: 'Toledo',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const res = await emitFiscalInvoice({ invoiceDraft: draft, fiscalConfig: config, persistRecordFn: async () => true });

    // Verificación inicial válida
    const checkOriginal = await verifyFiscalRecordHash(res.fiscalRecord);
    assert.strictEqual(checkOriginal.valid, true);

    // Simular manipulación no autorizada en memoria
    const tamperedRecord: FiscalRecord = {
      ...res.fiscalRecord,
      desgloseTributario: {
        ...res.fiscalRecord.desgloseTributario,
        importeTotal: 999.00 // Manipulación fraudulenta
      }
    };

    const checkTampered = await verifyFiscalRecordHash(tamperedRecord);
    assert.strictEqual(checkTampered.valid, false, 'La verificación debe fallar ante un cambio en importeTotal');
    assert.ok(checkTampered.reason?.includes('Discrepancia'));
  });

  // -----------------------------------------------------------------------------
  // Test 17: Detección de manipulación de la huella anterior en la cadena
  // -----------------------------------------------------------------------------
  await runTest('Test 17 — Detección de manipulación en encadenamiento.registroAnterior.huella', async () => {
    resetFiscalQueue();
    const config = createDefaultFiscalConfiguration({ nif: 'B12345678', nombreRazon: 'Granja Test S.L.' });

    const draft1: Factura = {
      id: 'f-chain-corrupt-1',
      numeroFactura: 'FAC-01',
      fecha: '2026-09-24',
      clienteId: 'c1',
      clienteNombre: 'C1',
      clienteCif: 'B99999999',
      clienteDireccion: 'Toledo',
      clienteRecargoEquivalencia: false,
      albaranesAsociados: [],
      lineas: [],
      totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
      estadoPago: 'pendiente',
      formaPago: 'transferencia',
      esVentaDirecta: true,
      creadoEn: '2026-09-24T12:00:00Z',
      tipoFactura: 'F1',
      esRectificativa: false
    };

    const res1 = await emitFiscalInvoice({ invoiceDraft: draft1, fiscalConfig: config, persistRecordFn: async () => true });
    const res2 = await emitFiscalInvoice({ invoiceDraft: { ...draft1, id: 'f-chain-corrupt-2', numeroFactura: 'FAC-02' }, fiscalConfig: config, persistRecordFn: async () => true });

    // Modificar artificialmente la huella del registro anterior en res2
    const corruptedRecord2: FiscalRecord = {
      ...res2.fiscalRecord,
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          ...res2.fiscalRecord.encadenamiento.registroAnterior!,
          huella: 'DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF'
        }
      }
    };

    const chainCheck = await verifyFiscalRecordChain([res1.fiscalRecord, corruptedRecord2]);
    assert.strictEqual(chainCheck.valid, false, 'La cadena debe ser invalidada si la huella anterior no coincide');
    assert.ok(chainCheck.reason?.includes('Ruptura en registro #1'));
  });

  // -----------------------------------------------------------------------------
  // Test 18: Formato estricto de Timestamps con huso horario (+01:00 / +02:00)
  // -----------------------------------------------------------------------------
  await runTest('Test 18 — Normalización y soporte de husos horarios ISO 8601 (+01:00 / +02:00)', () => {
    const tsWinter = formatFechaHoraHusoGenRegistro('2026-01-15T10:00:00+01:00');
    assert.strictEqual(tsWinter, '2026-01-15T10:00:00+01:00');

    const tsSummer = formatFechaHoraHusoGenRegistro('2026-07-15T10:00:00+02:00');
    assert.strictEqual(tsSummer, '2026-07-15T10:00:00+02:00');

    // Validación de skew temporal (Orden HAC/1177/2024: registro anterior no puede estar en el futuro por >1 min)
    const nowIso = '2026-09-24T12:00:00+02:00';
    const futureInvalidPrev: FiscalRecordRef = {
      id: 'f-fut',
      obligadoTributarioId: 'B12345678',
      invoiceId: 'inv-1',
      numeroFactura: 'F-1',
      fechaExpedicion: '24-09-2026',
      huellaHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      creadoEn: '2026-09-24T12:05:00+02:00' // 5 minutos en el futuro
    };

    assert.throws(() => {
      validatePreviousRecordRequirement(nowIso, 'B12345678', futureInvalidPrev);
    }, /Condición temporal vulnerada/);
  });

  // -----------------------------------------------------------------------------
  // Test 19: Formateo canónico exacto de importes
  // -----------------------------------------------------------------------------
  await runTest('Test 19 — Normalización oficial de importes numéricos (2 decimales con punto)', () => {
    assert.strictEqual(formatImporteFiscal(0), '0.00');
    assert.strictEqual(formatImporteFiscal(1), '1.00');
    assert.strictEqual(formatImporteFiscal(1.5), '1.50');
    assert.strictEqual(formatImporteFiscal('1.50'), '1.50');
    assert.strictEqual(formatImporteFiscal(10.00), '10.00');
    assert.strictEqual(formatImporteFiscal(91.52), '91.52');
    assert.strictEqual(formatImporteFiscal(1000.00), '1000.00');
    assert.strictEqual(formatImporteFiscal('1000'), '1000.00');
    assert.strictEqual(formatImporteFiscal(-12.4), '-12.40');
  });
}

main()
  .then(() => {
    console.log('\n================================================================');
    console.log(`  RESUMEN: ${passedTests}/${totalTests} TESTS DE HASH COMPLETADOS CON ÉXITO!`);
    console.log('================================================================\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSuite de tests fallida:', err);
    process.exit(1);
  });
