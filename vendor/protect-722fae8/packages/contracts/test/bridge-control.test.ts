// SW -> ISOLATED bridge control (ADR-004 changelog, F030): hand validator vs JSON Schema on a small corpus.
import { describe, expect, it } from 'vitest';
import { BRIDGE_CONTROL_COMMANDS, validateBridgeControl } from '../src/index';
import { compileSchema, throwingProxy, withOwnProtoKey } from './helpers';

const ok = (command: unknown): Record<string, unknown> => ({ schemaVersion: 1, type: 'bridge-control', command });

describe('validateBridgeControl vs bridge-control.v1 schema', () => {
  const ajvValidate = compileSchema('bridge-control.v1.schema.json');
  const cases: Array<{ name: string; input: unknown; expect: boolean; handOnly?: boolean }> = [
    ...BRIDGE_CONTROL_COMMANDS.map((command) => ({ name: 'command ' + command, input: ok(command), expect: true })),
    { name: 'null', input: null, expect: false },
    { name: 'array', input: [ok('pause')], expect: false },
    { name: 'missing command', input: { schemaVersion: 1, type: 'bridge-control' }, expect: false },
    { name: 'unknown command', input: ok('restart'), expect: false },
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
