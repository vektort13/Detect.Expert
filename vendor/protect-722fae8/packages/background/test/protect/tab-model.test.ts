import { describe, expect, it } from 'vitest';
import { MAX_PROTECT_TABS, ProtectTabModel, siteOfHost } from '../../src/protect/tab-model';
import { committed } from '../fake-chrome';
import { makeClock } from './support';

describe('ProtectTabModel', () => {
  it('site of a host: PSL registrable; IPv4, localhost and single labels as is; unknown suffix → null', () => {
    expect(siteOfHost('www.shop-site.com')).toBe('shop-site.com');
    expect(siteOfHost('a.b.example.co.uk')).toBe('example.co.uk');
    expect(siteOfHost('127.0.0.1')).toBe('127.0.0.1');
    expect(siteOfHost('app.localhost')).toBe('localhost');
    expect(siteOfHost('intranet')).toBe('intranet');
    expect(siteOfHost('x.example')).toBeNull();
    expect(siteOfHost('[::1]')).toBeNull();
  });

  it('frame-0 commits only (prerender ignored); previous site and the time of leaving it are kept', () => {
    const clock = makeClock();
    const changes: number[] = [];
    const m = new ProtectTabModel(clock, () => changes.push(1));
    expect(m.noteCommitted(committed({ frameId: 3 }))).toBeNull();
    expect(m.noteCommitted(committed({ documentLifecycle: 'prerender' }))).toBeNull();
    m.noteCommitted(committed({ url: 'https://www.shop-site.com/a?q=secret' }));
    clock.t += 5;
    const e = m.noteCommitted(committed({ url: 'https://news.other-site.org/', documentId: 'DOC2' }));
    expect(e).toMatchObject({ site: 'other-site.org', previousSite: 'shop-site.com', leftPreviousAt: clock.t, topDocumentId: 'DOC2', scheme: 'https' });
    expect(JSON.stringify(m.entries())).not.toContain('secret');
    expect(m.topDocumentKey(7)).toBe('7:0:DOC2');
    expect(changes.length).toBe(2);
    m.noteReplaced(9, 7);
    expect(m.get(7)).toBeUndefined();
    expect(m.get(9)?.site).toBe('other-site.org');
    expect(m.noteRemoved(9)).toBe(true);
  });

  it('bounded to MAX_PROTECT_TABS (oldest first)', () => {
    const m = new ProtectTabModel(makeClock());
    for (let t = 0; t < MAX_PROTECT_TABS + 3; t++) m.noteCommitted(committed({ tabId: t }));
    expect(m.size).toBe(MAX_PROTECT_TABS);
    expect(m.get(0)).toBeUndefined();
  });

  it('review r2: kept entries (excluded sites) are evicted last; with every other entry kept, the oldest goes', () => {
    const m = new ProtectTabModel(makeClock(), () => undefined, (e) => e.site === 'bank-site.com');
    m.noteCommitted(committed({ tabId: 1, url: 'https://www.bank-site.com/', documentId: 'B1' }));
    for (let t = 100; t < 100 + MAX_PROTECT_TABS + 5; t++) m.noteCommitted(committed({ tabId: t, url: 'https://www.shop-site.com/', documentId: 'D' + String(t) }));
    expect(m.size).toBe(MAX_PROTECT_TABS);
    expect(m.get(1)?.site).toBe('bank-site.com');
    for (let t = 100; t < 106; t++) expect(m.get(t), 'tab ' + String(t)).toBeUndefined();
    expect(m.get(106)).toBeDefined();
    const all = new ProtectTabModel(makeClock(), () => undefined, () => true);
    for (let t = 0; t < MAX_PROTECT_TABS + 2; t++) all.noteCommitted(committed({ tabId: t }));
    expect(all.size).toBe(MAX_PROTECT_TABS);
    expect(all.get(0)).toBeUndefined();
    expect(all.get(MAX_PROTECT_TABS + 1)).toBeDefined();
  });

  it('review r2: learnTopSite fills only an unknown tab (no top document, committedAt 0); a commit replaces it', () => {
    const changes: number[] = [];
    const m = new ProtectTabModel(makeClock(), () => changes.push(1));
    expect(m.learnTopSite(7, 'bank-site.com', 'https')).toMatchObject({ tabId: 7, site: 'bank-site.com', scheme: 'https', topDocumentId: null, committedAt: 0 });
    expect(m.topDocumentKey(7)).toBeNull();
    expect(m.resolveRequest({ tabId: 7, frameId: 2, url: 'https://collect.tracker-site.net/b', type: 'ping', timeStamp: 1, initiator: 'https://widget.other-site.org' })).toMatchObject({ topSite: 'bank-site.com', relation: 'cross-site' });
    expect(m.learnTopSite(7, 'other-site.org', 'https')).toBeNull();
    expect(m.get(7)?.site).toBe('bank-site.com');
    expect(m.learnTopSite(-1, 'a.com', null)).toBeNull();
    m.noteCommitted(committed({ tabId: 8, url: 'https://www.shop-site.com/' }));
    expect(m.learnTopSite(8, 'bank-site.com', 'https')).toBeNull();
    expect(m.get(8)?.site).toBe('shop-site.com');
    m.noteCommitted(committed({ tabId: 7, url: 'https://www.shop-site.com/', documentId: 'DOC7' }));
    expect(m.get(7)).toMatchObject({ site: 'shop-site.com', topDocumentId: 'DOC7', previousSite: 'bank-site.com' });
    expect(changes.length).toBe(3);
  });

  it('resolveRequest: trusted ids, redacted receiver, relation, frame context, kinds — never the URL', () => {
    const m = new ProtectTabModel(makeClock());
    m.noteCommitted(committed({ url: 'https://www.shop-site.com/' }));
    const top = m.resolveRequest({ tabId: 7, frameId: 0, documentId: 'DOC000000000000000000000000000001', url: 'https://cdn.shop-site.com/x?e=a%40b.cc', type: 'xmlhttprequest', timeStamp: 1, method: 'post', requestId: '12', initiator: 'https://www.shop-site.com' });
    expect(top).toMatchObject({ documentKey: '7:0:DOC000000000000000000000000000001', topDocumentKey: '7:0:DOC000000000000000000000000000001', receiver: 'shop-site.com', receiverCategory: null, relation: 'same-site', frameContext: 'top', requestKind: 'xhr', method: 'POST', requestId: '12' });
    expect(JSON.stringify(top)).not.toContain('a%40b.cc');
    const frame = m.resolveRequest({ tabId: 7, frameId: 4, documentId: 'F1', url: 'https://collect.tracker-site.net/b', type: 'ping', timeStamp: 1, initiator: 'https://widget.other-site.org' });
    expect(frame).toMatchObject({ frameContext: 'cross-site-frame', frameSite: 'other-site.org', receiver: 'tracker-site.net', relation: 'cross-site', requestKind: 'beacon', method: 'OTHER', documentKey: '7:4:F1' });
    const ip = m.resolveRequest({ tabId: 7, frameId: 0, url: 'http://192.168.1.2/x', type: 'image', timeStamp: 1 });
    expect(ip).toMatchObject({ receiver: null, receiverCategory: 'private', relation: 'unknown', requestKind: 'image' });
    expect(m.resolveRequest({ tabId: 7, frameId: 0, url: 'https://n.example/', type: 'main_frame', timeStamp: 1 })).toMatchObject({ documentKey: null, requestKind: 'navigation' });
    expect(m.resolveRequest({ tabId: -1, frameId: 0, url: 'https://a.com/', type: 'other', timeStamp: 1 })).toBeNull();
    expect(m.resolveRequest({ tabId: 7, frameId: 0, url: 'ftp://a.com/', type: 'other', timeStamp: 1 })).toBeNull();
  });

  it('lane data per tab (JSON), removed with undefined', () => {
    const m = new ProtectTabModel(makeClock());
    m.noteCommitted(committed());
    m.setLaneData(7, 'firewall', { once: 1 });
    expect(m.laneData(7, 'firewall')).toEqual({ once: 1 });
    m.setLaneData(7, 'firewall', undefined);
    expect(m.laneData(7, 'firewall')).toBeUndefined();
    m.setLaneData(99, 'firewall', 1);
    expect(m.get(99)).toBeUndefined();
  });
});
