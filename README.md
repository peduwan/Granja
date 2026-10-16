# Gestión Avícola AgroTech — SIF Certificado Veri*Factu

[![CI](https://github.com/peduwan/avicola-agrotech/actions/workflows/ci.yml/badge.svg)](https://github.com/peduwan/avicola-agrotech/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Veri*Factu](https://img.shields.io/badge/AEAT-Veri*Factu_Certificado-green.svg)](https://sede.agenciatributaria.gob.es/)

Sistema integral de gestión de explotaciones avícolas y **Sistema Informático de Facturación (SIF)** de alta seguridad, plenamente certificado y conforme a la normativa fiscal española:
- **Ley 11/2021**, de 9 de julio, de medidas de prevención y lucha contra el fraude fiscal.
- **Real Decreto 1007/2023**, de 5 de diciembre (Reglamento Veri*Factu / SIF).
- **Orden HAC/1177/2024**, de 17 de octubre (Especificaciones técnicas y diseño del registro de facturación).

---

## 1. Arquitectura del Sistema

El sistema implementa una arquitectura desacoplada y modular orientada a la inmutabilidad de datos y la seguridad en la nube (Google Cloud Run + Cloud Firestore):

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENTE WEB (REACT SPA)                         │
│  - Ventas, Puesta, Envasado, Trazabilidad REGA, Facturación Veri*Factu │
│  - QR Oficial con margen de 4 módulos (ISO/IEC 18004)                  │
│  - Sin secretos expuestos en cliente (VITE_* limpios)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS + Bearer Firebase Token
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           SERVER (EXPRESS)                             │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │       voiceRoutes       │  │            fiscalRoutes             │  │
│  │ - Rate Limit (30/min)   │  │ - Emisión autoritativa backend      │  │
│  │ - Cuota diaria (200/día)│  │ - Consulta registros en custodia    │  │
│  │ - Payload max 1MB       │  │ - Remisión SOAP AEAT (1..1000)      │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │     serverConfig.ts     │  │           sifIdentity.ts            │  │
│  │ - ROOT_OWNER_EMAIL      │  │ - Validación estricta SIF           │  │
│  │   (peduwan@gmail.com)   │  │ - Lista negra NIFs y razones demo   │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
          ┌───────────────────────────┴───────────────────────────┐
          ▼                                                       ▼
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│      FIRESTORE MULTI-TENANT      │    │           AGENCIA AEAT           │
│  - Reglas por /farms/{farmId}    │    │  - prewww1.aeat.es / www1        │
│    (members: [email])            │    │  - Cotejo QR en prewww2.aeat.es  │
│  - Custodia Cloud Fail-Closed    │    │  - Autenticación mTLS (FNMT)     │
│  - Sincronización al arranque    │    │  - Validación XSD libxml2-wasm   │
└──────────────────────────────────┘    └──────────────────────────────────┘
```

---

## 2. Características Clave y Cumplimiento Normativo

### Identidad SIF Centralizada y Segura (B1)
- Fuente única autoritativa en `src/config/sifIdentity.ts`.
- Validación normalizada `trim().toUpperCase()`.
- Prohibición de identificadores ficticios (`B99999999`, `ES_UNKNOWN`, etc.).
- Comportamiento *Fail-Fast* en el arranque si falta configuración obligatoria.

### Entorno AEAT Estricto (B2)
- Valores admitidos exclusivamente: `'test' | 'production'`.
- El modo `'mock'` está terminantemente prohibido en entornos de producción.
- No existen fallbacks silenciosos a simulaciones cuando hay fallos de red.

### Propietario Raíz y Control de Acceso (B3 & A5)
- Operador raíz oficial: **`peduwan@gmail.com`** con verificación obligatoria de correo (`email_verified === true`).
- Aislamiento multi-tenant estricto mediante reglas de seguridad en Cloud Firestore.
- Configuración aislada de backend en `src/config/serverConfig.ts` sin dependencias de Express ni de UI.

### Protección de Endpoints de Voz e Inteligencia Artificial (B4)
- Rate limiting por UID autenticado: **30 peticiones/minuto**.
- Cuota diaria por usuario: **200 consultas/día** (configurable vía `VOICE_DAILY_QUOTA`).
- Límite estricto de carga útil: **1 MB** en peticiones de voz.

### Conformidad de IVA y Recargo con Contexto Completo (B5)
- Validación de tipos oficiales vigentes en España: `[0, 2, 4, 5, 7.5, 10, 21]%`.
- Mensajes de error contextualizados que indican número de factura, índice de línea y descripción del producto.

### Código QR Reglamentario (B6)
- Margen de seguridad estricto de **4 módulos** conforme al estándar internacional ISO/IEC 18004.
- Destino de validación por omisión en entorno de pruebas (`https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR`).

### Custodia Cloud Run: Fail-Closed y Migración (A4)
- Al arrancar el contenedor, se inspecciona `data/fiscal_records.json` y se sincronizan registros pendientes con Firestore.
- En producción, si Firestore no está accesible, la emisión se cancela con HTTP 503 impidiendo facturas sin respaldo en la nube.

---

## 3. Variables de Entorno

Crear un archivo `.env` en la raíz basándose en `.env.example`:

```bash
# Identidad del Sistema Informático de Facturación (SIF) - Requerido
SIF_NIF=53541125T
SIF_NOMBRE_RAZON=Eduardo
SIF_INSTALACION_ID=2.0
SIF_NOMBRE_SIF=Gestión Avícola SIF
SIF_VERSION=2.0
SIF_FECHA_ACTIVACION=2026-02-04T00:00:00.000Z

# Conexión con la AEAT
AEAT_ENV=test
AEAT_TRANSPORT_MODE=mock
AEAT_CERT_PATH=/secrets/cert.p12
AEAT_CERT_PASSWORD=clave-segura

# Propietario Raíz y Seguridad
ROOT_OWNER_EMAIL=peduwan@gmail.com
VOICE_DAILY_QUOTA=200

# Servicios de IA (Opcional - solo en servidor)
GEMINI_API_KEY=tu-clave-gemini-ai
```

---

## 4. Instalación y Ejecución

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Compilar para producción
npm run build

# Iniciar en producción
npm start
```

---

## 5. Batería de Pruebas y Auditoría

El repositorio incluye más de 80 tests automatizados que cubren desde la criptografía SHA-256 hasta la validación con esquemas XSD oficiales:

```bash
# Ejecutar todas las suites de prueba
npm test

# Ejecutar auditoría activa de seguridad SIF / GCP
npx tsx scripts/verify-security-config.ts

# Ejecutar suites de remediación por fases
npm run test:fase1_bloqueantes
npx tsx tests/remediacion_fase2_alta_prioridad.test.ts
npx tsx tests/remediacion_fase3_media_prioridad.test.ts
npx tsx tests/remediacion_fase4_higiene.test.ts
```

---

## 6. Licencia

Este proyecto está distribuido bajo la licencia **Apache 2.0**. Consulte el archivo [LICENSE](LICENSE) para más detalles.
