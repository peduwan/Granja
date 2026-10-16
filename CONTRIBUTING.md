# Guía de Contribución — Gestión Avícola AgroTech SIF

Gracias por su interés en contribuir a este proyecto. Este repositorio implementa un **Sistema Informático de Facturación (SIF)** certificado bajo la normativa fiscal española (**Ley 11/2021 de Medidas contra el Fraude Fiscal**, **Real Decreto 1007/2023** y **Orden HAC/1177/2024**). Debido a las exigencias legales y de auditoría técnica, todas las contribuciones deben seguir directrices rigurosas de integridad, seguridad y trazabilidad.

---

## 1. Principios de Desarrollo y Arquitectura Legal

1. **Inmutabilidad y No Manipulación (Ley 11/2021)**:
   - Los registros de facturación generados (`FiscalRecord`) no pueden ser modificados ni eliminados. Toda rectificación o anulación debe emitirse como un nuevo registro encadenado criptográficamente con SHA-256.
2. **Autoridad Exclusiva de Backend**:
   - El cliente web (React) nunca genera huellas hash definitivas, ni asigna numeraciones oficiales de facturas, ni accede de forma directa al almacenamiento persistente de registros fiscales.
3. **Cero Caídas a Fallback Silencioso (Fail-Closed)**:
   - Está terminantemente prohibido capturar errores críticos y degradar la seguridad a modos "mock" o simulación en entornos de producción.

---

## 2. Requisitos Previos y Entorno de Desarrollo

- **Node.js**: Versión 20.x o 22.x LTS.
- **TypeScript**: Compilación estricta (`strict: true`, `noImplicitAny: true`).
- **Variables de Entorno**: Consultar `.env.example` y configurar:
  - `SIF_NIF`, `SIF_NOMBRE_RAZON`, `SIF_INSTALACION_ID` (obligatorias).
  - `AEAT_ENV`: Exclusivamente `test` o `production` (`mock` únicamente permitido si `NODE_ENV !== 'production'`).
  - `ROOT_OWNER_EMAIL`: Identificador del operador raíz (`peduwan@gmail.com`).

---

## 3. Flujo de Trabajo para Pull Requests

1. **Crear una rama descriptiva**:
   ```bash
   git checkout -b feature/nombre-de-la-mejora
   # o
   git checkout -b fix/correccion-defecto
   ```
2. **Desarrollar y mantener el estilo**:
   - Ejecutar verificación de tipos y linting:
     ```bash
     npm run lint
     ```
3. **Ejecutar la suite completa de pruebas**:
   - Todo cambio debe pasar el 100% de los tests unitarios y de conformidad XSD/AEAT:
     ```bash
     npm test
     ```
4. **Verificación de Auditoría de Seguridad**:
   ```bash
   npx tsx scripts/verify-security-config.ts
   ```
5. **Auditoría de Dependencias**:
   ```bash
   npm audit --audit-level=high
   ```

---

## 4. Estándar de Pruebas y Cobertura

- Cada nuevo endpoint o servicio fiscal debe incluir su correspondiente archivo de test en la carpeta `tests/`.
- La cobertura mínima requerida es del **80%** en branches, funciones y líneas (evaluada mediante `c8`).
- Los tests fiscales deben verificar la conformidad con los esquemas XSD oficiales (`docs/fiscal/xsd/`) utilizando el motor real Wasm (`libxml2-wasm`).

---

## 5. Reporte de Vulnerabilidades de Seguridad

Si identifica una vulnerabilidad de seguridad o un defecto que comprometa el cumplimiento tributario, **no abra un issue público**. Póngase en contacto directamente con el equipo de seguridad o el propietario raíz en `peduwan@gmail.com`.
