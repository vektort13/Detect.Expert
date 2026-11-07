import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { socialNetworkDetector as detector, SOCIAL_SERVICE_IDS, SOCIAL_KINDS } from '../../apps/production-extension/social-network-detector.js';
import { SOCIAL_SERVICES, SOCIAL_KINDS as canonicalKinds } from '../../packages/contracts/src/inspection.mjs';
const ledger = JSON.parse(readFileSync(new URL('../../packages/catalog/research/social-network-expansion-2026-10.json', import.meta.url), 'utf8'));

test('social catalog matches canonical service and observation enums', () => {
  assert.deepEqual(SOCIAL_SERVICE_IDS, SOCIAL_SERVICES);
  assert.deepEqual(SOCIAL_KINDS, canonicalKinds);
});

test('social expansion fixtures have primary-source provenance and precise classifications', () => {
  const sources = new Set(ledger.sources.map(source => source.id));
  assert.equal(ledger.knownProviders, SOCIAL_SERVICE_IDS.length - 1);
  assert.equal(ledger.researchNetwork.activeLoginOrHistoryProbes, false);
  assert.equal(ledger.researchNetwork.runtimeConnections, false);
  for (const fixture of ledger.fixtures) {
    assert.ok(fixture.sourceRefs.length > 0);
    for (const ref of fixture.sourceRefs) assert.ok(sources.has(ref), ref);
    const { sourceRefs: _sourceRefs, url, ...expected } = fixture;
    const result = detector.classify(url, fixture.requestType);
    assert.deepEqual(result, { ...expected, method: 'GET' }, url);
    assert.doesNotMatch(JSON.stringify(result), /CANARY|FIXTURE|fixture|[?&#]|https:/);
    const malicious = new URL(url); malicious.hostname += '.attacker.test';
    assert.equal(detector.classify(malicious.href, fixture.requestType), null, malicious.href);
    if (fixture.kind === 'sdk-load' || fixture.kind === 'tracking-sdk' || fixture.kind === 'tracking-pixel') {
      const wrongPath = new URL(url); wrongPath.pathname += '/unexpected';
      const different = detector.classify(wrongPath.href, fixture.requestType);
      assert.notEqual(different?.kind, fixture.kind, wrongPath.href);
      assert.equal(detector.classify(url, 'main_frame')?.kind, 'service-request', url);
    }
  }
});

test('social shared CDNs, federated instances and generic widgets do not imply tracking', () => {
  for (const url of [
    'https://t1.daumcdn.net/unrelated/kp.js',
    'https://t1.daumcdn.net/kas/static/kp.js/unexpected',
    'https://unpkg.byted-static.com/other/sdk.js',
    'https://unpkg.byted-static.com/bridge/douyin_open/1.0.7/lib/douyin_open.umd.js/unexpected',
    'https://unrecognized.mastodon-instance.example/@user/1/embed',
  ]) assert.equal(detector.classify(url, 'script'), null);
  for (const [service, url] of [
    ['kakao', 'https://t1.kakaocdn.net/other/resource.js'],
    ['naver', 'https://wcs.naver.com/unverified-event-path'],
    ['baidu', 'https://tieba.baidu.com/profile/PRIVATE_CANARY'],
    ['addthis', 'https://s7.addthis.com/js/300/addthis_widget.js'],
    ['mastodon', 'https://mastodon.social/@PRIVATE_CANARY/1/embed'],
    ['google', 'https://googleads.g.doubleclick.net/pagead/conversion/123'],
    ['wechat', 'https://mp.weixin.qq.com/ordinary-resource.js'],
    ['qq', 'https://connect.qq.com/ordinary-resource.js'],
  ]) {
    const row = detector.classify(url, 'image');
    assert.equal(row.service, service); assert.equal(row.kind, 'service-request');
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_CANARY/);
  }
  assert.equal(detector.classify('https://res.wx.qq.com/open/js/jweixin-1.4.0.js', 'script').service, 'wechat');
  assert.equal(detector.classify('https://connect.qq.com/open/js/jweixin-1.4.0.js', 'script').service, 'qq');
  assert.equal(detector.classify('https://platform-api.sharethis.com/js/sharethis.js', 'script').kind, 'sdk-load');
});

test('social tracking collectors remain distinct from authentication and ordinary navigation', () => {
  for (const fixture of ledger.fixtures.filter(row => row.kind === 'tracking-pixel')) {
    for (const requestType of ['image', 'xmlhttprequest', 'ping', 'other']) {
      assert.equal(detector.classify(fixture.url, requestType, 'POST').kind, 'tracking-pixel', fixture.url);
    }
    for (const requestType of ['main_frame', 'sub_frame', 'script', 'stylesheet', 'font', 'media']) {
      assert.equal(detector.classify(fixture.url, requestType).kind, 'service-request', fixture.url);
    }
  }
  for (const url of [
    'https://q.quora.com/_/ad/fixture/pixel/unexpected',
    'https://mc.yandex.ru/watch/not-numeric',
    'https://bat.bing.com/action/invalid',
    'https://alb.reddit.com/rp.gif/unexpected',
    'https://analytics.twitter.com/not-i/adsct',
  ]) assert.equal(detector.classify(url, 'image').kind, 'service-request');
  assert.equal(detector.classify('https://accounts.google.com/gsi/fedcm.json', 'xmlhttprequest').kind, 'service-request');
  // All variants of the already published Google Identity client remain general
  // SDK resources, without inspecting identity options or requested accounts.
  for (const basename of ['api.js', 'platform.js', 'api:client.js']) assert.equal(detector.classify('https://apis.google.com/js/' + basename, 'script').kind, 'sdk-load');
});
test('social catalog recognizes documented SDK resources without account inference', () => {
  const fixtures = [
    ['facebook', 'https://connect.facebook.net/en_US/sdk.js'], ['facebook', 'https://connect.facebook.net/ru_RU/fbevents.js'],
    ['x', 'https://platform.twitter.com/widgets.js'], ['linkedin', 'https://snap.licdn.com/li.lms-analytics/insight.min.js'],
    ['tiktok', 'https://analytics.tiktok.com/i18n/pixel/events.js'], ['snapchat', 'https://sc-static.net/scevent.min.js'],
    ['pinterest', 'https://s.pinimg.com/ct/core.js'], ['telegram', 'https://telegram.org/js/telegram-widget.js'],
    ['google', 'https://accounts.google.com/gsi/client'],
    ['google', 'https://apis.google.com/js/platform.js'],
  ];
  for (const [service, url] of fixtures) {
    assert.equal(detector.classify(url, 'script').service, service);
    const kind = /fbevents|insight\.min|pixel\/events|scevent|ct\/core/.test(url) ? 'tracking-sdk' : 'sdk-load';
    assert.equal(detector.classify(url, 'script').kind, kind);
    assert.equal(detector.classify(url, 'image').kind, 'service-request');
    assert.notEqual(detector.classify(url + '/unexpected', 'script').kind, kind);
  }
  assert.equal(detector.classify('https://vk.com/js/api/openapi.js', 'script').kind, 'service-request');
  assert.equal(detector.classify('https://px4.ads.linkedin.com/collect/', 'image').kind, 'service-request');
});
test('social ordinary navigation, OAuth frames, assets and login subresources stay separate', () => {
  assert.equal(detector.classify('https://www.facebook.com/login.php', 'main_frame').kind, 'authentication-navigation');
  assert.equal(detector.classify('https://www.facebook.com/login.php', 'sub_frame').kind, 'authentication-frame');
  assert.equal(detector.classify('https://www.facebook.com/login.php', 'image').kind, 'possible-login-probe');
  assert.equal(detector.classify('https://www.facebook.com/login.php', 'xmlhttprequest').kind, 'authentication-request');
  assert.equal(detector.classify('https://github.com/login', 'script').kind, 'possible-login-probe');
  assert.equal(detector.classify('https://github.com/login', 'main_frame').kind, 'authentication-navigation');
  assert.equal(detector.classify('https://discord.com/oauth2/authorize', 'sub_frame').kind, 'authentication-frame');
  assert.equal(detector.classify('https://discord.com/oauth2/authorize', 'image').kind, 'authentication-request');
  for (const url of ['https://github.com/favicon.ico', 'https://github.com/profiles/some-user', 'https://www.facebook.com/loginfo']) assert.equal(detector.classify(url, 'image').kind, 'service-request');
});
test('social pixel and embedded integrations use distinct observation classes', () => {
  assert.equal(detector.classify('https://www.facebook.com/tr/', 'image').kind, 'tracking-pixel');
  assert.equal(detector.classify('https://px.ads.linkedin.com/collect/', 'image').kind, 'tracking-pixel');
  assert.equal(detector.classify('https://ct.pinterest.com/v3/', 'ping').kind, 'tracking-pixel');
  assert.equal(detector.classify('https://tr.snapchat.com/p', 'xmlhttprequest').kind, 'tracking-pixel');
  assert.equal(detector.classify('https://www.youtube-nocookie.com/embed/VIDEO_SENTINEL', 'sub_frame').kind, 'embedded-content');
  assert.equal(detector.classify('https://www.facebook.com/plugins/page.php', 'sub_frame').kind, 'embedded-content');
});
test('social classifier rejects host confusion and unsafe inputs without coercion', () => {
  let coercions = 0;
  const evil = { toString() { ++coercions; throw Error('coercion'); } };
  for (const input of [evil, null, '', 'https://facebook.com.attacker.test/login', 'https://notfacebook.com/login', 'https://facebook.com@attacker.test/login', 'https://secret@facebook.com/login', 'http://facebook.com/login', 'https://facebook.com:9443/login', 'https://facebook.com\\attacker.test/login', 'https://facebook.com/login\n', 'x'.repeat(4097)]) assert.equal(detector.classify(input, 'image'), null);
  assert.equal(coercions, 0);
  assert.equal(detector.classify('https://facebook.com/login', 'INVALID'), null);
});
test('social results never retain query, fragment, user IDs or raw source paths', () => {
  const row = detector.classify('https://www.facebook.com/tr/?access_token=TOKEN_SENTINEL&email=EMAIL_SENTINEL#FRAGMENT_SENTINEL', 'image');
  assert.deepEqual(Object.keys(row).sort(), ['endpoint', 'kind', 'method', 'requestType', 'service']);
  const script = detector.script('https://assets.example.com:8443/private/ACCOUNT_SENTINEL/bundle-USER_SENTINEL.js?token=TOKEN_SENTINEL#FRAGMENT_SENTINEL');
  assert.deepEqual(script, { host: 'assets.example.com', pathTemplate: '/<script>' });
  assert.deepEqual(detector.script('http://assets.example.com:1234/private/main.js?token=TOKEN_SENTINEL'), { host: 'assets.example.com', pathTemplate: '/main.js' });
  assert.doesNotMatch(JSON.stringify({ row, script }), /TOKEN_SENTINEL|EMAIL_SENTINEL|FRAGMENT_SENTINEL|ACCOUNT_SENTINEL|USER_SENTINEL/);
});
