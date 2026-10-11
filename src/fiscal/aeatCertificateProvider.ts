/**
 * PROVEEDOR DE CERTIFICADOS ELECTRÓNICOS AEAT (FASE 3.1)
 *
 * Normativa Oficial:
 * - Ley 11/2021 | RD 1007/2023 | Orden HAC/1177/2024
 *
 * REGLAS ABSOLUTAS DE SEGURIDAD:
 * 1. NUNCA almacenar certificados ni claves privadas en el frontend, LocalStorage, Firestore ni AppData.
 * 2. NUNCA incorporar material criptográfico privado en FiscalRecord ni en FiscalSubmission.
 * 3. Esta abstracción opera exclusivamente en el entorno backend/servidor (Node.js/Express).
 * 4. Las credenciales se inyectan mediante variables de entorno seguras en el servidor.
 */

import crypto from 'node:crypto';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';

export interface AeatCertificateCredentials {
  readonly pfx?: Buffer;
  readonly passphrase?: string;
  readonly cert?: string;
  readonly key?: string;
}

export interface AeatCertificateInfo {
  readonly available: boolean;
  readonly type?: 'PKCS12' | 'PEM';
  readonly subject?: string;
  readonly issuer?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export interface AeatCertificateValidationReport {
  readonly valid: boolean;
  readonly type?: 'PKCS12' | 'PEM';
  readonly subject?: string;
  readonly issuer?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly serialNumber?: string;
  readonly reason?: string;
  /**
   * En contenedores PFX/PKCS#12: indica si se pudo extraer el certificado X.509 hoja para
   * validar fechas de vigencia (validFrom/validTo) y correspondencia de clave además de la integridad
   * del contenedor y contraseña mediante tls.createSecureContext.
   */
  readonly fullX509InspectionPerformed?: boolean;
}

export class AeatCertificateProvider {
  private static cachedCredentials: AeatCertificateCredentials | null = null;

  private static isPlaceholder(val?: string | null): boolean {
    if (!val) return true;
    const t = val.trim().toLowerCase();
    return t === '' || t === 'vacio' || t === 'vacío' || t === 'placeholder' || t === 'none' || t === 'undefined';
  }

  /**
   * Sanitiza cualquier mensaje de error o texto de log eliminando bloques PEM de claves privadas,
   * contraseñas de certificados, payloads Base64 de contenedores PFX y variables sensibles del entorno.
   */
  public static sanitizeSensitiveData(input: string): string {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input;

    // 1. Redactar bloques PEM de claves privadas (RSA, EC, PKCS#8, ENCRYPTED)
    sanitized = sanitized.replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'
    );

    // 2. Redactar valores explícitos de variables de entorno sensibles si estuvieran configuradas
    const envSecrets = [
      process.env.AEAT_CERT_PASSWORD,
      process.env.AEAT_KEY_PEM,
      process.env.AEAT_CERT_PFX_BASE64
    ];
    for (const secret of envSecrets) {
      if (secret && typeof secret === 'string' && secret.trim().length >= 4 && !this.isPlaceholder(secret)) {
        const trimmed = secret.trim();
        sanitized = sanitized.split(trimmed).join('[REDACTED_SECRET]');
      }
    }

    // 3. Redactar patrones de passphrase/password en URLs o parámetros
    sanitized = sanitized.replace(
      /(passphrase|password|passin)\s*(=|:)\s*([^\s,;'"`]+)/gi,
      '$1$2[REDACTED_SECRET]'
    );

    return sanitized;
  }

  /**
   * Valida criptográficamente un par PEM (certificado X.509 + clave privada) verificando:
   * 1. Estructura ASN.1 / X.509 válida.
   * 2. Vigencia temporal (validFrom <= now <= validTo).
   * 3. Correspondencia matemática entre la clave privada y la clave pública del certificado.
   */
  public static validatePemCertificatePair(
    certPem: string,
    keyPem: string,
    passphrase?: string
  ): AeatCertificateValidationReport {
    try {
      const x509 = new crypto.X509Certificate(certPem);
      const now = Date.now();
      const validFromMs = Date.parse(x509.validFrom);
      const validToMs = Date.parse(x509.validTo);

      if (!isNaN(validFromMs) && now < validFromMs) {
        return {
          valid: false,
          type: 'PEM',
          subject: x509.subject,
          issuer: x509.issuer,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          serialNumber: x509.serialNumber,
          fullX509InspectionPerformed: true,
          reason: `El certificado X.509 aún no es válido (validFrom: ${x509.validFrom}).`
        };
      }
      if (!isNaN(validToMs) && now > validToMs) {
        return {
          valid: false,
          type: 'PEM',
          subject: x509.subject,
          issuer: x509.issuer,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          serialNumber: x509.serialNumber,
          fullX509InspectionPerformed: true,
          reason: `El certificado X.509 ha expirado (validTo: ${x509.validTo}).`
        };
      }

      const privKey = crypto.createPrivateKey({
        key: keyPem,
        format: 'pem',
        ...(passphrase ? { passphrase } : {})
      });

      if (!x509.checkPrivateKey(privKey)) {
        return {
          valid: false,
          type: 'PEM',
          subject: x509.subject,
          issuer: x509.issuer,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          serialNumber: x509.serialNumber,
          fullX509InspectionPerformed: true,
          reason: 'La clave privada suministrada no corresponde a la clave pública del certificado X.509.'
        };
      }

      return {
        valid: true,
        type: 'PEM',
        subject: x509.subject,
        issuer: x509.issuer,
        validFrom: x509.validFrom,
        validTo: x509.validTo,
        serialNumber: x509.serialNumber,
        fullX509InspectionPerformed: true
      };
    } catch (err: any) {
      return {
        valid: false,
        type: 'PEM',
        fullX509InspectionPerformed: false,
        reason: this.sanitizeSensitiveData(
          `Certificado X.509 o clave privada PEM criptográficamente inválidos: ${err?.message || String(err)}`
        )
      };
    }
  }

  /**
   * Valida criptográficamente un contenedor PKCS#12 / PFX verificando:
   * 1. Integridad ASN.1/PKCS#12, MAC y contraseña mediante `tls.createSecureContext({ pfx, passphrase })` (OpenSSL nativo de Node.js).
   * 2. Extracción en memoria (vía stdin/stdout de openssl pkcs12 sin tocar disco ni exponer la contraseña en argv)
   *    del certificado X.509 y la clave privada para verificar vigencia temporal (`validFrom` / `validTo`) y correspondencia de clave.
   *
   * NOTA TÉCNICA DE PARIDAD PEM vs PFX:
   * - `tls.createSecureContext` verifica siempre en memoria que el contenedor PKCS#12 es auténtico, que la contraseña lo descifra
   *   y que la clave privada coincide con el certificado del contenedor.
   * - Sin embargo, `crypto.X509Certificate` de Node.js no parsea buffers PKCS#12 directamente. Por ello, para validar `validFrom`/`validTo`
   *   antes del handshake de red, se emplea `openssl pkcs12` por tuberías en memoria (`pass:stdin`). Si el binario `openssl` no estuviera
   *   disponible en el sistema operativo, `fullX509InspectionPerformed` será `false` y la caducidad será verificada por el servidor mTLS.
   */
  public static validatePfxCertificate(
    pfxBuffer: Buffer,
    passphrase?: string
  ): AeatCertificateValidationReport {
    if (!pfxBuffer || !Buffer.isBuffer(pfxBuffer) || pfxBuffer.length === 0) {
      return {
        valid: false,
        type: 'PKCS12',
        fullX509InspectionPerformed: false,
        reason: 'Contenedor PKCS#12 / PFX vacío o no válido.'
      };
    }

    // 1. Validar integridad PKCS#12, contraseña y par clave/certificado con OpenSSL interno de Node.js
    try {
      tls.createSecureContext({
        pfx: pfxBuffer,
        ...(passphrase !== undefined ? { passphrase } : {})
      });
    } catch (err: any) {
      return {
        valid: false,
        type: 'PKCS12',
        fullX509InspectionPerformed: false,
        reason: this.sanitizeSensitiveData(
          `Contenedor PKCS#12 / PFX inválido o contraseña incorrecta: ${err?.message || String(err)}`
        )
      };
    }

    // 2. Extraer certificado X.509 en memoria para comprobar vigencia temporal (validFrom / validTo)
    try {
      const envWithPass = {
        ...process.env,
        AEAT_INTERNAL_PFX_PASS: passphrase ?? ''
      };
      const certExtract = spawnSync(
        'openssl',
        ['pkcs12', '-in', '-', '-clcerts', '-nokeys', '-passin', 'env:AEAT_INTERNAL_PFX_PASS'],
        {
          input: pfxBuffer,
          env: envWithPass,
          timeout: 5000
        }
      );

      if (certExtract.status === 0 && certExtract.stdout) {
        const outStr = certExtract.stdout.toString('utf-8');
        const pemMatch = outStr.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
        if (pemMatch) {
          const x509 = new crypto.X509Certificate(pemMatch[0]);
          const now = Date.now();
          const validFromMs = Date.parse(x509.validFrom);
          const validToMs = Date.parse(x509.validTo);

          if (!isNaN(validFromMs) && now < validFromMs) {
            return {
              valid: false,
              type: 'PKCS12',
              subject: x509.subject,
              issuer: x509.issuer,
              validFrom: x509.validFrom,
              validTo: x509.validTo,
              serialNumber: x509.serialNumber,
              fullX509InspectionPerformed: true,
              reason: `El certificado X.509 contenido en el PFX aún no es válido (validFrom: ${x509.validFrom}).`
            };
          }
          if (!isNaN(validToMs) && now > validToMs) {
            return {
              valid: false,
              type: 'PKCS12',
              subject: x509.subject,
              issuer: x509.issuer,
              validFrom: x509.validFrom,
              validTo: x509.validTo,
              serialNumber: x509.serialNumber,
              fullX509InspectionPerformed: true,
              reason: `El certificado X.509 contenido en el PFX ha expirado (validTo: ${x509.validTo}).`
            };
          }

          return {
            valid: true,
            type: 'PKCS12',
            subject: x509.subject,
            issuer: x509.issuer,
            validFrom: x509.validFrom,
            validTo: x509.validTo,
            serialNumber: x509.serialNumber,
            fullX509InspectionPerformed: true
          };
        }
      }
    } catch {
      // Si el binario externo openssl no está disponible, mantenemos la validación criptográfica de tls.createSecureContext
    }

    return {
      valid: true,
      type: 'PKCS12',
      fullX509InspectionPerformed: false
    };
  }

  /**
   * Valida criptográficamente cualesquiera credenciales mTLS (PEM o PKCS#12/PFX).
   */
  public static validateCredentials(
    creds: AeatCertificateCredentials,
    options?: { allowSyntheticTestPem?: boolean }
  ): AeatCertificateValidationReport {
    if (creds.pfx) {
      return this.validatePfxCertificate(creds.pfx, creds.passphrase);
    }
    if (creds.cert && creds.key) {
      const isReallookingPem =
        creds.cert.includes('-----BEGIN CERTIFICATE-----') &&
        creds.key.includes('-----BEGIN') &&
        creds.cert.length > 200;
      if (!isReallookingPem && options?.allowSyntheticTestPem) {
        return {
          valid: true,
          type: 'PEM',
          fullX509InspectionPerformed: false
        };
      }
      return this.validatePemCertificatePair(creds.cert, creds.key, creds.passphrase);
    }
    return {
      valid: false,
      reason: 'No se suministraron credenciales PEM ni PKCS#12/PFX.'
    };
  }

  /**
   * Comprueba si el servidor dispone de credenciales de certificado configuradas.
   */
  public static hasCertificate(): boolean {
    if (this.cachedCredentials !== null) {
      return true;
    }
    const hasPfx = !this.isPlaceholder(process.env.AEAT_CERT_PFX_BASE64) && !this.isPlaceholder(process.env.AEAT_CERT_PASSWORD);
    const hasPem = !this.isPlaceholder(process.env.AEAT_CERT_PEM) && !this.isPlaceholder(process.env.AEAT_KEY_PEM);
    return hasPfx || hasPem;
  }

  /**
   * Obtiene la información pública del estado del certificado sin revelar secretos.
   */
  public static getPublicInfo(): AeatCertificateInfo {
    const hasPfx = !this.isPlaceholder(process.env.AEAT_CERT_PFX_BASE64);
    const hasPem = !this.isPlaceholder(process.env.AEAT_CERT_PEM);

    if (hasPfx) {
      return { available: true, type: 'PKCS12' };
    }
    if (hasPem) {
      return { available: true, type: 'PEM' };
    }
    return { available: false };
  }

  /**
   * Carga de forma segura las credenciales de mTLS para la conexión HTTPS con AEAT.
   * Exclusivo para ejecución en servidor Node.js.
   */
  public static getCredentials(): AeatCertificateCredentials | null {
    if (typeof window !== 'undefined') {
      throw new Error('AeatCertificateProvider: VIOLACIÓN DE SEGURIDAD. Las credenciales de certificado NUNCA deben solicitarse desde el frontend del navegador.');
    }

    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }

    const pfxBase64 = process.env.AEAT_CERT_PFX_BASE64;
    const passphrase = process.env.AEAT_CERT_PASSWORD;

    if (!this.isPlaceholder(pfxBase64) && !this.isPlaceholder(passphrase)) {
      const pfx = Buffer.from(pfxBase64!, 'base64');
      this.cachedCredentials = {
        pfx,
        passphrase: passphrase || ''
      };
      return this.cachedCredentials;
    }

    const cert = process.env.AEAT_CERT_PEM;
    const key = process.env.AEAT_KEY_PEM;

    if (!this.isPlaceholder(cert) && !this.isPlaceholder(key)) {
      this.cachedCredentials = {
        cert,
        key
      };
      return this.cachedCredentials;
    }

    return null;
  }

  /**
   * Permite inyectar credenciales temporales en tests de backend.
   */
  public static setMockCredentialsForTesting(creds: AeatCertificateCredentials | null): void {
    this.cachedCredentials = creds;
  }

  /**
   * Limpia la caché de credenciales en memoria.
   */
  public static clear(): void {
    this.cachedCredentials = null;
  }
}
