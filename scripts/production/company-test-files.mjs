// ADR-034: serve only the shared local company modules and declared packaged images in owned layout fixtures.
import { join } from 'node:path';
import { COMPANY_BRANDS } from '../../apps/production-extension/company-branding.js';
export function companyFixtureFiles(root) {
  return [
    ...['company-branding.js', 'company-ui.js', 'company-ui.css'].map(file => ['/production/' + file, join(root, 'apps/production-extension', file)]),
    ...COMPANY_BRANDS.map(brand => ['/production/icons/brands/' + brand.file, join(root, 'apps/production-extension/icons/brands', brand.file)])
  ];
}
export function companyFixtureContentType(file) {
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.ico')) return 'image/x-icon';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.gif')) return 'image/gif';
  return 'application/javascript';
}
