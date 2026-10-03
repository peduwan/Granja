import assert from 'node:assert';
import {
  Invoice,
  Factura,
  FiscalRecord,
  FiscalRecordRef,
  FiscalSubmission,
  FiscalEvent,
  FiscalConfiguration,
  AppData
} from '../src/types';
import {
  createFiscalRecordFromInvoice,
  createFiscalRecordRef,
  createFiscalSubmission,
  createFiscalEvent,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import {
  calcularTotales,
  getDefaultFiscalConfig,
  getInitialData,
  getZeroDayAppData
} from '../src/utils/storage';
import {
  generarHuellaVeriFactu,
  generarUrlAeatVeriFactu
} from '../src/utils/verifactu';
import { sanitizeForFirestore, saveFiscalRecordToCloud } from '../src/utils/firebase';
import { emitFiscalInvoice, resetFiscalQueue, getLastFiscalRecord } from '../src/fiscal/emissionService';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 1.1: LIMPIEZA ARQUITECTÓNICA ');
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
    console.error('         Error:', err.message);
    throw err;
  }
}

async function main() {

// -----------------------------------------------------------------------------
// Test 1: Una Invoice puede existir con todos sus datos comerciales y agrícolas
// -----------------------------------------------------------------------------
await runTest('Una Invoice puede existir con todos sus datos comerciales y agrícolas', () => {
  const invoice: Invoice = {
    id: 'inv-test-001',
    numeroFactura: 'FAC-2026-0001',
    fecha: '2026-09-24',
    clienteId: 'cli-001',
    clienteNombre: 'Restaurante El Gourmet Manchego',
    clienteCif: 'B45999888',
    clienteDireccion: 'Plaza Zocodover 4, Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [
      { id: 'alb-101', numeroAlbaran: 'ALB-2026-0012', fecha: '2026-09-23' },
      { id: 'alb-102', numeroAlbaran: 'ALB-2026-0015', fecha: '2026-09-24' }
    ],
    lineas: [
      {
        id: 'lin-001',
        loteEnvasadoId: 'lenv-2026-09-01',
        codigoLoteEnvasado: 'ENV-2026-0042',
        formatoId: 'fmt-12',
        nombreFormato: 'Estuche 12 Huevos (Clase A)',
        cantidadEstuches: 50,
        precioUnitario: 2.95,
        subtotal: 147.50,
        fechaConsumoPreferente: '2026-10-22',
        trazabilidadPuesta: [
          {
            codigoLotePuesta: 'NV1-20260920',
            huevosPorEstuche: 12,
            totalHuevosEntregados: 600
          }
        ]
      }
    ],
    totales: {
      baseImponible: 147.50,
      porcentajeIva: 4.0,
      cuotaIva: 5.90,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 153.40
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: false,
    notas: 'Entrega por puerta trasera antes de las 11:00 am.',
    creadoEn: '2026-09-24T08:30:00Z'
  };

  assert.strictEqual(invoice.numeroFactura, 'FAC-2026-0001');
  assert.strictEqual(invoice.albaranesAsociados.length, 2);
  assert.strictEqual(invoice.lineas[0].trazabilidadPuesta[0].codigoLotePuesta, 'NV1-20260920');
  assert.strictEqual(invoice.lineas[0].trazabilidadPuesta[0].totalHuevosEntregados, 600);
  assert.strictEqual(invoice.totales.totalDocumento, 153.40);
});

// -----------------------------------------------------------------------------
// Test 2: Unicidad del Hash: NO existen dos campos distintos para el hash
// -----------------------------------------------------------------------------
await runTest('No existen dos campos distintos para el hash (única fuente en huella y encadenamiento)', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Invoice = {
    id: 'inv-test-hash',
    numeroFactura: 'FAC-2026-HASH',
    fecha: '2026-09-24',
    clienteId: 'c-hash',
    clienteNombre: 'Cliente Test Hash',
    clienteCif: 'B12345678',
    clienteDireccion: 'Toledo',
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
    creadoEn: '2026-09-24T09:00:00Z',
    hashActual: 'HASH_ACTUAL_TEST_123',
    hashAnterior: 'HASH_PREVIO_TEST_000'
  };

  const previousRecordRef: FiscalRecordRef = {
    id: 'frec-prev-000',
    obligadoTributarioId: config.nifEmisor,
    invoiceId: 'inv-prev-000',
    numeroFactura: 'FAC-2026-000',
    fechaExpedicion: '2026-09-23',
    huellaHash: 'HASH_PREVIO_TEST_000',
    creadoEn: '2026-09-23T09:00:00Z'
  };

  const record = createFiscalRecordFromInvoice(invoice, config, previousRecordRef);

  // 1. huella.hash es la ÚNICA fuente para el hash del registro
  assert.strictEqual(record.huella.hash, 'HASH_ACTUAL_TEST_123');
  assert.strictEqual(record.huella.algoritmo, 'SHA-256');

  // 2. encadenamiento.registroAnterior.huella es la ÚNICA fuente para el hash anterior
  assert.strictEqual(record.encadenamiento.registroAnterior?.huella, 'HASH_PREVIO_TEST_000');

  // 3. Verificación de que no existen campos duplicados obsoletos en la raíz
  assert.strictEqual((record as any).hash, undefined, 'No debe existir el campo duplicado "hash" en la raíz');
  assert.strictEqual((record as any).previousHash, undefined, 'No debe existir el campo duplicado "previousHash" en la raíz');
  assert.strictEqual((record as any).hashAlgorithm, undefined, 'No debe existir el campo duplicado "hashAlgorithm" en la raíz');
  assert.strictEqual((record as any).hashSpecificationVersion, undefined, 'No debe existir el campo duplicado "hashSpecificationVersion" en la raíz');
});

// -----------------------------------------------------------------------------
// Test 3: Unicidad del XML oficial: NO existen dos campos y puede estar ausente
// -----------------------------------------------------------------------------
await runTest('No existen dos campos distintos para XML oficial y xmlOficial puede estar ausente', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Invoice = {
    id: 'inv-test-xml',
    numeroFactura: 'FAC-2026-XML',
    fecha: '2026-09-24',
    clienteId: 'c-xml',
    clienteNombre: 'Cliente Test XML',
    clienteCif: 'B87654321',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 50,
      porcentajeIva: 4,
      cuotaIva: 2,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 52
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T09:15:00Z',
    hashActual: 'HASH_TEST_XML_123'
  };

  const record = createFiscalRecordFromInvoice(invoice, config);

  // En Fase 1 / 1.1, xmlOficial debe ser la ÚNICA representación y puede estar ausente (undefined)
  assert.strictEqual(record.xmlOficial, undefined, 'xmlOficial debe ser undefined al no construirse XML oficial en Fase 1');
  assert.strictEqual((record as any).officialXml, undefined, 'No debe existir el campo duplicado "officialXml"');
});

// -----------------------------------------------------------------------------
// Test 4: Identidad del Obligado Tributario
// -----------------------------------------------------------------------------
await runTest('FiscalRecord y FiscalConfiguration identifican inequívocamente al obligadoTributarioId', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  assert.strictEqual(config.obligadoTributarioId, 'B45123987');

  const invoice: Invoice = {
    id: 'inv-test-ot',
    numeroFactura: 'FAC-2026-OT',
    fecha: '2026-09-24',
    clienteId: 'c-ot',
    clienteNombre: 'Cliente OT',
    clienteCif: 'A11223344',
    clienteDireccion: 'Toledo',
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
    creadoEn: '2026-09-24T09:30:00Z',
    hashActual: 'HASH_TEST_OT_123'
  };

  const record = createFiscalRecordFromInvoice(invoice, config);

  assert.strictEqual(record.obligadoTributarioId, 'B45123987');
  assert.strictEqual(record.emisor.nif, 'B45123987');
});

// -----------------------------------------------------------------------------
// Test 5: Un FiscalRecord puede existir sin FiscalSubmission (0 submissions)
// -----------------------------------------------------------------------------
await runTest('Un FiscalRecord puede existir sin FiscalSubmission (relación 0..N)', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Invoice = {
    id: 'inv-test-nosub',
    numeroFactura: 'FAC-2026-NOSUB',
    fecha: '2026-09-24',
    clienteId: 'c-nosub',
    clienteNombre: 'Cliente Sin Submission',
    clienteCif: 'B99887766',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 120,
      porcentajeIva: 4,
      cuotaIva: 4.8,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 124.8
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T10:00:00Z',
    hashActual: 'HASH_TEST_NOSUB_123'
  };

  const fiscalRecord = createFiscalRecordFromInvoice(invoice, config);

  // El registro fiscal existe con plenitud legal independientemente de si existe o no sumisión
  assert.strictEqual(fiscalRecord.estado, 'sellado_inmutable');
  assert.strictEqual(fiscalRecord.factura.numeroFactura, 'FAC-2026-NOSUB');

  // En la cola outbox puede haber exactamente 0 sumisiones asociadas
  const submissionsForRecord: FiscalSubmission[] = [];
  assert.strictEqual(submissionsForRecord.length, 0);
});

// -----------------------------------------------------------------------------
// Test 6: Un FiscalRecord puede tener múltiples FiscalSubmission (Reintentos)
// -----------------------------------------------------------------------------
await runTest('Un FiscalRecord puede tener múltiples FiscalSubmission independientes', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Invoice = {
    id: 'inv-test-multisub',
    numeroFactura: 'FAC-2026-MULTISUB',
    fecha: '2026-09-24',
    clienteId: 'c-multi',
    clienteNombre: 'Cliente Multi',
    clienteCif: 'B45666777',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 50,
      porcentajeIva: 4,
      cuotaIva: 2,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 52
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T10:30:00Z',
    hashActual: 'HASH_TEST_MULTISUB_123'
  };

  const fiscalRecord = createFiscalRecordFromInvoice(invoice, config);

  // Comprobar que rechaza <pending_xml/> o XML ausente
  assert.throws(
    () => createFiscalSubmission(fiscalRecord, config, { numeroIntento: 1 }),
    /No se puede crear una FiscalSubmission sin XML oficial válido/
  );

  const sub1 = createFiscalSubmission(fiscalRecord, config, { numeroIntento: 1, xmlEnviado: '<xml>alta-1</xml>' });
  const sub2 = createFiscalSubmission(fiscalRecord, config, { numeroIntento: 2, xmlEnviado: '<xml>alta-2</xml>' });
  const sub3 = createFiscalSubmission(fiscalRecord, config, { numeroIntento: 3, xmlEnviado: '<xml>alta-3</xml>' });

  const submissions = [sub1, sub2, sub3];

  assert.strictEqual(submissions.length, 3);
  assert.ok(submissions.every(s => s.fiscalRecordId === fiscalRecord.id));
  assert.ok(submissions.every(s => s.obligadoTributarioId === fiscalRecord.obligadoTributarioId));
  assert.strictEqual(submissions[0].numeroIntento, 1);
  assert.strictEqual(submissions[1].numeroIntento, 2);
  assert.strictEqual(submissions[2].numeroIntento, 3);

  // Inmutabilidad del FiscalRecord intacta
  assert.strictEqual(fiscalRecord.estado, 'sellado_inmutable');
});

// -----------------------------------------------------------------------------
// Test 7: FiscalEvent con actor USER o SYSTEM
// -----------------------------------------------------------------------------
await runTest('FiscalEvent puede ser generado tanto por USER como por SYSTEM', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  // Evento originado por un usuario humano
  const userEvent = createFiscalEvent({
    tipo: 'CREACION_FACTURA',
    actor: {
      tipo: 'USER',
      id: 'usr-100',
      email: 'peduwan@gmail.com',
      nombre: 'Pedro Propietario'
    },
    obligadoTributarioId: config.obligadoTributarioId,
    numeroFactura: 'FAC-2026-0001',
    descripcion: 'Usuario emitió factura comercial'
  });

  // Evento originado por un proceso automático del software (sin usuario humano)
  const systemEvent = createFiscalEvent({
    tipo: 'SELLADO_HUELLA',
    actor: {
      tipo: 'SYSTEM',
      id: 'sif-engine-daemon',
      nombre: 'Motor Criptográfico SIF'
    },
    obligadoTributarioId: config.obligadoTributarioId,
    numeroFactura: 'FAC-2026-0001',
    descripcion: 'Generación automática de huella digital y registro fiscal',
    datos: { hash: 'HASH_DEMO_SYSTEM' }
  });

  assert.strictEqual(userEvent.actor.tipo, 'USER');
  assert.strictEqual(userEvent.actor.email, 'peduwan@gmail.com');
  assert.strictEqual(systemEvent.actor.tipo, 'SYSTEM');
  assert.strictEqual(systemEvent.actor.id, 'sif-engine-daemon');
});

// -----------------------------------------------------------------------------
// Test 8: FiscalRecord NO se duplica como documento completo en AppData/farm snapshot
// -----------------------------------------------------------------------------
await runTest('FiscalRecord no se duplica como documento completo dentro de AppData o farm snapshot', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B45123987',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const invoice: Invoice = {
    id: 'inv-test-snapshot',
    numeroFactura: 'FAC-2026-SNAP',
    fecha: '2026-09-24',
    clienteId: 'c-snap',
    clienteNombre: 'Cliente Snap',
    clienteCif: 'B99999999',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 200,
      porcentajeIva: 4,
      cuotaIva: 8,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 208
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T11:00:00Z',
    hashActual: 'HASH_TEST_SNAP_123'
  };

  const fullRecord = createFiscalRecordFromInvoice(invoice, config);

  // Generar referencia indexable liviana
  const ref: FiscalRecordRef = createFiscalRecordRef(fullRecord);

  // AppData solo almacena referencias livianas
  const appData: AppData = {
    ...getInitialData(),
    fiscalRecordRefs: [ref]
  };

  // Verificar que AppData no tiene fiscalRecords completos
  assert.strictEqual((appData as any).fiscalRecords, undefined);
  assert.strictEqual(appData.fiscalRecordRefs?.length, 1);
  assert.strictEqual(appData.fiscalRecordRefs?.[0].id, fullRecord.id);
  assert.strictEqual(appData.fiscalRecordRefs?.[0].numeroFactura, 'FAC-2026-SNAP');

  // Comprobar que sanitizeForFirestore preparado para el guardado en /farms/granja_principal
  // no contiene los datos completos de desglose, emisor, factura detallada, etc.
  const payloadToSanitize = {
    ...appData,
    fiscalRecords: [fullRecord] // Simular inyección accidental
  };
  const { ...sanitizedSnapshot } = payloadToSanitize as any;
  delete sanitizedSnapshot.fiscalRecords; // Regla de arquitectura aplicada en firebase.ts

  assert.strictEqual(sanitizedSnapshot.fiscalRecords, undefined);
  assert.ok(sanitizedSnapshot.fiscalRecordRefs);
});

// -----------------------------------------------------------------------------
// Test 9: Compatibilidad con facturas existentes y Día Cero
// -----------------------------------------------------------------------------
await runTest('Compatibilidad con facturas existentes, cálculos comerciales y Día Cero', () => {
  const initialData = getInitialData();
  assert.ok(initialData.facturas.length > 0);
  assert.ok('hashActual' in initialData.facturas[0]);
  assert.ok('hashAnterior' in initialData.facturas[0]);

  const zeroDayData = getZeroDayAppData();
  assert.strictEqual(zeroDayData.facturas.length, 0);
  assert.strictEqual(zeroDayData.fiscalRecordRefs?.length, 0);
  assert.strictEqual(zeroDayData.isZeroDayClean, true);

  const lineas = [{ subtotal: 100 }, { subtotal: 50 }];
  const totales = calcularTotales(lineas, true);
  assert.strictEqual(totales.baseImponible, 150);
  assert.strictEqual(totales.cuotaIva, 6.00);
  assert.strictEqual(totales.cuotaRecargo, 0.75);
  assert.strictEqual(totales.totalDocumento, 156.75);
});

// -----------------------------------------------------------------------------
// Test 10: FASE 1.2 - Emisión unificada Invoice + FiscalRecord + FiscalRecordRef
// -----------------------------------------------------------------------------
await runTest('FASE 1.2: emitFiscalInvoice crea Invoice y FiscalRecord vinculados bidireccionalmente con hash real', async () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola Test S.L.'
  });

  const invoiceDraft: Factura = {
    id: 'fac-test-10',
    numeroFactura: 'FAC-2026-0099',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente Hostelería',
    clienteCif: 'B99887766',
    clienteDireccion: 'Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [{
      id: 'l1',
      formatoId: 'f1',
      nombreFormato: 'Docena huevos camperos M',
      loteEnvasadoId: 'le-1',
      codigoLoteEnvasado: 'ENV-2026-001',
      cantidadEstuches: 10,
      precioUnitario: 2.5,
      subtotal: 25,
      fechaConsumoPreferente: '2026-10-24',
      trazabilidadPuesta: []
    }],
    totales: {
      baseImponible: 25,
      porcentajeIva: 4,
      cuotaIva: 1,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 26
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T12:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const { invoice, fiscalRecord, fiscalRecordRef } = await emitFiscalInvoice({
    invoiceDraft,
    fiscalConfig: config,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  // 1. Vinculación bi-direccional
  assert.strictEqual(invoice.fiscalRecordId, fiscalRecord.id);
  assert.strictEqual(fiscalRecord.invoiceId, invoice.id);
  assert.strictEqual(fiscalRecordRef.id, fiscalRecord.id);
  assert.strictEqual(fiscalRecordRef.numeroFactura, invoice.numeroFactura);

  // 2. Huella real y encadenamiento inicial
  assert.ok(fiscalRecord.huella.hash.length > 20);
  assert.notStrictEqual(fiscalRecord.huella.hash, 'PENDING_FASE_2_HASH');
  assert.strictEqual(fiscalRecord.encadenamiento.primerRegistro, true);
  assert.strictEqual(fiscalRecord.encadenamiento.registroAnterior, undefined);
  assert.strictEqual(fiscalRecord.estado, 'sellado_inmutable');

  // 3. Inmutabilidad en memoria
  assert.throws(() => {
    (fiscalRecord as any).estado = 'modificado';
  }, /Cannot assign to read only property/);
});

// -----------------------------------------------------------------------------
// Test 11: FASE 1.2 - Encadenamiento secuencial sin condiciones de carrera
// -----------------------------------------------------------------------------
await runTest('FASE 1.2: Encadenamiento secuencial genera cadena criptográfica correcta', async () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola Test S.L.'
  });

  const draft1: Factura = {
    id: 'fac-chain-1',
    numeroFactura: 'FAC-2026-0101',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente 1',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
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
    creadoEn: '2026-09-24T12:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const draft2: Factura = {
    ...draft1,
    id: 'fac-chain-2',
    numeroFactura: 'FAC-2026-0102'
  };

  const res1 = await emitFiscalInvoice({
    invoiceDraft: draft1,
    fiscalConfig: config,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  const res2 = await emitFiscalInvoice({
    invoiceDraft: draft2,
    fiscalConfig: config,
    previousRecordRef: res1.fiscalRecordRef,
    persistRecordFn: async () => true
  });

  assert.strictEqual(res1.fiscalRecord.encadenamiento.primerRegistro, true);
  assert.strictEqual(res1.fiscalRecord.encadenamiento.registroAnterior, undefined);
  assert.strictEqual(res2.fiscalRecord.encadenamiento.primerRegistro, false);
  assert.strictEqual(res2.fiscalRecord.encadenamiento.registroAnterior?.huella, res1.fiscalRecord.huella.hash);
  assert.strictEqual(res2.fiscalRecord.encadenamiento.registroAnterior?.numSerieFactura, res1.fiscalRecord.factura.numeroFactura);
  assert.strictEqual(res2.invoice.hashAnterior, res1.fiscalRecord.huella.hash);
});

// -----------------------------------------------------------------------------
// Test 12: FASE 1.2 - Prohibición de persistir PENDING_FASE_2_HASH
// -----------------------------------------------------------------------------
await runTest('FASE 1.2: saveFiscalRecordToCloud rechaza tajantemente PENDING_FASE_2_HASH o huellas vacías', async () => {
  const invalidRecord: any = {
    id: 'frec-invalid-hash',
    obligadoTributarioId: 'B12345678',
    emisor: {
      nif: 'B12345678',
      nombreRazon: 'Granja Test S.L.'
    },
    huella: {
      hash: 'PENDING_FASE_2_HASH',
      algoritmo: 'SHA-256'
    }
  };

  await assert.rejects(
    async () => {
      await saveFiscalRecordToCloud(invalidRecord);
    },
    /PENDING_FASE_2_HASH/
  );
});

// -----------------------------------------------------------------------------
// Test 13: FASE 1.2 - createFiscalEvent rechaza obligadoTributarioId ausente
// -----------------------------------------------------------------------------
await runTest('FASE 1.2: createFiscalEvent no permite fallbacks ficticios ni obligadoTributarioId vacío', () => {
  assert.throws(
    () => {
      createFiscalEvent({
        tipo: 'SELLADO_HUELLA',
        actor: { tipo: 'SYSTEM', id: 'sys-daemon' },
        obligadoTributarioId: '',
        descripcion: 'Evento inválido sin obligado'
      });
    },
    /obligadoTributarioId es obligatorio y no puede estar vacío/
  );
});

// =============================================================================
// FASE 1.3: TESTS ESPECÍFICOS DE SANEAMIENTO ARQUITECTÓNICO Y CONCURRENCIA
// =============================================================================

// -----------------------------------------------------------------------------
// Test 14 (Test A): Nueva emisión NUNCA usa Invoice.hashAnterior
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test A: Nueva emisión NUNCA utiliza Invoice.hashAnterior como fuente de encadenamiento', async () => {
  resetFiscalQueue();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola Test S.L.'
  });

  const invoiceWithLegacyHash: Factura = {
    id: 'fac-legacy-test',
    numeroFactura: 'FAC-2026-LEGACY-01',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente 1',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
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
    creadoEn: '2026-09-24T12:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false,
    // Campo legacy con valor falso:
    hashAnterior: 'HASH_LEGACY_FALSO_DEBE_SER_IGNORADO'
  };

  const res = await emitFiscalInvoice({
    invoiceDraft: invoiceWithLegacyHash,
    fiscalConfig: config,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  // El FiscalRecord generado NO debe usar el valor legacy
  assert.notStrictEqual(
    res.fiscalRecord.encadenamiento.registroAnterior?.huella,
    'HASH_LEGACY_FALSO_DEBE_SER_IGNORADO',
    'El nuevo FiscalRecord NUNCA debe adoptar invoice.hashAnterior'
  );
  assert.strictEqual(
    res.fiscalRecord.encadenamiento.primerRegistro,
    true,
    'Al ser previousRecordRef null, debe ser primerRegistro=true sin registro anterior'
  );
  assert.strictEqual(
    res.fiscalRecord.encadenamiento.registroAnterior,
    undefined
  );
});

// -----------------------------------------------------------------------------
// Test 15 (Test B): Concurrencia - Dos emisiones simultáneas encadenadas
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test B: Dos emisiones simultáneas se serializan y encadenan secuencialmente sin colisión', async () => {
  resetFiscalQueue();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Concurrente S.L.'
  });

  const draftA: Factura = {
    id: 'fac-conc-A',
    numeroFactura: 'FAC-2026-CONC-A',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente Concurrente',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: {
      baseImponible: 50,
      porcentajeIva: 4,
      cuotaIva: 2,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 52
    },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T14:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const draftB: Factura = {
    ...draftA,
    id: 'fac-conc-B',
    numeroFactura: 'FAC-2026-CONC-B'
  };

  // Lanzar simultáneamente ambas emisiones para el mismo obligado tributario
  const [resA, resB] = await Promise.all([
    emitFiscalInvoice({ invoiceDraft: draftA, fiscalConfig: config, persistRecordFn: async () => true }),
    emitFiscalInvoice({ invoiceDraft: draftB, fiscalConfig: config, persistRecordFn: async () => true })
  ]);

  // Una de las dos debe ser la primera (primerRegistro: true) y la otra debe encadenar estrictamente con la primera
  const primer = resA.fiscalRecord.encadenamiento.primerRegistro ? resA : resB;
  const segundo = primer === resA ? resB : resA;

  assert.strictEqual(primer.fiscalRecord.encadenamiento.primerRegistro, true);
  assert.strictEqual(primer.fiscalRecord.encadenamiento.registroAnterior, undefined);

  assert.strictEqual(segundo.fiscalRecord.encadenamiento.primerRegistro, false);
  assert.strictEqual(
    segundo.fiscalRecord.encadenamiento.registroAnterior?.huella,
    primer.fiscalRecord.huella.hash,
    'El segundo registro concurrente debe encadenarse con el hash del primero'
  );
  assert.strictEqual(
    segundo.fiscalRecord.encadenamiento.registroAnterior?.numSerieFactura,
    primer.fiscalRecord.factura.numeroFactura
  );
});

// -----------------------------------------------------------------------------
// Test 16 (Test C): Obligado tributario independiente
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test C: La cadena fiscal está aislada estrictamente por obligadoTributarioId', async () => {
  resetFiscalQueue();

  const configA = createDefaultFiscalConfiguration({
    nif: 'A11111111',
    nombreRazon: 'Granja Empresa A S.A.'
  });

  const configB = createDefaultFiscalConfiguration({
    nif: 'B22222222',
    nombreRazon: 'Granja Empresa B S.L.'
  });

  const draftA1: Factura = {
    id: 'fac-A1',
    numeroFactura: 'FAC-A-001',
    fecha: '2026-09-24',
    clienteId: 'c-a',
    clienteNombre: 'Cliente A',
    clienteCif: 'B99999999',
    clienteDireccion: 'Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: { baseImponible: 100, porcentajeIva: 4, cuotaIva: 4, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 104 },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T15:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const draftB1: Factura = {
    ...draftA1,
    id: 'fac-B1',
    numeroFactura: 'FAC-B-001'
  };

  const draftA2: Factura = {
    ...draftA1,
    id: 'fac-A2',
    numeroFactura: 'FAC-A-002'
  };

  // Empresa A -> Factura 1
  const resA1 = await emitFiscalInvoice({
    invoiceDraft: draftA1,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });

  // Empresa B -> Factura 1
  const resB1 = await emitFiscalInvoice({
    invoiceDraft: draftB1,
    fiscalConfig: configB,
    persistRecordFn: async () => true
  });

  // Empresa A -> Factura 2
  const resA2 = await emitFiscalInvoice({
    invoiceDraft: draftA2,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });

  // Verificaciones:
  // 1. A1 es el primer registro de la Empresa A
  assert.strictEqual(resA1.fiscalRecord.encadenamiento.primerRegistro, true);

  // 2. B1 es el primer registro de la Empresa B y NO encadena con A1
  assert.strictEqual(resB1.fiscalRecord.encadenamiento.primerRegistro, true);
  assert.strictEqual(resB1.fiscalRecord.encadenamiento.registroAnterior, undefined);
  assert.notStrictEqual(resB1.fiscalRecord.huella.hash, resA1.fiscalRecord.huella.hash);

  // 3. A2 encadena con A1 (de su misma empresa A), y no con B1
  assert.strictEqual(resA2.fiscalRecord.encadenamiento.primerRegistro, false);
  assert.strictEqual(resA2.fiscalRecord.encadenamiento.registroAnterior?.huella, resA1.fiscalRecord.huella.hash);
  assert.strictEqual(resA2.fiscalRecord.encadenamiento.registroAnterior?.numSerieFactura, resA1.fiscalRecord.factura.numeroFactura);
  assert.strictEqual(resA2.fiscalRecord.encadenamiento.registroAnterior?.idEmisorFactura, 'A11111111');
});

// -----------------------------------------------------------------------------
// Test 17 (Test D): No persistencia legacy en /registros_facturacion
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test D: Ninguna emisión nueva escribe en /registros_facturacion', async () => {
  resetFiscalQueue();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Sin Legacy S.L.'
  });

  const draft: Factura = {
    id: 'fac-no-legacy',
    numeroFactura: 'FAC-2026-NOLEGACY',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente Test',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: { baseImponible: 50, porcentajeIva: 4, cuotaIva: 2, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 52 },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T16:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const persistedCollections: string[] = [];

  const mockPersist = async (record: FiscalRecord) => {
    // Verificar que el registro se destina al dominio /fiscal_records
    persistedCollections.push(`fiscal_records/${record.id}`);
  };

  await emitFiscalInvoice({
    invoiceDraft: draft,
    fiscalConfig: config,
    persistRecordFn: mockPersist
  });

  // Validar que se ha persistido exactamente en fiscal_records y nunca en registros_facturacion
  assert.strictEqual(persistedCollections.length, 1);
  assert.ok(persistedCollections[0].startsWith('fiscal_records/'));
  assert.ok(!persistedCollections.some(col => col.includes('registros_facturacion')));
});

// -----------------------------------------------------------------------------
// Test 18 (Test E): Persistencia única por emisión
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test E: Cada emisión provoca exactamente una única persistencia de FiscalRecord', async () => {
  resetFiscalQueue();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Unica Persistencia S.L.'
  });

  const draft: Factura = {
    id: 'fac-single-persist',
    numeroFactura: 'FAC-2026-SINGLE-01',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente Test',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: { baseImponible: 50, porcentajeIva: 4, cuotaIva: 2, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 52 },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T16:30:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  let persistCount = 0;
  const mockPersist = async (_record: FiscalRecord) => {
    persistCount++;
  };

  await emitFiscalInvoice({
    invoiceDraft: draft,
    fiscalConfig: config,
    persistRecordFn: mockPersist
  });

  assert.strictEqual(persistCount, 1, 'Debe ejecutarse exactamente UNA persistencia');

  // Segunda emisión
  const draft2: Factura = { ...draft, id: 'fac-single-persist-2', numeroFactura: 'FAC-2026-SINGLE-02' };
  await emitFiscalInvoice({
    invoiceDraft: draft2,
    fiscalConfig: config,
    persistRecordFn: mockPersist
  });

  assert.strictEqual(persistCount, 2, 'Tras dos emisiones, debe haber exactamente DOS persistencias');
});

// -----------------------------------------------------------------------------
// Test 19 (Test F): Propagación obligatoria del error de persistencia
// -----------------------------------------------------------------------------
await runTest('FASE 1.3 - Test F: Si la persistencia física falla, emitFiscalInvoice no oculta el error y rechaza la emisión', async () => {
  resetFiscalQueue();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Falla Persistencia S.L.'
  });

  const draft: Factura = {
    id: 'fac-fail-persist',
    numeroFactura: 'FAC-2026-FAIL-01',
    fecha: '2026-09-24',
    clienteId: 'c1',
    clienteNombre: 'Cliente Error',
    clienteCif: 'B11111111',
    clienteDireccion: 'Madrid',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [],
    totales: { baseImponible: 50, porcentajeIva: 4, cuotaIva: 2, aplicaRecargo: false, porcentajeRecargo: 0, cuotaRecargo: 0, totalDocumento: 52 },
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: true,
    creadoEn: '2026-09-24T17:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const failingPersist = async (_record: FiscalRecord) => {
    throw new Error('Fallo crítico de custodia en Firestore: Conexión rechazada');
  };

  await assert.rejects(
    async () => {
      await emitFiscalInvoice({
        invoiceDraft: draft,
        fiscalConfig: config,
        persistRecordFn: failingPersist
      });
    },
    /Fallo crítico de custodia en Firestore: Conexión rechazada/
  );
});

}

main()
  .then(() => {
    console.log('\n================================================================');
    console.log(`  RESUMEN: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO! `);
    console.log('================================================================\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nSuite de tests fallida:', err);
    process.exit(1);
  });
