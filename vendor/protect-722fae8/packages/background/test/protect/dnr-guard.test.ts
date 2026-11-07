import { DNR_PRIORITIES } from '@detect-expert/contracts';
import { DnrGuardError, FORBIDDEN_DNR_ACTIONS, assertAllowedRule, isAllowedRule } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';

const BLOCK = { id: 100001, priority: DNR_PRIORITIES.receiverBlock, action: { type: 'block' }, condition: { requestDomains: ['collect.example'], excludedTopDomains: ['collect.example'] } };
const GPC = { id: 1, priority: DNR_PRIORITIES.gpc, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] } };

describe('assertAllowedRule (ADR-020 §C, §5)', () => {
  it('accepts block / allow / Sec-GPC rules in their ranges', () => {
    expect(() => assertAllowedRule(BLOCK)).not.toThrow();
    expect(() => assertAllowedRule({ ...BLOCK, id: 100002, priority: DNR_PRIORITIES.siteAllow, action: { type: 'allow' }, condition: { requestDomains: ['collect.example'], topDomains: ['shop.example'] } })).not.toThrow();
    expect(() => assertAllowedRule(GPC)).not.toThrow();
    expect(() => assertAllowedRule({ id: 200000, priority: DNR_PRIORITIES.once, action: { type: 'block' }, condition: { requestDomains: ['collect.example'], tabIds: [7] } })).not.toThrow();
    expect(() => assertAllowedRule({ id: 101000, priority: DNR_PRIORITIES.presetBlock, action: { type: 'block' }, condition: { urlFilter: '||collect.example/v1/' } })).not.toThrow();
  });

  it.each(FORBIDDEN_DNR_ACTIONS.map((t) => [t]))('rejects %s', (type) => {
    expect(() => assertAllowedRule({ ...BLOCK, action: { type } })).toThrow(DnrGuardError);
  });

  it('rejects header removal and any other header or operation', () => {
    const variants = [
      { header: 'Sec-GPC', operation: 'remove' },
      { header: 'Cookie', operation: 'set', value: '1' },
      { header: 'sec-gpc', operation: 'set', value: '1' },
      { header: 'Sec-GPC', operation: 'append', value: '1' },
      { header: 'Sec-GPC', operation: 'set', value: '0' },
    ];
    for (const h of variants) expect(isAllowedRule({ ...GPC, action: { type: 'modifyHeaders', requestHeaders: [h] } })).toBe(false);
    expect(isAllowedRule({ ...GPC, action: { type: 'modifyHeaders', requestHeaders: [GPC.action.requestHeaders[0], GPC.action.requestHeaders[0]] } })).toBe(false);
    expect(isAllowedRule({ ...GPC, action: { type: 'modifyHeaders', requestHeaders: GPC.action.requestHeaders, responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }] } })).toBe(false);
  });

  it('rejects ids outside the ranges and priorities of another range', () => {
    expect(isAllowedRule({ ...BLOCK, id: 99 + 1 })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, id: 300000 })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, id: 0 })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, priority: DNR_PRIORITIES.gpc })).toBe(false);
    expect(isAllowedRule({ ...GPC, id: 100500 })).toBe(false); // modifyHeaders outside the gpc range
    expect(isAllowedRule({ ...BLOCK, id: 5, priority: DNR_PRIORITIES.gpc })).toBe(false); // block in the gpc range
    expect(isAllowedRule({ id: 101001, priority: DNR_PRIORITIES.presetBlock, action: { type: 'allow' }, condition: { requestDomains: ['a.example'] } })).toBe(false);
  });

  it('rejects other condition keys, regex filters, urlFilter outside the preset and target-less rules', () => {
    expect(isAllowedRule({ ...BLOCK, condition: { ...BLOCK.condition, regexFilter: '.*' } })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, condition: { ...BLOCK.condition, requestMethods: ['post'] } })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, condition: { urlFilter: '||collect.example' } })).toBe(false);
    expect(isAllowedRule({ id: 101000, priority: DNR_PRIORITIES.presetBlock, action: { type: 'block' }, condition: { urlFilter: '*collect*' } })).toBe(false);
    expect(isAllowedRule({ id: 101000, priority: DNR_PRIORITIES.presetBlock, action: { type: 'block' }, condition: { urlFilter: '||collect.example/x?id=1' } })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, condition: {} })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, condition: { requestDomains: [] } })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, condition: { requestDomains: ['https://collect.example/'] } })).toBe(false);
    expect(isAllowedRule({ id: 200001, priority: DNR_PRIORITIES.once, action: { type: 'block' }, condition: { requestDomains: ['a.example'] } })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, extra: true })).toBe(false);
    expect(isAllowedRule({ ...BLOCK, action: { type: 'block', redirect: { url: 'https://x.example/' } } })).toBe(false);
    expect(isAllowedRule(null)).toBe(false);
  });
});
