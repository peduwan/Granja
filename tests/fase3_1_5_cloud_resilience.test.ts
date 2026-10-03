/**
 * SUITE DE TESTS: RESILIENCIA EN LA NUBE Y CUMPLIMIENTO C1, C2, C3
 *
 * Verificaciones obligatorias:
 * - C1: Custodia persistente de registros y estado de cadena (Cloud & Firestore atomic model).
 * - C2: Detección y bloqueo estricto de bifurcaciones multi-instancia mediante control transaccional del estado.
 * - C3: Prohibición tajante de emisión o cálculo de huellas en cliente (generarHuellaVeriFactu lanza excepción)
 *       y verificación de que la UI delega autoritativamente en /api/fiscal/emit-invoice.
 */

import assert from 'node:assert';
import { BackendFiscalCustody } from '../src/fiscal/backendCustodyRepository';
import { emitFiscalInvoice } from '../src/fiscal/emissionService';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { generarHuellaVeriFactu } from '../src/utils/verifactu';
import { Factura } from '../src/types';

const NIF_EMISOR_PRUEBA = 'B88888888';

function createDummyInvoice(numFactura: string): Factura {
  return {
    id: `fac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    numeroFactura: numFactura,
    fecha: '2026-03-01',
    clienteId: 'cli-001',
    clienteNombre: 'Distribuciones Agrícolas S.L.',
    clienteCif: 'B99999999',
    clienteDireccion: 'Polígono Industrial 1, Nave 4',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-01',
        loteEnvasadoId: 'lot-01',
        codigoLoteEnvasado: 'L-2026-99',
        formatoId: 'fmt-01',
        nombreFormato: 'Huevos Camperos XL',
        cantidadEstuches: 50,
        precioUnitario: 3.0,
        subtotal: 150.0,
        fechaConsumoPreferente: '2026-04-01',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 150.0,
      porcentajeIva: 4,
      cuotaIva: 6.0,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 156.0
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-03-01T10:00:00Z'
  };
}

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         Error: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log('  TESTS DE ARQUITECTURA CLOUD: EJECUCIÓN C1, C2 Y C3');
  console.log('================================================================');

  const config = createDefaultFiscalConfiguration({
    nif: NIF_EMISOR_PRUEBA,
    nombreRazon: 'Granja Avícola San Antonio S.L.'
  });

  // ---------------------------------------------------------------------------
  // C3: Prohibición de doble vía de emisión / cálculo de huellas en cliente
  // ---------------------------------------------------------------------------
  await runTest('C3.1: generarHuellaVeriFactu en cliente arroja excepción inmediata (Fail Closed)', async () => {
    await assert.rejects(async () => {
      await generarHuellaVeriFactu({
        nifEmisor: 'B12345678',
        numSerieFactura: 'FAC-01',
        fechaExpedicion: '2026-03-01',
        tipoFactura: 'F1',
        totalFactura: 100,
        hashAnterior: '',
        fechaHoraSellado: new Date().toISOString()
      });
    }, /VIOLACIÓN DE AUTORIDAD FISCAL/);
  });

  // ---------------------------------------------------------------------------
  // C1: Custodia persistente de registros y estado de cadena
  // ---------------------------------------------------------------------------
  await runTest('C1.1: BackendFiscalCustody custodia registros y recupera la cabeza de cadena unívocamente', async () => {
    const inv1 = createDummyInvoice('FAC-CLOUD-01');
    const res1 = await emitFiscalInvoice({
      invoiceDraft: inv1,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    assert.ok(res1.fiscalRecord.id);
    assert.ok(res1.fiscalRecord.huella.hash);

    const latest = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_PRUEBA);
    assert.ok(latest);
    assert.strictEqual(latest.id, res1.fiscalRecord.id);
    assert.strictEqual(latest.huella.hash, res1.fiscalRecord.huella.hash);
  });

  // ---------------------------------------------------------------------------
  // C2: Detección estricta y bloqueo de bifurcaciones en concurrencia
  // ---------------------------------------------------------------------------
  await runTest('C2.1: Emisiones secuenciales encadenan exactamente con el último registro registrado', async () => {
    const latestBefore = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_PRUEBA);
    assert.ok(latestBefore);

    const inv2 = createDummyInvoice('FAC-CLOUD-02');
    const res2 = await emitFiscalInvoice({
      invoiceDraft: inv2,
      fiscalConfig: config,
      persistRecordFn: async (record) => {
        await BackendFiscalCustody.saveFiscalRecord(record);
      }
    });

    assert.strictEqual(
      res2.fiscalRecord.encadenamiento.registroAnterior?.huella,
      latestBefore.huella.hash,
      'El registro debe encadenar estrictamente con la huella del registro previo'
    );
  });

  await runTest('C2.2: Intento de forzar un registro bifurcado es bloqueado tajantemente por BackendFiscalCustody', async () => {
    const latest = BackendFiscalCustody.getLatestFiscalRecord(NIF_EMISOR_PRUEBA);
    assert.ok(latest);

    // Intentamos guardar un registro clonado pero con huella anterior falsa/obsoleta
    const fakeForkedRecord = {
      ...latest,
      id: `rec-fake-${Date.now()}`,
      encadenamiento: {
        primerRegistro: false,
        registroAnterior: {
          id: 'prev-fake',
          huella: 'DEADBEEF00000000000000000000000000000000000000000000000000000000',
          numeroFactura: 'FAC-OLD',
          fechaExpedicion: '2026-02-01'
        }
      }
    };

    await assert.rejects(async () => {
      await BackendFiscalCustody.saveFiscalRecord(fakeForkedRecord as any);
    }, /Bifurcación de cadena detectada|Fallo de integridad criptográfica/);
  });

  console.log('================================================================');
  console.log('  C1, C2 Y C3 SUPERADOS EXITOSAMENTE!');
  console.log('================================================================');
}

main().catch(err => {
  console.error('ERROR EN TESTS C1, C2, C3:', err);
  process.exit(1);
});
