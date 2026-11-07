// Actual local company artwork is shared by the inspector and exported report.
// Declaration-author marks do not become cookie manufacturer marks.
import { companyBrand } from './company-branding.js';

export function cookieCompanyMark(owner) {
  const label = typeof owner === 'string' ? owner.trim().slice(0, 160) : '';
  const company = companyBrand(label);
  if (company && company.role === 'company') return { brand: company.id, src: company.src, monogram: '' };
  const letters = Array.from(label.match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join('').toUpperCase();
  return { brand: null, src: null, monogram: letters || '?' };
}
