// REQ-010, ADR-002, F074: validate output without changing manifest policy.
export function validateBrowserSupport(manifest, support) {
  return manifest.minimum_chrome_version === support.minimumChromeVersion
    ? [] : ['minimum_chrome_version differs from browser-support.json'];
}

function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return a.length === sa.length && b.length === sb.length && JSON.stringify(sa) === JSON.stringify(sb);
}

export function validateManifest(manifest, allow) {
  const problems = [];
  const problem = (message) => problems.push(message);
  const allowedKeys = new Set(['manifest_version', 'name', 'version', 'description', 'default_locale', 'minimum_chrome_version', 'permissions', 'optional_host_permissions', 'background', 'action', 'side_panel', 'options_ui', 'incognito', 'content_security_policy', 'icons']);
  for (const key of Object.keys(manifest)) if (!allowedKeys.has(key)) problem('unapproved manifest key: ' + key);
  if (manifest.optional_permissions !== undefined) problem('optional_permissions must be absent in the local profile');
if (manifest.manifest_version !== 3) problem('manifest_version must be 3');
if (!sameSet(manifest.permissions, allow.permissions)) problem('permissions differ from the allowlist: ' + JSON.stringify(manifest.permissions));
if (manifest.host_permissions !== undefined) problem('host_permissions must be absent in the local profile');
if (!sameSet(manifest.optional_host_permissions, allow.optional_host_permissions)) problem('optional_host_permissions differ from the allowlist');
for (const p of manifest.permissions ?? []) if (allow.forbidden_permissions.includes(p)) problem('forbidden permission ' + p);
if (manifest.content_security_policy?.extension_pages !== allow.content_security_policy.extension_pages) problem('extension_pages CSP differs from the allowlist');
if (manifest.content_security_policy?.sandbox !== undefined) problem('sandbox CSP is not allowed');
if (manifest.incognito !== allow.incognito) problem('incognito must be ' + allow.incognito);
if (manifest.minimum_chrome_version !== allow.minimum_chrome_version) problem('minimum_chrome_version must be ' + allow.minimum_chrome_version);
if (manifest.content_scripts !== undefined) problem('static content_scripts are not allowed (registered dynamically after scope selection)');
if (manifest.web_accessible_resources !== undefined) problem('web_accessible_resources are not expected');
if (manifest.name !== '__MSG_extName__') problem('release name must be __MSG_extName__ (got ' + manifest.name + ')');
if (manifest.default_locale !== 'ru') problem('default_locale must be ru');
if (manifest.background?.type !== 'module' || manifest.background?.service_worker !== 'background.js') problem('background must be a module service worker background.js');
for (const key of ['externally_connectable', 'oauth2', 'key', 'update_url']) if (manifest[key] !== undefined) problem(key + ' is not allowed in the manifest');

  return problems;
}
