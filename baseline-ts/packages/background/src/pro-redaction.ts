import { redactHost, registrableDomain, toAsciiHost } from '../../attribution/src/index';

// ADR-023: finite route vocabulary. Unknown path segments become placeholders, never retained IDs.
const ROUTES = new Set(('account accounts api app assets auth authentication blog browser browserleaks canvas cart catalog categories checkout client contact css dashboard data docs download fingerprint fonts forgot-password home images img index js javascript login logout main media news oauth password password-recovery pixelscan privacy product products profile recover recovery register registration reset reset-password resources script scripts search service services settings signup static status styles terms test tests user users v1 v2 v3 vendor vendors webgl webgpu webrtc').split(' '));
const EXTENSIONS = new Set(['js', 'mjs', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'wasm', 'json', 'html', 'htm', 'php', 'aspx', 'map']);

export interface SafeProUrl { url: string; domain: string; siteKey: string; scheme: 'http' | 'https' }

/** Browser-provided URL only; no network, query, fragment, userinfo or arbitrary path identifiers. */
export function safeProUrl(value: unknown): SafeProUrl | null {
  if (typeof value !== 'string' || value.length > 16384) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return null;
    const host = toAsciiHost(parsed.hostname);
    if (!host) return null;
    const domain = registrableDomain(host) ?? host;
    const path = parsed.pathname.split('/').slice(1, 13).map((part) => {
      if (!part) return '';
      const lower = part.toLowerCase();
      if (ROUTES.has(lower)) return lower;
      const dot = lower.lastIndexOf('.');
      const extension = dot >= 0 ? lower.slice(dot + 1) : '';
      if (EXTENSIONS.has(extension)) {
        const stem = lower.slice(0, dot);
        return (ROUTES.has(stem) ? stem : ':resource') + '.' + extension;
      }
      return ':segment';
    }).join('/');
    const scheme = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'https' : 'http';
    return { url: parsed.protocol + '//' + domain + (parsed.port ? ':' + parsed.port : '') + '/' + path, domain, siteKey: domain, scheme };
  } catch { return null; }
}

/** Titles come from chrome.tabs, never from a content-script message; neutralize obvious identifiers. */
export function safeProTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 1000).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/[a-z0-9_-]{24,}/gi, '[id]').replace(/\b\d{7,}\b/g, '[id]').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Exact local/IP identity is limited to the explicitly selected target, never unrelated probe destinations. */
export function safeProResourceUrl(target: SafeProUrl, selectedSite: string | null): SafeProUrl {
  if (target.siteKey === selectedSite) return target;
  const host = redactHost(target.domain);
  if (host.kind === 'registrable') return target;
  const category = host.kind === 'unknown' ? 'unknown' : host.value.toLowerCase();
  const domain = category + '.invalid';
  return { ...target, url: target.url.replace('//' + target.domain, '//' + domain), domain, siteKey: domain };
}
