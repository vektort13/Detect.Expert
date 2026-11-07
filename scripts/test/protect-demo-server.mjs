// Local demo stand for the owner's manual check of the module «Защита» (ADR-020, ADR-047) in the production Chrome
// build (dist/chrome). Port plan §5.4 / §8. Node only, no dependencies, no external network: the server listens on
// 127.0.0.1 only and answers synthetic pages under demo host names (*.example.com|net|org) that the printed Chrome
// command maps to 127.0.0.1 with --host-resolver-rules (registrable domains must be in the PSL, so .test/.localhost
// would have no site). The vendored stand (vendor/protect-722fae8/fixtures/protect/**) is served read-only under
// /protect/; nothing in vendor/ is changed. Receiver endpoints answer 204 and drain bodies unread; the log prints the
// method, host, path and parameter NAMES only, never values.
//   shop-a.example.com, shop-b.example.org: e-mail / phone / name form + a third-party «pixel» script from
//     px.collector.example.net that sends sha256(trim+lower e-mail) as ud[em] while the user types (0.8 s pause) and on
//     leaving the field, before any submit (SHA-256 of the vendored forms/lib.js: no crypto.subtle on http pages);
//   gpc.example.org: the Sec-GPC header of its own navigation and of a fetch, and navigator.globalPrivacyControl;
//   recorder.example.org: vendored replay/recorder-positive.html (listeners, observer, 6 POSTs to rec.example.net);
//   login.example.com: vendored forms/password-negative.html (the site itself sends the password to a third party).
// Usage: node scripts/test/protect-demo-server.mjs [--port 4180]   (pnpm protect:demo). Stops on Ctrl+C.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const VENDOR = join(root, 'vendor', 'protect-722fae8', 'fixtures', 'protect');
const FIXTURE_LIB = join(root, 'fixtures', 'fixture-lib.js');
const DIST = join(root, 'dist', 'chrome');
const PROFILE = join(root, '.tmp', 'protect-demo-profile');
const PROFILE_CHROMIUM = join(root, '.tmp', 'protect-demo-profile-chromium');
const DEFAULT_PORT = 4180;

const HOSTS = Object.freeze({
  index: 'stand.example.com',
  shopA: 'shop-a.example.com',
  shopB: 'shop-b.example.org',
  collector: 'px.collector.example.net',
  gpc: 'gpc.example.org',
  gpcOther: 'gpc-other.example.com',
  recorder: 'recorder.example.org',
  login: 'login.example.com',
});
// Every demo and vendored-stand host is under these three names; nothing of them may leave the machine.
const RESOLVER_RULES = 'MAP *.example.com 127.0.0.1, MAP *.example.net 127.0.0.1, MAP *.example.org 127.0.0.1';
const RECEIVER_PATHS = new Set(['/tr', '/fw/collect', '/replay/collect', '/history/collect']);
const LOGGED_EVENTS = new Set(['PageView', 'Lead']);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function parsePort(argv) {
  const at = argv.findIndex((a) => a === '--port' || a.startsWith('--port='));
  if (at < 0) return DEFAULT_PORT;
  const raw = argv[at].includes('=') ? argv[at].slice('--port='.length) : argv[at + 1];
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('protect-demo-server: --port ждёт число 0…65535 (0 — свободный порт), получено: ' + String(raw));
    process.exit(2);
  }
  return port;
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node scripts/test/protect-demo-server.mjs [--port ' + DEFAULT_PORT + ']   (0 = any free port)');
  process.exit(0);
}
const requestedPort = parsePort(argv);
let port = requestedPort;

const origin = (host) => 'http://' + host + ':' + String(port);
function urls() {
  return {
    index: origin(HOSTS.index) + '/',
    shopA: origin(HOSTS.shopA) + '/',
    shopB: origin(HOSTS.shopB) + '/',
    gpc: origin(HOSTS.gpc) + '/',
    recorder: origin(HOSTS.recorder) + '/protect/replay/recorder-positive.html',
    password: origin(HOSTS.login) + '/protect/forms/password-negative.html?rp=' + String(port),
    collector: origin(HOSTS.collector) + '/tr',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------------------

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5b6170;--line:#d9dde4;--accent:#2456b3}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1c1f24;--text:#e8eaed;--muted:#a3a9b5;--line:#343a43;--accent:#8ab4f8}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:16px 0}
.tag{color:var(--muted);font-size:13px;margin:0}
.muted{color:var(--muted)}
label{display:block;margin:10px 0 4px}
input{box-sizing:border-box;width:100%;max-width:420px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
button{margin-top:14px;padding:8px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
code{font-size:13px}
dt{font-weight:600;margin-top:10px}dd{margin:2px 0 0}
a{color:var(--accent)}
li{margin:6px 0}
</style>`;

function page(title, body, bodyAttr = '') {
  return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    escapeHtml(title) + '</title>\n' + STYLE + '\n</head>\n<body' + bodyAttr + '>\n<main>\n' + body + '\n</main>\n</body>\n</html>\n';
}

function shopPage(which) {
  const host = which === 'a' ? HOSTS.shopA : HOSTS.shopB;
  const name = which === 'a' ? 'Магазин A' : 'Магазин B';
  return page(name + ' — стенд «Защиты»', `<p class="tag">Синтетическая страница стенда detect.expert · ${escapeHtml(host)}</p>
<h1 id="title">${name}: оформление заказа</h1>
<div class="card">
<p>На странице стоит сторонний скрипт «пикселя» с <code>${escapeHtml(HOSTS.collector)}</code>. Пока вы вводите e-mail (после паузы ~0,8 с) и при уходе из поля он отправляет SHA-256 e-mail в параметре <code>ud[em]</code> на свой сервер — ещё до нажатия «Оформить заказ». Все адреса стенда ведут на локальный сервер (127.0.0.1).</p>
<form id="order" action="#">
<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email">
<label for="phone">Телефон</label><input id="phone" name="phone" type="tel" autocomplete="tel">
<label for="name">Имя</label><input id="name" name="name" type="text" autocomplete="name">
<button id="submit" type="submit">Оформить заказ</button>
</form>
<p id="submitted" hidden>Демо: заказ никуда не отправлен.</p>
</div>
<p class="muted">Пиксель: <span id="pixel-status">загружается…</span></p>
<script>
document.getElementById('order').addEventListener('submit', function (event) {
  event.preventDefault();
  document.getElementById('submitted').hidden = false;
});
</script>
<script src="${origin(HOSTS.collector)}/pixel.js"></script>`, ' data-demo="shop-' + which + '"');
}

// The synthetic third party: PageView on load; sha256(trim+lower e-mail) as ud[em] after a 0.8 s typing pause and on
// blur, once per value per focus (a new focus sends again, so a repeat after a firewall decision is a new request).
const PIXEL_SCRIPT = `
// detect.expert demo stand: synthetic third-party pixel (served from the collector host after the vendored
// forms/lib.js above, whose formsLib.sha256Hex it uses). The page's own third party reads its field and sends the
// hash; the extension never sends anything.
(function () {
  'use strict';
  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src).origin : '';
  var status = document.getElementById('pixel-status');
  var sent = { PageView: 0, Lead: 0 };
  var last = '';
  var timer = 0;
  function show() {
    if (status) status.textContent = 'PageView — ' + sent.PageView + ', ud[em] (SHA-256 e-mail) — ' + sent.Lead;
  }
  function send(query, kind) {
    var img = new Image();
    img.src = base + '/tr?' + query;
    sent[kind]++;
    show();
  }
  function sendEmail() {
    clearTimeout(timer);
    var value = field.value.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$/i.test(value)) return;
    var hex = window.formsLib.sha256Hex(value);
    if (hex === last) return;
    last = hex;
    send('ev=Lead&ud[em]=' + hex, 'Lead');
  }
  send('ev=PageView', 'PageView');
  var field = document.querySelector('input[type=email]');
  if (!field) return;
  field.addEventListener('focus', function () { last = ''; });
  field.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(sendEmail, 800); });
  field.addEventListener('blur', sendEmail);
})();
`;

function pixelSource() {
  return readFileSync(join(VENDOR, 'forms', 'lib.js'), 'utf8') + '\n' + PIXEL_SCRIPT;
}

function gpcState(request) {
  const value = request.headers['sec-gpc'];
  if (value === undefined) return { key: 'absent', text: 'нет заголовка' };
  if (value === '1') return { key: '1', text: 'Sec-GPC: 1' };
  return { key: 'other', text: 'Sec-GPC: (другое значение)' };
}

function gpcPage(request) {
  const nav = gpcState(request);
  const detail = '/protect/gpc/gpc-top.html?other=' + encodeURIComponent(origin(HOSTS.gpcOther));
  return page('GPC — стенд «Защиты»', `<p class="tag">Синтетическая страница стенда detect.expert · ${escapeHtml(HOSTS.gpc)}</p>
<h1 id="title">Сигнал Global Privacy Control</h1>
<div class="card"><dl>
<dt>Заголовок <code>Sec-GPC</code> в запросе этой страницы (видит сервер стенда)</dt>
<dd id="nav-header" data-value="${nav.key}">${escapeHtml(nav.text)}</dd>
<dt><code>navigator.globalPrivacyControl</code></dt>
<dd id="property" data-value="pending">…</dd>
<dt>Заголовок <code>Sec-GPC</code> fetch-запроса к этому сайту</dt>
<dd id="fetch-header" data-value="pending">…</dd>
</dl>
<button id="recheck" type="button">Проверить fetch ещё раз</button>
</div>
<p class="muted">После включения или выключения GPC перезагрузите страницу: заголовок навигации и свойство берутся при загрузке. Подробный стенд 722fae8 (кадр, about:blank, worker, картинка, WebSocket): <a href="${escapeHtml(detail)}">gpc-top.html</a>.</p>
<script>
(function () {
  'use strict';
  var value = navigator.globalPrivacyControl;
  var property = document.getElementById('property');
  property.textContent = value === undefined ? 'undefined (свойства нет)' : String(value);
  property.dataset.value = String(value);
  var out = document.getElementById('fetch-header');
  function check() {
    out.textContent = '…';
    fetch('/gpc-echo/demo', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      out.dataset.value = j.secGpc === null ? 'absent' : String(j.secGpc);
      out.textContent = j.secGpc === null ? 'нет заголовка' : 'Sec-GPC: ' + String(j.secGpc);
    }, function () {
      out.dataset.value = 'error';
      out.textContent = 'запрос не удался';
    });
  }
  document.getElementById('recheck').addEventListener('click', check);
  check();
})();
</script>`, ' data-demo="gpc"');
}

function checklist() {
  const u = urls();
  return [
    'Запустите Chrome командой выше. Если detect.expert нет в chrome://extensions: «Режим разработчика» → «Загрузить распакованное» → ' + DIST + '.',
    'Значок расширения → шестерёнка (настройки) → «Защита данных ›» → «Включить «Защиту»…». В согласии отметьте все пять функций, режим «Обычный» и галочку согласия → «Включить и запросить разрешения».',
    'shop-a (' + u.shopA + '): введите e-mail, «Оформить заказ» не нажимайте. Через ~1 с пиксель отправит SHA-256 e-mail: в этом окне строка «[получатель] … ' + HOSTS.collector + '/tr ev=Lead ключи=ev,ud[em]». Окно фаервола откроется само у значка расширения (на значке синяя «1»): «Запрос к example.net уже отправлен — ещё до отправки формы». Если окно не появилось (окно Chrome было не в фокусе), кликните по значку — откроется фаервол.',
    'В окне фаервола: «Этот сайт» → «Блокировать следующие». Без перезагрузки страницы (после блокировки Chrome не загрузит и сам скрипт пикселя) кликните в поле e-mail и вне его: новой строки «[получатель]» нет, в отчёте «остановлено», счётчик «Сегодня» вырос. «Отменить решение» → следующий уход из поля снова даёт строку.',
    'shop-b (' + u.shopB + '): тот же e-mail → боковая панель «Кто узнаёт» и Options #history: example.net на 2 сайтах. Карточка получателя → «Подготовить запрос» → черновик в requests.html.',
    'GPC (' + u.gpc + '): «Sec-GPC: 1» для страницы и fetch, navigator.globalPrivacyControl = true.',
    'Запись сессии (' + u.recorder + '): подождите ~10 с (6 строк «[получатель] … rec.example.net») → в окне расширения строка записи сессии «Отдельные признаки…» (signals-only: в release подписки страницы на ввод не наблюдаются).',
    'Пароль (' + u.password + '): введите любой пароль и кликните вне поля. Сайт сам отправит пароль и его SHA-256 на pw.collect.example.org (строки «[получатель]»), но синей «1» и карточки нет: модуль пароли не читает. Красная цифра на значке — счётчик техник наблюдения (fetch), не модуль.',
    'Тема ОС или Chrome — окно фаервола и страницы модуля в тёмной теме; язык в пикере: ru и en полностью, остальные — английский текст с пояснением.',
    'Options #protect → «Выключить «Защиту»» с галочкой удаления данных → страница GPC после перезагрузки: заголовка нет, свойство undefined; блокировка снята.',
  ];
}

function indexPage() {
  const u = urls();
  const rows = [
    ['shop-a', u.shopA, 'форма e-mail / телефон / имя и сторонний пиксель ' + HOSTS.collector],
    ['shop-b', u.shopB, 'та же форма и тот же пиксель на другом сайте'],
    ['GPC', u.gpc, 'эхо заголовка Sec-GPC и navigator.globalPrivacyControl'],
    ['Запись сессии', u.recorder, 'стенд 722fae8: обработчики, наблюдатель документа, 6 POST на rec.example.net'],
    ['Пароль', u.password, 'стенд 722fae8: сайт сам отправляет пароль третьей стороне'],
    ['Сборщик пикселя', u.collector, 'отвечает 204, тела не читает'],
  ];
  const list = rows.map(([label, href, note]) => '<li><a href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a> — ' + escapeHtml(note) + '</li>').join('\n');
  const steps = checklist().map((s) => '<li>' + escapeHtml(s) + '</li>').join('\n');
  return page('Стенд «Защиты» detect.expert', `<p class="tag">Локальный стенд модуля «Защита» (ADR-020, ADR-047) · 127.0.0.1:${String(port)}</p>
<h1 id="title">Стенд модуля «Защита»</h1>
<div class="card"><ul>
${list}
</ul>
<p class="muted">Страницы работают только в Chrome, запущенном командой из окна сервера: она направляет *.example.com, *.example.net и *.example.org на 127.0.0.1. Исходные страницы стенда 722fae8: <a href="/protect/index.html">/protect/index.html</a> (получателям нужен <code>?rp=${String(port)}</code>).</p>
</div>
<div class="card"><h2>Чек-лист</h2><ol>
${steps}
</ol></div>`, ' data-demo="index"');
}

// ---------------------------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------------------------

const time = () => new Date().toTimeString().slice(0, 8);
const safe = (text, max) => String(text).replace(/[^A-Za-z0-9_.:\/\[\]-]/g, '?').slice(0, max);

function logReceiver(request, url, host) {
  const names = [...new Set(url.searchParams.keys())].slice(0, 8).map((n) => safe(n, 32));
  const ev = url.searchParams.get('ev');
  console.log('[получатель] ' + time() + ' ' + safe(request.method, 8) + ' ' + safe(host, 64) + safe(url.pathname, 64) +
    (ev !== null && LOGGED_EVENTS.has(ev) ? ' ev=' + ev : '') + ' ключи=' + (names.length > 0 ? names.join(',') : '-') +
    ' sec-gpc=' + (request.headers['sec-gpc'] === '1' ? '1' : 'нет'));
}

function logGpc(request, url, host) {
  console.log('[GPC] ' + time() + ' ' + safe(request.method, 8) + ' ' + safe(host, 64) + safe(url.pathname, 64) + ' sec-gpc=' + gpcState(request).key);
}

function reply(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}

function serveFile(response, file, base) {
  const inside = file.startsWith(base + sep) || file === base;
  if (!inside || !existsSync(file) || !statSync(file).isFile()) return reply(response, 404, CONTENT_TYPES['.txt'], 'not found');
  return reply(response, 200, CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
}

function handle(request, response) {
  const host = String(request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  let url;
  try {
    url = new URL(request.url ?? '/', 'http://127.0.0.1');
  } catch {
    request.resume();
    return reply(response, 400, CONTENT_TYPES['.txt'], 'bad request');
  }
  const path = url.pathname;
  if (RECEIVER_PATHS.has(path) || path.startsWith('/fsink/')) {
    request.resume(); // bodies are never read
    logReceiver(request, url, host);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (path === '/gpc-echo' || path.startsWith('/gpc-echo/')) {
    request.resume();
    logGpc(request, url, host);
    const value = request.headers['sec-gpc'];
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'], 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', Vary: 'Sec-GPC' });
    return response.end(JSON.stringify({ secGpc: value === undefined ? null : value === '1' ? '1' : 'other' }));
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    request.resume();
    return reply(response, 405, CONTENT_TYPES['.txt'], 'method not allowed');
  }
  if (path === '/favicon.ico') {
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (path === '/pixel.js' && host === HOSTS.collector) return reply(response, 200, CONTENT_TYPES['.js'], pixelSource());
  if (path === '/fixture-lib.js') return serveFile(response, FIXTURE_LIB, FIXTURE_LIB);
  if (path.startsWith('/protect/')) {
    let rel;
    try {
      rel = decodeURIComponent(path.slice('/protect/'.length));
    } catch {
      return reply(response, 400, CONTENT_TYPES['.txt'], 'bad path');
    }
    return serveFile(response, normalize(join(VENDOR, rel)), VENDOR);
  }
  if (path === '/') {
    if (host === HOSTS.shopA) return reply(response, 200, CONTENT_TYPES['.html'], shopPage('a'));
    if (host === HOSTS.shopB) return reply(response, 200, CONTENT_TYPES['.html'], shopPage('b'));
    if (host === HOSTS.gpc || host === HOSTS.gpcOther) {
      logGpc(request, url, host);
      response.setHeader('Vary', 'Sec-GPC');
      return reply(response, 200, CONTENT_TYPES['.html'], gpcPage(request));
    }
    return reply(response, 200, CONTENT_TYPES['.html'], indexPage());
  }
  return reply(response, 404, CONTENT_TYPES['.txt'], 'not found');
}

// ---------------------------------------------------------------------------------------------------------------
// Start-up output
// ---------------------------------------------------------------------------------------------------------------

function findChrome() {
  const candidates = process.platform === 'win32'
    ? [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']]
      .filter((dir) => typeof dir === 'string' && dir.length > 0).map((dir) => join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((file) => existsSync(file)) ?? null;
}

async function findPlaywrightChromium() {
  try {
    const { chromium } = await import('playwright');
    const file = chromium.executablePath();
    return typeof file === 'string' && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

function chromeArgs(profile) {
  return ['--user-data-dir=' + profile, '--host-resolver-rules=' + RESOLVER_RULES, '--no-proxy-server', '--no-first-run',
    '--no-default-browser-check', '--load-extension=' + DIST, urls().index];
}

const quoteWin = (arg) => (/[\s"*,]/.test(arg) ? '"' + arg.replace(/"/g, '\\"') + '"' : arg);
const quotePosix = (arg) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : "'" + arg.replace(/'/g, "'\\''") + "'");

function commandLines(exe, profile) {
  if (process.platform === 'win32') {
    const line = quoteWin(exe ?? '<путь к chrome.exe>') + ' ' + chromeArgs(profile).map(quoteWin).join(' ');
    return ['  PowerShell:  & ' + line, '  cmd.exe:     ' + line];
  }
  return ['  ' + [exe ?? '<путь к chrome>', ...chromeArgs(profile)].map(quotePosix).join(' ')];
}

async function printStart() {
  const u = urls();
  const chrome = findChrome();
  const chromium = await findPlaywrightChromium();
  const lines = [
    '',
    'detect.expert — стенд модуля «Защита» для ручной проверки production-сборки',
    'Сервер слушает только http://127.0.0.1:' + String(port) + ' (внешней сети нет). Остановить: Ctrl+C.',
    '',
    'Страницы (открывать только в Chrome, запущенном командой ниже):',
    '  Оглавление       ' + u.index,
    '  shop-a           ' + u.shopA,
    '  shop-b           ' + u.shopB,
    '  GPC              ' + u.gpc,
    '  Запись сессии    ' + u.recorder,
    '  Пароль           ' + u.password,
    '  Сборщик пикселя  ' + u.collector + '  (204)',
    '',
    'Расширение: ' + DIST + (existsSync(join(DIST, 'manifest.json')) ? '' : '   <- manifest.json нет: сначала pnpm build:chrome'),
    '',
    'Команда Chrome' + (chrome === null ? ' (chrome не найден — подставьте путь):' : ':'),
    ...commandLines(chrome, PROFILE),
    'Google Chrome флаг --load-extension не применяет (проверено на 155). Тогда в этом окне: chrome://extensions →',
    '«Режим разработчика» → «Загрузить распакованное» → ' + DIST + ' (один раз: профиль отдельный и сохраняется).',
  ];
  if (chromium !== null) {
    lines.push('Chromium из Playwright загружает расширение флагом сам (свой профиль):', ...commandLines(chromium, PROFILE_CHROMIUM));
  }
  lines.push('', 'Чек-лист:', ...checklist().map((step, i) => (i < 9 ? ' ' : '') + String(i + 1) + '. ' + step), '',
    'Строки «[получатель]» и «[GPC]» ниже — запросы, дошедшие до сервера стенда (только имена параметров, без значений).',
    'Жду запросы. Остановить: Ctrl+C.', '');
  console.log(lines.join('\n'));
}

const server = createServer(handle);
server.on('upgrade', (_request, socket) => socket.destroy());
server.on('clientError', (_error, socket) => socket.destroy());
server.once('error', (error) => {
  console.error(error?.code === 'EADDRINUSE'
    ? 'protect-demo-server: порт ' + String(requestedPort) + ' занят. Укажите другой: pnpm protect:demo --port 4190'
    : 'protect-demo-server: ' + String(error?.message ?? error));
  process.exit(1);
});
server.listen(requestedPort, '127.0.0.1', () => {
  port = server.address().port;
  printStart().catch((error) => console.error('protect-demo-server: ' + String(error?.message ?? error)));
});

function stop() {
  server.closeAllConnections?.();
  server.close(() => {
    console.log('Стенд остановлен.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
