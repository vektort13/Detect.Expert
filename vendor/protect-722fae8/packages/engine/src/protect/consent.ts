// ADR-020 §6: the consent screen of the module «Защита». S04 created the key list; S06 wrote the texts in
// apps/extension/_locales/{ru,en} and the SHA-256 of the RU+EN texts of these keys, in this order. The locale test
// (apps/extension/test/locales.test.ts) fails when a text changes without a new digest: changing the consent text needs
// a decision about PROTECT_CONSENT_VERSION (a new version moves enabled modules to `needs-consent`).

export const PROTECT_CONSENT_KEYS = [
  'protect_consent_title',
  'protect_consent_intro',
  'protect_consent_reads_title',
  'protect_consent_reads',
  'protect_consent_never_title',
  'protect_consent_never',
  'protect_consent_bodies',
  'protect_consent_changes_title',
  'protect_consent_blocking',
  'protect_consent_gpc',
  'protect_consent_detectable',
  'protect_consent_stored_title',
  'protect_consent_stored',
  'protect_consent_permissions_title',
  'protect_consent_permissions',
  'protect_consent_limits',
  'protect_consent_no_server',
  'protect_consent_ack',
] as const;
export type ProtectConsentKey = (typeof PROTECT_CONSENT_KEYS)[number];

/**
 * The text the digest is computed over: for each key of PROTECT_CONSENT_KEYS, in order, the RU text, '\n', the EN text;
 * the per-key parts are joined with '\n'. Pure: the caller passes the two locale lookups.
 */
export function protectConsentDigestInput(ru: (key: ProtectConsentKey) => string, en: (key: ProtectConsentKey) => string): string {
  return PROTECT_CONSENT_KEYS.map((key) => ru(key) + '\n' + en(key)).join('\n');
}

/** `version` equals PROTECT_CONSENT_VERSION; `sha256` is the lowercase hex SHA-256 (UTF-8) of protectConsentDigestInput. */
export const PROTECT_CONSENT_DIGEST: { readonly version: 1; readonly sha256: string } = {
  version: 1,
  sha256: '08ca812843b9c1d3d87f957d3ae65ce8748c5ae0732967cf1a330172c43feb6c',
};
