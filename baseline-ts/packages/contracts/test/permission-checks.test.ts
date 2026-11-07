// ADR-026: paired permission evidence, independent of current settings and site policy.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { EMPTY_DROPPED, MAX_COUNT, MAX_PERMISSION_CHECKS, PERMISSION_NAMES, readPermissionChecks, validateProSession } from '../src/index';
import type { PermissionCheck, ProSession, ReportProjection } from '../src/index';

const row = (overrides: Partial<PermissionCheck> = {}): PermissionCheck => ({ permission: 'camera', kind: 'permission', result: 'granted', count: 1, countQuality: 'exact', ...overrides });
const checks = [row({ count: 2 }), row({ permission: 'microphone', result: 'denied', count: 3 }), row({ kind: 'policy', result: 'blocked' })];
const projection = (): ReportProjection => ({ reportRevision: 1, documentKey: '7:0:DOC1', host: 'example.com', coverageState: 'active', coverageFlags: [], techniques: [], findings: [], vendors: [], dropped: { ...EMPTY_DROPPED }, observedSince: 1000, scopeMode: 'all-sites', permissionChecks: structuredClone(checks) });
function pro(): ProSession {
  return { schemaVersion: 1, id: 'session-permissions', domain: 'example.com', siteKey: 'example.com', startTabId: 7, status: 'stopped', startedAt: 1000, deadlineAt: 601000, stoppedAt: 2000, stopReason: 'manual', limitations: [], dropped: { pages: 0, resources: 0, documents: 0, events: 0 }, pages: [{ id: 'page-1', tabId: 7, documentKey: '7:0:DOC1', url: 'https://example.com/', title: 'Fixture', startedAt: 1000, endedAt: 2000, reports: [projection()], resources: [] }] };
}
const common = JSON.parse(readFileSync(new URL('../schemas/common.v1.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const ajv = new Ajv2020({ strict: true, allErrors: true }); ajv.addSchema(common);
const schema = ajv.compile({ $ref: String(common['$id']) + '#/$defs/permissionChecks' });
const projectionSchema = ajv.compile(JSON.parse(readFileSync(new URL('../schemas/report-projection.v1.schema.json', import.meta.url), 'utf8')));

describe('paired permission-check DTO boundary', () => {
  it('keeps camera/granted, microphone/denied and camera/policy-blocked separate, with detached copies', () => {
    const input = structuredClone(checks), result = readPermissionChecks(input)!;
    expect(result).toEqual(checks); expect(schema(input)).toBe(true);
    result[0]!.count = 19;
    expect(input[0]!.count).toBe(2);
    expect(result).not.toContainEqual(expect.objectContaining({ permission: 'microphone', result: 'granted' }));
  });

  it('accepts all bounded name/result pairs and retains historical transitions', () => {
    const all = PERMISSION_NAMES.flatMap(permission => [
      ...(['granted', 'denied', 'prompt'] as const).map(result => row({ permission, result })),
      ...(['allowed', 'blocked'] as const).map(result => row({ permission, kind: 'policy', result })),
    ]);
    expect(all).toHaveLength(MAX_PERMISSION_CHECKS);
    expect(readPermissionChecks(all)).toEqual(all); expect(schema(all)).toBe(true);
    expect(readPermissionChecks([...all, row()])).toBeNull(); expect(schema([...all, row()])).toBe(false);
  });

  it.each([
    { permission: 'camera-secret' }, { permission: '' }, { result: 'unknown' }, { kind: 'permission', result: 'allowed' },
    { kind: 'permission', result: 'blocked' }, { kind: 'policy', result: 'granted' }, { kind: 'policy', result: 'denied' },
    { kind: 'policy', result: 'prompt' }, { count: 0 }, { count: -1 }, { count: 1.1 }, { count: MAX_COUNT + 1 },
    { count: Number.NaN }, { count: Number.POSITIVE_INFINITY }, { count: '1' }, { countQuality: 'certain' },
  ])('rejects invalid paired primitives %j', invalid => {
    const value = [{ ...row(), ...invalid }];
    expect(readPermissionChecks(value)).toBeNull(); expect(schema(value)).toBe(false);
  });

  it('rejects duplicate tuples even when counts/quality differ; schema is explicitly weaker for that case', () => {
    const exact = [row(), row()], differing = [row(), row({ count: 2, countQuality: 'lower-bound' })];
    expect(readPermissionChecks(exact)).toBeNull(); expect(schema(exact)).toBe(false);
    expect(readPermissionChecks(differing)).toBeNull();
    // JSON Schema uniqueItems compares complete rows; runtime also enforces tuple uniqueness.
    expect(schema(differing)).toBe(true);
  });

  it('rejects hidden/symbol/raw fields, foreign prototypes and sparse/custom arrays', () => {
    const hidden = row(); Object.defineProperty(hidden, 'secret', { value: 'RAW_PERMISSION_CANARY' });
    const symbol = row(); Object.defineProperty(symbol, Symbol('secret'), { value: 'RAW_PERMISSION_CANARY' });
    const foreign = Object.assign(Object.create({ inherited: true }) as object, row());
    const named = Object.assign([row()], { descriptor: 'RAW_PERMISSION_CANARY' });
    const symbolic = [row()]; Object.defineProperty(symbolic, Symbol('extra'), { value: true });
    const sparse = new Array<PermissionCheck>(1);
    const changedPrototype = [row()]; Object.setPrototypeOf(changedPrototype, null);
    for (const value of [[hidden], [symbol], [foreign], named, symbolic, sparse, changedPrototype, [{ ...row(), name: 'camera' }]]) expect(readPermissionChecks(value)).toBeNull();
    expect(readPermissionChecks([Object.assign(Object.create(null) as object, row())])).toEqual([row()]);
  });

  it('refuses row and array accessors without calling them', () => {
    let called = 0;
    const accessor = row(); Object.defineProperty(accessor, 'permission', { enumerable: true, get() { called++; return 'camera'; } });
    const array: unknown[] = []; Object.defineProperty(array, '0', { enumerable: true, get() { called++; return row(); } });
    expect(readPermissionChecks([accessor])).toBeNull(); expect(readPermissionChecks(array)).toBeNull();
    expect(called).toBe(0);
  });

  it('does not mistake inherited descriptor.value for an own data slot', () => {
    let called = 0;
    const accessor = row(); Object.defineProperty(accessor, 'permission', { enumerable: true, get() { called++; return 'microphone'; } });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let result: PermissionCheck[] | null;
    try {
      Object.defineProperty(Object.prototype, 'value', { value: 'camera', configurable: true });
      result = readPermissionChecks([accessor]);
    } finally {
      if (previous) Object.defineProperty(Object.prototype, 'value', previous); else Reflect.deleteProperty(Object.prototype, 'value');
    }
    expect(result).toBeNull(); expect(called).toBe(0);
  });

  it('keeps optional-field compatibility and pairs through projection schema and stopped Pro restore', () => {
    const old = projection(); delete old.permissionChecks;
    expect(projectionSchema(old)).toBe(true); expect(projectionSchema(projection())).toBe(true);
    const session = JSON.parse(JSON.stringify(pro())) as ProSession;
    expect(validateProSession(session).ok).toBe(true);
    expect(session.pages[0]!.reports[0]!.permissionChecks).toEqual(checks);
    session.pages[0]!.reports[0]!.permissionChecks![2]!.result = 'granted';
    expect(validateProSession(session).ok).toBe(false);
  });
});
