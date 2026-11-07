// SW -> ISOLATED bridge control (ADR-004 changelog, F030): hand validator vs JSON Schema on a small corpus.
import { describe, expect, it } from 'vitest';
import { BRIDGE_CONTROL_COMMANDS, validateBridgeControl } from '../src/index';
import { compileSchema, throwingProxy, withOwnProtoKey } from './helpers';

const ok = (command: unknown): Record<string, unknown> => ({ schemaVersion: 1, type: 'bridge-control', command });

describe('validateBridgeControl vs bridge-control.v1 schema', () => {
  const ajvValidate = compileSchema('bridge-control.v1.schema.json');
  const cases: Array<{ name: string; input: unknown; expect: boolean; handOnly?: boolean }> = [
    // Simple commands validate on shape alone; 'reset' is a privileged SW→ISO message carrying a resetId
    // (ADR-073) and is exercised separately below.
    ...BRIDGE_CONTROL_COMMANDS.filter((command) => command !== 'reset').map((command) => ({ name: 'command ' + command, input: ok(command), expect: true })),
    { name: 'reset without resetId', input: ok('reset'), expect: false },
    // The reset variant has no JSON-schema representation (it is not a plain command); hand validator only.
    { name: 'reset with resetId', input: { ...ok('reset'), resetId: 'reset-abc' }, expect: true, handOnly: true },
    { name: 'reset with empty resetId', input: { ...ok('reset'), resetId: '' }, expect: false, handOnly: true },
    { name: 'null', input: null, expect: false },
    { name: 'array', input: [ok('pause')], expect: false },
    { name: 'missing command', input: { schemaVersion: 1, type: 'bridge-control' }, expect: false },
    { name: 'unknown command', input: ok('stop'), expect: false },
    { name: 'command number', input: ok(1), expect: false },
    { name: 'schemaVersion 2', input: { ...ok('pause'), schemaVersion: 2 }, expect: false },
    { name: 'type bridge-pause (page message type)', input: { ...ok('pause'), type: 'bridge-pause' }, expect: false },
    { name: 'unknown key (no tab/document ids in the payload)', input: { ...ok('pause'), documentKey: '1:0:x' }, expect: false },
    { name: 'own __proto__ key', input: withOwnProtoKey(ok('pause'), '__proto__'), expect: false },
    { name: 'hostile proxy', input: throwingProxy(), expect: false, handOnly: true },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const hand = validateBridgeControl(c.input);
      expect(hand.ok).toBe(c.expect);
      if (c.handOnly) return;
      expect(ajvValidate(c.input)).toBe(c.expect);
      if (hand.ok) {
        expect(ajvValidate(hand.value)).toBe(true);
        expect(hand.value).toEqual(c.input);
        expect(hand.value).not.toBe(c.input);
      }
    });
  }
});
