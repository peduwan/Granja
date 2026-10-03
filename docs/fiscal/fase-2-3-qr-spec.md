# ESPECIFICACIÓN TÉCNICA OFICIAL: CÓDIGO QR TRIBUTARIO Y OUTBOX FISCAL
**Fase 2.3 — Código QR de Cotejo y Modelo de Remisión Veri*Factu**
**Normativa de Referencia:** Ley 11/2021 | Real Decreto 1007/2023 | Orden HAC/1177/2024 (BOE 28/10/2024) | Especificaciones Técnicas AEAT v1.0

---

## 1. MARCO NORMATIVO DEL CÓDIGO QR TRIBUTARIO

El Real Decreto 1007/2023 (Reglamento de requisitos de los sistemas informáticos de facturación) y la Orden HAC/1177/2024 establecen en sus artículos 20 y 21 la obligación de incorporar un código QR en todas las facturas expedidas (tanto en soporte papel como en formato electrónico / PDF):

1. **Artículo 20 de la Orden HAC/1177/2024:**
   - *"Las facturas que se expidan en soporte papel o en formato electrónico mediante sistemas o programas informáticos [...] deberán incorporar un código «QR» que cumpla las especificaciones contenidas en el artículo 21."*
   - Las facturas de sistemas Veri*Factu deberán incorporar la indicación «Factura verificable en la sede electrónica de la AEAT» o «VERI*FACTU».
2. **Artículo 21 de la Orden HAC/1177/2024:**
   - Simbología estándar: **ISO/IEC 18004:2015**.
   - Nivel de corrección de errores: **M (Medium)** (capacidad de recuperación de hasta un 15% de daños o manchas).
   - Tamaño físico de representación: Entre **30 × 30 mm y 40 × 40 mm**.
   - Zona de silencio (quiet zone): Margen perimetral blanco de al menos 2 mm (recomendado 6 mm) para garantizar la legibilidad óptica.
   - Leyenda superior obligatoria: Texto literal **«QR tributario»** inmediatamente encima del código.
   - Leyenda inferior obligatoria: **«Factura verificable en la sede electrónica de la AEAT»** o abreviadamente **«VERI*FACTU»**.

---

## 2. URL OFICIAL DE COTEJO Y PARÁMETROS DE CONSULTA

El contenido unívoco codificado en el código QR es una URL accesible mediante protocolo HTTPS que apunta al servicio oficial de cotejo de la Agencia Estatal de Administración Tributaria (AEAT):

### 2.1. Endpoints Oficiales
- **Producción:**  
  `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR`
- **Entorno de Pruebas / Preproducción:**  
  `https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR`

### 2.2. Parámetros de Consulta (Query String)
La URL de cotejo debe contener exactamente los cuatro parámetros oficiales definidos por la AEAT, sin parámetros inventados ni omisiones:

| Parámetro | Tipo / Formato | Longitud / Restricción | Descripción | Origen en FiscalRecord |
|---|---|---|---|---|
| `nif` | String (Alfanumérico) | 9 caracteres (NIF español) | NIF del emisor / obligado tributario titular de la facturación | `FiscalRecord.emisor.nif` |
| `numserie` | String (Alfanumérico) | Hasta 60 caracteres (URL-encoded) | Serie y número de la factura expedida | `FiscalRecord.factura.numeroFactura` |
| `fecha` | String (`DD-MM-YYYY`) | Exactamente 10 caracteres | Fecha de expedición oficial de la factura | `FiscalRecord.factura.fechaExpedicion` |
| `importe` | Numérico con 2 decimales (`12.2`) | Hasta 12 enteros, punto decimal, 2 decimales | Importe total de la factura con impuestos incluidos | `FiscalRecord.desgloseTributario.importeTotal` |

### 2.3. Reglas Estrictas de Codificación
1. **Separador de parámetros:** `&` estándar de query string.
2. **Formato de Importe:** Separador decimal punto (`.`), exactamente dos decimales (ej. `121.00`, `-50.25`).
3. **Formato de Fecha:** `DD-MM-YYYY` (ej. `02-01-2026`). Si la fecha interna se encuentra en formato `YYYY-MM-DD`, se normaliza canónicamente a `DD-MM-YYYY`.
4. **URL Encoding (RFC 3986):** El valor de `numserie` debe ser codificado con `encodeURIComponent` para garantizar el transporte seguro de caracteres especiales (`/`, `-`, etc.).
5. **Cero Valores Ficticios:** Se rechazan tajantemente cadenas vacías o marcadores ficticios (`ES_UNKNOWN`, `UNKNOWN`, `PENDING_FASE_2_HASH`, etc.).

### 2.4. Ejemplo Real de URL y Payload
```text
https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=F2026-0001&fecha=02-01-2026&importe=121.00
```

---

## 3. DIFERENCIAS CON IMPLEMENTACIONES PREVIAS O LEGACY

| Concepto | Implementación Legacy previa | Especificación Oficial Fase 2.3 |
|---|---|---|
| **URL Base** | `https://sede.agenciatributaria.gob.es/Sede/verifactu.html` (genérica) | `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR` (oficial AEAT) |
| **Nombre parámetro importe** | `total=` | `importe=` (literal exigido por la AEAT) |
| **Fuente de datos** | Recálculo desde `Invoice` | Consumo exclusivo del `FiscalRecord` sellado |
| **Tratamiento de ausencias** | Fallbacks ficticios (`'B12345678'`) | Error explícito de dominio (no inventar valores) |
| **Simbología y Corrección** | No especificado | ISO/IEC 18004:2015, nivel M, zona de silencio 2-6 mm |
| **Leyenda Legal** | Incompleta | «QR tributario» superior y «VERI*FACTU» inferior |

---

## 4. ÁMBITO DE APLICACIÓN: REGISTRO ALTA VS REGISTRO ANULACIÓN

1. **RegistroAlta (Facturas expedidas):**
   - El código QR es obligatorio para toda factura expedida entregada al cliente (completa o simplificada).
   - Contiene la URL de cotejo con `nif`, `numserie`, `fecha` e `importe`.
2. **RegistroAnulacion (Anulación de facturas):**
   - Es un apunte contable y fiscal interno en el registro de facturación que se remite electrónicamente a la AEAT.
   - No constituye una factura expedida comercial ni se entrega al destinatario; carece de `importeTotal` en su esquema oficial (`RegistroFacturacionAnulacionType`).
   - Por tanto, no genera código QR de cotejo comercial. El servicio `FiscalQrService` valida que `tipoRegistro === 'alta'` y rechaza o inhabilita la generación para registros de anulación.

---

## 5. ARQUITECTURA DE OUTBOX Y REMISIÓN (FiscalSubmission)

Para permitir que el `FiscalRecord` permanezca estrictamente inmutable tras su sellado, las remisiones a la AEAT se modelan como entidades independientes en un patrón Outbox:

```text
FiscalRecord (Inmutable, sellado definitivo)
     │
     ├── FiscalSubmission #1 (estado: 'PENDING', intento: 1)
     │         ↓ (fallo de red)
     ├── FiscalSubmission #2 (estado: 'RETRY_PENDING', intento: 2)
     │         ↓ (aceptación con CSV)
     └── FiscalSubmission #3 (estado: 'ACCEPTED', intento: 3)
```

### Reglas de Inmutabilidad del Outbox:
1. La creación de una `FiscalSubmission` NO modifica en ningún caso el `FiscalRecord`.
2. El cambio de estado de una remisión (`PENDING` -> `SENDING` -> `ACCEPTED`) pertenece a la `FiscalSubmission`.
3. El `FiscalRecord` mantiene de forma inalterable su huella SHA-256, encadenamiento, XML oficial y código QR.
