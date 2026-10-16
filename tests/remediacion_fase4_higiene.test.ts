/**
 * SUITE DE TESTS - FASE 4: HIGIENE Y MANTENIBILIDAD (H1 - H9)
 * Normativa: RD 1007/2023, Orden HAC/1177/2024, Ley 11/2021
 * Ejecución directa: npx tsx tests/remediacion_fase4_higiene.test.ts
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { voiceRouter } from '../src/routes/voiceRoutes';
import { fiscalRouter } from '../src/routes/fiscalRoutes';

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  [PASS] Test: ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] Test: ${name}`);
    console.error(`         Error: ${err.message || err}`);
    throw err;
  }
}

async function main() {
  console.log('========================================================================');
  console.log('  EJECUTANDO SUITE DE TESTS — FASE 4: HIGIENE Y MANTENIBILIDAD (H1 - H9)');
  console.log('========================================================================');

  const rootDir = process.cwd();

  // ==========================================
  // H5: REFACTOR MODULAR DESACOPLADO
  // ==========================================
  console.log('\n--- H5: Desacoplamiento Modular de Rutas (voiceRoutes & fiscalRoutes) ---');

  await runTest('H5.1: voiceRouter está instanciado y contiene rutas de transcripción por voz', () => {
    assert.ok(voiceRouter, 'voiceRouter debe estar definido');
    assert.strictEqual(typeof voiceRouter, 'function', 'voiceRouter debe ser un enrutador Express');

    // Inspeccionar la pila de rutas del enrutador
    const voiceStack = (voiceRouter as any).stack || [];
    assert.ok(voiceStack.length > 0, 'voiceRouter debe contener capas de rutas');

    const routePaths = voiceStack
      .map((layer: any) => layer.route?.path)
      .flat()
      .filter(Boolean);

    assert.ok(
      routePaths.some((p: string) => p.includes('interpretar-puesta')),
      'voiceRouter debe incluir ruta de puesta por voz'
    );
    assert.ok(
      routePaths.some((p: string) => p.includes('interpretar-envasado')),
      'voiceRouter debe incluir ruta de envasado por voz'
    );
    assert.ok(
      routePaths.some((p: string) => p.includes('interpretar-venta')),
      'voiceRouter debe incluir ruta de venta por voz'
    );
  });

  await runTest('H5.2: fiscalRouter está instanciado y contiene las rutas fiscales Veri*Factu', () => {
    assert.ok(fiscalRouter, 'fiscalRouter debe estar definido');
    assert.strictEqual(typeof fiscalRouter, 'function', 'fiscalRouter debe ser un enrutador Express');

    const fiscalStack = (fiscalRouter as any).stack || [];
    assert.ok(fiscalStack.length > 0, 'fiscalRouter debe contener capas de rutas');

    const routePaths = fiscalStack
      .map((layer: any) => layer.route?.path)
      .flat()
      .filter(Boolean);

    assert.ok(
      routePaths.includes('/api/fiscal/emit-invoice'),
      'fiscalRouter debe incluir /api/fiscal/emit-invoice'
    );
    assert.ok(
      routePaths.includes('/api/fiscal/emit-anulacion'),
      'fiscalRouter debe incluir /api/fiscal/emit-anulacion'
    );
    assert.ok(
      routePaths.includes('/api/fiscal/records'),
      'fiscalRouter debe incluir /api/fiscal/records'
    );
    assert.ok(
      routePaths.includes('/api/fiscal/cert-status'),
      'fiscalRouter debe incluir /api/fiscal/cert-status'
    );
    assert.ok(
      routePaths.includes('/api/fiscal/submit'),
      'fiscalRouter debe incluir /api/fiscal/submit'
    );
    assert.ok(
      routePaths.includes('/api/fiscal/outbox/pending'),
      'fiscalRouter debe incluir /api/fiscal/outbox/pending'
    );
  });

  await runTest('H5.3: server.ts importa y monta los enrutadores modulares', () => {
    const serverCode = fs.readFileSync(path.join(rootDir, 'server.ts'), 'utf-8');
    assert.match(serverCode, /import\s+.*voiceRouter.*from\s+['"]\.\/src\/routes\/voiceRoutes['"]/);
    assert.match(serverCode, /import\s+.*fiscalRouter.*from\s+['"]\.\/src\/routes\/fiscalRoutes['"]/);
    assert.match(serverCode, /app\.use\(voiceRouter\)/);
    assert.match(serverCode, /app\.use\(fiscalRouter\)/);
  });

  // ==========================================
  // H1: LICENCIA APACHE-2.0
  // ==========================================
  console.log('\n--- H1: Licencia Oficial Apache-2.0 ---');

  await runTest('H1.1: Archivo LICENSE existe y corresponde a Apache License 2.0', () => {
    const licensePath = path.join(rootDir, 'LICENSE');
    assert.ok(fs.existsSync(licensePath), 'El archivo LICENSE debe existir en la raíz');
    const licenseText = fs.readFileSync(licensePath, 'utf-8');
    assert.match(licenseText, /Apache License/i);
    assert.match(licenseText, /Version 2\.0/i);
    assert.match(licenseText, /http:\/\/www\.apache\.org\/licenses\//i);
  });

  // ==========================================
  // H2: GUÍA DE CONTRIBUCIÓN
  // ==========================================
  console.log('\n--- H2: Guía de Contribución (CONTRIBUTING.md) ---');

  await runTest('H2.1: Archivo CONTRIBUTING.md existe y documenta principios de no alteración y pruebas', () => {
    const contribPath = path.join(rootDir, 'CONTRIBUTING.md');
    assert.ok(fs.existsSync(contribPath), 'El archivo CONTRIBUTING.md debe existir en la raíz');
    const contribText = fs.readFileSync(contribPath, 'utf-8');
    assert.match(contribText, /Ley 11\/2021/i);
    assert.match(contribText, /Real Decreto 1007\/2023/i);
    assert.match(contribText, /Fail-Closed/i);
    assert.match(contribText, /peduwan@gmail\.com/i);
  });

  // ==========================================
  // H3: CÓDIGO DE CONDUCTA
  // ==========================================
  console.log('\n--- H3: Código de Conducta (CODE_OF_CONDUCT.md) ---');

  await runTest('H3.1: Archivo CODE_OF_CONDUCT.md existe conforme a Contributor Covenant', () => {
    const cocPath = path.join(rootDir, 'CODE_OF_CONDUCT.md');
    assert.ok(fs.existsSync(cocPath), 'El archivo CODE_OF_CONDUCT.md debe existir en la raíz');
    const cocText = fs.readFileSync(cocPath, 'utf-8');
    assert.match(cocText, /Código de Conducta/i);
    assert.match(cocText, /Contributor Covenant/i);
    assert.match(cocText, /peduwan@gmail\.com/i);
  });

  // ==========================================
  // H7: PIPELINE DE INTEGRACIÓN CONTINUA (CI)
  // ==========================================
  console.log('\n--- H7: Pipeline de Integración Continua (.github/workflows/ci.yml) ---');

  await runTest('H7.1: .github/workflows/ci.yml existe y bloquea ante vulnerabilidades altas de npm audit', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), 'El pipeline ci.yml debe existir en .github/workflows/');
    const ciText = fs.readFileSync(ciPath, 'utf-8');
    assert.match(ciText, /npm audit --audit-level=high/);
    assert.match(ciText, /npm run lint/);
    assert.match(ciText, /npm test/);
    assert.match(ciText, /npm run build/);
    assert.match(ciText, /node-version:\s*\[\s*20\.x,\s*22\.x\s*\]/);
  });

  // ==========================================
  // H8: CONFIGURACIÓN DE COBERTURA DE CÓDIGO
  // ==========================================
  console.log('\n--- H8: Métricas de Cobertura con Umbral del 80% (.c8rc.json) ---');

  await runTest('H8.1: .c8rc.json existe y define umbral mínimo del 80% en branches, funciones y líneas', () => {
    const c8Path = path.join(rootDir, '.c8rc.json');
    assert.ok(fs.existsSync(c8Path), 'El archivo .c8rc.json debe existir');
    const c8Config = JSON.parse(fs.readFileSync(c8Path, 'utf-8'));
    assert.strictEqual(c8Config.lines, 80, 'Umbral de líneas debe ser 80%');
    assert.strictEqual(c8Config.functions, 80, 'Umbral de funciones debe ser 80%');
    assert.strictEqual(c8Config.branches, 80, 'Umbral de branches debe ser 80%');
    assert.strictEqual(c8Config.checkCoverage, true, 'check-coverage debe estar activado');
  });

  // ==========================================
  // H9: DOCUMENTACIÓN OFICIAL (README.md)
  // ==========================================
  console.log('\n--- H9: Documentación Oficial y Arquitectura en README.md ---');

  await runTest('H9.1: README.md documenta al propietario raíz peduwan@gmail.com y las 3 normativas fiscales', () => {
    const readmePath = path.join(rootDir, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'El archivo README.md debe existir');
    const readmeText = fs.readFileSync(readmePath, 'utf-8');
    assert.match(readmeText, /peduwan@gmail\.com/);
    assert.match(readmeText, /Ley 11\/2021/);
    assert.match(readmeText, /Real Decreto 1007\/2023/);
    assert.match(readmeText, /Orden HAC\/1177\/2024/);
    assert.match(readmeText, /Fail-Closed/);
    assert.match(readmeText, /4 módulos/);
  });

  console.log('\n========================================================================');
  console.log('  RESULTADO SUITE FASE 4 (H1-H9): TODOS LOS TESTS SUPERADOS CON ÉXITO');
  console.log('========================================================================\n');
}

main().catch((err) => {
  console.error('\n*** ERROR FATAL EN LA SUITE DE LA FASE 4 ***\n', err);
  process.exit(1);
});
