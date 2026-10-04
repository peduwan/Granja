/**
 * SUITE DE TESTS - FASE 2.2: GENERADOR Y VALIDADOR XML OFICIAL AEAT (VERI*FACTU)
 *
 * Normativa:
 * - Ley 11/2021 | RD 1007/2023 | Orden HAC/1177/2024
 * - Esquemas oficiales AEAT: SuministroLR.xsd (v1.0) y SuministroInformacion.xsd (v1.0)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.FISCAL_COORDINATOR_MODE) {
  process.env.FISCAL_COORDINATOR_MODE = 'simulator';
}
import {
  buildAeatVerifactuXml,
  buildRegistroAltaXml,
  buildRegistroAnulacionXml,
  buildCabeceraXml,
  validateAeatVerifactuXml,
  escapeXml,
  AEAT_NAMESPACES
} from '../src/fiscal/aeatVerifactuXmlBuilder';
import { validateXmlAgainstOfficialXsd } from '../src/fiscal/aeatXsdValidatorNode';
import {
  createFiscalRecordFromInvoice,
  createFiscalAnulacionRecord,
  createDefaultFiscalConfiguration
} from '../src/fiscal/modelTransformers';
import { emitFiscalInvoice, resetFiscalQueue } from '../src/fiscal/emissionService';
import { Factura, FiscalRecord, FiscalRecordRef } from '../src/types';

console.log('================================================================');
console.log('  EJECUTANDO SUITE DE TESTS - FASE 2.2: XML OFICIAL AEAT VERI*FACTU');
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
    if (err.stack) {
      console.error(err.stack);
    }
    throw err;
  }
}

function createDummyInvoice(overrides?: Partial<Factura>): Factura {
  return {
    id: 'inv-test-xml-001',
    numeroFactura: 'FAC-2026-0001',
    fecha: '2026-01-02',
    clienteId: 'cli-001',
    clienteNombre: 'Supermercados del Campo S.A.',
    clienteCif: 'A12345674',
    clienteDireccion: 'Calle Mayor 10, Toledo',
    clienteRecargoEquivalencia: false,
    albaranesAsociados: [],
    lineas: [
      {
        id: 'lin-001',
        loteEnvasadoId: 'lote-env-001',
        formatoId: 'form-001',
        fechaConsumoPreferente: '2026-01-30',
        nombreFormato: 'Huevos Camperos M Docena',
        cantidadEstuches: 100,
        precioUnitario: 2.50,
        subtotal: 250.00,
        codigoLoteEnvasado: 'L-ENV-2026-01',
        trazabilidadPuesta: []
      }
    ],
    totales: {
      baseImponible: 250.00,
      porcentajeIva: 4.0,
      cuotaIva: 10.00,
      aplicaRecargo: false,
      porcentajeRecargo: 0,
      cuotaRecargo: 0,
      totalDocumento: 260.00
    },
    tipoFactura: 'F1',
    estadoPago: 'pendiente',
    formaPago: 'transferencia',
    esVentaDirecta: false,
    creadoEn: '2026-01-02T10:00:00Z',
    hashActual: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90',
    ...overrides
  };
}

async function main() {
  const config = createDefaultFiscalConfiguration({
    nif: 'B99999999',
    nombreRazon: 'Granja Avícola El Madroño S.L.',
    modalidad: 'VERI_FACTU'
  });

  // -----------------------------------------------------------------------------
  // Test 1: Generación de XML de Alta con estructura oficial completa
  // -----------------------------------------------------------------------------
  await runTest('Generación de XML de Alta con estructura oficial completa sfLR:RegFactuSistemaFacturacion', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Debe comenzar con la declaración XML');
    assert(xml.includes('<sfLR:RegFactuSistemaFacturacion'), 'Debe contener el elemento raíz sfLR:RegFactuSistemaFacturacion');
    assert(xml.includes(`xmlns:sfLR="${AEAT_NAMESPACES.sfLR}"`), 'Debe incluir el namespace sfLR');
    assert(xml.includes(`xmlns:sf="${AEAT_NAMESPACES.sf}"`), 'Debe incluir el namespace sf');
    assert(xml.includes('<sfLR:Cabecera>'), 'Debe contener Cabecera');
    assert(xml.includes('<sf:ObligadoEmision>'), 'Debe contener ObligadoEmision');
    assert(xml.includes('<sf:NIF>B99999999</sf:NIF>'), 'Debe contener el NIF del emisor en Cabecera');
    assert(xml.includes('<sf:RemisionVoluntaria>'), 'Debe contener RemisionVoluntaria en VERI_FACTU');
    assert(xml.includes('<sfLR:RegistroFactura>'), 'Debe contener RegistroFactura');
    assert(xml.includes('<sf:RegistroAlta>'), 'Debe contener RegistroAlta');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true, `El XML debe ser válido estructuralmente. Errores: ${validation.errors.join(', ')}`);
  });

  // -----------------------------------------------------------------------------
  // Test 2: Orden secuencial estricto de xs:sequence en RegistroAlta
  // -----------------------------------------------------------------------------
  await runTest('Orden secuencial estricto de xs:sequence en RegistroAlta según el XSD', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '1111222233334444555566667777888899990000AAAABBBBCCCCDDDDEEEEFFFF',
      fechaHoraSellado: '2026-01-02T11:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    // Índices de posición en el texto para comprobar el orden secuencial exigido por XSD
    const idxVersion = xml.indexOf('<sf:IDVersion>');
    const idxFactura = xml.indexOf('<sf:IDFactura>');
    const idxNombreRazon = xml.indexOf('<sf:NombreRazonEmisor>');
    const idxTipoFactura = xml.indexOf('<sf:TipoFactura>');
    const idxDescripcion = xml.indexOf('<sf:DescripcionOperacion>');
    const idxDestinatarios = xml.indexOf('<sf:Destinatarios>');
    const idxDesglose = xml.indexOf('<sf:Desglose>');
    const idxCuotaTotal = xml.indexOf('<sf:CuotaTotal>');
    const idxImporteTotal = xml.indexOf('<sf:ImporteTotal>');
    const idxEncadenamiento = xml.indexOf('<sf:Encadenamiento>');
    const idxSistema = xml.indexOf('<sf:SistemaInformatico>');
    const idxFechaHora = xml.indexOf('<sf:FechaHoraHusoGenRegistro>');
    const idxTipoHuella = xml.indexOf('<sf:TipoHuella>');
    const idxHuella = xml.indexOf('<sf:Huella>');

    assert(idxVersion < idxFactura, 'IDVersion debe ir antes de IDFactura');
    assert(idxFactura < idxNombreRazon, 'IDFactura debe ir antes de NombreRazonEmisor');
    assert(idxNombreRazon < idxTipoFactura, 'NombreRazonEmisor debe ir antes de TipoFactura');
    assert(idxTipoFactura < idxDescripcion, 'TipoFactura debe ir antes de DescripcionOperacion');
    assert(idxDescripcion < idxDestinatarios, 'DescripcionOperacion debe ir antes de Destinatarios');
    assert(idxDestinatarios < idxDesglose, 'Destinatarios debe ir antes de Desglose');
    assert(idxDesglose < idxCuotaTotal, 'Desglose debe ir antes de CuotaTotal');
    assert(idxCuotaTotal < idxImporteTotal, 'CuotaTotal debe ir antes de ImporteTotal');
    assert(idxImporteTotal < idxEncadenamiento, 'ImporteTotal debe ir antes de Encadenamiento');
    assert(idxEncadenamiento < idxSistema, 'Encadenamiento debe ir antes de SistemaInformatico');
    assert(idxSistema < idxFechaHora, 'SistemaInformatico debe ir antes de FechaHoraHusoGenRegistro');
    assert(idxFechaHora < idxTipoHuella, 'FechaHoraHusoGenRegistro debe ir antes de TipoHuella');
    assert(idxTipoHuella < idxHuella, 'TipoHuella debe ir antes de Huella');
  });

  // -----------------------------------------------------------------------------
  // Test 3: Generación de XML para el primer registro de la cadena
  // -----------------------------------------------------------------------------
  await runTest('Generación de XML para el primer registro de la cadena (<PrimerRegistro>S)', () => {
    const invoice = createDummyInvoice({ numeroFactura: 'FAC-2026-INIT' });
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '0000111122223333444455556666777788889999AAAABBBBCCCCDDDDEEEEFFFF',
      fechaHoraSellado: '2026-01-02T12:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:Encadenamiento>'), 'Debe contener el bloque Encadenamiento');
    assert(xml.includes('<sf:PrimerRegistro>S</sf:PrimerRegistro>'), 'Debe contener PrimerRegistro con valor S');
    assert(!xml.includes('<sf:RegistroAnterior>'), 'No debe contener RegistroAnterior');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true);
  });

  // -----------------------------------------------------------------------------
  // Test 4: Generación de XML con encadenamiento al registro anterior
  // -----------------------------------------------------------------------------
  await runTest('Generación de XML con encadenamiento al registro anterior (<RegistroAnterior>)', () => {
    const prevRef: FiscalRecordRef = {
      id: 'frec-001',
      obligadoTributarioId: 'B99999999',
      invoiceId: 'inv-001',
      numeroFactura: 'FAC-2026-0001',
      fechaExpedicion: '2026-01-02',
      huellaHash: '1111111111111111111111111111111111111111111111111111111111111111',
      creadoEn: '2026-01-02T10:00:00Z'
    };

    const invoice = createDummyInvoice({ numeroFactura: 'FAC-2026-0002', fecha: '2026-01-03' });
    const record = createFiscalRecordFromInvoice(invoice, config, prevRef, {
      hashActual: '2222222222222222222222222222222222222222222222222222222222222222',
      fechaHoraSellado: '2026-01-03T09:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:Encadenamiento>'), 'Debe contener el bloque Encadenamiento');
    assert(!xml.includes('<sf:PrimerRegistro>'), 'No debe contener PrimerRegistro');
    assert(xml.includes('<sf:RegistroAnterior>'), 'Debe contener RegistroAnterior');
    assert(xml.includes('<sf:IDEmisorFactura>B99999999</sf:IDEmisorFactura>'), 'Debe incluir el NIF anterior');
    assert(xml.includes('<sf:NumSerieFactura>FAC-2026-0001</sf:NumSerieFactura>'), 'Debe incluir el número anterior');
    assert(xml.includes('<sf:FechaExpedicionFactura>02-01-2026</sf:FechaExpedicionFactura>'), 'Fecha anterior en DD-MM-YYYY');
    assert(xml.includes('<sf:Huella>1111111111111111111111111111111111111111111111111111111111111111</sf:Huella>'), 'Huella anterior completa');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true);
  });

  // -----------------------------------------------------------------------------
  // Test 5: Generación de XML para Factura Rectificativa (R1)
  // -----------------------------------------------------------------------------
  await runTest('Generación de XML para Factura Rectificativa (R1, TipoRectificativa, FacturasRectificadas)', () => {
    const invoice = createDummyInvoice({
      numeroFactura: 'REC-2026-0001',
      tipoFactura: 'R1',
      esRectificativa: true,
      tipoRectificativa: 'por_diferencias',
      facturaRectificadaNumero: 'FAC-2026-0001',
      facturaRectificadaFecha: '2026-01-02',
      motivoRectificativa: 'Devolución de 10 docenas por rotura'
    });

    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '3333333333333333333333333333333333333333333333333333333333333333',
      fechaHoraSellado: '2026-01-04T10:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:TipoFactura>R1</sf:TipoFactura>'), 'TipoFactura debe ser R1');
    assert(xml.includes('<sf:TipoRectificativa>I</sf:TipoRectificativa>'), 'TipoRectificativa debe ser I (por diferencias/incremental)');
    assert(xml.includes('<sf:FacturasRectificadas>'), 'Debe contener bloque FacturasRectificadas');
    assert(xml.includes('<sf:IDFacturaRectificada>'), 'Debe contener IDFacturaRectificada');
    assert(xml.includes('<sf:NumSerieFactura>FAC-2026-0001</sf:NumSerieFactura>'), 'Número rectificado');
    assert(xml.includes('<sf:FechaExpedicionFactura>02-01-2026</sf:FechaExpedicionFactura>'), 'Fecha rectificada DD-MM-YYYY');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true);
  });

  // -----------------------------------------------------------------------------
  // Test 6: Generación de XML de Registro de Anulación (RegistroAnulacion)
  // -----------------------------------------------------------------------------
  await runTest('Generación de XML de Registro de Anulación (<sf:RegistroAnulacion>)', () => {
    const prevRef: FiscalRecordRef = {
      id: 'frec-001',
      obligadoTributarioId: 'B99999999',
      invoiceId: 'inv-001',
      numeroFactura: 'FAC-2026-0001',
      fechaExpedicion: '2026-01-02',
      huellaHash: '1111111111111111111111111111111111111111111111111111111111111111',
      creadoEn: '2026-01-02T10:00:00Z'
    };

    const anulacionRecord = createFiscalAnulacionRecord({
      obligadoTributarioId: 'B99999999',
      config,
      facturaAnulada: {
        numeroFactura: 'FAC-2026-0001',
        fechaExpedicion: '2026-01-02',
        motivoAnulacion: 'Error en identificación del cliente y tarifa aplicada'
      },
      previousRecord: prevRef,
      options: {
        hashActual: '4444444444444444444444444444444444444444444444444444444444444444',
        fechaHoraHusoGenRegistro: '2026-01-05T12:00:00+01:00'
      }
    });

    const xml = buildAeatVerifactuXml(anulacionRecord);

    assert(xml.includes('<sfLR:RegistroFactura>'), 'Debe contener RegistroFactura');
    assert(xml.includes('<sf:RegistroAnulacion>'), 'Debe contener RegistroAnulacion');
    assert(!xml.includes('<sf:RegistroAlta>'), 'No debe contener RegistroAlta');

    // Comprobar elementos específicos de anulación (IDFacturaExpedidaBajaType)
    assert(xml.includes('<sf:IDEmisorFacturaAnulada>B99999999</sf:IDEmisorFacturaAnulada>'), 'Debe contener IDEmisorFacturaAnulada');
    assert(xml.includes('<sf:NumSerieFacturaAnulada>FAC-2026-0001</sf:NumSerieFacturaAnulada>'), 'Debe contener NumSerieFacturaAnulada');
    assert(xml.includes('<sf:FechaExpedicionFacturaAnulada>02-01-2026</sf:FechaExpedicionFacturaAnulada>'), 'Debe contener FechaExpedicionFacturaAnulada en DD-MM-YYYY');

    // Encadenamiento
    assert(xml.includes('<sf:Encadenamiento>'), 'Debe contener Encadenamiento');
    assert(xml.includes('<sf:RegistroAnterior>'), 'Debe contener RegistroAnterior');

    // Huella
    assert(xml.includes('<sf:TipoHuella>01</sf:TipoHuella>'), 'TipoHuella 01');
    assert(xml.includes('<sf:Huella>4444444444444444444444444444444444444444444444444444444444444444</sf:Huella>'), 'Huella 64 hex');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true, `Errores de validación: ${validation.errors.join(', ')}`);
  });

  // -----------------------------------------------------------------------------
  // Test 7: Escapado riguroso de caracteres XML (&, <, >, ", ')
  // -----------------------------------------------------------------------------
  await runTest('Escapado riguroso de caracteres XML (&, <, >, ", \') en campos de texto', () => {
    const invoice = createDummyInvoice({
      clienteNombre: 'Avícola & Cía "La Granja" <Directo>\'',
      numeroFactura: 'F-2026/01 & "A"'
    });

    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '5555555555555555555555555555555555555555555555555555555555555555',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('&amp;'), 'Debe haber escapado & a &amp;');
    assert(xml.includes('&quot;'), 'Debe haber escapado " a &quot;');
    assert(xml.includes('&lt;Directo&gt;'), 'Debe haber escapado <Directo> a &lt;Directo&gt;');
    assert(xml.includes('&apos;'), 'Debe haber escapado \' a &apos;');
    assert(!xml.includes(' <Directo> '), 'No debe haber tags no declarados');

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true);
  });

  // -----------------------------------------------------------------------------
  // Test 8: Formato oficial de fechas DD-MM-YYYY en todos los campos de fecha
  // -----------------------------------------------------------------------------
  await runTest('Formato oficial de fechas DD-MM-YYYY en todos los campos de fecha de factura', () => {
    const invoice = createDummyInvoice({ fecha: '2026-01-02' });
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '6666666666666666666666666666666666666666666666666666666666666666',
      fechaHoraSellado: '2026-01-02T15:30:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    // Debe contener exactamente 02-01-2026 en FechaExpedicionFactura
    assert(xml.includes('<sf:FechaExpedicionFactura>02-01-2026</sf:FechaExpedicionFactura>'));
    // No debe contener 2026-01-02 en FechaExpedicionFactura
    assert(!xml.includes('<sf:FechaExpedicionFactura>2026-01-02</sf:FechaExpedicionFactura>'));
    // FechaHoraHusoGenRegistro en ISO 8601 con huso
    assert(xml.includes('<sf:FechaHoraHusoGenRegistro>2026-01-02T15:30:00+01:00</sf:FechaHoraHusoGenRegistro>'));
  });

  // -----------------------------------------------------------------------------
  // Test 9: Formato oficial de importes (12.2) con punto decimal y exactamente 2 decimales
  // -----------------------------------------------------------------------------
  await runTest('Formato oficial de importes (12.2) con punto decimal y exactamente 2 decimales', () => {
    const invoice = createDummyInvoice({
      lineas: [],
      totales: {
        baseImponible: 91.50,
        porcentajeIva: 4,
        cuotaIva: 3.66,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 95.16
      }
    });

    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '7777777777777777777777777777777777777777777777777777777777777777',
      fechaHoraSellado: '2026-01-02T16:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:BaseImponibleOimporteNoSujeto>91.50</sf:BaseImponibleOimporteNoSujeto>'));
    assert(xml.includes('<sf:CuotaRepercutida>3.66</sf:CuotaRepercutida>'));
    assert(xml.includes('<sf:CuotaTotal>3.66</sf:CuotaTotal>'));
    assert(xml.includes('<sf:ImporteTotal>95.16</sf:ImporteTotal>'));
    // Asegurar que no hay comas ni separadores de miles
    assert(!xml.includes('91,50'));
    assert(!xml.includes('95,16'));
  });

  // -----------------------------------------------------------------------------
  // Test 10: Bloque SistemaInformatico cumple rigurosamente con TextMax2Type y sus 9 campos
  // -----------------------------------------------------------------------------
  await runTest('Bloque SistemaInformatico cumple rigurosamente con TextMax2Type (<= 2 chars) y sus 9 campos', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '8888888888888888888888888888888888888888888888888888888888888888',
      fechaHoraSellado: '2026-01-02T17:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:NombreRazon>Gestión Avícola Software S.L.</sf:NombreRazon>'));
    assert(xml.includes('<sf:NIF>B99999999</sf:NIF>'));
    assert(xml.includes('<sf:NombreSistemaInformatico>Gestión Avícola SIF</sf:NombreSistemaInformatico>'));
    assert(xml.includes('<sf:IdSistemaInformatico>01</sf:IdSistemaInformatico>'), 'IdSistemaInformatico debe ser <= 2 caracteres');
    assert(xml.includes('<sf:Version>1.0.0</sf:Version>'));
    assert(xml.includes('<sf:NumeroInstalacion>INST-001</sf:NumeroInstalacion>'));
    assert(xml.includes('<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>'));
    assert(xml.includes('<sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT>'));
    assert(xml.includes('<sf:IndicadorMultiplesOT>N</sf:IndicadorMultiplesOT>'));
  });

  // -----------------------------------------------------------------------------
  // Test 11: Desglose tributario soporta múltiples tipos de IVA y Recargo de Equivalencia
  // -----------------------------------------------------------------------------
  await runTest('Desglose tributario soporta múltiples tipos de IVA y Recargo de Equivalencia', () => {
    const invoice: Factura = {
      ...createDummyInvoice({ numeroFactura: 'FAC-MULTI-IVA' }),
      clienteRecargoEquivalencia: true,
      lineas: [
        {
          id: 'lin-1',
          tipoHuevo: 'M',
          tipoVenta: 'estuche_12',
          nombreFormato: 'Huevos de mesa (IVA 4% + RE 0.5%)',
          cantidadEstuches: 10,
          unidadesSueltas: 0,
          precioUnitario: 10,
          subtotal: 100,
          codigoLoteEnvasado: 'L-1',
          trazabilidadPuesta: [],
          tipoIva: 4,
          tipoRecargo: 0.5
        } as any,
        {
          id: 'lin-2',
          tipoHuevo: 'L',
          tipoVenta: 'estuche_12',
          nombreFormato: 'Huevos elaborados pasteurizados (IVA 10% + RE 1.4%)',
          cantidadEstuches: 10,
          unidadesSueltas: 0,
          precioUnitario: 20,
          subtotal: 200,
          codigoLoteEnvasado: 'L-2',
          trazabilidadPuesta: [],
          tipoIva: 10,
          tipoRecargo: 1.4
        } as any
      ],
      totales: {
        baseImponible: 300,
        porcentajeIva: 4,
        cuotaIva: 24, // 4 + 20
        aplicaRecargo: true,
        porcentajeRecargo: 0.5,
        cuotaRecargo: 3.3, // 0.50 + 2.80
        totalDocumento: 327.30
      }
    };

    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '9999999999999999999999999999999999999999999999999999999999999999',
      fechaHoraSellado: '2026-01-02T18:00:00+01:00'
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes('<sf:TipoImpositivo>4.00</sf:TipoImpositivo>'));
    assert(xml.includes('<sf:TipoRecargoEquivalencia>0.50</sf:TipoRecargoEquivalencia>'));
    assert(xml.includes('<sf:TipoImpositivo>10.00</sf:TipoImpositivo>'));
    assert(xml.includes('<sf:TipoRecargoEquivalencia>1.40</sf:TipoRecargoEquivalencia>'));

    const validation = validateAeatVerifactuXml(xml);
    assert.strictEqual(validation.valid, true, `Errores: ${validation.errors.join(', ')}`);
  });

  // -----------------------------------------------------------------------------
  // Test 12: Generación por lotes (Batch) de múltiples registros en un único suministro
  // -----------------------------------------------------------------------------
  await runTest('Generación por lotes (Batch) de múltiples registros (Altas y Anulación) en un único XML', () => {
    const inv1 = createDummyInvoice({ numeroFactura: 'BATCH-001' });
    const rec1 = createFiscalRecordFromInvoice(inv1, config, null, {
      hashActual: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });

    const inv2 = createDummyInvoice({ numeroFactura: 'BATCH-002' });
    const rec2 = createFiscalRecordFromInvoice(inv2, config, rec1, {
      hashActual: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      fechaHoraSellado: '2026-01-02T10:05:00+01:00'
    });

    const recAnul = createFiscalAnulacionRecord({
      obligadoTributarioId: 'B99999999',
      config,
      facturaAnulada: {
        numeroFactura: 'BATCH-001',
        fechaExpedicion: '2026-01-02',
        motivoAnulacion: 'Error administrativo en emisión'
      },
      previousRecord: rec2,
      options: {
        hashActual: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        fechaHoraHusoGenRegistro: '2026-01-02T10:10:00+01:00'
      }
    });

    // Generar XML con los 3 registros en un solo lote
    const batchXml = buildAeatVerifactuXml([rec1, rec2, recAnul]);

    assert(batchXml.includes('BATCH-001'));
    assert(batchXml.includes('BATCH-002'));
    assert(batchXml.includes('<sf:RegistroAlta>'));
    assert(batchXml.includes('<sf:RegistroAnulacion>'));

    const countRegistros = (batchXml.match(/<sfLR:RegistroFactura>/g) || []).length;
    assert.strictEqual(countRegistros, 3, 'Debe haber exactamente 3 registros en el lote');

    const validation = validateAeatVerifactuXml(batchXml);
    assert.strictEqual(validation.valid, true);
  });

  // -----------------------------------------------------------------------------
  // Test 13: Rechazo tajante de datos obligatorios faltantes o artificiales
  // -----------------------------------------------------------------------------
  await runTest('Rechazo tajante de datos obligatorios faltantes o artificiales (no inventar valores)', () => {
    const invalidRecord: any = {
      tipoRegistro: 'alta',
      modoFiscal: 'VERI_FACTU',
      versionEspecificacion: '1.0',
      emisor: {
        nif: 'ES_UNKNOWN', // Artificial!
        nombreRazon: 'Test'
      },
      destinatario: {
        nif: 'B12345678',
        nombreRazon: 'Cliente Test'
      },
      factura: {
        numeroFactura: 'F-1',
        fechaExpedicion: '2026-01-02',
        tipoFactura: 'F1',
        descripcionOperacion: 'Test'
      },
      desgloseTributario: {
        desgloseIVA: [{ tipoImpositivo: 4, baseImponible: 100, cuotaRepercutida: 4 }],
        cuotaTotal: 4,
        importeTotal: 104
      },
      encadenamiento: { primerRegistro: true },
      sistemaInformatico: config.sistemaInformatico,
      fechaHoraHusoGenRegistro: '2026-01-02T10:00:00+01:00',
      huella: { hash: 'A'.repeat(64) }
    };

    assert.throws(
      () => buildAeatVerifactuXml(invalidRecord),
      /no puede ser un valor artificial/
    );

    // Con huella de longitud incorrecta
    const invalidHashRecord = {
      ...invalidRecord,
      emisor: { nif: 'B99999999', nombreRazon: 'Test' },
      huella: { hash: 'HASH_CORTO' }
    };

    assert.throws(
      () => buildAeatVerifactuXml(invalidHashRecord),
      /Longitud de huella inválida/
    );
  });

  // -----------------------------------------------------------------------------
  // Test 14: Verificación contra los esquemas XSD oficiales locales
  // -----------------------------------------------------------------------------
  await runTest('Verificación física de los esquemas XSD oficiales en docs/fiscal/xsd/', () => {
    const xsdDir = path.resolve(process.cwd(), 'docs/fiscal/xsd');
    assert(fs.existsSync(xsdDir), 'El directorio docs/fiscal/xsd debe existir');

    const lrPath = path.join(xsdDir, 'SuministroLR.xsd');
    const infoPath = path.join(xsdDir, 'SuministroInformacion.xsd');
    const respPath = path.join(xsdDir, 'RespuestaSuministro.xsd');

    assert(fs.existsSync(lrPath), 'SuministroLR.xsd debe existir');
    assert(fs.existsSync(infoPath), 'SuministroInformacion.xsd debe existir');
    assert(fs.existsSync(respPath), 'RespuestaSuministro.xsd debe existir');

    const lrContent = fs.readFileSync(lrPath, 'utf-8');
    assert(lrContent.includes('RegFactuSistemaFacturacion'), 'SuministroLR debe definir RegFactuSistemaFacturacion');
    assert(lrContent.includes('targetNamespace="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"'));

    const infoContent = fs.readFileSync(infoPath, 'utf-8');
    assert(infoContent.includes('RegistroFacturacionAltaType'), 'SuministroInformacion debe definir RegistroFacturacionAltaType');
    assert(infoContent.includes('RegistroFacturacionAnulacionType'), 'SuministroInformacion debe definir RegistroFacturacionAnulacionType');
  });

  // -----------------------------------------------------------------------------
  // Test 15: Integración con flujo emitFiscalInvoice() y validación del XML resultante
  // -----------------------------------------------------------------------------
  await runTest('Integración con flujo emitFiscalInvoice() y validación del XML resultante', async () => {
    resetFiscalQueue();

    const invoiceDraft = createDummyInvoice({ numeroFactura: 'FAC-INTEGRATION-001' });

    let persistedRecord: FiscalRecord | null = null;
    const persistRecordFn = async (rec: FiscalRecord) => {
      persistedRecord = rec;
    };

    const emissionResult = await emitFiscalInvoice({
      invoiceDraft,
      fiscalConfig: config,
      persistRecordFn
    });

    assert(emissionResult.fiscalRecord, 'Debe haber emitido el FiscalRecord');
    assert(persistedRecord, 'Debe haberse persistido el FiscalRecord');

    // Generar XML a partir del registro fiscal emitido
    const xml = buildAeatVerifactuXml(emissionResult.fiscalRecord);
    const validation = validateAeatVerifactuXml(xml);

    assert.strictEqual(validation.valid, true, `El XML emitido debe ser 100% conforme: ${validation.errors.join(', ')}`);
    assert(xml.includes(emissionResult.fiscalRecord.huella.hash), 'El XML debe contener la huella calculada por el motor criptográfico');
  });

  // -----------------------------------------------------------------------------
  // Test 16: Comprobar duplicidades en el modelo fiscal activo
  // -----------------------------------------------------------------------------
  await runTest('El modelo FiscalRecord activo NO contiene campos duplicados (hash, previousHash, etc.)', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });

    // Únicas fuentes autorizadas:
    assert.strictEqual(record.huella.hash, '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF');
    assert.strictEqual(record.encadenamiento.primerRegistro, true);

    // Campos prohibidos que NUNCA deben existir en FiscalRecord activo:
    assert.strictEqual((record as any).hash, undefined, 'No debe existir el campo duplicate "hash"');
    assert.strictEqual((record as any).previousHash, undefined, 'No debe existir el campo duplicate "previousHash"');
    assert.strictEqual((record as any).hashAlgorithm, undefined, 'No debe existir el campo duplicate "hashAlgorithm"');
    assert.strictEqual((record as any).hashSpecificationVersion, undefined, 'No debe existir el campo duplicate "hashSpecificationVersion"');
    assert.strictEqual((record as any).officialXml, undefined, 'No debe existir el campo duplicate "officialXml"');
  });

  // -----------------------------------------------------------------------------
  // Test 17: Batería exhaustiva de Casos A a G contra los esquemas XSD oficiales
  // -----------------------------------------------------------------------------
  await runTest('Casos A a G: Validación XSD negativa y positiva contra SuministroLR.xsd y SuministroInformacion.xsd', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });
    const validXml = buildAeatVerifactuXml(record);

    // Caso G: XML completamente válido (debe pasar en ambos validadores)
    const reportG = validateAeatVerifactuXml(validXml);
    assert.strictEqual(reportG.valid, true, `Caso G debe pasar: ${reportG.errors.join(', ')}`);
    const xsdG = validateXmlAgainstOfficialXsd(validXml);
    assert.strictEqual(xsdG.valid, true, `Caso G contra XSD oficial libxml2 debe pasar: ${xsdG.errors.join(', ')}`);

    // Caso A: Eliminar elemento obligatorio <sf:NombreRazonEmisor> (debe fallar)
    const xmlCaseA = validXml.replace(/<sf:NombreRazonEmisor>.*?<\/sf:NombreRazonEmisor>/, '');
    const reportA = validateAeatVerifactuXml(xmlCaseA);
    assert.strictEqual(reportA.valid, false, 'Caso A debe fallar en validador estructural');
    assert(reportA.errors.some(e => e.includes('NombreRazonEmisor') || e.includes('Schemas validity error') || e.includes('is not expected')), 'Caso A debe indicar error en NombreRazonEmisor');
    const xsdA = validateXmlAgainstOfficialXsd(xmlCaseA);
    assert.strictEqual(xsdA.valid, false, 'Caso A debe fallar en libxml2');

    // Caso B: Cambiar el orden de dos elementos de un xs:sequence (IDFactura y NombreRazonEmisor intercambiados) (debe fallar)
    const idFactura = validXml.slice(validXml.indexOf('<sf:IDFactura>'), validXml.indexOf('</sf:IDFactura>') + '</sf:IDFactura>'.length);
    const nombreEmisor = validXml.slice(validXml.indexOf('<sf:NombreRazonEmisor>'), validXml.indexOf('</sf:NombreRazonEmisor>') + '</sf:NombreRazonEmisor>'.length);
    const xmlCaseB = validXml.replace(idFactura, '__TEMP__').replace(nombreEmisor, idFactura).replace('__TEMP__', nombreEmisor);
    const reportB = validateAeatVerifactuXml(xmlCaseB);
    assert.strictEqual(reportB.valid, false, 'Caso B debe fallar por secuencia xs:sequence alterada');
    assert(reportB.errors.some(e => e.includes('Schemas validity error') || e.includes('This element is not expected') || e.includes('IDFactura')), 'Caso B debe detectar alteración de orden');
    const xsdB = validateXmlAgainstOfficialXsd(xmlCaseB);
    assert.strictEqual(xsdB.valid, false, 'Caso B debe fallar en libxml2 por xs:sequence');

    // Caso C: Introducir un valor fuera de una enumeración (TipoFactura='INVALID') (debe fallar)
    const xmlCaseC = validXml.replace('<sf:TipoFactura>F1</sf:TipoFactura>', '<sf:TipoFactura>INVALID</sf:TipoFactura>');
    const reportC = validateAeatVerifactuXml(xmlCaseC);
    assert.strictEqual(reportC.valid, false, 'Caso C debe fallar por valor fuera de enumeración');
    assert(reportC.errors.some(e => e.includes('INVALID') || e.includes('enumeration')), 'Caso C debe reportar error de enumeración');
    const xsdC = validateXmlAgainstOfficialXsd(xmlCaseC);
    assert.strictEqual(xsdC.valid, false, 'Caso C debe fallar en libxml2 por enumeración');

    // Caso D: Introducir un importe que no cumpla el tipo XSD (ej. 3 decimales 260.000) (debe fallar)
    const xmlCaseD = validXml.replace('<sf:ImporteTotal>260.00</sf:ImporteTotal>', '<sf:ImporteTotal>260.000</sf:ImporteTotal>');
    const reportD = validateAeatVerifactuXml(xmlCaseD);
    assert.strictEqual(reportD.valid, false, 'Caso D debe fallar por patrón de importe con 3 decimales');
    assert(reportD.errors.some(e => e.includes('ImporteTotal') || e.includes('pattern')), 'Caso D debe reportar fallo de patrón numérico');
    const xsdD = validateXmlAgainstOfficialXsd(xmlCaseD);
    assert.strictEqual(xsdD.valid, false, 'Caso D debe fallar en libxml2 por patrón');

    // Caso E: Introducir un elemento inexistente (debe fallar)
    const xmlCaseE = validXml.replace('</sf:RegistroAlta>', '  <sf:ElementoInexistente>Invalido</sf:ElementoInexistente>\n    </sf:RegistroAlta>');
    const reportE = validateAeatVerifactuXml(xmlCaseE);
    assert.strictEqual(reportE.valid, false, 'Caso E debe fallar por elemento no declarado');
    assert(reportE.errors.some(e => e.includes('ElementoInexistente') || e.includes('is not expected')), 'Caso E debe indicar elemento no esperado');
    const xsdE = validateXmlAgainstOfficialXsd(xmlCaseE);
    assert.strictEqual(xsdE.valid, false, 'Caso E debe fallar en libxml2 por elemento inexistente');

    // Caso F: Usar un namespace incorrecto en el elemento raíz (debe fallar)
    const xmlCaseF = validXml.replace(
      'xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"',
      'xmlns:sfLR="http://fake.namespace.com/invalid.xsd"'
    );
    const reportF = validateAeatVerifactuXml(xmlCaseF);
    assert.strictEqual(reportF.valid, false, 'Caso F debe fallar por namespace erróneo');
    const xsdF = validateXmlAgainstOfficialXsd(xmlCaseF);
    assert.strictEqual(xsdF.valid, false, 'Caso F debe fallar en libxml2 por namespace');
  });

  // -----------------------------------------------------------------------------
  // Test 18: Pureza del builder XML y garantía de no mutación del FiscalRecord
  // -----------------------------------------------------------------------------
  await runTest('Pureza del builder: FiscalRecord de entrada no sufre mutaciones ni efectos colaterales', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: '9999999999999999999999999999999999999999999999999999999999999999',
      fechaHoraSellado: '2026-01-02T10:00:00+01:00'
    });

    const snapshotBefore = JSON.stringify(record);

    // Ejecutar múltiples generaciones XML
    buildAeatVerifactuXml(record);
    buildAeatVerifactuXml(record);

    const snapshotAfter = JSON.stringify(record);
    assert.strictEqual(snapshotBefore, snapshotAfter, 'El FiscalRecord debe ser idéntico antes y después de llamar al builder');
    assert(Object.isFrozen(record), 'El FiscalRecord debe permanecer inmutable y congelado');
  });

  // -----------------------------------------------------------------------------
  // Test 19: Determinismo absoluto del builder XML
  // -----------------------------------------------------------------------------
  await runTest('Determinismo absoluto: múltiples llamadas sobre el mismo FiscalRecord producen XML idéntico byte por byte', () => {
    const invoice = createDummyInvoice();
    const record = createFiscalRecordFromInvoice(invoice, config, null, {
      hashActual: 'FEEDFACECAFEFEEDFACECAFEFEEDFACECAFEFEEDFACECAFEFEEDFACECAFEFEED',
      fechaHoraSellado: '2026-01-02T14:20:00+01:00'
    });

    const xml1 = buildAeatVerifactuXml(record);
    const xml2 = buildAeatVerifactuXml(record);
    const xml3 = buildAeatVerifactuXml(record);

    assert.strictEqual(xml1, xml2, 'xml1 y xml2 deben ser idénticos');
    assert.strictEqual(xml2, xml3, 'xml2 y xml3 deben ser idénticos');
    assert.strictEqual(xml1.length, xml3.length);
  });

  // -----------------------------------------------------------------------------
  // Test 20: El XML consume directamente los valores fijados en FiscalRecord sin recalcular
  // -----------------------------------------------------------------------------
  await runTest('El XML consume huella, huella anterior y timestamp directamente de FiscalRecord', () => {
    const prevRef: FiscalRecordRef = {
      id: 'prev-1',
      obligadoTributarioId: 'B99999999',
      invoiceId: 'inv-prev',
      numeroFactura: 'FAC-PREV',
      fechaExpedicion: '2026-01-01',
      huellaHash: '1111111111111111111111111111111111111111111111111111111111111111',
      creadoEn: '2026-01-01T10:00:00Z'
    };

    const invoice = createDummyInvoice();
    const explicitTimestamp = '2026-01-02T18:45:12+01:00';
    const explicitHash = '9999999999999999999999999999999999999999999999999999999999999999';

    const record = createFiscalRecordFromInvoice(invoice, config, prevRef, {
      hashActual: explicitHash,
      fechaHoraSellado: explicitTimestamp
    });

    const xml = buildAeatVerifactuXml(record);

    assert(xml.includes(`<sf:Huella>${explicitHash}</sf:Huella>`), 'La huella en el XML debe ser exactamente la de FiscalRecord.huella.hash');
    assert(xml.includes(`<sf:Huella>${prevRef.huellaHash}</sf:Huella>`), 'La huella anterior debe ser exactamente la de encadenamiento');
    assert(xml.includes(`<sf:FechaHoraHusoGenRegistro>${explicitTimestamp}</sf:FechaHoraHusoGenRegistro>`), 'El timestamp debe ser el de FiscalRecord');
  });

  // -----------------------------------------------------------------------------
  // Test 21: Casos independientes de Factura Rectificativa (R1, R2, R3, R4)
  // -----------------------------------------------------------------------------
  await runTest('Casos de Facturas Rectificativas R1, R2, R3 y R4 generan XML validable contra XSD', () => {
    const tiposRectificativas = ['R1', 'R2', 'R3', 'R4'] as const;

    for (const tipo of tiposRectificativas) {
      const invRect = createDummyInvoice({
        numeroFactura: `${tipo}-2026-0001`,
        tipoFactura: tipo,
        esRectificativa: true,
        tipoRectificativa: 'por_sustitucion',
        facturaRectificadaNumero: 'FAC-2026-0001',
        facturaRectificadaFecha: '2026-01-02',
        motivoRectificativa: `Rectificativa tipo ${tipo}`
      });

      const recordRect = createFiscalRecordFromInvoice(invRect, config, null, {
        hashActual: 'A'.repeat(64),
        fechaHoraSellado: '2026-01-02T10:00:00+01:00'
      });

      const xmlRect = buildAeatVerifactuXml(recordRect);
      assert(xmlRect.includes(`<sf:TipoFactura>${tipo}</sf:TipoFactura>`), `Debe incluir TipoFactura ${tipo}`);
      assert(xmlRect.includes('<sf:TipoRectificativa>S</sf:TipoRectificativa>'), 'Debe incluir TipoRectificativa S (sustitución)');

      const validation = validateAeatVerifactuXml(xmlRect);
      assert.strictEqual(validation.valid, true, `Rectificativa ${tipo} debe validar contra XSD: ${validation.errors.join(', ')}`);
    }
  });

  // -----------------------------------------------------------------------------
  // Test 22: Alta sin destinatario (F2 / Simplificada) genera XML válido conforme al Art. 6.1.d
  // -----------------------------------------------------------------------------
  await runTest('Alta de factura simplificada F2 sin destinatario omite bloque Destinatarios y valida contra XSD', () => {
    const invF2: Factura = {
      ...createDummyInvoice({ numeroFactura: 'SIMP-2026-001', tipoFactura: 'F2' }),
      clienteCif: '',
      clienteNombre: '',
      lineas: [
        {
          id: 'lin-f2',
          loteEnvasadoId: 'env-1',
          formatoId: 'form-1',
          fechaConsumoPreferente: '2026-01-20',
          nombreFormato: 'Docena huevos camperos',
          cantidadEstuches: 2,
          precioUnitario: 3.00,
          subtotal: 6.00,
          codigoLoteEnvasado: 'L-1',
          trazabilidadPuesta: []
        }
      ],
      totales: {
        baseImponible: 6.00,
        porcentajeIva: 4,
        cuotaIva: 0.24,
        aplicaRecargo: false,
        porcentajeRecargo: 0,
        cuotaRecargo: 0,
        totalDocumento: 6.24
      }
    };

    const recordF2 = createFiscalRecordFromInvoice(invF2, config, null, {
      hashActual: 'F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2F2',
      fechaHoraSellado: '2026-01-02T12:00:00+01:00'
    });

    const xmlF2 = buildAeatVerifactuXml(recordF2);

    assert(xmlF2.includes('<sf:TipoFactura>F2</sf:TipoFactura>'), 'TipoFactura F2');
    assert(xmlF2.includes('<sf:FacturaSimplificadaArt7273>S</sf:FacturaSimplificadaArt7273>'));
    assert(xmlF2.includes('<sf:FacturaSinIdentifDestinatarioArt61d>S</sf:FacturaSinIdentifDestinatarioArt61d>'));
    assert(!xmlF2.includes('<sf:Destinatarios>'), 'No debe contener bloque Destinatarios');

    const validation = validateAeatVerifactuXml(xmlF2);
    assert.strictEqual(validation.valid, true, `F2 debe validar contra XSD: ${validation.errors.join(', ')}`);
  });

  console.log('\n================================================================');
  console.log(`  RESUMEN FASE 2.2: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO!`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n*** ERROR FATAL EN LA SUITE DE TESTS FASE 2.2 ***');
  console.error(err);
  process.exit(1);
});
