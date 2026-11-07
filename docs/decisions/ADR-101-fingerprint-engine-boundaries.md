# ADR-101 — Native profile sessions and private asynchronous metadata

2026-11-01. The owner explicitly requested fixes for actual CSS/layout, Workers
and delayed native Promise chains after ADR-100. This extends ADR-048/049/075/
085/086/087/095/100 only in the following bounded areas. No manifest, permission,
CSP, contract enum, dependency, detector threshold or Protect change is made.

## Native session

An explicit action in top-level own Options opens one new owned normal Chrome
window, initially about:blank. The existing debugger permission is reused;
the browser attachment banner remains visible. No personal tab/window is attached
or resized. The fixed packaged driver attaches before the initial HTTP(S)
navigation, applies the validated selected profile and installs worker-only
recursive Target auto-attachment. UI may send only load/start/stop, an initial
HTTP(S) URL and expected configuration revision. UI cannot send CDP commands,
target/session IDs, JavaScript, seed values or profile dictionaries.

The compiler accepts only the existing effective Custom profile. It rejects
conflicting viewport/DPR/timezone/language selections, incomplete pairs and
oversized selected surfaces. Selected width × height × DPR² is limited to
67,108,864 pixels. Unselected native DPR uses protocol zero, so that limit is
not a measured native allocator bound. The closed command allowlist covers
device metrics, the five measured native media features, IANA timezone, locale,
hardwareConcurrency and explicitly selected UA/Client Hints. The latter changes
HTTP UA/Accept-Language/Client-Hints headers as well as JavaScript metadata.
There is no Network/Fetch interception, request-body reading, page input,
clicking, CAPTCHA operation, proxy configuration or source masking.

Real stylesheet conditions, layout and native MediaQueryList events are covered
only for the protocol features actually proven in the delivered Chrome. An
accepted protocol command does not establish support for every media name.
Unsupported fields are returned as partial, never silently marked applied.
Firefox has no corresponding extension debugger API; this session is unavailable
there. Existing normal document Custom functions remain available.

## Dedicated Workers

Paused dedicated Worker targets in the exact owned origin receive a packaged
bootstrap before their first instruction, including recursive dedicated workers.
Existing selected Window helpers use the genuine WorkerNavigator when present;
absent APIs are not fabricated. Classic/module/blob scripts retain their original
URL, import resolution and CSP. The source is an opaque private capability built
from validated configuration and existing Math/Canvas seeds, not arbitrary UI
code. Current consent, exact origin, revision/signature and native host grants
are rechecked before injection, including after asynchronous checks.

SharedWorker, ServiceWorker and worklets are unsupported. Workers already running
are not retroactively declared covered. Native messages, queues, paused targets,
protocol calls and authorization have fixed bounds/deadlines. An independent
128-ID cleanup intake retains overflow and late attachments. Teardown first
keeps auto-attachment enabled with future start-pausing disabled, preserving
existing restoration handles. Eight-worker batches restore and resume current
and late targets before disabling auto-attachment and detaching. Unknown paused
targets, saturated intake or incomplete physical work retain ownership and
listeners for explicit retry/Close; detach is not proof of resume. The native
waiting hint can be misleading during teardown: all addressable own
attachments receive the bounded resume handshake even when waitingForDebugger
is false. The unchanged native seventy-Worker fixture must complete every Worker.
A timed-out attach
or detach retains physical ownership until native settlement; new Start cannot
reuse the slot. Stop restores current owned live Worker descriptors before disabling
target auto-attachment and detaching. Snapshot-only Canvas/Math helpers require a
private before/after descriptor ledger; Stop must not silently assume their
returned handle has a stop method. Later page replacements are preserved.
Already retained immutable Canvas/Math functions can retain their projection
until the Worker ends. Unexpected transport loss cannot guarantee removal
of already installed Worker hooks. The stopped/detached owned window remains
available to preserve user work; explicit Close closes only that window.

Native outer-window geometry is not proven restored by detach. This is why the
feature owns a window, not merely a personal tab. Cross-origin onBeforeNavigate
stop is best effort, not atomic interception of the first destination request.
No claim that selected UA headers never reach a redirected origin is made.

Stop explicitly clears the root UA override with `{userAgent:''}` before detach;
Window restoration is verified by an actual native comparison. Existing Workers
can retain a creation-time native UA even after root reset. They are not silently
terminated and host UA values are not sampled to fabricate a replacement getter.
The normal UI Close action terminates the owned window and its Workers. Policy
stops which preserve user work require closing/reloading that session; the UI
instructs the user to close the session window. No exact native reversal of every
Accept-Language/platform/Client-Hints or previously retained handle is promised.

Own trusted storage.session keeps only `{v,windowId,tabId}` for the owned window.
No profile, visited URL, token or native observation is persisted there. A new
background verifies the exact live native window/tab before restoring ownership
as detached and unusable. It never automatically attaches or resumes. Stale IDs
are cleared only after native absence/mismatch is verified; transient native
errors remain not-ready. Journal transactions have a physical fence and one
latest queued write, including a delayed Clear after a timed-out Save.

Trusted profile reads share one physical operation and logical deadline; at most
four native permission lookups remain physically outstanding. Private preparation
and native window closure also have deadlines and retain physical ownership after
timeout. Repeated clicks cannot pile up hung providers or duplicate native remove.
After an idle/lost port, a user Start first reads current service state. It never
repeats an unknown Start if a session exists or startup/teardown is in progress;
scope, saved revision and unchanged pending input are rechecked before one new
mutation. There is no reconnect heartbeat or automatic Start replay.

## Promise boundaries

Custom UAData high-entropy queries use selected/neutral snapshots without a
native high-entropy query. Native brand validation and bounded sequence conversion
precede snapshot construction. Caller conversion errors retain identity. Permission-
dependent physical keys, backend scheduling and physical rejection are not
queried in this virtual metadata operation. OFF/Stop retain their native path.

Custom Window MediaCapabilities records canonical primitive arguments through
the native WebIDL converter and aborts that MAIN call at the final type conversion
before backend launch. A private completion marker is never an authorization
token. Exact canonical primitive JSON may pass through one new packaged ISOLATED
relay to the extension-private media backend. This narrowly extends REQ-005's
codec argument restriction: the transient bytes are bounded to 16 KiB, never
stored, logged, reported, exported or sent over a network. No caller callback,
raw native flags/dictionary, handle, media sample, URL or credential is relayed.

The background authenticates native MessageSender, exact current document,
consent/grants and effective current Custom profile. The public channel contains
only three selected boolean flags and is routing, not authentication. Canonical
arguments are validated again. No-DRM validation uses the real private extension
backend; physical results remain private and only allowed field names return.
MAIN constructs its own chosen result. Native error messages/stacks are omitted.
DRM false is virtual unsupported metadata; DRM true cannot synthesize an opaque
MediaKeySystemAccess and rejects as unsupported. Worker MediaCapabilities has no
Window relay and is not certified isolated by this change. Opaque inaccessible
documents cannot query a private backend and fail on a bounded deadline.

The generic opaque entry must not plant a specialized installer's immutable marker
before its imported entry executes. Media and the fifteen extended opaque bundles
require their real specialized installer first. The generic preload may retain
the independent deny-only observation veto, but cannot suppress the actual guard.

The Firefox relay uses the existing packaged bridge adapter and its isolated
document-identity envelope. Current-document checks reuse the existing bounded
native-document resolver; a raw Firefox getFrame result is not treated as a
normalized document identity. Resolver failure never falls back to accepting a
page-supplied ID. No adapter authority or new permission is added.

The relay/backend each cap concurrent work, bytes and logical deadlines. Actual
native backend operations keep their physical slot after a logical timeout until
settlement. Navigation, profile changes and revocation invalidate replies.
If a started private native Promise cannot be observed at all, its physical slot
stays reserved. Sixty-four such abnormal failures can make the backend unavailable
until restart; releasing unknown live work would defeat the concurrency bound.
No public stop/restore channel or global Promise/Object/Function mask is added.
RTC live handles and other backend-specific deferred chains remain outside this
proof; pre-return species pinning alone is not declared a universal fix.

## Native Date context and validation

A private captured Intl/Temporal helper recognizes whether the original Date
offset already matches the selected IANA zone, preserving real DST/historical
offsets after native emulation. No extra clock read, selected-zone page marker or
public patched Intl oracle is used. Legacy fixed-offset fallback remains when
native context is unavailable/different. Observed dates/offsets are never reported.

Evidence, regressions, independent review, source/release hashes and native
browser results belong to внутренний отчёт.
Actual BrowserLeaks visits, local native fixtures and unit tests must be described
separately. No complete OS/GPU/TLS/JIT emulation or universal naturalness claim.

References: [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger),
[CDP Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/),
[Media Capabilities](https://www.w3.org/TR/media-capabilities/),
[Web IDL](https://webidl.spec.whatwg.org/).

## Дополнение 2026-11-06 (раунд 5): кодеки только вниз

Решение владельца: Custom `media-capabilities` может только понизить то, что сообщает этот браузер. Конфигурация Window MediaCapabilities без `keySystemConfiguration` больше не прерывает MAIN-вызов: родной `decodingInfo`/`encodingInfo` страницы выполняется до конца, и его ответ возвращается пониженным (`supported` = родной И выбранный И ни одно скрытое семейство не названо в кодовых строках аудио/видео, которые увидело родное преобразование; `smooth` и `powerEfficient` дополнительно требуют родной И выбранный И `supported`). Ни одна кодовая строка таких конфигураций не покидает страницу. Приватное реле и backend с прежними границами и проверками канала обслуживают только конфигурации с ключевой системой (Custom true отклоняет их, Custom false остаётся виртуальным unsupported); для непрозрачных документов этот срок по-прежнему ограничен дедлайном. Причина: измерено, что родной результат service worker расширения отличается от результата страницы (`powerEfficient` для AV1 и VP8, WebRTC H.264), поэтому «И» по данным backend мог бы поднять флаг выше того, что сообщает браузер страницы.

`HTMLMediaElement.canPlayType` и `MediaSource`/`ManagedMediaSource`/`MediaRecorder.isTypeSupported` используют тот же список скрытых семейств: оригинал вызывается один раз и первым с исходными `this` и аргументами, родные `''`/`false` никогда не поднимаются, читается только примитивная строка первого аргумента (первые 512 единиц UTF-16, простой разбор, без приведения). Хуки не устанавливаются в профиле, который оставляет все три флага и ничего не скрывает. Пределы: непрозрачные документы и Worker (скрытые семейства не применяются), объект `String` и строки длиннее 512 единиц, `WebCodecs.isConfigSupported`, EME, `RTCRtpSender/Receiver.getCapabilities`, `ImageDecoder.isTypeSupported`. Подробности и проверки — [ADR-108](ADR-108-shardbrowser-owner-decisions.md), раздел 4.
