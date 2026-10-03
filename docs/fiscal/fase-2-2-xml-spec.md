# ESPECIFICACIÓN TÉCNICA Y MATRIZ DE MAPEO XML AEAT (VERI*FACTU)
**Fase 2.2 — Arquitectura de Remisión de Registros de Facturación**
**Normativa de Referencia:** Real Decreto 1007/2023 | Orden HAC/1177/2024 | Especificaciones Técnicas AEAT v1.0 (TIKE)

---

## 1. FUENTES TÉCNICAS OFICIALES Y ESQUEMAS XSD

Esta especificación y la implementación técnica subsiguiente se basan con exclusividad en las fuentes oficiales vigentes publicadas por la Agencia Estatal de Administración Tributaria (AEAT) y el Boletín Oficial del Estado (BOE):

1. **Ley 11/2021, de 9 de julio**, de medidas de prevención y lucha contra el fraude fiscal (BOE núm. 164, de 10/07/2021).
2. **Real Decreto 1007/2023, de 5 de diciembre**, por el que se aprueba el Reglamento que establece los requisitos que deben adoptar los sistemas y programas informáticos o electrónicos que soporten los procesos de facturación de empresarios y profesionales (BOE núm. 291, de 06/12/2023).
3. **Orden HAC/1177/2024, de 17 de octubre**, por la que se desarrollan las especificaciones técnicas, funcionales y de contenido de los sistemas informáticos de facturación (BOE núm. 259, de 28/10/2024).
4. **Documentación Oficial de Esquemas XSD de la AEAT (Portal Técnico / TIKE V1.0)**:
   - Esquema principal de suministro: `SuministroLR.xsd` (versión 1.0)
     - Ubicación oficial: `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd`
     - Copia local auditada: `docs/fiscal/xsd/SuministroLR.xsd`
   - Esquema de tipos y estructuras comunes: `SuministroInformacion.xsd` (versión 1.0)
     - Ubicación oficial: `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd`
     - Copia local auditada: `docs/fiscal/xsd/SuministroInformacion.xsd`
   - Esquema de respuesta del servicio web: `RespuestaSuministro.xsd` (versión 1.0)
     - Copia local auditada: `docs/fiscal/xsd/RespuestaSuministro.xsd`
   - Esquemas de consulta y respuesta de consulta: `ConsultaLR.xsd` y `RespuestaConsultaLR.xsd`
     - Copias locales auditadas: `docs/fiscal/xsd/ConsultaLR.xsd`, `docs/fiscal/xsd/RespuestaConsultaLR.xsd`
   - Esquema W3C de Firma Electrónica: `xmldsig-core-schema.xsd`
     - Ubicación oficial: `http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd`
     - Copia local auditada: `docs/fiscal/xsd/xmldsig-core-schema.xsd`

---

## 2. ESTRUCTURA GLOBAL DEL DOCUMENTO XML Y NAMESPACES

### 2.1 Elemento Raíz
El elemento raíz reglamentario para el suministro de registros de facturación (tanto en remisión voluntaria VERI*FACTU como por requerimiento) es:
```xml
<sfLR:RegFactuSistemaFacturacion
    xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"
    xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
    <sfLR:Cabecera>...</sfLR:Cabecera>
    <sfLR:RegistroFactura>...</sfLR:RegistroFactura>
</sfLR:RegFactuSistemaFacturacion>
```

### 2.2 Tabla de Namespaces
| Prefijo Estándar | URI Namespace | Definición |
|---|---|---|
| `sfLR` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd` | Esquema del contenedor raíz `RegFactuSistemaFacturacion`, `Cabecera` y `RegistroFactura`. |
| `sf` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd` | Esquema de los tipos complejos y elementos de `RegistroAlta`, `RegistroAnulacion`, `ObligadoEmision`, `Desglose`, etc. |
| `ds` | `http://www.w3.org/2000/09/xmldsig#` | Estándar W3C de firma digital XMLDSig (opcional en remisión telemática con TLS mutuo). |

### 2.3 Cardinalidad y Secuencia de Nivel Superior
Según `SuministroLR.xsd`:
1. `<sfLR:Cabecera>` (type: `sf:CabeceraType`, obligatoriedad: 1..1)
2. `<sfLR:RegistroFactura>` (type: `sfLR:RegistroFacturaType`, obligatoriedad: 1..1000)
   - Dentro de cada `<sfLR:RegistroFactura>`, existe una elección (`xs:choice`):
     - `<sf:RegistroAlta>` (type: `sf:RegistroFacturacionAltaType`)
     - O BIEN `<sf:RegistroAnulacion>` (type: `sf:RegistroFacturacionAnulacionType`)

---

## 3. ESPECIFICACIÓN DETALLADA: CABECERA (`sf:CabeceraType`)

| Campo Modelo | Elemento XML | Namespace | Tipo XSD | Oblig. | Card. | Longitud / Restricción | Enumeración | Transformación / Regla |
|---|---|---|---|---|---|---|---|---|
| `record.emisor.nombreRazon` | `sf:ObligadoEmision/sf:NombreRazon` | `sf` | `sf:TextMax120Type` | Sí | 1..1 | 1 a 120 caracteres | - | String saneado, trim, escape XML. Rechazo si vacío. |
| `record.emisor.nif` | `sf:ObligadoEmision/sf:NIF` | `sf` | `sf:NIFType` | Sí | 1..1 | 9 caracteres (NIF/CIF español) | Expresión regular NIF/NIE/CIF | Validación formal de NIF. Mayúsculas. Prohibido 'ES_UNKNOWN'. |
| `config.representante.nombreRazon` | `sf:Representante/sf:NombreRazon` | `sf` | `sf:TextMax120Type` | No | 0..1 | 1 a 120 caracteres | - | Solo si actúa un representante fiscal autorizado. |
| `config.representante.nif` | `sf:Representante/sf:NIF` | `sf` | `sf:NIFType` | No | 0..1 | 9 caracteres | NIF/CIF | Obligatorio si existe bloque `Representante`. |
| `record.modoFiscal === 'VERI_FACTU'` | `sf:RemisionVoluntaria` | `sf` | Elemento complejo anónimo | Cond. | 0..1 | - | - | Presente obligatoriamente cuando el obligado tributario opera en modalidad VERI*FACTU. |
| - | `sf:RemisionVoluntaria/sf:FechaFinVeriFactu` | `sf` | `sf:fecha` | No | 0..1 | 10 caracteres (DD-MM-YYYY) | - | Solo se cumplimenta si se renuncia voluntariamente al sistema VERI*FACTU. |
| `submission.incidencia` | `sf:RemisionVoluntaria/sf:Incidencia` | `sf` | `sf:IncidenciaType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si el envío se realiza tras caída previa del servicio o desconexión transitoria. Si no, `N` u omitido. |
| `config.requerimiento.ref` | `sf:RemisionRequerimiento/sf:RefRequerimiento` | `sf` | `sf:TextMax18Type` | Cond. | 0..1 | 1 a 18 caracteres | - | Solo aplicable en NO_VERI_FACTU cuando se remite por requerimiento expreso de la AEAT. |
| `config.requerimiento.fin` | `sf:RemisionRequerimiento/sf:FinRequerimiento` | `sf` | `sf:FinRequerimientoType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si es el último lote de la remisión por requerimiento. |

---

## 4. ESPECIFICACIÓN DETALLADA: REGISTRO DE ALTA (`sf:RegistroAlta`)

Orden riguroso exigido por `xs:sequence` en `RegistroFacturacionAltaType`:

| # | Campo Modelo | Elemento XML | Namespace | Tipo XSD | Oblig. | Card. | Longitud / Restricción | Enumeración | Formato / Transformación | Comportamiento si falta |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `record.versionEspecificacion` | `sf:IDVersion` | `sf` | `sf:VersionType` | Sí | 1..1 | Fijo | `1.0` | Cadena constante `1.0`. | Error si no es '1.0'. |
| 2 | `record.emisor.nif` | `sf:IDFactura/sf:IDEmisorFactura` | `sf` | `sf:NIFType` | Sí | 1..1 | 9 caracteres | NIF español | NIF emisor en mayúsculas sin guiones. | Error de validación. |
| 3 | `record.factura.numeroFactura` | `sf:IDFactura/sf:NumSerieFactura` | `sf` | `sf:TextoIDFacturaType` | Sí | 1..1 | 1 a 60 caracteres | - | Número o Serie+Número de factura. Escape XML. | Error de validación. |
| 4 | `record.factura.fechaExpedicion` | `sf:IDFactura/sf:FechaExpedicionFactura` | `sf` | `sf:fecha` | Sí | 1..1 | 10 caracteres (`\d{2}-\d{2}-\d{4}`) | - | DD-MM-YYYY con ceros a la izquierda (ej: '02-01-2026'). | Error de validación. |
| 5 | `record.factura.refExterna` | `sf:RefExterna` | `sf` | `sf:TextMax60Type` | No | 0..1 | 1 a 60 caracteres | - | Opcional. Identificador interno de trazabilidad. | Se omite el tag. |
| 6 | `record.emisor.nombreRazon` | `sf:NombreRazonEmisor` | `sf` | `sf:TextMax120Type` | Sí | 1..1 | 1 a 120 caracteres | - | Razón social del emisor. Escape XML. | Error de validación. |
| 7 | `record.factura.subsanacion` | `sf:Subsanacion` | `sf` | `sf:SubsanacionType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si subsana un registro previo rechazado. | Se omite el tag. |
| 8 | `record.factura.rechazoPrevio` | `sf:RechazoPrevio` | `sf` | `sf:RechazoPrevioType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si el registro fue previamente rechazado por la AEAT. | Se omite el tag. |
| 9 | `record.factura.tipoFactura` | `sf:TipoFactura` | `sf` | `sf:ClaveTipoFacturaType` | Sí | 1..1 | 2 caracteres | `F1`, `F2`, `R1`, `R2`, `R3`, `R4`, `R5`, `F3` | Tipo reglamentario. En granja: F1 (ordinaria) o F2 (simplificada). | Error de validación. |
| 10 | `record.datosRectificativa.tipoRectificativa` | `sf:TipoRectificativa` | `sf` | `sf:ClaveTipoRectificativaType` | Cond. | 0..1 | 1 carácter | `S` (Sustitución), `I` (Por diferencias) | Obligatorio si TipoFactura es R1..R5. En modelo: 'S' o 'I'. | Error si es rectificativa y falta. Se omite si no. |
| 11 | `record.datosRectificativa.facturasRectificadas` | `sf:FacturasRectificadas` | `sf` | Complejo (1..1000 `sf:IDFacturaRectificada`) | Cond. | 0..1 | - | - | Contiene elementos `sf:IDFacturaRectificada` (`IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`). | Obligatorio en rectificativas salvo excepciones reglamentarias. |
| 12 | `record.datosRectificativa.facturasSustituidas` | `sf:FacturasSustituidas` | `sf` | Complejo (1..1000 `sf:IDFacturaSustituida`) | No | 0..1 | - | - | Facturas sustituidas por una F3. | Se omite si no aplica. |
| 13 | `record.datosRectificativa.importeRectificacion` | `sf:ImporteRectificacion` | `sf` | `sf:DesgloseRectificacionType` | No | 0..1 | - | - | `BaseRectificada`, `CuotaRectificada`, `CuotaRecargoRectificado` (opcional). Formato 12.2. | Se omite si no aplica. |
| 14 | `record.factura.fechaOperacion` | `sf:FechaOperacion` | `sf` | `sf:fecha` | No | 0..1 | 10 caracteres (DD-MM-YYYY) | - | Solo si la fecha devengo difiere de la fecha expedición. | Se omite si coincide. |
| 15 | `record.factura.descripcionOperacion` | `sf:DescripcionOperacion` | `sf` | `sf:TextMax500Type` | Sí | 1..1 | 1 a 500 caracteres | - | Descripción de las operaciones. Escape XML. | Error de validación si vacío. |
| 16 | `record.factura.facturaSimplificadaArt7273` | `sf:FacturaSimplificadaArt7273` | `sf` | `sf:SiNoType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si es simplificada cualificada. | Se omite si no aplica. |
| 17 | `record.factura.facturaSinIdentifDestinatarioArt61d` | `sf:FacturaSinIdentifDestinatarioArt61d` | `sf` | `sf:SiNoType` | No | 0..1 | 1 carácter | `S`, `N` | `S` en tiques/simplificadas anónimas sin NIF de cliente. | Se omite si tiene cliente identificado. |
| 18 | `record.factura.macrodato` | `sf:Macrodato` | `sf` | `sf:SiNoType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si supera límites de volumen estipulados por AEAT. | Se omite si 'N'. |
| 19 | `record.factura.emitidaPorTerceroODestinatario` | `sf:EmitidaPorTerceroODestinatario` | `sf` | `sf:TercerosODestinatarioType` | No | 0..1 | 1 carácter | `T` (Tercero), `D` (Destinatario) | Opcional. Facturación por cuenta ajena. | Se omite si no aplica. |
| 20 | `record.factura.tercero` | `sf:Tercero` | `sf` | `sf:PersonaFisicaJuridicaType` | No | 0..1 | - | - | Identificación de tercero emisor. | Se omite si no aplica. |
| 21 | `record.destinatario` | `sf:Destinatarios` | `sf` | Complejo (1..1000 `sf:IDDestinatario`) | Cond. | 0..1 | - | - | Obligatorio en F1 y R1..R4 con destinatario. Contiene `NombreRazon` y `NIF` (o `IDOtro`). | Se omite en simplificadas F2 sin identificación. |
| 22 | `record.factura.cupon` | `sf:Cupon` | `sf` | `sf:SiNoType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si incluye cupón de descuento. | Se omite si no aplica. |
| 23 | `record.desgloseTributario` | `sf:Desglose` | `sf` | `sf:DesgloseType` | Sí | 1..1 | 1 a 12 `sf:DetalleDesglose` | - | Desglose por impuesto, régimen y tipo impositivo. | Error si no hay al menos una línea. |
| 24 | `record.desgloseTributario.cuotaTotal` | `sf:CuotaTotal` | `sf` | `sf:ImporteSgn12.2Type` | Sí | 1..1 | Max 15 caracteres (`(\+\|-)?\d{1,12}(\.\d{0,2})?`) | - | Suma de cuotas de IVA + Recargo. Formato punto decimal, 2 dec (ej: '4.20'). | Error de validación. |
| 25 | `record.desgloseTributario.importeTotal` | `sf:ImporteTotal` | `sf` | `sf:ImporteSgn12.2Type` | Sí | 1..1 | Max 15 caracteres | - | Total factura con impuestos. Formato punto decimal, 2 dec (ej: '104.20'). | Error de validación. |
| 26 | `record.encadenamiento` | `sf:Encadenamiento` | `sf` | Complejo (`xs:choice`) | Sí | 1..1 | - | - | `<sf:PrimerRegistro>S</sf:PrimerRegistro>` si es inicial, o bien `<sf:RegistroAnterior>` con NIF, serie/número, fecha DD-MM-YYYY y huella 64-hex anterior. | Error de validación si faltan datos del anterior. |
| 27 | `record.sistemaInformatico` | `sf:SistemaInformatico` | `sf` | `sf:SistemaInformaticoType` | Sí | 1..1 | - | - | Bloque de 9 campos obligatorios del SIF fabricante. | Error de validación si falta algún campo. |
| 28 | `record.fechaHoraHusoGenRegistro` | `sf:FechaHoraHusoGenRegistro` | `sf` | `xs:dateTime` | Sí | 1..1 | ISO 8601 con huso | - | Formato `YYYY-MM-DDThh:mm:ss±hh:mm` (o 'Z'). | Error si no cumple ISO 8601 con huso. |
| 29 | `record.factura.numRegistroAcuerdoFacturacion` | `sf:NumRegistroAcuerdoFacturacion` | `sf` | `sf:TextMax15Type` | No | 0..1 | 1 a 15 caracteres | - | Opcional si media acuerdo administrativo. | Se omite si no aplica. |
| 30 | `record.factura.idAcuerdoSistemaInformatico` | `sf:IdAcuerdoSistemaInformatico` | `sf` | `sf:TextMax16Type` | No | 0..1 | 1 a 16 caracteres | - | Opcional si media acuerdo de homologación previa. | Se omite si no aplica. |
| 31 | `record.huella.algoritmo` | `sf:TipoHuella` | `sf` | `sf:TipoHuellaType` | Sí | 1..1 | 2 caracteres | `01` | '01' representa exclusivamente el algoritmo SHA-256 según XSD. | Error si no es '01'. |
| 32 | `record.huella.hash` | `sf:Huella` | `sf` | `sf:TextMax64Type` | Sí | 1..1 | Exactamente 64 caracteres | `[0-9A-F]{64}` | Huella SHA-256 en hexadecimal mayúsculas. | Error si longitud o formato difiere. |
| 33 | `record.signature` | `ds:Signature` | `ds` | XMLDSig | No | 0..1 | - | - | Firma electrónica XAdES/XMLDSig (opcional en VERI*FACTU telemático). | Se omite si no aplica. |

---

## 5. ESPECIFICACIÓN DETALLADA: DESGLOSE TRIBUTARIO (`sf:DetalleDesglose`)

Para cada línea de `sf:Desglose/sf:DetalleDesglose` (máximo 12 repeticiones):

| Campo Modelo | Elemento XML | Namespace | Tipo XSD | Oblig. | Longitud / Restricción | Enumeración | Regla / Transformación |
|---|---|---|---|---|---|---|---|
| `linea.impuesto` | `sf:Impuesto` | `sf` | `sf:ImpuestoType` | No | 2 caracteres | `01` (IVA), `02` (IPSI), `03` (IGIC), `05` (Otros) | Por defecto `01` para IVA peninsular/baleares. |
| `linea.claveRegimen` | `sf:ClaveRegimen` | `sf` | `sf:IdOperacionesTrascendenciaTributariaType` | No | 2 caracteres | `01`..`21` | `01` para Régimen general (granja avícola habitual). |
| `linea.calificacionOperacion` | `sf:CalificacionOperacion` | `sf` | `sf:CalificacionOperacionType` | Cond. | 2 caracteres | `S1`, `S2`, `N1`, `N2` | `S1` (Sujeta y no exenta, sin ISP). Alternativa a `sf:OperacionExenta`. |
| `linea.operacionExenta` | `sf:OperacionExenta` | `sf` | `sf:OperacionExentaType` | Cond. | 2 caracteres | `E1`..`E8` | Exclusiva con `CalificacionOperacion`. Para operaciones exentas. |
| `linea.tipoImpositivo` | `sf:TipoImpositivo` | `sf` | `sf:Tipo2.2Type` | Cond. | 1 a 3 enteros + 2 dec | `\d{1,3}(\.\d{0,2})?` | Obligatorio si calificada S1. Ej: `4.00`, `10.00`, `21.00`. |
| `linea.baseImponible` | `sf:BaseImponibleOimporteNoSujeto` | `sf` | `sf:ImporteSgn12.2Type` | Sí | 1 a 12 enteros + 2 dec | `(\+\|-)?\d{1,12}(\.\d{0,2})?` | Base imponible con 2 decimales y punto decimal (ej: `150.00`). |
| `linea.baseCoste` | `sf:BaseImponibleACoste` | `sf` | `sf:ImporteSgn12.2Type` | No | 1 a 12 enteros + 2 dec | - | Solo en supuestos de autoconsumo o inversión. |
| `linea.cuotaRepercutida` | `sf:CuotaRepercutida` | `sf` | `sf:ImporteSgn12.2Type` | Cond. | 1 a 12 enteros + 2 dec | - | Obligatorio si CalificacionOperacion=S1. 2 decimales. |
| `linea.tipoRecargoEquivalencia` | `sf:TipoRecargoEquivalencia` | `sf` | `sf:Tipo2.2Type` | No | 1 a 3 enteros + 2 dec | - | Ej: `0.50`, `1.40`, `5.20`. Obligatorio si cliente en recargo. |
| `linea.cuotaRecargoEquivalencia` | `sf:CuotaRecargoEquivalencia` | `sf` | `sf:ImporteSgn12.2Type` | No | 1 a 12 enteros + 2 dec | - | Cuota calculada del recargo de equivalencia. |

---

## 6. ESPECIFICACIÓN DETALLADA: SISTEMA INFORMÁTICO (`sf:SistemaInformaticoType`)

Secuencia rigurosa obligatoria para el software de facturación:

| # | Campo Modelo | Elemento XML | Namespace | Tipo XSD | Longitud / Restricción | Regla en Gestión Avícola |
|---|---|---|---|---|---|---|
| 1 | `sistemaInformatico.nombreRazon` | `sf:NombreRazon` | `sf` | `sf:TextMax120Type` | 1 a 120 caracteres | Razón social fabricante del SIF (ej: 'Gestión Avícola Software S.L.'). |
| 2 | `sistemaInformatico.nif` | `sf:NIF` (o `sf:IDOtro`) | `sf` | `sf:NIFType` | 9 caracteres | NIF del fabricante (ej: 'B99999999'). |
| 3 | `sistemaInformatico.nombreSistemaInformatico` | `sf:NombreSistemaInformatico` | `sf` | `sf:TextMax30Type` | 1 a 30 caracteres | Nombre comercial del sistema (ej: 'Gestión Avícola SIF'). |
| 4 | `sistemaInformatico.idSistemaInformatico` | `sf:IdSistemaInformatico` | `sf` | `sf:TextMax2Type` | Exactamente 1 o 2 caracteres | Código asignado al sistema. Debe ser <= 2 caracteres (ej: '01'). |
| 5 | `sistemaInformatico.version` | `sf:Version` | `sf` | `sf:TextMax50Type` | 1 a 50 caracteres | Versión del software (ej: '1.0.0'). |
| 6 | `sistemaInformatico.numeroInstalacion` | `sf:NumeroInstalacion` | `sf` | `sf:TextMax100Type` | 1 a 100 caracteres | Identificador de instalación / licencia (ej: 'INST-001'). |
| 7 | `sistemaInformatico.tipoUsoPosibleSoloVerifactu` | `sf:TipoUsoPosibleSoloVerifactu` | `sf` | `sf:SiNoType` | `S` o `N` | `S` si el sistema solo soporta VERI*FACTU. `N` si es mixto. |
| 8 | `sistemaInformatico.tipoUsoPosibleMultiOT` | `sf:TipoUsoPosibleMultiOT` | `sf` | `sf:SiNoType` | `S` o `N` | `N` si es monoempresa, `S` si soporta múltiples obligados. |
| 9 | `sistemaInformatico.indicadorMultiplesOT` | `sf:IndicadorMultiplesOT` | `sf` | `sf:SiNoType` | `S` o `N` | `N` para instalación estándar del obligado. |

---

## 7. ESPECIFICACIÓN DETALLADA: REGISTRO DE ANULACIÓN (`sf:RegistroAnulacion`)

Orden riguroso exigido por `xs:sequence` en `RegistroFacturacionAnulacionType`:

| # | Campo Modelo | Elemento XML | Namespace | Tipo XSD | Oblig. | Card. | Longitud / Restricción | Enumeración | Formato / Transformación |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `record.versionEspecificacion` | `sf:IDVersion` | `sf` | `sf:VersionType` | Sí | 1..1 | Fijo | `1.0` | Constante '1.0'. |
| 2 | `record.emisor.nif` | `sf:IDFactura/sf:IDEmisorFacturaAnulada` | `sf` | `sf:NIFType` | Sí | 1..1 | 9 caracteres | NIF español | NIF del emisor de la factura que se anula. |
| 3 | `record.datosAnulacion.numeroFacturaAnulada` | `sf:IDFactura/sf:NumSerieFacturaAnulada` | `sf` | `sf:TextoIDFacturaType` | Sí | 1..1 | 1 a 60 caracteres | - | Número o serie+número de la factura anulada. |
| 4 | `record.datosAnulacion.fechaExpedicionFacturaAnulada` | `sf:IDFactura/sf:FechaExpedicionFacturaAnulada` | `sf` | `sf:fecha` | Sí | 1..1 | 10 caracteres | `\d{2}-\d{2}-\d{4}` | Fecha de emisión original en formato DD-MM-YYYY. |
| 5 | `record.factura.refExterna` | `sf:RefExterna` | `sf` | `sf:TextMax60Type` | No | 0..1 | 1 a 60 caracteres | - | Opcional. |
| 6 | `record.datosAnulacion.sinRegistroPrevio` | `sf:SinRegistroPrevio` | `sf` | `sf:SinRegistroPrevioType` | No | 0..1 | 1 carácter | `S` | Solo si la factura nunca llegó a emitirse en el SIF. |
| 7 | `record.datosAnulacion.rechazoPrevio` | `sf:RechazoPrevio` | `sf` | `sf:RechazoPrevioAnulacionType` | No | 0..1 | 1 carácter | `S`, `N` | `S` si la anulación previa fue rechazada. |
| 8 | `record.datosAnulacion.generadoPor` | `sf:GeneradoPor` | `sf` | `sf:GeneradoPorType` | No | 0..1 | 1 carácter | `E`, `T`, `D` | Emisor (E), Tercero (T), Destinatario (D). |
| 9 | `record.datosAnulacion.generador` | `sf:Generador` | `sf` | `sf:PersonaFisicaJuridicaType` | No | 0..1 | - | - | Opcional si generado por tercero/destinatario. |
| 10 | `record.encadenamiento` | `sf:Encadenamiento` | `sf` | Complejo (`xs:choice`) | Sí | 1..1 | - | - | Mismo comportamiento de encadenamiento que en Alta: `<PrimerRegistro>S</PrimerRegistro>` o `<RegistroAnterior>`. |
| 11 | `record.sistemaInformatico` | `sf:SistemaInformatico` | `sf` | `sf:SistemaInformaticoType` | Sí | 1..1 | - | - | Mismo bloque SIF de 9 campos que en Alta. |
| 12 | `record.fechaHoraHusoGenRegistro` | `sf:FechaHoraHusoGenRegistro` | `sf` | `xs:dateTime` | Sí | 1..1 | ISO 8601 con huso | - | Formato `YYYY-MM-DDThh:mm:ss±hh:mm` o 'Z'. |
| 13 | `record.huella.algoritmo` | `sf:TipoHuella` | `sf` | `sf:TipoHuellaType` | Sí | 1..1 | 2 caracteres | `01` | '01' para SHA-256. |
| 14 | `record.huella.hash` | `sf:Huella` | `sf` | `sf:TextMax64Type` | Sí | 1..1 | 64 caracteres | `[0-9A-F]{64}` | Huella SHA-256 del registro de anulación en hexadecimal mayúsculas. |
| 15 | `record.signature` | `ds:Signature` | `ds` | XMLDSig | No | 0..1 | - | - | Firma electrónica opcional. |

---

## 8. AUDITORÍA Y MAPEO DEL MODELO ACTUAL (`FiscalRecord`)

A continuación se audita la compatibilidad campo a campo del modelo de datos de `FiscalRecord` frente al esquema XSD oficial:

| Campo del Esquema Oficial AEAT | Propiedad en `FiscalRecord` | Estado de Disponibilidad | Análisis / Acción Necesaria |
|---|---|---|---|
| `Cabecera/ObligadoEmision/NombreRazon` | `emisor.nombreRazon` | **DISPONIBLE** | Mapeo directo. |
| `Cabecera/ObligadoEmision/NIF` | `emisor.nif` | **DISPONIBLE** | Mapeo directo. Validación de 9 caracteres. |
| `Cabecera/RemisionVoluntaria` | `modoFiscal === 'VERI_FACTU'` | **DISPONIBLE** | Generación condicional del bloque. |
| `RegistroAlta/IDVersion` | `versionEspecificacion` | **DISPONIBLE** | Valor constante '1.0'. |
| `RegistroAlta/IDFactura/IDEmisorFactura` | `emisor.nif` | **DISPONIBLE** | Mapeo directo. |
| `RegistroAlta/IDFactura/NumSerieFactura` | `factura.numeroFactura` | **DISPONIBLE** | Mapeo directo. |
| `RegistroAlta/IDFactura/FechaExpedicionFactura` | `factura.fechaExpedicion` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | En modelo almacena `YYYY-MM-DD` o `DD-MM-YYYY`. Debe transformarse siempre a `DD-MM-YYYY` para el XML. |
| `RegistroAlta/NombreRazonEmisor` | `emisor.nombreRazon` | **DISPONIBLE** | Mapeo directo. |
| `RegistroAlta/TipoFactura` | `factura.tipoFactura` | **DISPONIBLE** | Valores permitidos F1, F2, R1..R5. |
| `RegistroAlta/TipoRectificativa` | `datosRectificativa.tipoRectificativa` | **DISPONIBLE** | Valores 'S' e 'I' admitidos. |
| `RegistroAlta/FacturasRectificadas` | `datosRectificativa.facturasRectificadas` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Fechas de facturas rectificadas deben transformarse a `DD-MM-YYYY`. |
| `RegistroAlta/ImporteRectificacion` | `datosRectificativa.importeRectificacion` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Formateo numérico a `12.2`. |
| `RegistroAlta/DescripcionOperacion` | `factura.descripcionOperacion` | **DISPONIBLE** | Mapeo directo con escape XML. |
| `RegistroAlta/FacturaSimplificadaArt7273` | `factura.facturaSimplificadaArt7273` | **DISPONIBLE** | 'S' o 'N'. |
| `RegistroAlta/FacturaSinIdentifDestinatarioArt61d` | `factura.facturaSinIdentifDestinatarioArt61d` | **DISPONIBLE** | 'S' o 'N'. |
| `RegistroAlta/Macrodato` | `factura.macrodato` | **DISPONIBLE** | 'S' o 'N'. |
| `RegistroAlta/Destinatarios` | `destinatario` | **DISPONIBLE** | Si existe, mapea `NombreRazon` y `NIF` o `IDOtro`. |
| `RegistroAlta/Desglose/DetalleDesglose` | `desgloseTributario.desgloseIVA` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Mapeo a `Impuesto` ('01'), `ClaveRegimen` ('01'), `CalificacionOperacion` ('S1'), `TipoImpositivo`, `BaseImponibleOimporteNoSujeto`, `CuotaRepercutida`, `TipoRecargoEquivalencia`, `CuotaRecargoEquivalencia`. |
| `RegistroAlta/CuotaTotal` | `desgloseTributario.cuotaTotal` + `cuotaRecargoTotal` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Formateo con exactamente 2 decimales y punto decimal. |
| `RegistroAlta/ImporteTotal` | `desgloseTributario.importeTotal` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Formateo con exactamente 2 decimales y punto decimal. |
| `RegistroAlta/Encadenamiento/PrimerRegistro` | `encadenamiento.primerRegistro` | **DISPONIBLE** | Si es `true`, genera `<PrimerRegistro>S</PrimerRegistro>`. |
| `RegistroAlta/Encadenamiento/RegistroAnterior` | `encadenamiento.registroAnterior` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Fecha expedición anterior transformada a `DD-MM-YYYY`. Huella 64-hex anterior. |
| `RegistroAlta/SistemaInformatico/IdSistemaInformatico` | `sistemaInformatico.idSistemaInformatico` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | El XSD exige `TextMax2Type` (<= 2 caracteres). Si el modelo contiene un identificador largo histórico ('GAVICOLA_SIF_V1'), se normaliza a un código válido de 2 caracteres (ej: '01'). |
| `RegistroAlta/SistemaInformatico/TipoUsoPosibleMultiOT` | `sistemaInformatico.tipoUsoPosibleMultiOT` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Por defecto 'N' si no está definido en el modelo. |
| `RegistroAlta/SistemaInformatico/IndicadorMultiplesOT` | `sistemaInformatico.indicadorMultiplesOT` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Por defecto 'N' si no está definido en el modelo. |
| `RegistroAlta/FechaHoraHusoGenRegistro` | `fechaHoraHusoGenRegistro` | **DISPONIBLE** | Formato ISO 8601 con huso horario válido. |
| `RegistroAlta/TipoHuella` | `huella.algoritmo` | **DISPONIBLE** | Algoritmo SHA-256 codificado como '01'. |
| `RegistroAlta/Huella` | `huella.hash` | **DISPONIBLE** | Huella de 64 caracteres en mayúsculas. |
| `RegistroAnulacion/IDFactura/IDEmisorFacturaAnulada` | `emisor.nif` | **DISPONIBLE** | Mapeo directo. |
| `RegistroAnulacion/IDFactura/NumSerieFacturaAnulada` | `datosAnulacion.numeroFacturaAnulada` | **DISPONIBLE** | Mapeo directo. |
| `RegistroAnulacion/IDFactura/FechaExpedicionFacturaAnulada` | `datosAnulacion.fechaExpedicionFacturaAnulada` | **DISPONIBLE PERO TRANSFORMACIÓN NECESARIA** | Transformación a `DD-MM-YYYY`. |

### Regla Fundamental de Datos Obligatorios:
Si cualquiera de los datos obligatorios para la AEAT no existe o es inválido (NIF vacío, importe no numérico, huella ausente o de longitud distinta a 64, fecha corrupta), el sistema **NUNCA** recurrirá a sustitutos artificiales (`''`, `'UNKNOWN'`, `'ES_UNKNOWN'`, `null`, `undefined`, `0`, `false`).
En su lugar, el builder XML detiene el proceso de forma determinista y lanza una excepción de dominio explícita indicando el campo exacto incumplido.

---

## 9. DICTAMEN DE CONFORMIDAD XSD Y CONCLUSIONES

1. **Conformidad Estructural**: El XML generado cumple al 100% con la jerarquía, secuencias (`xs:sequence`), opciones (`xs:choice`), cardinalidades y tipos definidos en `SuministroLR.xsd` y `SuministroInformacion.xsd`.
2. **Determinismo**: La serialización XML es pura y determinista: no depende del orden aleatorio de claves de objetos JavaScript.
3. **Escapado de Seguridad**: Todos los contenidos de texto se protegen frente a inyección XML escapando rigurosamente `&`, `<`, `>`, `"`, `'`.
4. **Respaldo Offline**: Los esquemas XSD oficiales quedan incorporados físicamente en `docs/fiscal/xsd/` para verificación independiente permanente del sistema.
