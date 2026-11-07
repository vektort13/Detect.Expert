// REQ-001/005/011: passive URL classification; no requests or login-state inference.
// The same function is serialized into MAIN and imported by the background.
export function createSocialNetworkDetector(trustedURL = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeURL = descriptor(globalThis, 'URL')?.value;
  const nativeSource = Function.prototype.toString, exec = RegExp.prototype.exec;
  const ends = String.prototype.endsWith, includes = Array.prototype.includes;
  const match = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && match(/\[native code\]/, apply(nativeSource, fn, []));
  const getters = Object.create(null);
  let ready = false;
  try {
    if (typeof NativeURL === 'function' && (trustedURL || native(NativeURL))) {
      const prototype = descriptor(NativeURL, 'prototype')?.value;
      ready = !!prototype;
      for (const key of ['protocol', 'hostname', 'pathname', 'username', 'password', 'port']) {
        const entry = prototype && descriptor(prototype, key);
        if (!entry || typeof entry.get !== 'function' || !trustedURL && !native(entry.get)) { ready = false; break; }
        getters[key] = entry.get;
      }
    }
  } catch { ready = false; }
  const field = (url, key) => apply(getters[key], url, []);
  const suffix = (host, domain) => host === domain || apply(ends, host, ['.' + domain]);
  const services = [
    ['facebook', ['facebook.com', 'facebook.net']], ['instagram', ['instagram.com']],
    ['x', ['twitter.com', 'x.com', 't.co', 'ads-twitter.com']], ['linkedin', ['linkedin.com', 'licdn.com']],
    ['tiktok', ['tiktok.com']], ['snapchat', ['snapchat.com', 'sc-static.net']],
    ['pinterest', ['pinterest.com', 'pinimg.com']], ['reddit', ['reddit.com', 'redditmedia.com', 'redditstatic.com']],
    ['discord', ['discord.com', 'discordapp.com']], ['twitch', ['twitch.tv']],
    ['youtube', ['youtube.com', 'youtube-nocookie.com']], ['github', ['github.com']],
    ['gitlab', ['gitlab.com']], ['vk', ['vk.com', 'vk.ru', 'vkuser.net']],
    ['ok', ['ok.ru']], ['weibo', ['weibo.com']], ['wechat', ['weixin.qq.com', 'wx.qq.com']], ['qq', ['qq.com']],
    ['telegram', ['telegram.org']], ['line', ['line.me', 'line-scdn.net']],
    ['google', ['accounts.google.com', 'apis.google.com', 'googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'googlesyndication.com', 'doubleclick.net']],
    ['microsoft', ['login.microsoftonline.com', 'login.live.com', 'bat.bing.com']], ['apple', ['appleid.apple.com']],
    ['spotify', ['accounts.spotify.com']], ['steam', ['steamcommunity.com']],
    ['yahoo', ['login.yahoo.com']], ['tumblr', ['tumblr.com']],
    ['quora', ['quora.com']], ['disqus', ['disqus.com']], ['yandex', ['yandex.ru', 'yandex.com']], ['mailru', ['mail.ru']],
    ['kakao', ['kakao.com', 'kakaocdn.net', 'bc.ad.daum.net']], ['naver', ['naver.com', 'naver.net']],
    ['baidu', ['baidu.com']], ['bluesky', ['bsky.app']], ['sharethis', ['sharethis.com']],
    ['douyin', ['douyin.com']], ['mastodon', ['mastodon.social', 'mastodon.online']], ['addthis', ['addthis.com']],
    ['whatsapp', ['whatsapp.com', 'wa.me']], ['viber', ['viber.com']], ['threads', ['threads.com', 'threads.net']],
    ['vimeo', ['vimeo.com']], ['dailymotion', ['dailymotion.com']], ['soundcloud', ['soundcloud.com']],
  ];
  const types = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
  function parse(raw, source = false) {
    if (!ready || typeof raw !== 'string' || raw.length > 4096 || match(/[\u0000-\u0020\u007f\\]/, raw)) return null;
    try {
      const url = new NativeURL(raw);
      const protocol = field(url, 'protocol');
      if ((protocol !== 'https:' && !(source && protocol === 'http:')) || field(url, 'username') || field(url, 'password') || !source && field(url, 'port')) return null;
      return { host: field(url, 'hostname'), path: field(url, 'pathname') };
    } catch { return null; }
  }
  function classify(raw, requestType = 'other', method = 'GET') {
    if (!apply(includes, types, [requestType])) return null;
    const url = parse(raw);
    if (!url) return null;
    const { host, path } = url;
    // These CDNs are shared by products: only a documented path identifies the
    // provider. Other resources on the same host remain unclassified.
    const kakaoPixel = host === 't1.daumcdn.net' && path === '/kas/static/kp.js';
    const douyinSdk = host === 'unpkg.byted-static.com' && match(/^\/bridge\/douyin_open\/[0-9]+\.[0-9]+\.[0-9]+\/lib\/douyin_open\.umd\.js$/, path);
    let service = kakaoPixel ? 'kakao' : douyinSdk ? 'douyin' : null;
    for (const [id, domains] of services) {
      if (service) break;
      for (let index = 0; index < domains.length; index++) if (suffix(host, domains[index])) { service = id; break; }
      if (service) break;
    }
    if (!service) return null;
    let endpoint = 'service', kind = 'service-request';
    const trackingSdk = requestType === 'script' && (
      host === 'connect.facebook.net' && match(/^\/[a-z]{2}_[A-Z]{2}\/fbevents\.js$/, path) ||
      host === 'static.ads-twitter.com' && path === '/uwt.js' ||
      host === 'snap.licdn.com' && path === '/li.lms-analytics/insight.min.js' ||
      host === 'analytics.tiktok.com' && path === '/i18n/pixel/events.js' ||
      host === 'sc-static.net' && path === '/scevent.min.js' ||
      host === 's.pinimg.com' && path === '/ct/core.js' ||
      host === 'www.redditstatic.com' && path === '/ads/pixel.js' ||
      host === 'd.line-scdn.net' && path === '/n/line_tag/public/release/v1/lt.js' ||
      host === 'a.quora.com' && path === '/qevents.js' ||
      (host === 'mc.yandex.ru' || host === 'mc.yandex.com') && match(/^\/metrika\/(?:tag|watch)\.js$/, path) ||
      host === 'top-fwz1.mail.ru' && path === '/js/code.js' ||
      host === 'bat.bing.com' && path === '/bat.js' ||
      host === 'www.googletagmanager.com' && path === '/gtag/js' ||
      host === 'www.google-analytics.com' && (path === '/analytics.js' || path === '/ga.js') ||
      host === 'www.googleadservices.com' && path === '/pagead/conversion.js' ||
      host === 'wcs.naver.net' && path === '/wcslog.js' ||
      host === 'hm.baidu.com' && path === '/hm.js' || kakaoPixel);
    const sdk = requestType === 'script' && (
      host === 'connect.facebook.net' && match(/^\/[a-z]{2}_[A-Z]{2}\/sdk\.js$/, path) ||
      host === 'platform.twitter.com' && path === '/widgets.js' ||
      host === 'telegram.org' && path === '/js/telegram-widget.js' ||
      host === 'accounts.google.com' && path === '/gsi/client' ||
      host === 'apis.google.com' && match(/^\/js\/(?:api|platform|api:client)\.js$/, path) ||
      host === 'www.googletagmanager.com' && path === '/gtm.js' ||
      host === 't1.kakaocdn.net' && match(/^\/kakao_js_sdk\/[0-9]+\.[0-9]+\.[0-9]+\/kakao\.min\.js$/, path) ||
      host === 'res.wx.qq.com' && match(/^\/open\/js\/jweixin-[0-9]+\.[0-9]+\.[0-9]+\.js$/, path) ||
      host === 'platform-api.sharethis.com' && path === '/js/sharethis.js' ||
      host === 'www.instagram.com' && path === '/embed.js' ||
      (host === 'www.threads.com' || host === 'threads.com') && path === '/embed.js' ||
      host === 'player.vimeo.com' && path === '/api/player.js' ||
      host === 'geo.dailymotion.com' && match(/^\/(?:libs\/)?player\/[a-zA-Z0-9_-]{1,64}\.js$/, path) ||
      host === 'w.soundcloud.com' && path === '/player/api.js' || douyinSdk);
    const pixel = (
      suffix(host, 'facebook.com') && (path === '/tr' || path === '/tr/') ||
      (host === 'px.ads.linkedin.com' || host === 'dc.ads.linkedin.com') && (path === '/collect' || path === '/collect/') ||
      host === 'ct.pinterest.com' && (path === '/v3' || path === '/v3/') ||
      host === 'tr.snapchat.com' && (path === '/p' || path === '/p/') ||
      (host === 'analytics.twitter.com' || host === 'analytics.x.com' || host === 't.co') && match(/^\/i\/adsctp?$/, path) ||
      host === 'alb.reddit.com' && (path === '/rp.gif' || path === '/rp') ||
      host === 'tr.line.me' && path === '/tag.gif' ||
      host === 'q.quora.com' && match(/^\/_\/ad\/[a-zA-Z0-9_-]{1,128}\/pixel$/, path) ||
      (host === 'mc.yandex.ru' || host === 'mc.yandex.com') && match(/^\/watch\/[0-9]{1,32}$/, path) ||
      host === 'top-fwz1.mail.ru' && path === '/counter' ||
      host === 'bat.bing.com' && match(/^\/action\/[0-9]{1,32}$/, path) ||
      suffix(host, 'google-analytics.com') && (path === '/g/collect' || path === '/collect' || path === '/__utm.gif') ||
      host === 'analytics.google.com' && path === '/g/collect' ||
      host === 'bc.ad.daum.net' && path === '/bc') &&
      apply(includes, ['image', 'xmlhttprequest', 'ping', 'other'], [requestType]);
    const embedded = (requestType === 'sub_frame' || requestType === 'script') && (
      service === 'youtube' && match(/^\/embed(?:\/|$)/, path) ||
      service === 'facebook' && match(/^\/plugins(?:\/|$)/, path) ||
      service === 'instagram' && match(/(?:^\/embed(?:\/|$)|\/embed\/?$)/, path) ||
      service === 'x' && (host === 'platform.twitter.com' || host === 'syndication.twitter.com') ||
      service === 'disqus' && (requestType === 'script' && path === '/embed.js' || requestType === 'sub_frame' && match(/^\/embed(?:\/|$)/, path)) ||
      service === 'bluesky' && host === 'embed.bsky.app' && (path === '/static/embed.js' || match(/^\/embed\//, path)) ||
      service === 'vimeo' && host === 'player.vimeo.com' && match(/^\/video\//, path) ||
      service === 'dailymotion' && (host === 'geo.dailymotion.com' && path === '/player.html' || match(/^\/embed\/video\//, path)) ||
      service === 'soundcloud' && host === 'w.soundcloud.com' && (path === '/player/' || path === '/player'));
    const login = match(/^\/(?:login(?:\.php)?|signin|sign-in|ServiceLogin|i\/flow\/login|accounts\/login|auth\/login)(?:\/|$)/, path);
    const oauth = match(/(?:^|\/)(?:oauth(?:2)?|authorize|authorization|dialog\/oauth)(?:\/|$)/, path);
    if (trackingSdk) { endpoint = 'sdk'; kind = 'tracking-sdk'; }
    else if (sdk) { endpoint = 'sdk'; kind = 'sdk-load'; }
    else if (pixel) { endpoint = 'pixel'; kind = 'tracking-pixel'; }
    else if (embedded) { endpoint = 'embed'; kind = 'embedded-content'; }
    else if (login || oauth) {
      endpoint = oauth ? 'oauth' : 'login';
      kind = requestType === 'main_frame' ? 'authentication-navigation' :
        requestType === 'sub_frame' ? 'authentication-frame' :
        login && (requestType === 'image' || requestType === 'script') ? 'possible-login-probe' : 'authentication-request';
    }
    const cleanMethod = typeof method === 'string' && apply(includes, ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UNKNOWN'], [method]) ? method : 'UNKNOWN';
    return { service, kind, endpoint, method: cleanMethod, requestType };
  }
  function script(raw) {
    const url = parse(raw, true);
    if (!url || !match(/^[a-z0-9.-]{1,253}$/, url.host)) return null;
    // Host redaction with the bundled PSL happens at the privileged boundary.
    // MAIN never retains arbitrary paths or script identifiers.
    const fixed = /\/(main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(js|mjs)$/;
    const found = apply(exec, fixed, [url.path]);
    return { host: url.host, pathTemplate: found ? '/' + found[1] + '.' + found[2] : '/<script>' };
  }
  return { classify, script, ready };
}

export const socialNetworkDetector = createSocialNetworkDetector(true);
export const SOCIAL_SERVICE_IDS = Object.freeze(['facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'snapchat', 'pinterest', 'reddit', 'discord', 'twitch', 'youtube', 'github', 'gitlab', 'vk', 'ok', 'weibo', 'qq', 'telegram', 'line', 'google', 'microsoft', 'apple', 'spotify', 'steam', 'yahoo', 'tumblr', 'quora', 'disqus', 'yandex', 'mailru', 'kakao', 'naver', 'baidu', 'bluesky', 'sharethis', 'douyin', 'wechat', 'mastodon', 'addthis', 'whatsapp', 'viber', 'threads', 'vimeo', 'dailymotion', 'soundcloud', 'unknown']);
export const SOCIAL_KINDS = Object.freeze(['service-request', 'sdk-load', 'tracking-sdk', 'tracking-pixel', 'embedded-content', 'authentication-navigation', 'authentication-frame', 'authentication-request', 'possible-login-probe', 'manual-redirect-request', 'fedcm-call', 'login-status-api']);
