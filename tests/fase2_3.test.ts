/**
 * SUITE DE TESTS - FASE 2.3: QR TRIBUTARIO OFICIAL Y MODELO DE REMISIÓN VERI*FACTU (OUTBOX)
 *
 * Normativa Oficial:
 * - Ley 11/2021 de medidas de prevención y lucha contra el fraude fiscal
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu / SIF) Art. 8 y 16
 * - Orden HAC/1177/2024 Art. 20 y 21
 * - Especificaciones técnicas AEAT del Código QR v1.0
 */

import assert from 'node:assert';
import {
  buildFiscalQrPayload,
  buildFiscalQrUrl,
  generateQrDataUri,
  buildFiscalQr,
  getFiscalQrFromRecord,
  AEAT_QR_ENDPOINTS
} from '../src/fiscal/qrService';
import {
  createFiscalSubmission,
  transitionSubmissionStatus,
  getSubmissionsForRecord,
  getPendingSubmissions,
  resetFiscalOutbox
} from '../src/fiscal/submissionService';
import {
  createDefaultFiscalConfiguration,
  createFiscalRecordFromInvoice,
  createFiscalAnulacionRecord
} from '../src/fiscal/modelTransformers';
import { emitFiscalInvoice } from '../src/fiscal/emissionService';
import { FiscalRecord } from '../src/fiscal/types';
import { Factura } from '../src/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 2.3: QR Y OUTBOX VERI*FACTU  ');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  [PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] Test ${totalTests}: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// Fixture canónica de FiscalRecord de Alta sellado
function createSampleFiscalRecord(overrides?: any): FiscalRecord {
  const base: FiscalRecord = {
    id: 'frec-test-qr-001',
    obligadoTributarioId: 'B12345678',
    invoiceId: 'inv-test-qr-001',
    tipoRegistro: 'alta',
    modoFiscal: 'VERI_FACTU',
    versionEspecificacion: '1.0',
    sistemaInformatico: {
      nombreRazon: 'Gestión Avícola AgroTech Software S.L.',
      nif: 'B99000001',
      nombreSistemaInformatico: 'Gestión Avícola',
      idSistemaInformatico: 'GA',
      version: '1.0.0',
      numeroInstalacion: '01',
      tipoUsoPosibleSoloVerifactu: 'S',
      tipoUsoPosibleMultiOT: 'N',
      indicadorMultiplesOT: 'N'
    },
    emisor: {
      nif: 'B12345678',
      nombreRazon: 'Granja Avícola El Valle S.L.'
    },
    factura: {
      numeroFactura: 'FAC-2026/0123',
      fechaExpedicion: '2026-10-15',
      horaExpedicion: '10:00:00',
      tipoFactura: 'F1',
      descripcionOperacion: 'Venta de huevos camperos',
      facturaSimplificadaArt7273: 'N',
      facturaSinIdentifDestinatarioArt61d: 'N',
      macrodato: 'N'
    },
    desgloseTributario: {
      desgloseIVA: [
        {
          tipoImpositivo: 4,
          baseImponible: 100,
          cuotaRepercutida: 4
        }
      ],
      baseImponibleTotal: 100,
      cuotaTotal: 4,
      cuotaRecargoTotal: 0,
      importeTotal: 104
    },
    encadenamiento: {
      primerRegistro: true
    },
    huella: {
      hash: 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
      algoritmo: 'SHA-256',
      especificacionVersion: 'HAC/1177/2024',
      cadenaTextoCanonico: 'IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026/0123'
    },
    fechaHoraHusoGenRegistro: '2026-10-15T10:00:00+02:00',
    qr: {
      url: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=FAC-2026%2F0123&fecha=15-10-2026&importe=104.00',
      payloadTexto: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=FAC-2026%2F0123&fecha=15-10-2026&importe=104.00'
    },
    estado: 'sellado_inmutable',
    creadoEn: '2026-10-15T10:00:00+02:00'
  };

  return deepFreeze({
    ...base,
    ...overrides,
    emisor: overrides?.emisor ? { ...base.emisor, ...overrides.emisor } : base.emisor,
    factura: overrides?.factura ? { ...base.factura, ...overrides.factura } : base.factura,
    desgloseTributario: overrides?.desgloseTributario ? { ...base.desgloseTributario, ...overrides.desgloseTributario } : base.desgloseTributario,
    huella: overrides?.huella ? { ...base.huella, ...overrides.huella } : base.huella
  });
}

// -----------------------------------------------------------------------------
// BLOQUE 1: TESTS DEL QR TRIBUTARIO OFICIAL (Tests 1 - 12)
// -----------------------------------------------------------------------------

await runTest('QR - Test 1: Mismo FiscalRecord produce exactamente el mismo payload canónico', () => {
  const record = createSampleFiscalRecord();
  const payload1 = buildFiscalQrPayload(record);
  const payload2 = buildFiscalQrPayload(record);

  assert.deepStrictEqual(payload1, payload2);
  assert.strictEqual(payload1.nif, 'B12345678');
  assert.strictEqual(payload1.numserie, 'FAC-2026/0123');
  assert.strictEqual(payload1.fecha, '15-10-2026'); // Formato DD-MM-YYYY oficial
  assert.strictEqual(payload1.importe, '104.00'); // 12.2 oficial con dos decimales
});

await runTest('QR - Test 2: Mismo FiscalRecord produce exactamente la misma URL oficial de cotejo', () => {
  const record = createSampleFiscalRecord();
  const url1 = buildFiscalQrUrl(record);
  const url2 = buildFiscalQrUrl(record);

  assert.strictEqual(url1, url2);
  assert.ok(url1.startsWith(AEAT_QR_ENDPOINTS.production));
  assert.ok(url1.includes('nif=B12345678'));
  assert.ok(url1.includes('numserie=FAC-2026%2F0123'));
  assert.ok(url1.includes('fecha=15-10-2026'));
  assert.ok(url1.includes('importe=104.00'));
});

await runTest('QR - Test 3: URL correctamente codificada según estándares de la AEAT', () => {
  const record = createSampleFiscalRecord({
    factura: {
      numeroFactura: 'FAC/2026/001 & B + C',
      fechaExpedicion: '2026-11-20'
    }
  });

  const url = buildFiscalQrUrl(record);
  // Verificar que la barra, ampersand, espacios y signo más están percent-encoded en el parámetro
  assert.ok(url.includes('numserie=FAC%2F2026%2F001+%26+B+%2B+C') || url.includes('numserie=FAC%2F2026%2F001+%26+B+%2BC'));
  const parsed = new URL(url);
  assert.strictEqual(parsed.searchParams.get('numserie'), 'FAC/2026/001 & B + C');
  assert.strictEqual(parsed.searchParams.get('fecha'), '20-11-2026');
});

await runTest('QR - Test 4: NIF incorrecto o mal formateado provoca rechazo tajante', () => {
  // Caso 4.1: NIF con longitud incorrecta (demasiado corto)
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      emisor: { nif: '123' }
    }));
  }, /no cumple el formato reglamentario oficial/);

  // Caso 4.2: NIF vacío
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      emisor: { nif: '' }
    }));
  }, /es obligatorio y no puede estar vacío/);

  // Caso 4.3: Placeholder ficticio ES_UNKNOWN
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      emisor: { nif: 'ES_UNKNOWN' }
    }));
  }, /marcador ficticio prohibido/);

  // Caso 4.4: Caracteres inválidos
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      emisor: { nif: '@@@@@@@@@' }
    }));
  }, /no cumple el formato reglamentario oficial/);
});

await runTest('QR - Test 5: Fecha incorrecta o no válida calendáricamente provoca rechazo tajante', () => {
  // Caso 5.1: Fecha inexistente (30 de febrero)
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      factura: {
        numeroFactura: 'FAC-01',
        fechaExpedicion: '2026-02-30'
      }
    }));
  }, /formato de fecha no reconocido o inválido/);

  // Caso 5.2: Fecha vacía
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      factura: {
        numeroFactura: 'FAC-01',
        fechaExpedicion: ''
      }
    }));
  }, /es obligatorio y no puede estar vacío/);
});

await runTest('QR - Test 6: Importe no numérico, NaN o infinito provoca rechazo tajante', () => {
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      desgloseTributario: {
        importeTotal: NaN as any
      }
    }));
  }, /ImporteTotal debe ser un número finito válido/);

  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      desgloseTributario: {
        importeTotal: Infinity as any
      }
    }));
  }, /ImporteTotal debe ser un número finito válido/);
});

await runTest('QR - Test 7: Número de factura ausente o vacío provoca rechazo tajante', () => {
  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      factura: {
        numeroFactura: ''
      }
    }));
  }, /es obligatorio y no puede estar vacío/);

  assert.throws(() => {
    buildFiscalQrPayload(createSampleFiscalRecord({
      factura: {
        numeroFactura: undefined as any
      }
    }));
  }, /es obligatorio y no puede ser null ni undefined/);
});

await runTest('QR - Test 8: No se admiten marcadores ficticios prohibidos en ningún campo', () => {
  const placeholders = ['UNKNOWN', 'PENDING_FASE_2_HASH', '<pending_xml/>', 'NULL', 'UNDEFINED'];
  for (const ph of placeholders) {
    assert.throws(() => {
      buildFiscalQrPayload(createSampleFiscalRecord({
        factura: {
          numeroFactura: ph
        }
      }));
    }, /marcador ficticio prohibido/);
  }
});

await runTest('QR - Test 9: El servicio de QR es puro y no muta el FiscalRecord en ningún caso', async () => {
  const record = createSampleFiscalRecord();
  const snapshotBefore = JSON.stringify(record);

  const payload = buildFiscalQrPayload(record);
  const url = buildFiscalQrUrl(record);
  const full = await buildFiscalQr(record);

  assert.ok(payload);
  assert.ok(url);
  assert.ok(full.qrDataUri.startsWith('data:image/png;base64,'));

  const snapshotAfter = JSON.stringify(record);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'El FiscalRecord no debe sufrir ninguna mutación');
});

await runTest('QR - Test 10: Tres ejecuciones consecutivas producen resultado idéntico byte a byte', async () => {
  const record = createSampleFiscalRecord();

  const r1 = buildFiscalQrUrl(record);
  const r2 = buildFiscalQrUrl(record);
  const r3 = buildFiscalQrUrl(record);

  assert.strictEqual(r1, r2);
  assert.strictEqual(r2, r3);

  const uri1 = await generateQrDataUri(r1);
  const uri2 = await generateQrDataUri(r1);
  const uri3 = await generateQrDataUri(r1);

  assert.strictEqual(uri1, uri2);
  assert.strictEqual(uri2, uri3);
});

await runTest('QR - Test 11: PDF e impresión consumen el QR del FiscalRecord sin recalcular campos', () => {
  const record = createSampleFiscalRecord();
  const qrData = getFiscalQrFromRecord(record);

  assert.strictEqual(qrData.url, record.qr.url);
  assert.strictEqual(qrData.payloadTexto, record.qr.payloadTexto);

  // Intentar extraer de un registro nulo o sin QR falla limpiamente
  assert.throws(() => {
    getFiscalQrFromRecord(null as any);
  }, /no contiene información del código QR/);
});

await runTest('QR - Test 12: Modificar la Factura comercial tras la emisión no altera el QR ni el FiscalRecord sellado', async () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola Test S.L.'
  });

  const invoiceDraft: Factura = {
    id: 'inv-draft-mod-test',
    numeroFactura: 'FAC-2026-MUT-01',
    fecha: '2026-10-15',
    clienteId: 'c1',
    clienteNombre: 'Cliente Hostelería',
    clienteCif: 'B99887766',
    clienteDireccion: 'Madrid',
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
    creadoEn: '2026-10-15T11:00:00Z',
    tipoFactura: 'F1',
    esRectificativa: false
  };

  const { invoice, fiscalRecord } = await emitFiscalInvoice({
    invoiceDraft,
    fiscalConfig: config,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  const qrOriginalUrl = fiscalRecord.qr.url;
  const qrOriginalHash = fiscalRecord.huella.hash;

  // Modificar comercialmente el objeto Factura devuelto
  invoice.numeroFactura = 'FAC-MODIFICADA-POSTERIOR';
  invoice.totales.totalDocumento = 999999;
  invoice.fecha = '2030-01-01';

  // El FiscalRecord sellado y su QR permanecen completamente intactos
  assert.strictEqual(fiscalRecord.qr.url, qrOriginalUrl);
  assert.strictEqual(fiscalRecord.huella.hash, qrOriginalHash);
  assert.strictEqual(fiscalRecord.factura.numeroFactura, 'FAC-2026-MUT-01');
  assert.strictEqual(fiscalRecord.desgloseTributario.importeTotal, 208);
  assert.ok(fiscalRecord.qr.url.includes('importe=208.00'));
});

// -----------------------------------------------------------------------------
// BLOQUE 2: TESTS DEL MODELO DE REMISIÓN / OUTBOX (Tests A - J)
// -----------------------------------------------------------------------------

resetFiscalOutbox();

await runTest('Outbox - Test A: Un FiscalRecord puede existir sin ninguna FiscalSubmission asociada (relación 0..N)', () => {
  const record = createSampleFiscalRecord();
  const submissions = getSubmissionsForRecord(record.id);

  assert.strictEqual(submissions.length, 0, 'Al emitirse, el FiscalRecord debe existir sin envíos obligatorios');
});

await runTest('Outbox - Test B: Crear la primera remisión genera FiscalSubmission #1 en estado PENDING', () => {
  const record = createSampleFiscalRecord();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const submission1 = createFiscalSubmission(record, config);

  assert.strictEqual(submission1.estado, 'PENDING');
  assert.strictEqual(submission1.numeroIntento, 1);
  assert.strictEqual(submission1.fiscalRecordId, record.id);
  assert.strictEqual(submission1.obligadoTributarioId, record.obligadoTributarioId);
  assert.strictEqual(submission1.numeroFactura, record.factura.numeroFactura);
  assert.ok(submission1.xmlEnviado.includes('RegFactuSistemaFacturacion'));
});

await runTest('Outbox - Test C: Crear una segunda remisión NO modifica en ningún caso el FiscalRecord sellado', () => {
  const record = createSampleFiscalRecord();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const snapshotBefore = JSON.stringify(record);

  const sub1 = createFiscalSubmission(record, config, { numeroIntento: 1 });
  const sub2 = createFiscalSubmission(record, config, { numeroIntento: 2 });

  const snapshotAfter = JSON.stringify(record);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'El FiscalRecord no debe modificarse tras múltiples sumisiones');
  assert.notStrictEqual(sub1.id, sub2.id);
  assert.strictEqual(sub2.numeroIntento, 2);
});

await runTest('Outbox - Test D: Un FiscalRecord puede tener múltiples FiscalSubmissions independientes en el historial', () => {
  const record = createSampleFiscalRecord({ id: 'frec-multisub-test' });
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  createFiscalSubmission(record, config, { numeroIntento: 1 });
  createFiscalSubmission(record, config, { numeroIntento: 2 });
  createFiscalSubmission(record, config, { numeroIntento: 3 });

  const subs = getSubmissionsForRecord('frec-multisub-test');
  assert.strictEqual(subs.length, 3);
  assert.strictEqual(subs[0].numeroIntento, 1);
  assert.strictEqual(subs[1].numeroIntento, 2);
  assert.strictEqual(subs[2].numeroIntento, 3);
});

await runTest('Outbox - Test E: Cambiar el estado de FiscalSubmission no altera la huella, XML ni QR del FiscalRecord', () => {
  const record = createSampleFiscalRecord();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const sub = createFiscalSubmission(record, config);
  const sendingSub = transitionSubmissionStatus(sub, 'SENDING');
  const updatedSub = transitionSubmissionStatus(sendingSub, 'ACCEPTED', {
    httpStatus: 200,
    codigoAeat: '0',
    descripcion: 'Aceptado con éxito por AEAT',
    csv: 'CSV-AEAT-1234567890'
  });

  assert.strictEqual(updatedSub.estado, 'ACCEPTED');
  assert.strictEqual(updatedSub.csv, 'CSV-AEAT-1234567890');

  // Comprobar inviolabilidad del FiscalRecord:
  assert.strictEqual(record.estado, 'sellado_inmutable');
  assert.strictEqual((record as any).csv, undefined, 'FiscalRecord no debe contaminarse con CSV de respuesta');
  assert.strictEqual((record as any).respuestaAeat, undefined, 'FiscalRecord no debe contener respuestas de transporte');
  assert.strictEqual(record.huella.hash, 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890');
  assert.strictEqual(record.encadenamiento.primerRegistro, true);
});

await runTest('Outbox - Test F: Inmutabilidad física estricta en runtime mediante Object.isFrozen', () => {
  const record = createSampleFiscalRecord();
  assert.strictEqual(Object.isFrozen(record), true, 'FiscalRecord debe estar congelado en runtime');

  assert.throws(() => {
    (record as any).estado = 'ENVIADO';
  }, /Cannot assign to read only property/);

  assert.throws(() => {
    (record.huella as any).hash = 'ALTERADO';
  }, /Cannot assign to read only property/);
});

await runTest('Outbox - Test G: Outbox soporta transiciones completas de ciclo de vida (ACCEPTED, REJECTED, RETRY)', () => {
  const record = createSampleFiscalRecord();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  // Flujo 1: PENDING -> SENDING -> ACCEPTED
  const sub1 = createFiscalSubmission(record, config);
  const s1Sending = transitionSubmissionStatus(sub1, 'SENDING');
  assert.strictEqual(s1Sending.estado, 'SENDING');
  assert.ok(s1Sending.fechaEnvio);
  const s1Accepted = transitionSubmissionStatus(s1Sending, 'ACCEPTED', {
    httpStatus: 200,
    csv: 'CSV-CORRECTO-01'
  });
  assert.strictEqual(s1Accepted.estado, 'ACCEPTED');
  assert.ok(s1Accepted.completadoEn);

  // Flujo 2: PENDING -> SENDING -> REJECTED
  const sub2 = createFiscalSubmission(record, config, { numeroIntento: 2 });
  const s2Sending = transitionSubmissionStatus(sub2, 'SENDING');
  const s2Rejected = transitionSubmissionStatus(s2Sending, 'REJECTED', {
    httpStatus: 200,
    codigoAeat: '1104',
    descripcion: 'NIF emisor no censado'
  });
  assert.strictEqual(s2Rejected.estado, 'REJECTED');
  assert.strictEqual(s2Rejected.codigoAeat, '1104');

  // Flujo 3: PENDING -> SENDING -> FAILED_TECHNICAL -> RETRY_PENDING
  const sub3 = createFiscalSubmission(record, config, { numeroIntento: 3 });
  const s3Sending = transitionSubmissionStatus(sub3, 'SENDING');
  const s3Failed = transitionSubmissionStatus(s3Sending, 'FAILED_TECHNICAL', {
    httpStatus: 503,
    descripcion: 'Timeout conectando a sede AEAT'
  });
  assert.strictEqual(s3Failed.estado, 'FAILED_TECHNICAL');
  const s3Retry = transitionSubmissionStatus(s3Failed, 'RETRY_PENDING', {
    proximoReintento: new Date(Date.now() + 60000).toISOString()
  });
  assert.strictEqual(s3Retry.estado, 'RETRY_PENDING');
  assert.ok(s3Retry.proximoReintento);
});

await runTest('Outbox - Test H: Rechazo tajante de sumisiones con <pending_xml/> o sin XML válido', () => {
  const record = createSampleFiscalRecord();
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  assert.throws(() => {
    createFiscalSubmission(record, config, { xmlEnviado: '<pending_xml/>' });
  }, /No se permite <pending_xml\/>/);

  assert.throws(() => {
    createFiscalSubmission(record, config, { xmlEnviado: '   ' });
  }, /No se puede crear una FiscalSubmission sin XML oficial válido/);
});

await runTest('Outbox - Test I: Aislamiento de sumisiones en el Outbox por obligadoTributarioId', () => {
  resetFiscalOutbox();

  const configOT1 = createDefaultFiscalConfiguration({ nif: 'B11111111', nombreRazon: 'OT 1' });
  const configOT2 = createDefaultFiscalConfiguration({ nif: 'B22222222', nombreRazon: 'OT 2' });

  const rec1 = createSampleFiscalRecord({ id: 'rec-ot-1', obligadoTributarioId: 'B11111111', emisor: { nif: 'B11111111', nombreRazon: 'OT 1' } });
  const rec2 = createSampleFiscalRecord({ id: 'rec-ot-2', obligadoTributarioId: 'B22222222', emisor: { nif: 'B22222222', nombreRazon: 'OT 2' } });

  createFiscalSubmission(rec1, configOT1);
  createFiscalSubmission(rec2, configOT2);

  const pendingOT1 = getPendingSubmissions('B11111111');
  const pendingOT2 = getPendingSubmissions('B22222222');
  const pendingAll = getPendingSubmissions();

  assert.strictEqual(pendingOT1.length, 1);
  assert.strictEqual(pendingOT1[0].obligadoTributarioId, 'B11111111');

  assert.strictEqual(pendingOT2.length, 1);
  assert.strictEqual(pendingOT2[0].obligadoTributarioId, 'B22222222');

  assert.strictEqual(pendingAll.length, 2);
});

await runTest('Outbox - Test J: Registro de Anulación NO genera QR de cotejo comercial tributario (HAC/1177/2024 Art. 20)', () => {
  const config = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola El Valle S.L.'
  });

  const anulacionRecord = createFiscalAnulacionRecord({
    obligadoTributarioId: 'B12345678',
    config,
    facturaAnulada: {
      numeroFactura: 'FAC-2026-ANULADA-01',
      fechaExpedicion: '2026-10-15',
      motivoAnulacion: 'Error en desglose de unidades'
    },
    previousRecord: null,
    options: {
      hashActual: 'A1B2C3D4E5F60123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123'
    }
  });

  // 1. En el modelo sellado de anulación, el QR está vacío
  assert.strictEqual(anulacionRecord.tipoRegistro, 'anulacion');
  assert.strictEqual(anulacionRecord.qr.url, '');
  assert.strictEqual(anulacionRecord.qr.payloadTexto, '');

  // 2. buildFiscalQrPayload rechaza explícitamente registros de anulación
  assert.throws(() => {
    buildFiscalQrPayload(anulacionRecord);
  }, /solo es aplicable a registros de Alta de facturas expedidas/);
});

console.log('================================================================');
console.log(`  RESUMEN FASE 2.3: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO! `);
console.log('================================================================');
