// Test-only helpers. Ajv is used here for cross-checking the JSON Schemas against the hand-written
// validator; it is never shipped (it compiles schemas with dynamic code, which MV3 CSP forbids).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

export const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export type JsonSchema = Record<string, unknown>;

export function loadSchema(name: string): JsonSchema {
  return JSON.parse(readFileSync(join(schemasDir, name), 'utf8')) as JsonSchema;
}

export function makeAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: false });
  ajv.addSchema(loadSchema('common.v1.schema.json'));
  return ajv;
}

export function compileSchema(name: string): ValidateFunction {
  return makeAjv().compile(loadSchema(name));
}

/** Own-property "__proto__" key, as produced by JSON.parse (not a prototype assignment). */
export function withOwnProtoKey(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const text = JSON.stringify(value);
  return JSON.parse(text.slice(0, -1) + ',' + JSON.stringify(key) + ':1}') as Record<string, unknown>;
}

export const unicode513 = 'я'.repeat(513);
export const ascii513 = 'a'.repeat(513);
export const id64 = 'a'.repeat(64);
export const id65 = 'a'.repeat(65);

export function throwingProxy(): unknown {
  return new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
      get() {
        throw new Error('hostile get');
      },
      has() {
        throw new Error('hostile has');
      },
    },
  );
}

export function throwingGetterObject(): unknown {
  return {
    get schemaVersion(): number {
      throw new Error('hostile getter');
    },
    type: 'sensor-events',
  };
}
