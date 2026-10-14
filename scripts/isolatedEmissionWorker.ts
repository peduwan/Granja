/**
 * WORKER DE EMISIÓN FISCAL EN PROCESO DE SISTEMA OPERATIVO AISLADO
 *
 * Se ejecuta como proceso hijo completamente independiente (sin memoria compartida,
 * sin caché de módulos ni variables en heap compartidas) para demostrar la resiliencia
 * distribuida, la exclusión mutua OCC y la idempotencia entre procesos del SO.
 */

import { emitFiscalInvoice } from '../src/fiscal/emissionService';
import { CloudDistributedChainCoordinator } from '../src/fiscal/cloudDistributedChainCoordinator';
import { createDefaultFiscalConfiguration } from '../src/fiscal/modelTransformers';
import { Factura } from '../src/types';

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
      args[key] = val;
    }
  }
  return args;
}

function buildDummyInvoice(id: string, obligadoNif: string, numFactura: string): Factura {
  return {
    id: `${obligadoNif}-${id}`,
    numeroFactura: numFactura,
    fecha: '2026-03-20',
    clienteId: 'cli-worker-01',
    clienteNombre: 'Cliente Proceso Aislado S.L.',
    clienteCif: 'B99999999',
    clienteDireccion: 'Calle Mayor 1',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'F1',
    esRectificativa: false,
    lineas: [
      {
        id: 'lin-w1',
        loteEnvasadoId: 'lot-w1',
        codigoLoteEnvasado: 'L-WORKER',
        formatoId: 'fmt-w1',
        nombreFormato: 'Docena Huevos',
        cantidadEstuches: 5,
        precioUnitario: 3.0,
        subtotal: 15.0,
        fechaConsumoPreferente: '2026-04-20',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 15.0,
      porcentajeIva: 4,
      cuotaIva: 0.6,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 15.6
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-03-20T10:00:00Z'
  };
}

function buildDummyRectificativa(originalFac: Factura, idSuffix: string, obligadoNif: string): Factura {
  return {
    id: `rect-worker-${obligadoNif}-${idSuffix}`,
    numeroFactura: 'AUTO',
    fecha: '2026-03-21',
    clienteId: originalFac.clienteId,
    clienteNombre: originalFac.clienteNombre,
    clienteCif: originalFac.clienteCif,
    clienteDireccion: originalFac.clienteDireccion,
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    tipoFactura: 'R1',
    esRectificativa: true,
    facturasRectificadas: [
      {
        idEmisorFactura: obligadoNif,
        numeroFactura: originalFac.numeroFactura,
        fechaExpedicion: originalFac.fecha
      }
    ],
    motivoRectificativa: '01',
    tipoRectificativa: 'I',
    lineas: [
      {
        id: 'lin-rw1',
        loteEnvasadoId: 'lot-w1',
        codigoLoteEnvasado: 'L-WORKER',
        formatoId: 'fmt-w1',
        nombreFormato: 'Docena Huevos Rectificada',
        cantidadEstuches: -5,
        precioUnitario: 3.0,
        subtotal: -15.0,
        fechaConsumoPreferente: '2026-04-20',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: -15.0,
      porcentajeIva: 4,
      cuotaIva: -0.6,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: -15.6
    },
    formaPago: 'transferencia',
    estadoPago: 'pendiente',
    esVentaDirecta: true,
    creadoEn: '2026-03-21T10:00:00Z'
  };
}

async function main() {
  const args = parseArgs();
  const mode = args.mode;
  const obligado = args.obligado || 'B12345678';
  const opKey = args.opKey || 'OP-CROSS-DEFAULT';

  const fiscalConfig = createDefaultFiscalConfiguration({
    nif: obligado,
    nombreRazon: 'Granja Avícola Proceso S.L.',
    modalidad: 'VERI_FACTU'
  });

  const baseInvoiceDraft = buildDummyInvoice(`fac-base-${opKey}`, obligado, `FAC-BASE-${opKey}`);

  if (mode === 'crash_after_reservation') {
    // 1. Emitir primero la factura base para que exista en la cadena de Firestore
    await emitFiscalInvoice({
      invoiceDraft: baseInvoiceDraft,
      fiscalConfig,
      _simulateIndependentCloudRunInstance: true
    });

    // 2. Reservar atómicamente el número rectificativo en la autoridad compartida para la rectificativa
    const reservedNum = await CloudDistributedChainCoordinator.reserveNextRectificativaNumberForOperation({
      operationKey: opKey,
      obligadoId: obligado,
      invoiceId: `rect-worker-${opKey}`,
      fechaIsoOrAeat: '2026-03-21'
    });

    // 3. Escribir en stdout y crashear abruptamente con exit 42
    process.stdout.write(JSON.stringify({ status: 'RESERVED_CRASHING', reservedNum }) + '\n');
    process.exit(42);
  }

  if (mode === 'emit_rectificativa') {
    // Emitir factura original primero si no existe
    await emitFiscalInvoice({
      invoiceDraft: baseInvoiceDraft,
      fiscalConfig,
      _simulateIndependentCloudRunInstance: true
    });

    const rectDraft = buildDummyRectificativa(baseInvoiceDraft, opKey, obligado);
    const resRect = await emitFiscalInvoice({
      invoiceDraft: rectDraft,
      operationKey: opKey,
      fiscalConfig,
      _simulateIndependentCloudRunInstance: true
    });

    process.stdout.write(
      JSON.stringify({
        status: 'EMITTED_SUCCESS',
        numeroFactura: resRect.invoice.numeroFactura,
        fiscalRecordId: resRect.fiscalRecord.id,
        huellaHash: resRect.fiscalRecord.huella.hash
      }) + '\n'
    );
    process.exit(0);
  }

  if (mode === 'retry_recovery') {
    const rectDraft = buildDummyRectificativa(baseInvoiceDraft, opKey, obligado);

    const resRect = await emitFiscalInvoice({
      invoiceDraft: rectDraft,
      operationKey: opKey,
      fiscalConfig,
      _simulateIndependentCloudRunInstance: true
    });

    process.stdout.write(
      JSON.stringify({
        status: 'RECOVERED_SUCCESS',
        numeroFactura: resRect.invoice.numeroFactura,
        fiscalRecordId: resRect.fiscalRecord.id,
        huellaHash: resRect.fiscalRecord.huella.hash
      }) + '\n'
    );
    process.exit(0);
  }

  process.stderr.write(`Modo desconocido: ${mode}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`ERROR EN WORKER AISLADO: ${err.stack || err.message}\n`);
  process.exit(1);
});
