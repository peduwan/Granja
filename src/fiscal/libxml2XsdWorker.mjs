import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { XmlDocument, XsdValidator, xmlRegisterInputProvider } from 'libxml2-wasm';

let currentXsdDir = path.resolve(process.cwd(), 'docs/fiscal/xsd');
const openBuffers = new Map();
let nextFd = 1;

xmlRegisterInputProvider({
  match(filename) {
    if (!filename) return false;
    if (
      filename.includes('SuministroInformacion.xsd') ||
      filename.includes('xmldsig-core-schema.xsd') ||
      filename.includes('SuministroLR.xsd') ||
      filename.includes('RespuestaSuministro.xsd') ||
      filename.includes('ConsultaLR.xsd') ||
      filename.includes('RespuestaConsultaLR.xsd')
    ) {
      return true;
    }
    return fs.existsSync(filename);
  },
  open(filename) {
    try {
      let targetPath = filename;
      if (filename.includes('xmldsig-core-schema.xsd')) {
        targetPath = path.join(currentXsdDir, 'xmldsig-core-schema.xsd');
      } else if (filename.includes('SuministroInformacion.xsd')) {
        targetPath = path.join(currentXsdDir, 'SuministroInformacion.xsd');
      } else if (filename.includes('SuministroLR.xsd') && !fs.existsSync(filename)) {
        targetPath = path.join(currentXsdDir, 'SuministroLR.xsd');
      } else if (!path.isAbsolute(filename) && !fs.existsSync(filename)) {
        targetPath = path.join(currentXsdDir, path.basename(filename));
      }
      if (!fs.existsSync(targetPath)) {
        return undefined;
      }
      const buf = fs.readFileSync(targetPath);
      const fd = nextFd++;
      openBuffers.set(fd, { buf, pos: 0 });
      return fd;
    } catch {
      return undefined;
    }
  },
  read(fd, buf) {
    const state = openBuffers.get(fd);
    if (!state) return -1;
    const remaining = state.buf.length - state.pos;
    if (remaining <= 0) return 0;
    const toCopy = Math.min(remaining, buf.length);
    state.buf.copy(buf, 0, state.pos, state.pos + toCopy);
    state.pos += toCopy;
    return toCopy;
  },
  close(fd) {
    openBuffers.delete(fd);
    return true;
  }
});

// Cache compiled XsdValidator by schemaPath + mtimeMs
const validatorCache = new Map();

function getCompiledValidator(schemaPath) {
  const stat = fs.statSync(schemaPath);
  const cacheKey = `${schemaPath}:${stat.mtimeMs}`;
  const cached = validatorCache.get(cacheKey);
  if (cached) {
    return cached.validator;
  }

  currentXsdDir = path.dirname(schemaPath);
  const schemaBuf = fs.readFileSync(schemaPath);
  const schemaDoc = XmlDocument.fromBuffer(schemaBuf, { url: schemaPath });
  const validator = XsdValidator.fromDoc(schemaDoc);
  validatorCache.set(cacheKey, { schemaDoc, validator });
  return validator;
}

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { xmlString, schemaPath, signal, port } = msg;
    let response;
    try {
      const validator = getCompiledValidator(schemaPath);
      const xmlDoc = XmlDocument.fromString(xmlString);
      try {
        validator.validate(xmlDoc);
        response = {
          valid: true,
          errors: [],
          engine: 'libxml2-wasm'
        };
      } catch (valErr) {
        const details = Array.isArray(valErr?.details)
          ? valErr.details.map((d) => `Schemas validity error : ${d.message ? d.message.trim() : String(d)}`)
          : [`Schemas validity error : ${valErr?.message ? valErr.message.trim() : String(valErr)}`];
        response = {
          valid: false,
          errors: details,
          engine: 'libxml2-wasm'
        };
      } finally {
        xmlDoc.dispose();
      }
    } catch (err) {
      response = {
        valid: false,
        errors: [`XML/XSD error (libxml2): ${err?.message ? err.message.trim() : String(err)}`],
        engine: 'libxml2-wasm'
      };
    }

    try {
      port.postMessage(response);
    } finally {
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0, 1);
    }
  });
}
