/**
 * SERVICIO DE MIGRACIÓN Y SINCRONIZACIÓN DE REGISTROS FISCALES A FIRESTORE (A4)
 *
 * Cumplimiento con:
 * - A4: Rutina al arranque que inspecciona data/fiscal_records.json y sincroniza
 *   registros pendientes en Firestore antes de abrir el puerto HTTP.
 * - Garantía Fail-Closed: si estamos en producción y Firestore es inaccesible,
 *   la inicialización aborta impidiendo servir tráfico sin custodia en la nube.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FiscalRecord } from './types';
import { CloudDistributedChainCoordinator, getCoordinatorMode } from './cloudDistributedChainCoordinator';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'fiscal_records.json');

export interface MigrationSummary {
  inspected: number;
  migrated: number;
  alreadySynced: number;
  mode: string;
}

export async function migratePendingLocalRecordsToFirestore(): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    inspected: 0,
    migrated: 0,
    alreadySynced: 0,
    mode: 'unknown'
  };

  if (!fs.existsSync(RECORDS_FILE)) {
    return summary;
  }

  let localRecords: FiscalRecord[] = [];
  try {
    const raw = fs.readFileSync(RECORDS_FILE, 'utf-8');
    localRecords = JSON.parse(raw);
  } catch (err: any) {
    console.error('[MIGRATION] Error leyendo data/fiscal_records.json:', err.message);
    return summary;
  }

  summary.inspected = localRecords.length;
  if (localRecords.length === 0) {
    return summary;
  }

  let mode = 'simulator';
  try {
    mode = getCoordinatorMode();
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[MIGRATION FATAL] No se pudo determinar el modo del coordinador en producción: ${err.message}`);
    }
  }
  summary.mode = mode;

  console.log(`[MIGRATION] Inspeccionando ${localRecords.length} registros locales en modo '${mode}'...`);

  // Ordenar cronológicamente por número de factura y timestamp para preservar encadenamiento
  const sortedRecords = [...localRecords].sort((a, b) => {
    const timeA = new Date(a.fechaHoraHusoGenRegistro || a.creadoEn).getTime();
    const timeB = new Date(b.fechaHoraHusoGenRegistro || b.creadoEn).getTime();
    return timeA - timeB;
  });

  for (const record of sortedRecords) {
    try {
      // Comprobar si ya existe en la custodia de nube
      const existing = await CloudDistributedChainCoordinator.getRecordById(record.id);
      if (existing) {
        summary.alreadySynced++;
        continue;
      }

      // Si no existe, cometer el registro a Firestore
      await CloudDistributedChainCoordinator.commitRecord(record);
      summary.migrated++;
    } catch (err: any) {
      console.warn(`[MIGRATION] Registro '${record.id}' (${record.factura?.numeroFactura}):`, err.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `[MIGRATION FAIL-CLOSED] Fallo al migrar registro ${record.id} a Firestore en producción: ${err.message}`
        );
      }
    }
  }

  console.log(
    `[MIGRATION] Completado: ${summary.inspected} inspeccionados, ${summary.migrated} migrados, ${summary.alreadySynced} ya sincronizados.`
  );

  return summary;
}
