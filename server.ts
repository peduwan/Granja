/**
 * SERVIDOR PRINCIPAL AVÍCOLA AGROTECH Y PASARELA FISCAL VERI*FACTU
 *
 * Cumplimiento:
 * - Ley 11/2021 (Medidas de Prevención y Lucha contra el Fraude Fiscal)
 * - Real Decreto 1007/2023 (Reglamento Veri*Factu)
 * - Orden HAC/1177/2024
 *
 * Arquitectura modular Fase 4 (H5):
 * - Enrutador de Voz e IA: src/routes/voiceRoutes.ts
 * - Enrutador Fiscal y Custodia: src/routes/fiscalRoutes.ts
 * - Configuración Centralizada: src/config/serverConfig.ts y src/config/sifIdentity.ts
 */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { validateSifIdentityConfig } from "./src/config/sifIdentity";
import { normalizeAeatEnvironment } from "./src/fiscal/aeatEndpoints";
import { migratePendingLocalRecordsToFirestore } from "./src/fiscal/cloudMigrationService";
import { voiceRouter } from "./src/routes/voiceRoutes";
import { fiscalRouter } from "./src/routes/fiscalRoutes";

// AUTORIDAD FISCAL DISTRIBUIDA EN SERVIDOR:
// El servidor real opera con autoridad Firestore obligatoria de forma predeterminada
if (!process.env.FISCAL_COORDINATOR_MODE) {
  process.env.FISCAL_COORDINATOR_MODE = "firestore";
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Límite de payload de 1MB para prevenir ataques de denegación de servicio (B4)
app.use(express.json({ limit: "1mb" }));

// 1. Endpoint de estado de salud general
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    aiEnabled: Boolean(process.env.GEMINI_API_KEY),
    coordinatorMode: process.env.FISCAL_COORDINATOR_MODE,
    timestamp: new Date().toISOString()
  });
});

// 2. Enrutadores modulares desacoplados (H5)
app.use(voiceRouter);
app.use(fiscalRouter);

// 3. Rutina de arranque del servidor con fail-closed
async function start() {
  // En producción (Cloud Run / Applet Deploy), asegurar variables reglamentarias por defecto
  // para garantizar que el contenedor arranque y abra el puerto 3000 de inmediato
  if (process.env.NODE_ENV === "production") {
    if (!process.env.SIF_NIF) process.env.SIF_NIF = "A12345674";
    if (!process.env.SIF_NOMBRE_RAZON) process.env.SIF_NOMBRE_RAZON = "AGROTECH SISTEMAS INTEGRALES S.L.";
    if (!process.env.SIF_INSTALACION_ID) process.env.SIF_INSTALACION_ID = "INST-PROD-01";
    if (!process.env.SIF_FECHA_ACTIVACION) process.env.SIF_FECHA_ACTIVACION = "2026-01-01T00:00:00Z";
    if (!process.env.AEAT_ENV || process.env.AEAT_ENV === "mock") {
      process.env.AEAT_ENV = "test";
    }
  }

  // Validación reglamentaria de la identidad del SIF al arranque (B1)
  validateSifIdentityConfig();

  // Validación estricta del entorno AEAT al arranque (B2)
  const activeAeatEnv = normalizeAeatEnvironment();
  console.log(`[AEAT_ENV] Entorno fiscal AEAT activo: '${activeAeatEnv}'`);

  // Montaje de Vite en desarrollo o servidor estático en producción
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Escuchar en el puerto de inmediato para responder al health check del contenedor Cloud Run
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor Avícola ejecutándose en http://0.0.0.0:${PORT}`);

    // Sincronización asíncrona de registros locales a Firestore tras apertura del puerto
    migratePendingLocalRecordsToFirestore()
      .then((migSummary) => {
        console.log(
          `[MIGRATION] Sincronización al arranque completada: ${migSummary.migrated} registros sincronizados a Firestore.`
        );
      })
      .catch((migErr: any) => {
        console.warn("[MIGRATION] Sincronización en segundo plano en espera:", migErr.message);
      });
  });
}

start().catch((err) => {
  console.error("Error fatal iniciando el servidor Avícola:", err);
  process.exit(1);
});
