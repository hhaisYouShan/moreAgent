import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SCHEMA_FILES = Object.freeze([
  'common.schema.json',
  'project.schema.json',
  'workflow.schema.json',
  'task.schema.json',
  'work.schema.json',
  'execution.schema.json',
  'governance.schema.json',
  'evidence.schema.json',
]);

export async function createSchemaRegistry({ root = moduleRoot } = {}) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const schemas = new Map();
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(await readFile(path.join(root, 'schemas', file), 'utf8'));
    if (!schema.$id) throw new Error(`Schema ${file} is missing $id`);
    ajv.addSchema(schema);
    schemas.set(schema.$id, schema);
  }

  for (const schemaId of schemas.keys()) {
    if (!ajv.getSchema(schemaId)) throw new Error(`Schema did not compile: ${schemaId}`);
  }

  return Object.freeze({
    schemaIds: Object.freeze([...schemas.keys()]),
    getSchema(schemaId) {
      return schemas.get(schemaId) || null;
    },
    validate(schemaId, value) {
      const validator = ajv.getSchema(schemaId);
      if (!validator) throw new Error(`Unknown schema: ${schemaId}`);
      const valid = validator(value);
      return {
        valid: Boolean(valid),
        errors: valid ? [] : normalizeErrors(validator.errors),
      };
    },
    assert(schemaId, value) {
      const result = this.validate(schemaId, value);
      if (!result.valid) {
        const error = new TypeError(`Contract validation failed for ${schemaId}`);
        error.code = 'OUTPUT_CONTRACT_ERROR';
        error.validationErrors = result.errors;
        throw error;
      }
      return value;
    },
  });
}

function normalizeErrors(errors = []) {
  return errors.map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message,
    params: error.params,
  }));
}
