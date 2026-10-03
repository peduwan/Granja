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
  | 'ACCEPTANCE'                  // Caso 1: Aceptación con CSV
  | 'ACCEPTANCE_WITH_WARNINGS'     // Caso 2: Aceptación con avisos/errores subsanables
  | 'FUNCTIONAL_REJECTION'        // Caso 3: Rechazo funcional AEAT (ej. NIF no censado)
  | 'TIMEOUT'                     // Caso 4: Timeout de red / socket
  | 'HTTP_500'                    // Caso 5: Error 500 del servidor / SOAP Fault
  | 'INVALID_XML'                 // Caso 6: Respuesta HTML o XML corrupto
  | 'UNEXPECTED_RESPONSE'         // Caso 7: XML válido pero estructura ajena
  | 'TLS_CERT_ERROR'              // Caso 8: Error de certificado o handshake TLS
  | 'SOAP_FAULT_SERVER'           // SOAP Fault explícito de servidor (reintentable)
  | 'SOAP_FAULT_CLIENT'           // SOAP Fault explícito de cliente (NO reintentable)
  | 'SOAP_FAULT_UNKNOWN';         // SOAP Fault desconocido (NO reintentable por defecto)

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

  /**
   * Genera el XML SOAP de respuesta simulado para una factura dada según el escenario.
   */
  public static generateMockResponseBody(
    scenario: MockScenario,
    params?: {
      nifEmisor?: string;
      numSerie?: string;
      fechaExpedicion?: string;
      tiempoEsperaEnvio?: number;
    }
  ): string {
    const nif = params?.nifEmisor || 'B12345678';
    const numSerie = params?.numSerie || 'FAC-2026/001';
    const fecha = params?.fechaExpedicion || '15-10-2026';
    const tiempoEspera = params?.tiempoEsperaEnvio !== undefined ? params.tiempoEsperaEnvio : this.globalTiempoEsperaEnvio;

    switch (scenario) {
      case 'ACCEPTANCE':
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
      <sfR:CSV>CSV-AEAT-1234567890ABCDEF</sfR:CSV>
      <sfR:DatosPresentacion>
        <sf:NIFPresentador>${nif}</sf:NIFPresentador>
        <sf:TimestampPresentacion>${fecha} 10:00:00</sf:TimestampPresentacion>
      </sfR:DatosPresentacion>
      <sfR:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>Granja Avícola El Valle S.L.</sf:NombreRazon>
          <sf:NIF>${nif}</sf:NIF>
        </sf:ObligadoEmision>
      </sfR:Cabecera>
      <sfR:TiempoEsperaEnvio>${tiempoEspera}</sfR:TiempoEsperaEnvio>
      <sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${nif}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>${numSerie}</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>Correcto</sfR:EstadoRegistro>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

      case 'ACCEPTANCE_WITH_WARNINGS':
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
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${nif}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>${numSerie}</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>AceptadoConErrores</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>1101</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>NIF del destinatario no censado en AEAT pero admitido con aviso</sfR:DescripcionErrorRegistro>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

      case 'FUNCTIONAL_REJECTION':
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
      <sfR:RespuestaLinea>
        <sfR:IDFactura>
          <sf:IDEmisorFactura>${nif}</sf:IDEmisorFactura>
          <sf:NumSerieFactura>${numSerie}</sf:NumSerieFactura>
          <sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura>
        </sfR:IDFactura>
        <sfR:Operacion>Alta</sfR:Operacion>
        <sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>
        <sfR:CodigoErrorRegistro>1104</sfR:CodigoErrorRegistro>
        <sfR:DescripcionErrorRegistro>NIF emisor no identificado en el censo de la AEAT</sfR:DescripcionErrorRegistro>
      </sfR:RespuestaLinea>
    </sfR:RespuestaRegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;

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
    params?: {
      nifEmisor?: string;
      numSerie?: string;
      fechaExpedicion?: string;
      tiempoEsperaEnvio?: number;
    }
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
