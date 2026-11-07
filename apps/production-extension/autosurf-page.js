// ADR-075: fixed ISOLATED-world inspection. No page commands, form values or text are read.
// The function is self-contained because scripting.executeScript serializes it.
export function inspectAutosurfPage(expectedOrigin, expectedUrl = null) {
  if (window !== window.top || location.origin !== expectedOrigin || expectedUrl !== null && location.href !== expectedUrl) return null;
  const bounded = (value, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
  const width = bounded(innerWidth, 16384), height = bounded(innerHeight, 16384);
  const output = { viewport: { width, height }, scroll: { x: bounded(scrollX, 10000000), y: bounded(scrollY, 10000000), maxY: bounded((document.scrollingElement?.scrollHeight ?? 0) - height, 10000000) }, hoverPoints: [], links: [], challenge: null, hidden: document.visibilityState !== 'visible' };
  if (!width || !height || output.hidden) return output;
  const action = /(?:^|[\/_\-.])(?:log[-_]?(?:in|out|off)|sign[-_]?(?:in|out|up)|register|registration|delete|remove|destroy|unsubscribe|checkout|payment|pay|purchase|buy|order|cart|basket|admin|account|auth|oauth|authorize|confirm|activate|reset|download|export|import|api|выход|удалить|оплата|купить|заказ|корзина|вход|регистрация)(?:$|[\/_\-.\d])/i;
  const file = /\.(?:pdf|zip|rar|7z|exe|msi|dmg|pkg|apk|iso|tar|gz|mp[34]|webm|mov|avi|wav|ogg|png|jpe?g|gif|webp|svg|woff2?|ttf|csv|xlsx?|docx?|pptx?)(?:$|\/)/i;
  const excluded = element => Boolean(element.closest('form,input,textarea,select,button,[contenteditable],[role="button"],[role="textbox"],[data-ad],[data-ad-slot],ins.adsbygoogle,[aria-label="Advertisement"],[aria-label="advertisement"],[class~="advertisement"],[class~="ads"],[id^="google_ads"]'));
  const point = element => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0.05 || style.pointerEvents === 'none') return null;
    const x = Math.min(width - 1, Math.max(1, (Math.max(0, rect.left) + Math.min(width, rect.right)) / 2));
    const y = Math.min(height - 1, Math.max(1, (Math.max(0, rect.top) + Math.min(height, rect.bottom)) / 2));
    const hit = document.elementFromPoint(x, y);
    return hit && (hit === element || element.contains(hit)) && !excluded(hit) ? { x, y } : null;
  };
  // A normal embedded CAPTCHA/Turnstile widget or loader is not a blocking challenge.
  for (const selector of ['#challenge-form', '#cf-challenge-running', '#challenge-running']) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const area = Math.max(0, Math.min(width, rect.right) - Math.max(0, rect.left)) * Math.max(0, Math.min(height, rect.bottom) - Math.max(0, rect.top));
    if (area >= width * height * 0.25 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0.05) { output.challenge = 'visible-challenge'; return output; }
  }
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  const seen = new Set();
  let element = walker.currentNode, checked = 0, candidates = 0;
  while (element && checked++ < 1024 && candidates < 128) {
    const tag = element.localName;
    if ((tag === 'a' || tag === 'video') && !excluded(element)) {
      ++candidates;
      let href = null;
      if (tag === 'a') {
        const raw = element.getAttribute('href');
        if (typeof raw !== 'string' || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw) || element.hasAttribute('download') || /(?:^|\s)(?:sponsored|nofollow)(?:\s|$)/i.test(element.getAttribute('rel') ?? '')) { element = walker.nextNode(); continue; }
        try {
          const url = new URL(raw, location.href); let path = url.pathname;
          for (let decode = 0; decode < 3 && /%[\da-f]{2}/i.test(path); ++decode) path = decodeURIComponent(path);
          if (url.origin !== expectedOrigin || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || action.test(path) || file.test(path) || /[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069\\?#%]/u.test(path) || url.href.length > 2048) { element = walker.nextNode(); continue; }
          href = url.href;
        } catch { element = walker.nextNode(); continue; }
      }
      const target = point(element);
      if (target) {
        if (output.hoverPoints.length < 8) output.hoverPoints.push(target);
        if (href && href !== location.href && output.links.length < 32 && !seen.has(href)) { seen.add(href); output.links.push(href); }
      }
    }
    element = walker.nextNode();
  }
  return output;
}
