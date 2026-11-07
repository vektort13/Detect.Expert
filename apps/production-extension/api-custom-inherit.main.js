// ADR-049: origin-fallback document-start bridge for blank/srcdoc realms.
// The capability only installs an immutable parent's profile; it cannot stop a
// hook, return originals, accept values or access extension privileges.
(() => {
  if (!['about:', 'blob:', 'data:'].includes(location.protocol)) return;
  const key = Symbol.for('detect.expert/api-custom/inherit/v2');
  const getOwn = Object.getOwnPropertyDescriptor, apply = Reflect.apply;
  for (const candidate of [window.parent, window.opener]) {
    if (!candidate || candidate === window) continue;
    try {
      const inherit = getOwn(candidate, key)?.value;
      if (typeof inherit === 'function') { apply(inherit, undefined, [window]); return; }
    } catch { /* An inaccessible parent/opener cannot provide a profile. */ }
  }
})();
