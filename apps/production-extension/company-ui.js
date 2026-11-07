// REQ-002/010/013: shared, packaged company marks for analysis and printed reports.
import { companyBrand, COMPANY_BRANDS } from './company-branding.js';
const packagedSvgSources = new Set(COMPANY_BRANDS.filter(brand => brand.file.endsWith('.svg')).map(brand => new URL('./icons/brands/' + brand.file, import.meta.url).href));

export function createCompanyUi({ h }) {
  function CompanyLabel({ name, identity = name, size = 'compact' }) {
    const brand = companyBrand(identity);
    return h('span', { class: 'company-label company-label--' + (size === 'large' ? 'large' : 'compact'),
      'data-company-label': true, ...(brand ? { 'data-company-brand': brand.id, 'data-company-role': brand.role ?? 'company' } : {}), children: [
        brand ? h('span', { class: 'company-label__mark', 'aria-hidden': 'true', children:
          h('img', { class: 'company-logo', 'data-company-logo': brand.id, src: brand.src, alt: '', width: size === 'large' ? 28 : 20, height: size === 'large' ? 28 : 20, loading: 'eager', decoding: 'async' }) }) : null,
        h('bdi', { class: 'company-label__name', children: name })
      ] });
  }
  return { CompanyLabel };
}

export async function waitForCompanyImages(documentRef, timeoutMs = 4500) {
  let timer;
  const removers = [];
  try {
    const images = Array.from(documentRef.querySelectorAll('img[data-company-logo], img[data-system-logo], .cookie-company-mark img'));
    if (images.length > 32768) return false;
    const ready = image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    // Firefox can decode a viewBox-only SVG without reporting intrinsic dimensions.
    // Only our exact packaged vectors qualify, after successful native decode.
    const vectorReady = image => {
      if (!image.complete || !packagedSvgSources.has(image.currentSrc || image.src) || typeof image.getBoundingClientRect !== 'function') return false;
      const box = image.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const decoded = images.map(image => {
      if (ready(image)) return true;
      if (typeof image.decode === 'function') return image.decode().then(() => ready(image) || vectorReady(image), () => false);
      return new Promise(resolve => {
        const loaded = () => resolve(ready(image)), failed = () => resolve(false);
        image.addEventListener('load', loaded); image.addEventListener('error', failed);
        removers.push(() => { image.removeEventListener('load', loaded); image.removeEventListener('error', failed); });
        if (image.complete) loaded();
      });
    });
    return await Promise.race([
      Promise.all(decoded).then(results => results.every(Boolean)),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } catch { return false; }
  finally { clearTimeout(timer); for (const remove of removers) remove(); }
}
