/**
 * MOCK OFICIAL DEL SERVICIO WEB AEAT VERI*FACTU (FASE 3.1)
 *
 * Normativa Oficial:
 * - Real Decreto 1007/2023 | Orden HAC/1177/2024
 * - Esquema oficial RespuestaSuministro.xsd
 *
 * RESPONSABILIDAD:
 * Simula fielmente los 8 escenarios oficiales del servicio web de la AEAT
 * para testing exhaustivo y desacoplamiento de entornos sin certificado real.
 */

export type MockScenario =
  | 'ACCEPTANCE'                  // Caso 1: Aceptación con CSV (1..1000 registros Correcto)
  | 'ACCEPTANCE_WITH_WARNINGS'     // Caso 2: Aceptación con avisos/errores subsanables
  | 'PARTIAL_ACCEPTANCE'          // Caso 2.b: Lote parcialmente aceptado (mezcla de Correcto/AceptadoConErrores e Incorrecto)
  | 'FUNCTIONAL_REJECTION'        // Caso 3: Rechazo funcional AEAT (ej. NIF no censado)
  | 'TIMEOUT'                     // Caso 4: Timeout de red / socket
  | 'HTTP_500'                    // Caso 5: Error 500 del servidor / SOAP Fault
  | 'INVALID_XML'                 // Caso 6: Respuesta HTML o XML corrupto
  | 'UNEXPECTED_RESPONSE'         // Caso 7: XML válido pero estructura ajena
  | 'TLS_CERT_ERROR'              // Caso 8: Error de certificado o handshake TLS
  | 'SOAP_FAULT_SERVER'           // SOAP Fault explícito de servidor (reintentable)
  | 'SOAP_FAULT_CLIENT'           // SOAP Fault explícito de cliente (NO reintentable)
  | 'SOAP_FAULT_UNKNOWN';         // SOAP Fault desconocido (NO reintentable por defecto)

export interface MockRecordLineSpec {
  readonly nifEmisor: string;
  readonly numSerie: string;
  readonly fechaExpedicion: string;
  readonly operacion?: 'Alta' | 'Anulacion';
  readonly estadoRegistro?: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';
  readonly codigoError?: string;
  readonly descripcionError?: string;
  readonly registroDuplicado?: {
    readonly idPeticionRegistroDuplicado: string;
    readonly estadoRegistroDuplicado: 'Correcta' | 'AceptadaConErrores' | 'Anulada';
  };
}

export interface MockTransportParams {
  readonly nifEmisor?: string;
  readonly numSerie?: string;
  readonly fechaExpedicion?: string;
  readonly operacion?: 'Alta' | 'Anulacion';
  readonly tiempoEsperaEnvio?: number;
  readonly records?: ReadonlyArray<MockRecordLineSpec>;
}

export interface MockTransportResponse {
  readonly status: number;
  readonly statusText: string;
  readonly text: string;
  readonly headers: Record<string, string>;
}

export class MockAeatTransport {
  private static defaultScenario: MockScenario = 'ACCEPTANCE';
  private static globalTiempoEsperaEnvio: number = 60; // Valor de control de flujo por defecto oficial AEAT

  public static setDefaultScenario(scenario: MockScenario): void {
    this.defaultScenario = scenario;
  }

  public static getDefaultScenario(): MockScenario {
    return this.defaultScenario;
  }

  public static setTiempoEsperaEnvio(seconds: number): void {
    this.globalTiempoEsperaEnvio = seconds;
  }

  public static getTiempoEsperaEnvio(): number {
    return this.globalTiempoEsperaEnvio;
  }

  public static resetDefaults(): void {
    this.defaultScenario = 'ACCEPTANCE';
    this.globalTiempoEsperaEnvio = 60;
  }

  private static formatDateToAeatPattern(dateStr: string): string {
    const trimmed = (dateStr || '').trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
    }
    return trimmed;
  }

  private static renderRespuestaLineaXml(line: {
    nifEmisor: string;
    numSerie: string;
    fechaExpedicion: string;
    operacion: 'Alta' | 'Anulacion';
    estadoRegistro: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto';
    codigoError?: string;
    descripcionError?: string;
    registroDuplicado?: {
      idPeticionRegistroDuplicado: string;
      estadoRegistroDuplicado: 'Correcta' | 'AceptadaConErrores' | 'Anulada';
    };
  }): string {
    const fechaResp = this.formatDateToAeatPattern(line.fechaExpedicion);
    const errorTags = line.codigoError
      ? `\n        <sfR:CodigoErrorRegistro>${line.codigoError}</sfR:CodigoErrorRegistro>\n        <sfR:DescripcionErrorRegistro>${line.descripcionError || 'Error en registro'}</sfR:DescripcionErrorRegistro>`
      : '';
    const dupTags = line.registroDuplicado
      ? `\n        <sfR:RegistroDuplicado>\n          <sf:IdPeticionRegistroDuplicado>${line.registroDuplicado.idPeticionRegistroDuplicado}</sf:IdPeticionRegistroDuplicado>\n          <sf:EstadoRegistroDuplicado>${line.registroDuplicado.estadoRegistroDuplicado}</sf:EstadoRegistroDuplicado>\n        </sfR:RegistroDuplicado>`
      : '';

    return `      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${line.nifEmisor}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>${line.numSerie}</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>${fechaResp}</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>
          <sf:TipoOperacion>${line.operacion}</sf:TipoOperacion>
        </sfR:Operacion>
        <sfR:EstadoRegistro>${line.estadoRegistro}</sfR:EstadoRegistro>${errorTags}${dupTags}
      </sfR:RespuestaLinea>`;
  }

  /**
   * Genera el XML SOAP de respuesta simulado para 1 a 1000 registros según el escenario.
   */
  public static generateMockResponseBody(
    scenario: MockScenario,
    params?: MockTransportParams
  ): string {
    const nif = params?.nifEmisor || params?.records?.[0]?.nifEmisor || 'B12345678';
    const numSerie = params?.numSerie || params?.records?.[0]?.numSerie || 'FAC-2026/001';
    const fecha = params?.fechaExpedicion || params?.records?.[0]?.fechaExpedicion || '15-10-2026';
    const operacion = params?.operacion || params?.records?.[0]?.operacion || 'Alta';
    const tiempoEspera = params?.tiempoEsperaEnvio !== undefined ? params.tiempoEsperaEnvio : this.globalTiempoEsperaEnvio;

    const rawRecords: ReadonlyArray<MockRecordLineSpec> = params?.records && params.records.length > 0
      ? params.records
      : [{ nifEmisor: nif, numSerie, fechaExpedicion: fecha, operacion }];

    switch (scenario) {
      case 'ACCEPTANCE': {
        const linesXml = rawRecords.map(r => this.renderRespuestaLineaXml({
          nifEmisor: r.nifEmisor || nif,
          numSerie: r.numSerie,
          fechaExpedicion: r.fechaExpedicion,
          operacion: r.operacion || 'Alta',
          estadoRegistro: r.estadoRegistro || 'Correcto',
          codigoError: r.codigoError,
          descripcionError: r.descripcionError,
          registroDuplicado: r.registroDuplicado
        })).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>CSV-AEAT-1234567890ABCDEF</sfR:CSV>
      <sfR:DatosPresentacion>
        <sf:NIFPresentador>${nif}</sf:NIFPresentador>
        <sf:TimestampPresentacion>2026-10-15T10:00:00+02:00</sf:TimestampPresentacion>
      </sfR:DatosPresentacion>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>Granja Avícola El Valle S.L.</sf:NombreRazon>
          <sf:NIF>${nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${tiempoEspera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>
${linesXml}
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
      }

      case 'ACCEPTANCE_WITH_WARNINGS': {
        const linesXml = rawRecords.map(r => this.renderRespuestaLineaXml({
          nifEmisor: r.nifEmisor || nif,
          numSerie: r.numSerie,
          fechaExpedicion: r.fechaExpedicion,
          operacion: r.operacion || 'Alta',
          estadoRegistro: r.estadoRegistro || 'AceptadoConErrores',
          codigoError: r.codigoError || '1101',
          descripcionError: r.descripcionError || 'NIF del destinatario no censado en AEAT pero admitido con aviso',
          registroDuplicado: r.registroDuplicado
        })).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>CSV-AEAT-AVISO-987654321</sfR:CSV>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>Granja Avícola El Valle S.L.</sf:NombreRazon>
          <sf:NIF>${nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${tiempoEspera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>
${linesXml}
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
      }

      case 'PARTIAL_ACCEPTANCE': {
        const linesXml = rawRecords.map((r, idx) => {
          // Si tiene estadoRegistro explícito, respetarlo; de lo contrario, alternar:
          // último registro (o impares) Incorrecto, el resto Correcto o AceptadoConErrores
          const defaultEstado: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto' =
            rawRecords.length === 1
              ? 'AceptadoConErrores'
              : (idx === rawRecords.length - 1 ? 'Incorrecto' : (idx % 2 === 1 ? 'AceptadoConErrores' : 'Correcto'));

          const estado = r.estadoRegistro || defaultEstado;
          const codErr = r.codigoError || (estado === 'Incorrecto' ? '1104' : (estado === 'AceptadoConErrores' ? '1101' : undefined));
          const descErr = r.descripcionError || (
            estado === 'Incorrecto'
              ? 'Error funcional bloqueante en factura del lote: tipo impositivo incoherente'
              : (estado === 'AceptadoConErrores' ? 'NIF del destinatario con aviso no bloqueante' : undefined)
          );

          return this.renderRespuestaLineaXml({
            nifEmisor: r.nifEmisor || nif,
            numSerie: r.numSerie,
            fechaExpedicion: r.fechaExpedicion,
            operacion: r.operacion || 'Alta',
            estadoRegistro: estado,
            codigoError: codErr,
            descripcionError: descErr,
            registroDuplicado: r.registroDuplicado
          });
        }).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>CSV-AEAT-PARCIAL-777888999</sfR:CSV>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>Granja Avícola El Valle S.L.</sf:NombreRazon>
          <sf:NIF>${nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${tiempoEspera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>
${linesXml}
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
      }

      case 'FUNCTIONAL_REJECTION': {
        const linesXml = rawRecords.map(r => this.renderRespuestaLineaXml({
          nifEmisor: r.nifEmisor || nif,
          numSerie: r.numSerie,
          fechaExpedicion: r.fechaExpedicion,
          operacion: r.operacion || 'Alta',
          estadoRegistro: r.estadoRegistro || 'Incorrecto',
          codigoError: r.codigoError || '1104',
          descripcionError: r.descripcionError || 'NIF emisor no identificado en el censo de la AEAT',
          registroDuplicado: r.registroDuplicado
        })).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>Granja Avícola El Valle S.L.</sf:NombreRazon>
          <sf:NIF>${nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${tiempoEspera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Incorrecto</sfR:EstadoEnvio>
${linesXml}
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
      }

      case 'HTTP_500':
      case 'SOAP_FAULT_SERVER':
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>Error interno en base de datos de la AEAT</faultstring>
      <detail>Database timeout during transaction processing</detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      case 'SOAP_FAULT_CLIENT':
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Client</faultcode>
      <faultstring>El mensaje XML de solicitud no cumple con el esquema XSD SuministroLR</faultstring>
      <detail>cvc-complex-type.2.4.a: Invalid content was found</detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      case 'SOAP_FAULT_UNKNOWN':
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:CustomDiagnosticCode</faultcode>
      <faultstring>Diagnóstico no estándar reportado por gateway intermedio</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

      case 'INVALID_XML':
        return `<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>AEAT Gateway Proxy</center></body></html>`;

      case 'UNEXPECTED_RESPONSE':
        return `<?xml version="1.0" encoding="UTF-8"?>
<RespuestaInesperadaSistema xmlns="https://www.agenciatributaria.gob.es/inesperada">
  <Codigo>ERR_ROUTING</Codigo>
  <Mensaje>Servicio temporalmente fuera de línea por mantenimiento programado</Mensaje>
</RespuestaInesperadaSistema>`;

      case 'TIMEOUT':
      case 'TLS_CERT_ERROR':
      default:
        return '';
    }
  }

  /**
   * Ejecuta la remisión simulada produciendo la respuesta HTTP o lanzando el error de red correspondiente.
   */
  public static async execute(
    scenarioParam?: MockScenario,
    params?: MockTransportParams
  ): Promise<MockTransportResponse> {
    const scenario = scenarioParam || this.defaultScenario;

    if (scenario === 'TIMEOUT') {
      const err = new Error('Conexión con sede AEAT excedió el tiempo límite (timeout: 10000ms)');
      (err as any).code = 'ETIMEDOUT';
      throw err;
    }

    if (scenario === 'TLS_CERT_ERROR') {
      const err = new Error('Fallo de autenticación mTLS: El certificado del obligado tributario ha caducado o no es reconocido por la AEAT');
      (err as any).code = 'CERT_HAS_EXPIRED';
      throw err;
    }

    if (scenario === 'HTTP_500' || scenario === 'SOAP_FAULT_SERVER') {
      return {
        status: 500,
        statusText: 'Internal Server Error',
        text: this.generateMockResponseBody(scenario, params),
        headers: { 'content-type': 'text/xml; charset=utf-8' }
      };
    }

    if (scenario === 'SOAP_FAULT_CLIENT') {
      return {
        status: 400,
        statusText: 'Bad Request',
        text: this.generateMockResponseBody('SOAP_FAULT_CLIENT', params),
        headers: { 'content-type': 'text/xml; charset=utf-8' }
      };
    }

    if (scenario === 'SOAP_FAULT_UNKNOWN') {
      return {
        status: 500,
        statusText: 'Internal Server Error',
        text: this.generateMockResponseBody('SOAP_FAULT_UNKNOWN', params),
        headers: { 'content-type': 'text/xml; charset=utf-8' }
      };
    }

    if (scenario === 'INVALID_XML') {
      return {
        status: 502,
        statusText: 'Bad Gateway',
        text: this.generateMockResponseBody('INVALID_XML', params),
        headers: { 'content-type': 'text/html; charset=utf-8' }
      };
    }

    const xml = this.generateMockResponseBody(scenario, params);
    return {
      status: 200,
      statusText: 'OK',
      text: xml,
      headers: { 'content-type': 'text/xml; charset=utf-8' }
    };
  }
}
