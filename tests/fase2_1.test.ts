import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  Factura,
  FiscalRecord,
  FiscalRecordRef,
  FiscalConfiguration
} from '../src/types';
import {
  calculateAltaHash,
  calculateAnulacionHash,
  calculateSha256,
  buildCanonicalAltaString,
  buildCanonicalAnulacionString,
  formatImporteFiscal,
  formatFechaExpedicionFiscal,
  formatFechaHoraHusoGenRegistro,
  validatePreviousRecordRequirement,
  verifyFiscalRecordHash,
  verifyFiscalRecordChain
} from '../src/fiscal/hashService';
import {
  createFiscalRecordFromInvoice,
  createFiscalAnulacionRecord,
  createFiscalRecordRef,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import {
  emitFiscalInvoice,
  emitFiscalAnulacion,
  resetFiscalQueue,
  getLastFiscalRecord
} from '../src/fiscal/emissionService';

function logTest(testNum: number, desc: string) {
  console.log(`  [PASS] Test ${testNum}: ${desc}`);
}

async function runTestSuite() {
  console.log('\n================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS - FASE 2.1: HASH Y ENCADENAMIENTO OFICIAL');
  console.log('================================================================\n');

  const configA: FiscalConfiguration = createDefaultFiscalConfiguration({
    nif: 'B12345678',
    nombreRazon: 'Granja Avícola Santa Clara S.L.'
  });

  const configB: FiscalConfiguration = createDefaultFiscalConfiguration({
    nif: 'B87654321',
    nombreRazon: 'Avícola Los Pinos S.A.'
  });

  // --------------------------------------------------------------------------
  // TEST 1: Normalización oficial de importes (Orden HAC/1177/2024)
  // --------------------------------------------------------------------------
  assert.strictEqual(formatImporteFiscal(0), '0.00');
  assert.strictEqual(formatImporteFiscal(0.0), '0.00');
  assert.strictEqual(formatImporteFiscal('0'), '0.00');
  assert.strictEqual(formatImporteFiscal('0.00'), '0.00');
  assert.strictEqual(formatImporteFiscal(-0), '0.00');
  assert.strictEqual(formatImporteFiscal('-0.00'), '0.00');
  assert.strictEqual(formatImporteFiscal(-91.52), '-91.52');
  assert.strictEqual(formatImporteFiscal('-91.52'), '-91.52');
  assert.strictEqual(formatImporteFiscal(91.5), '91.50');
  assert.strictEqual(formatImporteFiscal(91.50), '91.50');
  assert.strictEqual(formatImporteFiscal(91.52), '91.52');
  assert.strictEqual(formatImporteFiscal('91.52'), '91.52');
  assert.strictEqual(formatImporteFiscal(1000), '1000.00');
  assert.strictEqual(formatImporteFiscal(1000.00), '1000.00');
  assert.strictEqual(formatImporteFiscal('1000'), '1000.00');
  assert.strictEqual(formatImporteFiscal('1000.00'), '1000.00');
  assert.strictEqual(formatImporteFiscal(null), '0.00');
  assert.strictEqual(formatImporteFiscal(undefined), '0.00');
  assert.throws(() => formatImporteFiscal('invalido'), /valor no numérico o no finito/);
  assert.throws(() => formatImporteFiscal(NaN), /valor no numérico o no finito/);
  assert.throws(() => formatImporteFiscal(Infinity), /valor no numérico o no finito/);
  logTest(1, 'Normalización de importes con exactamente 2 decimales, punto separador, -0.00 saneado y rechazo de NaN/Infinity');

  // --------------------------------------------------------------------------
  // TEST 2: Formato oficial de fechas de expedición y timestamp con huso horario
  // --------------------------------------------------------------------------
  assert.strictEqual(formatFechaExpedicionFiscal('2026-09-25'), '25-09-2026');
  assert.strictEqual(formatFechaExpedicionFiscal('25-09-2026'), '25-09-2026');
  assert.strictEqual(formatFechaExpedicionFiscal('2026/09/25'), '25-09-2026');
  assert.strictEqual(formatFechaExpedicionFiscal('2026-01-02'), '02-01-2026');
  assert.throws(() => formatFechaExpedicionFiscal('invalida'), /formato de fecha no reconocido o inválido/);
  assert.throws(() => formatFechaExpedicionFiscal('2026-02-31'), /formato de fecha no reconocido o inválido/);
  assert.throws(() => formatFechaExpedicionFiscal('2026-13-01'), /formato de fecha no reconocido o inválido/);

  const timestampActual = formatFechaHoraHusoGenRegistro();
  assert.ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(timestampActual),
    `El timestamp debe incluir huso horario ISO 8601: ${timestampActual}`
  );

  const timestampManual = '2026-09-25T14:30:00+02:00';
  assert.strictEqual(formatFechaHoraHusoGenRegistro(timestampManual), timestampManual);
  logTest(2, 'Formato oficial de fecha expedición DD-MM-YYYY con validación calendárica y timestamp con huso horario');

  // --------------------------------------------------------------------------
  // TEST 3: Cadena canónica oficial de Alta
  // --------------------------------------------------------------------------
  const altaInputPrimerRegistro = {
    nifEmisor: 'B12345678',
    numSerieFactura: 'FAC-2026-0001',
    fechaExpedicion: '2026-09-25',
    tipoFactura: 'F1',
    cuotaTotal: 91.50,
    importeTotal: 1091.50,
    huellaAnterior: null,
    fechaHoraHusoGenRegistro: '2026-09-25T12:00:00+02:00'
  };

  const canonicalAlta1 = buildCanonicalAltaString(altaInputPrimerRegistro);
  assert.strictEqual(
    canonicalAlta1,
    'IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026-0001&FechaExpedicionFactura=25-09-2026&TipoFactura=F1&CuotaTotal=91.50&ImporteTotal=1091.50&Huella=&FechaHoraHusoGenRegistro=2026-09-25T12:00:00+02:00'
  );

  const prevHashMock = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
  const altaInputSegundoRegistro = {
    ...altaInputPrimerRegistro,
    numSerieFactura: 'FAC-2026-0002',
    huellaAnterior: prevHashMock
  };

  const canonicalAlta2 = buildCanonicalAltaString(altaInputSegundoRegistro);
  assert.strictEqual(
    canonicalAlta2,
    `IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026-0002&FechaExpedicionFactura=25-09-2026&TipoFactura=F1&CuotaTotal=91.50&ImporteTotal=1091.50&Huella=${prevHashMock}&FechaHoraHusoGenRegistro=2026-09-25T12:00:00+02:00`
  );
  logTest(3, 'Cadena canónica de Alta cumple estrictamente campos, orden y separadores oficiales');

  // --------------------------------------------------------------------------
  // TEST 4: Cadena canónica oficial de Anulación (subconjunto oficial)
  // --------------------------------------------------------------------------
  const anulacionInput = {
    nifEmisor: 'B12345678',
    numSerieFactura: 'FAC-2026-0001',
    fechaExpedicion: '2026-09-25',
    huellaAnterior: prevHashMock,
    fechaHoraHusoGenRegistro: '2026-09-25T12:05:00+02:00'
  };

  const canonicalAnulacion = buildCanonicalAnulacionString(anulacionInput);
  assert.strictEqual(
    canonicalAnulacion,
    `IDEmisorFactura=B12345678&NumSerieFactura=FAC-2026-0001&FechaExpedicionFactura=25-09-2026&Huella=${prevHashMock}&FechaHoraHusoGenRegistro=2026-09-25T12:05:00+02:00`
  );
  assert.ok(!canonicalAnulacion.includes('TipoFactura='), 'Anulación no debe contener TipoFactura');
  assert.ok(!canonicalAnulacion.includes('CuotaTotal='), 'Anulación no debe contener CuotaTotal');
  assert.ok(!canonicalAnulacion.includes('ImporteTotal='), 'Anulación no debe contener ImporteTotal');
  logTest(4, 'Cadena canónica de Anulación utiliza exclusivamente el subconjunto oficial de la Orden');

  // --------------------------------------------------------------------------
  // TEST 5: Cálculo del Hash SHA-256 en mayúsculas de 64 caracteres
  // --------------------------------------------------------------------------
  const hashResAlta = await calculateAltaHash(altaInputPrimerRegistro);
  assert.strictEqual(hashResAlta.algoritmo, 'SHA-256');
  assert.strictEqual(hashResAlta.especificacionVersion, 'HAC/1177/2024');
  assert.strictEqual(hashResAlta.hash.length, 64);
  assert.strictEqual(hashResAlta.hash, hashResAlta.hash.toUpperCase());
  assert.ok(/^[0-9A-F]{64}$/.test(hashResAlta.hash));

  // Reproducibilidad determinista
  const hashResAltaRepetido = await calculateAltaHash(altaInputPrimerRegistro);
  assert.strictEqual(hashResAlta.hash, hashResAltaRepetido.hash);
  logTest(5, 'Cálculo de huella SHA-256 determinista, 64 caracteres hex en mayúsculas');

  // --------------------------------------------------------------------------
  // TEST 6: Primer registro de facturación de una cadena
  // --------------------------------------------------------------------------
  const facturaDraft1: Factura = {
    id: 'inv-f21-1',
    numeroFactura: 'FAC-2026-0101',
    fecha: '2026-09-25',
    clienteId: 'cli-01',
    clienteNombre: 'Restaurante El Molino',
    clienteCif: 'B99112233',
    clienteDireccion: 'Av. Mayor 10',
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
    creadoEn: '2026-09-25T10:00:00Z'
  };

  resetFiscalQueue();
  const emission1 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft1,
    fiscalConfig: configA,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });

  const record1 = emission1.fiscalRecord;
  assert.strictEqual(record1.encadenamiento.primerRegistro, true);
  assert.strictEqual(record1.encadenamiento.registroAnterior, undefined);
  assert.ok(record1.huella.cadenaTextoCanonico.includes('&Huella=&'));
  assert.strictEqual(record1.huella.hash.length, 64);
  logTest(6, 'Primer registro de la cadena marcado con primerRegistro=true y Huella=&');

  // --------------------------------------------------------------------------
  // TEST 7: Encadenamiento secuencial R1 -> R2 -> R3
  // --------------------------------------------------------------------------
  const facturaDraft2: Factura = {
    ...facturaDraft1,
    id: 'inv-f21-2',
    numeroFactura: 'FAC-2026-0102'
  };

  const emission2 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft2,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });
  const record2 = emission2.fiscalRecord;

  assert.strictEqual(record2.encadenamiento.primerRegistro, false);
  assert.ok(record2.encadenamiento.registroAnterior !== undefined);
  assert.strictEqual(record2.encadenamiento.registroAnterior.huella, record1.huella.hash);
  assert.ok(record2.huella.cadenaTextoCanonico.includes(`&Huella=${record1.huella.hash}&`));

  const facturaDraft3: Factura = {
    ...facturaDraft1,
    id: 'inv-f21-3',
    numeroFactura: 'FAC-2026-0103'
  };

  const emission3 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft3,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });
  const record3 = emission3.fiscalRecord;

  assert.strictEqual(record3.encadenamiento.primerRegistro, false);
  assert.strictEqual(record3.encadenamiento.registroAnterior?.huella, record2.huella.hash);
  assert.ok(record3.huella.cadenaTextoCanonico.includes(`&Huella=${record2.huella.hash}&`));
  logTest(7, 'Encadenamiento secuencial R1 -> R2 -> R3 con huellas anteriores exactas');

  // --------------------------------------------------------------------------
  // TEST 8: Verificación positiva de integridad (verifyFiscalRecordHash)
  // --------------------------------------------------------------------------
  const check1 = await verifyFiscalRecordHash(record1);
  assert.strictEqual(check1.valid, true);
  assert.strictEqual(check1.actualHash, check1.expectedHash);

  const check2 = await verifyFiscalRecordHash(record2);
  assert.strictEqual(check2.valid, true);

  const check3 = await verifyFiscalRecordHash(record3);
  assert.strictEqual(check3.valid, true);
  logTest(8, 'Verificación positiva de integridad matemática para registros válidos');

  // --------------------------------------------------------------------------
  // TEST 9: Detección estricta de alteraciones (Integridad negativa)
  // --------------------------------------------------------------------------
  // 9.1 Alterar NIF
  const tamperedNif: FiscalRecord = {
    ...record1,
    emisor: { ...record1.emisor, nif: 'B99999999' }
  };
  const checkTamperedNif = await verifyFiscalRecordHash(tamperedNif);
  assert.strictEqual(checkTamperedNif.valid, false);

  // 9.2 Alterar número de factura
  const tamperedNum: FiscalRecord = {
    ...record1,
    factura: { ...record1.factura, numeroFactura: 'FAC-2026-HACK' }
  };
  const checkTamperedNum = await verifyFiscalRecordHash(tamperedNum);
  assert.strictEqual(checkTamperedNum.valid, false);

  // 9.3 Alterar fecha expedición
  const tamperedFecha: FiscalRecord = {
    ...record1,
    factura: { ...record1.factura, fechaExpedicion: '2026-01-01' }
  };
  assert.strictEqual((await verifyFiscalRecordHash(tamperedFecha)).valid, false);

  // 9.4 Alterar cuota
  const tamperedCuota: FiscalRecord = {
    ...record1,
    desgloseTributario: { ...record1.desgloseTributario, cuotaTotal: 999 }
  };
  assert.strictEqual((await verifyFiscalRecordHash(tamperedCuota)).valid, false);

  // 9.5 Alterar importe total
  const tamperedTotal: FiscalRecord = {
    ...record1,
    desgloseTributario: { ...record1.desgloseTributario, importeTotal: 5000 }
  };
  assert.strictEqual((await verifyFiscalRecordHash(tamperedTotal)).valid, false);

  // 9.6 Alterar timestamp de generación
  const tamperedTimestamp: FiscalRecord = {
    ...record1,
    fechaHoraHusoGenRegistro: '2026-09-25T11:11:11+02:00'
  };
  assert.strictEqual((await verifyFiscalRecordHash(tamperedTimestamp)).valid, false);

  // 9.7 Alterar huella anterior en record2
  const tamperedPrevHuella: FiscalRecord = {
    ...record2,
    encadenamiento: {
      primerRegistro: false,
      registroAnterior: {
        idEmisorFactura: configA.nifEmisor,
        numSerieFactura: record1.factura.numeroFactura,
        fechaExpedicionFactura: record1.factura.fechaExpedicion,
        huella: '0000000000000000000000000000000000000000000000000000000000000000'
      }
    }
  };
  assert.strictEqual((await verifyFiscalRecordHash(tamperedPrevHuella)).valid, false);
  logTest(9, 'Detección exhaustiva de alteraciones en NIF, número, fecha, importes, timestamps y huella anterior');

  // --------------------------------------------------------------------------
  // TEST 10: Verificación de cadena completa y detección de rupturas (verifyFiscalRecordChain)
  // --------------------------------------------------------------------------
  const validChain = [record1, record2, record3];
  const chainCheck = await verifyFiscalRecordChain(validChain);
  assert.strictEqual(chainCheck.valid, true);
  assert.strictEqual(chainCheck.totalRecords, 3);

  // Ruptura por alteración de registro intermedio
  const brokenChainRecord = [record1, tamperedCuota, record3];
  const break1 = await verifyFiscalRecordChain(brokenChainRecord);
  assert.strictEqual(break1.valid, false);
  assert.strictEqual(break1.brokenAtIndex, 1);

  // Ruptura por eliminación de registro intermedio (R1 -> R3)
  const missingMiddleChain = [record1, record3];
  const break2 = await verifyFiscalRecordChain(missingMiddleChain);
  assert.strictEqual(break2.valid, false);
  assert.strictEqual(break2.brokenAtIndex, 1);
  assert.ok(break2.reason?.includes('no coincide con la huella del registro'));

  // Ruptura por inversión de orden cronológico
  const reversedChain = [record2, record1];
  const break3 = await verifyFiscalRecordChain(reversedChain);
  assert.strictEqual(break3.valid, false);
  logTest(10, 'verifyFiscalRecordChain valida cadenas íntegras y detecta con precisión cualquier salto o mutación');

  // --------------------------------------------------------------------------
  // TEST 11: Aislamiento estricto de cadenas por obligadoTributarioId
  // --------------------------------------------------------------------------
  resetFiscalQueue();
  const facturaDraftEmpresaB: Factura = {
    ...facturaDraft1,
    id: 'inv-emp-b-1',
    numeroFactura: 'FAC-B-001'
  };

  const emissionB1 = await emitFiscalInvoice({
    invoiceDraft: facturaDraftEmpresaB,
    fiscalConfig: configB,
    persistRecordFn: async () => true
  });
  const recordB1 = emissionB1.fiscalRecord;

  // Intentar validar una cadena cruzada [record1 (Empresa A), recordB1 (Empresa B)]
  const crossChain = [record1, recordB1];
  const crossCheck = await verifyFiscalRecordChain(crossChain);
  assert.strictEqual(crossCheck.valid, false);
  assert.strictEqual(crossCheck.brokenAtIndex, 1);
  assert.ok(crossCheck.reason?.includes('Obligado tributario'));

  // Comprobar que validatePreviousRecordRequirement rechaza registros de distinto obligado
  await assert.rejects(
    async () => await validatePreviousRecordRequirement(formatFechaHoraHusoGenRegistro(), configA.nifEmisor, recordB1),
    /Ruptura de aislamiento fiscal/
  );
  logTest(11, 'Aislamiento estricto de cadenas por obligadoTributarioId');

  // --------------------------------------------------------------------------
  // TEST 12: Cadena intercalada con Registro de Alta y Registro de Anulación
  // --------------------------------------------------------------------------
  resetFiscalQueue();
  // 1. Alta 1
  const emAlta1 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft1,
    fiscalConfig: configA,
    previousRecordRef: null,
    persistRecordFn: async () => true
  });
  const recAlta1 = emAlta1.fiscalRecord;

  // 2. Alta 2
  const emAlta2 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft2,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });
  const recAlta2 = emAlta2.fiscalRecord;

  // 3. Anulación de la Factura 2 (debe encadenar con Alta 2 en la misma cadena del obligado)
  const emAnul2 = await emitFiscalAnulacion({
    obligadoTributarioId: configA.nifEmisor,
    fiscalConfig: configA,
    facturaAnulada: {
      numeroFactura: facturaDraft2.numeroFactura,
      fechaExpedicion: facturaDraft2.fecha,
      motivoAnulacion: 'Error en cantidades facturadas por duplicidad'
    },
    persistRecordFn: async () => true
  });
  const recAnul2 = emAnul2.fiscalRecord;

  assert.strictEqual(recAnul2.tipoRegistro, 'anulacion');
  assert.strictEqual(recAnul2.encadenamiento.registroAnterior?.huella, recAlta2.huella.hash);
  assert.strictEqual((await verifyFiscalRecordHash(recAnul2)).valid, true);

  // 4. Alta 3 (debe encadenar con Anulación 2)
  const emAlta3 = await emitFiscalInvoice({
    invoiceDraft: facturaDraft3,
    fiscalConfig: configA,
    persistRecordFn: async () => true
  });
  const recAlta3 = emAlta3.fiscalRecord;

  assert.strictEqual(recAlta3.encadenamiento.registroAnterior?.huella, recAnul2.huella.hash);

  // Validar toda la cadena mixta [Alta 1 -> Alta 2 -> Anulación 2 -> Alta 3]
  const mixedChain = [recAlta1, recAlta2, recAnul2, recAlta3];
  const mixedCheck = await verifyFiscalRecordChain(mixedChain);
  assert.strictEqual(mixedCheck.valid, true);
  assert.strictEqual(mixedCheck.totalRecords, 4);
  logTest(12, 'Cadena única unificada intercalando registros de Alta y Anulación verificada al 100%');

  // --------------------------------------------------------------------------
  // TEST 13: Vectores independientes externos documentados
  // --------------------------------------------------------------------------
  // Vector 1 (Alta Primer Registro)
  // Fuente: Calculado externamente en shell Linux mediante 'echo -n <canonical> | sha256sum | tr a-z A-Z'
  const v1Canonical = 'IDEmisorFactura=B12345678&NumSerieFactura=FAC-TEST-001&FechaExpedicionFactura=15-10-2026&TipoFactura=F1&CuotaTotal=42.00&ImporteTotal=1042.00&Huella=&FechaHoraHusoGenRegistro=2026-10-15T09:30:00+02:00';
  const v1ExpectedHash = '251FA916EF4E233CBFAF388D94570E6FFAFD9528AF12A8E51DAD839E60E07599';
  const v1Calculated = await calculateSha256(v1Canonical);
  assert.strictEqual(v1Calculated, v1ExpectedHash, 'Vector 1 debe coincidir exactamente con el hash externo precalculado');

  const v1ServiceResult = await calculateAltaHash({
    nifEmisor: 'B12345678',
    numSerieFactura: 'FAC-TEST-001',
    fechaExpedicion: '2026-10-15',
    tipoFactura: 'F1',
    cuotaTotal: 42,
    importeTotal: 1042,
    huellaAnterior: '',
    fechaHoraHusoGenRegistro: '2026-10-15T09:30:00+02:00'
  });
  assert.strictEqual(v1ServiceResult.hash, v1ExpectedHash);
  assert.strictEqual(v1ServiceResult.canonicalString, v1Canonical);

  // Vector 2 (Anulación encadenada a Vector 1)
  // Fuente: Calculado externamente en shell Linux mediante 'echo -n <canonical> | sha256sum | tr a-z A-Z'
  const v2Canonical = `IDEmisorFactura=B12345678&NumSerieFactura=FAC-TEST-001&FechaExpedicionFactura=15-10-2026&Huella=${v1ExpectedHash}&FechaHoraHusoGenRegistro=2026-10-15T09:35:00+02:00`;
  const v2ExpectedHash = '11B54E7E2CD73C7F33EE8822544ED4F0ADD714FB30851DF18265DC67DFC6C6AE';
  const v2Calculated = await calculateSha256(v2Canonical);
  assert.strictEqual(v2Calculated, v2ExpectedHash, 'Vector 2 debe coincidir exactamente con el hash externo precalculado');

  const v2ServiceResult = await calculateAnulacionHash({
    nifEmisor: 'B12345678',
    numSerieFactura: 'FAC-TEST-001',
    fechaExpedicion: '2026-10-15',
    huellaAnterior: v1ExpectedHash,
    fechaHoraHusoGenRegistro: '2026-10-15T09:35:00+02:00'
  });
  assert.strictEqual(v2ServiceResult.hash, v2ExpectedHash);
  assert.strictEqual(v2ServiceResult.canonicalString, v2Canonical);

  // Vector 3 (Alta posterior encadenada a Vector 1)
  // Fuente: Calculado externamente en shell Linux mediante 'echo -n <canonical> | sha256sum | tr a-z A-Z'
  const v3Canonical = `IDEmisorFactura=B12345678&NumSerieFactura=FAC-TEST-002&FechaExpedicionFactura=15-10-2026&TipoFactura=F1&CuotaTotal=10.50&ImporteTotal=110.50&Huella=${v1ExpectedHash}&FechaHoraHusoGenRegistro=2026-10-15T09:40:00+02:00`;
  const v3ExpectedHash = '3B435C45BCBBE749B3955C0B6FE54295D547EC7175638B8F5EE56D49DAA32D28';
  const v3Calculated = await calculateSha256(v3Canonical);
  assert.strictEqual(v3Calculated, v3ExpectedHash, 'Vector 3 debe coincidir exactamente con el hash externo precalculado');
  logTest(13, 'Vectores independientes externos precalculados (Alta inicial, Anulación y Alta consecutiva)');

  // --------------------------------------------------------------------------
  // TEST 14: Compatibilidad plena con el modelo de datos FiscalRecord
  // --------------------------------------------------------------------------
  assert.ok(recAlta1.id.startsWith('frec-'));
  assert.strictEqual(recAlta1.huella.algoritmo, 'SHA-256');
  assert.strictEqual(recAlta1.huella.especificacionVersion, 'HAC/1177/2024');
  assert.ok(recAlta1.huella.cadenaTextoCanonico.length > 0);
  assert.strictEqual(recAlta1.xmlOficial, undefined); // Ausente hasta Fase 3
  assert.notStrictEqual(recAlta1.huella.hash, 'PENDING_FASE_2_HASH');
  assert.ok(!('hashActual' in (recAlta1 as any)), 'FiscalRecord no duplica hashActual fuera de huella.hash');
  assert.ok(!('hashAnterior' in (recAlta1 as any)), 'FiscalRecord no duplica hashAnterior fuera de encadenamiento');
  logTest(14, 'Compatibilidad con modelo FiscalRecord sin campos duplicados ni placeholders');

  // --------------------------------------------------------------------------
  // TEST 15: Auditoría Requisito 14 - Detección de corrupción en el registro anterior antes de emitir
  // --------------------------------------------------------------------------
  const corruptedPredecessor: FiscalRecord = {
    ...record1,
    huella: {
      ...record1.huella,
      hash: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
    }
  };

  await assert.rejects(
    async () => {
      await emitFiscalInvoice({
        invoiceDraft: {
          ...facturaDraft1,
          id: 'inv-fail-corrupt',
          numeroFactura: 'FAC-2026-9999'
        },
        fiscalConfig: configA,
        previousRecordRef: corruptedPredecessor,
        persistRecordFn: async () => true
      });
    },
    /Corrupción criptográfica en el último registro/
  );
  logTest(15, 'Comprobación de integridad previa: rechazo tajante de emisión si el registro predecesor está corrupto');

  console.log('\n================================================================');
  console.log('  RESUMEN FASE 2.1: 15/15 TESTS COMPLETADOS CON ÉXITO!');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n[FATAL ERROR EN SUITE DE TESTS FASE 2.1]:', err);
  process.exit(1);
});
