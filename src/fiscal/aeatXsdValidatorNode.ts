/**
 * VALIDADOR NORMATIVO XSD PARA ENTORNO NODE.JS / CLI
 *
 * Utiliza libxml2 (xmllint) para validar el XML contra los esquemas XSD oficiales
 * de la Agencia Estatal de Administración Tributaria (AEAT):
 * - SuministroLR.xsd
 * - SuministroInformacion.xsd
 * - xmldsig-core-schema.xsd
 *
 * Este archivo está aislado exclusivamente para tests y backend Node.
 * NO debe ser importado en código cliente del navegador.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { validateAeatVerifactuXml } from './aeatVerifactuXmlBuilder';

export interface XmlValidationReport {
  valid: boolean;
  errors: string[];
}

/**
 * Validador formal estricto contra los esquemas XSD oficiales de la AEAT
 * (SuministroLR.xsd y sus importaciones asociadas) utilizando el motor normativo xmllint (libxml2).
 * Si xmllint no está disponible en el entorno del sistema, delega en validateAeatVerifactuXml.
 */
export function validateXmlAgainstOfficialXsd(
  xmlString: string,
  xsdFilePath?: string
): XmlValidationReport {
  const schemaPath = xsdFilePath || path.resolve(process.cwd(), 'docs/fiscal/xsd/SuministroLR.xsd');
  if (!fs.existsSync(schemaPath)) {
    return {
      valid: false,
      errors: [`No se encontró el archivo de esquema oficial XSD en '${schemaPath}'.`]
    };
  }

  const tmpFile = path.join(os.tmpdir(), `aeat_xsd_val_${Date.now()}_${Math.random().toString(36).slice(2)}.xml`);
  try {
    fs.writeFileSync(tmpFile, xmlString, 'utf-8');
    try {
      execFileSync('xmllint', ['--schema', schemaPath, '--noout', tmpFile], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { valid: true, errors: [] };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // Si xmllint no está instalado en el sistema operativo, validar con el validador normativo interno
        return validateAeatVerifactuXml(xmlString);
      }
      const output = (err.stderr || err.stdout || err.message || '').toString();
      const rawLines = output
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.includes('Schemas validity error') || l.includes('fails to validate') || l.includes('parser error'));
      const errors = rawLines.length > 0 ? rawLines : [output.trim() || 'Error de validación XSD'];
      return { valid: false, errors };
    }
  } finally {
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // cleanup ignore
      }
    }
  }
}

export const validateAeatXmlAgainstXsd = validateXmlAgainstOfficialXsd;
