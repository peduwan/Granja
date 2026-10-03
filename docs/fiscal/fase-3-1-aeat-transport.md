# Documentación Oficial AEAT: Transporte y Remisión Web Service VERI*FACTU (Fases 3.1 y 3.1.1)

## 1. Identificación del Documento Oficial de Referencia

- **Nombre Oficial del Documento:** *«Documento técnico de especificaciones del servicio web de los sistemas de facturación verificables (VERI\*FACTU)»* / *«Descripción del Servicio Web de Suministro de Registros de Facturación (SuministroLR)»*.
- **Emisor:** Departamento de Informática Tributaria — Agencia Estatal de Administración Tributaria (AEAT).
- **Versión:** 1.0 (Noviembre 2024).
- **Marco Normativo Vigente:**
  - Ley 11/2021, de 9 de julio, de medidas de prevención y lucha contra el fraude fiscal.
  - Real Decreto 1007/2023, de 5 de diciembre (Reglamento Veri*Factu / SIF).
  - Orden HAC/1177/2024, de 17 de octubre (BOE núm. 259, de 28 de octubre de 2024).
- **Esquemas XSD Oficiales:**
  - `SuministroLR.xsd` (v1.0): Contenedor raíz `RegFactuSistemaFacturacion`.
  - `RespuestaSuministro.xsd` (v1.0): Respuesta `RespuestaRegFactuSistemaFacturacion`.
  - `SuministroInformacion.xsd` (v1.0): Tipos complejos comunes de registros y desglose.

---

## 2. Endpoints Oficiales de los Servicios Web de Remisión (Única Fuente de Verdad)

| Entorno | Tipo de Autenticación | URL Oficial del Servicio Web SOAP (según SistemaFacturacion.wsdl) |
| :--- | :--- | :--- |
| **Producción** | Certificado electrónico cualificado estándar (Persona física/jurídica/representante) | `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| **Producción** | Certificado de sello electrónico de entidad | `https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| **Pruebas / Preproducción** | Certificado electrónico cualificado estándar | `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| **Pruebas / Preproducción** | Certificado de sello electrónico de entidad | `https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP` |
| **Modo Mock / Simulación** | Virtual (sin red externa ni resolución DNS) | `mock://aeat.local/ws/SistemaFacturacion/VerifactuSOAP` |

### Servicio de Cotejo de Código QR (Sede Electrónica)
- **Producción:** `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR`
- **Pruebas:** `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR`

*Nota sobre endpoints y WSDL:* Conforme al `SistemaFacturacion.wsdl` oficial de la AEAT, el `soap:address` del servicio utiliza `www1` / `prewww1` para certificados estándar y `www10` / `prewww10` para sello de entidad, mientras que los esquemas XSD y utilidades de sede residen en `www2` / `prewww2`. Centralizado de forma unificada en `src/fiscal/aeatEndpoints.ts`.

---

## 3. Protocolo SOAP 1.1 y Especificaciones de Conexión

1. **Protocolo:** SOAP 1.1 / WSDL Document/Literal.
2. **Método HTTP:** `POST`.
3. **Content-Type:** `text/xml; charset=utf-8`.
4. **SOAPAction:** `""` (encabezado HTTP vacío conforme a la especificación WSDL de la AEAT).
5. **Namespaces Oficiales:**
   - Envelope: `http://schemas.xmlsoap.org/soap/envelope/`
   - SuministroLR (Request): `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd`
   - SuministroInformacion: `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd`
   - RespuestaSuministro (Response): `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd`

---

## 4. Clasificación Estricta de SOAP Faults (Fase 3.1.1)

Los errores devueltos mediante el elemento `<soapenv:Fault>` se clasifican en tres categorías bien diferenciadas:

| Categoría | Criterio de Identificación (`faultcode`) | Diagnóstico | Estado Interno | Política de Reintento |
| :--- | :--- | :--- | :--- | :--- |
| **`SOAP_FAULT_SERVER`** | `soapenv:Server`, `Server`, `Server.*`, `500` | Problema interno de infraestructura, base de datos o indisponibilidad en los servidores de la AEAT. | `FAILED_TECHNICAL` | **Reintentable:** Se permite reprogramar el reintento técnico con backoff exponencial. |
| **`SOAP_FAULT_CLIENT`** | `soapenv:Client`, `Client`, `Client.*`, `VersionMismatch`, `MustUnderstand`, `400` | El mensaje enviado contiene un error de sintaxis, versión SOAP incorrecta o cabeceras ininteligibles imputables al cliente. | `FAILED_TECHNICAL` (Error de cliente) | **NO reintentable:** Se bloquea el reintento automático para evitar bucles infinitos. Requiere corrección técnica. |
| **`SOAP_FAULT_UNKNOWN`** | Cualquier otro código no concluyente | Indeterminado. | `FAILED_TECHNICAL` | **NO reintentable por defecto:** Queda registrado para diagnóstico; no se reintenta a ciegas. |

---

## 5. Política Interna de Reintentos Técnicos (Diseño del Software, No Requisito AEAT)

1. **Límite Máximo de Intentos:**
   - Se establece un límite interno de **3 intentos** (`INTERNAL_MAX_RETRY_ATTEMPTS = 3`).
   - *Aclaración normativa:* Este tope es una decisión de arquitectura y resiliencia del software para evitar bucles infinitos ante errores de conexión o servidor, **no un requisito normativo de la AEAT**.
2. **Cadencia de Reintentos Internos:**
   - Intento 1 $\rightarrow$ 60 segundos.
   - Intento 2 $\rightarrow$ 180 segundos (3 minutos).
   - Intento 3 $\rightarrow$ 600 segundos (10 minutos).
   - *Aclaración normativa:* Esta progresión es una política interna de la aplicación, **no una secuencia oficial impuesta por la AEAT**.
3. **Causas No Reintentables:**
   - Rechazos funcionales de la AEAT (`REJECTED`, ej. código 1104, 3000, etc.).
   - Sumisiones ya admitidas (`ACCEPTED` o `ACCEPTED_WITH_ERRORS`).
   - SOAP Faults de cliente (`SOAP_FAULT_CLIENT`): el mensaje debe ser corregido antes de reenviar.
4. **Regla de Inmutabilidad Absoluta:**
   - Un reintento crea una nueva instancia `FiscalSubmission` en estado `PENDING` con `numeroIntento = previous + 1`.
   - El `FiscalRecord` asociado permanece **100% inmutable** (`Object.isFrozen === true`), sin tocar huella, XML, número ni importes.

---

## 6. Seguridad del Certificado y Modo Mock

1. **Aislamiento en Backend:**
   - `AeatCertificateProvider` se ejecuta exclusivamente en el backend (Node.js/Express).
   - El acceso desde el navegador está bloqueado (`typeof window !== 'undefined'`).
   - Ningún certificado (`.pfx`) ni contraseña se expone en logs, respuestas de API, Firestore ni LocalStorage.
2. **Modo Mock Puro:**
   - En `AEAT_ENV=mock` o `AEAT_TRANSPORT_MODE=mock`, el sistema opera **sin requerir fichero de certificado ni contraseña**.
   - No se realiza ninguna petición de red externa, permitiendo ejecutar la suite de pruebas de forma 100% autónoma y segura.

---

## 7. Registro de Auditoría y Correcciones Técnicas (Fase 3.1.1)

En la auditoría de la integración AEAT Veri*Factu se validaron y corrigieron los siguientes aspectos críticos:

1. **Centralización y Eliminación de Endpoints Huérfanos / Legados:**
   - Se auditó todo el repositorio localizando y eliminando referencias residuales a URLs desfasadas (`SuministroLRFacturasEmitidas` y `prewww1.aeat.es`).
   - `src/fiscal/modelTransformers.ts` y `src/fiscal/submissionService.ts` fueron refactorizados para consumir exclusivamente `getAeatSoapEndpoint` de `src/fiscal/aeatEndpoints.ts`.
   - `src/fiscal/qrService.ts` consume directamente `AEAT_OFFICIAL_ENDPOINTS.qr`.
   - La resolución de entorno respeta de forma unificada `AEAT_ENV` y `AEAT_ENVIRONMENT` ('mock' | 'test' | 'production').

2. **Diferenciación Estricta de SOAP Faults (SOAP 1.1):**
   - Se reforzó `classifySoapFault` para inspeccionar `faultcode`, `faultstring` y `detail`.
   - Los fallos de validación sintáctica o de esquema XSD (`cvc-`, `invalid content`, `soapenv:Client`, `400`) se clasifican inequívocamente como `SOAP_FAULT_CLIENT` (`isRetryable: false`).
   - Los fallos de infraestructura (`soapenv:Server`, `500`, `timeout`, `unavailable`) se clasifican como `SOAP_FAULT_SERVER` (`isRetryable: true`).
   - En respuestas HTTP 5xx que contienen un sobre SOAP con `<soapenv:Fault>`, se preserva la estructura completa `parsedResponse` con el objeto `fault` clasificado.

3. **Endurecimiento de la Política de Reintentos:**
   - Se implementó la función pura `isRetryableSubmission(submission, parsedResponse)`.
   - Se bloquea cualquier intento de reprogramar o crear reintentos sobre sumisiones en `ACCEPTED`, `ACCEPTED_WITH_ERRORS` o con rechazo funcional `REJECTED`.
   - Inmutabilidad estricta: Cada reintento genera una nueva sumisión en Outbox (`numeroIntento = previous + 1`) manteniendo el `FiscalRecord` congelado (`Object.isFrozen === true`).

4. **Modo Mock Puro sin Credenciales:**
   - Verificado que `MockAeatTransport` opera 100% desconectado de la red, sin exigir variables de entorno de certificado ni claves.
   - `MockAeatTransport.execute` devuelve HTTP 500 para `SOAP_FAULT_SERVER`, HTTP 400 para `SOAP_FAULT_CLIENT` y HTTP 500 para `SOAP_FAULT_UNKNOWN`.

---

## 8. Fase 3.1.2: Control de Flujo Oficial AEAT (`<TiempoEsperaEnvio>`) vs. Reintento Técnico Interno

Se establece una separación conceptual y arquitectónica total entre el **control de flujo normativo de la AEAT** y la **política de reintentos técnicos de la aplicación**:

| Dimensión | Control de Flujo Oficial AEAT (`TiempoEsperaEnvio`) | Política Interna de Reintentos Técnicos |
| :--- | :--- | :--- |
| **Origen normativo** | Documentación Técnica Oficial AEAT v1.0.3 / SuministroLR | Decisión interna de arquitectura y resiliencia del software |
| **Mecanismo** | Elemento `<TiempoEsperaEnvio>` (segundos) devuelto en `RespuestaRegFactuSistemaFacturacion` | Contador `numeroIntento` y estados `FAILED_TECHNICAL` $\rightarrow$ `RETRY_PENDING` |
| **Finalidad** | Regular dinámicamente la cadencia y tasa de peticiones entre envíos ordinarios | Recuperar incidencias puntuales de red (timeouts, caídas de servidor) |
| **Dinamicidad** | Dinámico: el emisor actualiza su ventana según el valor $T$ recibido en cada respuesta (ej. 60s, 120s, 300s) | Configurable a nivel de software |
| **Gestor en código** | `AeatFlowControlManager` (`src/fiscal/aeatTransport.ts`) | `scheduleSubmissionRetry` / `createRetrySubmission` |

