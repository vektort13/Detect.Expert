// Shared Chrome/Firefox instructions. API-specific Chrome facts keep their original wording.
const BROWSER_NAMES = {
  en: 'browser', ru: 'браузера', zh_CN: '浏览器', vi: 'trình duyệt', es: 'el navegador', ar: 'المتصفح',
  uk: 'браузера', fr: 'le navigateur', pt_BR: 'navegador', hi: 'ब्राउज़र', ur: 'براؤزر', ja: 'ブラウザー',
  de: 'Browser', pl: 'przeglądarki', id: 'browser', mr: 'ब्राउझर', te: 'బ్రౌజర్', ko: '브라우저', ta: 'உலாவி',
  yue: '浏览器', wuu: '浏览器',
};
const PHRASES = {
  ru: { consent_controls: ['доступные Chrome сайты', 'доступные браузеру сайты'] },
  es: { consent_previews: ['almacenamiento de Chrome', 'almacenamiento del navegador'] },
  uk: { consent_controls: ['дозволені Chrome сайти', 'дозволені браузером сайти'] },
  fr: { consent_previews: ['stockage Chrome', 'stockage du navigateur'] },
  de: { consent_controls: ['Chrome-erlaubte', 'vom Browser erlaubte'] },
  pl: { consent_controls: ['przez Chrome', 'przez przeglądarkę'] },
};

export function applyBrowserNeutralCopy(table, locale) {
  const browser = BROWSER_NAMES[locale];
  if (!browser) throw new Error('browser-neutral copy: unknown locale ' + locale);
  for (const key of ['consent_controls', 'consent_previews', 'inventory_sync']) {
    const phrase = PHRASES[locale]?.[key];
    if (phrase) table[key].message = table[key].message.replace(phrase[0], phrase[1]);
    table[key].message = table[key].message.replaceAll('Chrome', browser);
  }
  return table;
}
