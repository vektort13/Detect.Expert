// ADR-020 §I (S14), REQ-008: the privacy-contacts table — where a company accepts data requests (a reviewed e-mail
// address or request form). Source data: rules/privacy-contacts/contacts.json under rules/privacy-contacts/policy.json;
// lint and generation run in scripts/protect-tables/privacy-contacts.mjs (this file is the single logic source). The
// production table stays empty until reviewed entries are admitted by the policy; the test profile gets synthetic
// entries on reserved `.test` hosts. A guessed address (e.g. privacy@<domain>) is never admitted: every entry needs an
// https source page on the company's own domain, the day it was read, and reviewers. Generated rows carry no source
// URL or reviewer names (the source stays in the data file, by contactId and contactsVersion).
// A request form is https by contract (isPortalUrl: no port, query or fragment), so a generated row stores it as
// `portalHost` + `portalPath` and the link is assembled when the row is read: shipped code then holds no URL literal,
// and the scanners for remote resources (lint `remote-url`, privacy-scan `dist-remote-url`) stay strict. A form link
// is opened by the user's click only; the extension never requests it.

import {
  CONTACT_ID_PATTERN,
  PROTECT_WIRE_LIMITS,
  RECIPIENT_CHANNELS,
  REQUEST_JURISDICTIONS,
  WIRE_CATALOG_VERSION_PATTERN,
  isDomainName,
  isEntityName,
  isLocalDay,
  isPortalUrl,
  isRequestEmail,
} from '@detect-expert/contracts';
import type { LocalDay, RecipientCandidate, RecipientChannel, RequestJurisdiction } from '@detect-expert/contracts';
import { requestDaysBetween } from './days';

export const MAX_CONTACT_DOMAINS = 8;
export const MAX_PRIVACY_CONTACTS = 512;

/** Row of a generated privacy-contacts table (PRIVACY_CONTACTS_ENTRIES): `address` for e-mail, host + path for a form. */
export interface GeneratedPrivacyContactRow {
  contactId: string;
  contactsVersion: string;
  entityName: string;
  domains: string[];
  channel: RecipientChannel;
  address?: string;
  portalHost?: string;
  portalPath?: string;
  jurisdictions: RequestJurisdiction[];
  accessedAt: LocalDay;
  reviewedAt: LocalDay;
}

/** A contact as the SW uses it (the form link assembled). */
export interface PrivacyContactRow {
  contactId: string;
  contactsVersion: string;
  entityName: string;
  /** Registrable domains of the company the contact answers for (lookup keys). */
  domains: string[];
  channel: RecipientChannel;
  address: string;
  jurisdictions: RequestJurisdiction[];
  accessedAt: LocalDay;
  reviewedAt: LocalDay;
}

export interface PrivacyContactsPolicy {
  allowPrivacyContacts: boolean;
  minReviewers: number;
  maxReviewIntervalDays: number;
}

const JURISDICTION_SET: ReadonlySet<string> = new Set(REQUEST_JURISDICTIONS);
const CHANNEL_SET: ReadonlySet<string> = new Set(RECIPIENT_CHANNELS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `host` equals `domain` or is one of its subdomains. */
export function hostWithinDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

/** Host of the contact address (e-mail domain or form host), or null. */
export function contactAddressHost(channel: RecipientChannel, address: string): string | null {
  if (channel === 'email') return isRequestEmail(address) ? address.slice(address.indexOf('@') + 1) : null;
  if (!isPortalUrl(address)) return null;
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}

function readDomains(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_CONTACT_DOMAINS) return null;
  const out: string[] = [];
  for (const d of v) {
    if (!isDomainName(d) || d !== d.toLowerCase() || out.includes(d)) return null;
    out.push(d);
  }
  return out;
}

function readJurisdictions(v: unknown): RequestJurisdiction[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > REQUEST_JURISDICTIONS.length) return null;
  const set = new Set<string>();
  for (const j of v) {
    if (typeof j !== 'string' || !JURISDICTION_SET.has(j) || set.has(j)) return null;
    set.add(j);
  }
  return REQUEST_JURISDICTIONS.filter((j) => set.has(j));
}

const PORTAL_PATH_RE = /^\/[A-Za-z0-9._~:/!$'()*+,;=@-]{0,400}$/;
const HTTPS_PREFIX = 'https://';

/** The https link of a form from its host and path, or null. */
export function portalAddress(host: unknown, path: unknown): string | null {
  if (!isDomainName(host) || typeof path !== 'string' || !PORTAL_PATH_RE.test(path)) return null;
  const address = HTTPS_PREFIX + host + path;
  return isPortalUrl(address) ? address : null;
}

/** Host and path of a form link (the inverse of portalAddress), or null. */
export function portalParts(address: string): { portalHost: string; portalPath: string } | null {
  if (!isPortalUrl(address)) return null;
  try {
    const url = new URL(address);
    return portalAddress(url.hostname, url.pathname) === address ? { portalHost: url.hostname, portalPath: url.pathname } : null;
  } catch {
    return null;
  }
}

/** One generated row, or null when any field is invalid (the address must lie on one of the domains). */
export function parsePrivacyContactRow(raw: unknown): PrivacyContactRow | null {
  if (!isRecord(raw)) return null;
  const contactId = raw['contactId'];
  const contactsVersion = raw['contactsVersion'];
  const entityName = raw['entityName'];
  const channel = raw['channel'];
  const address = channel === 'portal' ? portalAddress(raw['portalHost'], raw['portalPath']) : raw['address'];
  if (channel === 'portal' ? raw['address'] !== undefined : raw['portalHost'] !== undefined || raw['portalPath'] !== undefined) return null;
  const accessedAt = raw['accessedAt'];
  const reviewedAt = raw['reviewedAt'];
  if (typeof contactId !== 'string' || !CONTACT_ID_PATTERN.test(contactId)) return null;
  if (typeof contactsVersion !== 'string' || !WIRE_CATALOG_VERSION_PATTERN.test(contactsVersion)) return null;
  if (!isEntityName(entityName)) return null;
  if (typeof channel !== 'string' || !CHANNEL_SET.has(channel) || typeof address !== 'string') return null;
  if (!isLocalDay(accessedAt) || !isLocalDay(reviewedAt) || accessedAt > reviewedAt) return null;
  const domains = readDomains(raw['domains']);
  const jurisdictions = readJurisdictions(raw['jurisdictions']);
  if (domains === null || jurisdictions === null) return null;
  const host = contactAddressHost(channel as RecipientChannel, address);
  if (host === null || !domains.some((d) => hostWithinDomain(host, d))) return null;
  return { contactId, contactsVersion, entityName, domains, channel: channel as RecipientChannel, address, jurisdictions, accessedAt, reviewedAt };
}

/** Valid rows of a generated table (invalid ones are dropped), at most MAX_PRIVACY_CONTACTS. */
export function parsePrivacyContactRows(rows: readonly unknown[]): PrivacyContactRow[] {
  const out: PrivacyContactRow[] = [];
  const ids = new Set<string>();
  for (const raw of rows) {
    if (out.length >= MAX_PRIVACY_CONTACTS) break;
    const row = parsePrivacyContactRow(raw);
    if (row === null || ids.has(row.contactId)) continue;
    ids.add(row.contactId);
    out.push(row);
  }
  return out;
}

/** Contacts of the company of `domain` (exact registrable domain), at most maxRecipientCandidates. */
export function recipientCandidatesFor(rows: readonly PrivacyContactRow[], domain: string | null): RecipientCandidate[] {
  if (domain === null) return [];
  const out: RecipientCandidate[] = [];
  for (const r of rows) {
    if (!r.domains.includes(domain)) continue;
    out.push({
      contactId: r.contactId,
      contactsVersion: r.contactsVersion,
      entityName: r.entityName,
      channel: r.channel,
      address: r.address,
      jurisdictions: [...r.jurisdictions],
      accessedAt: r.accessedAt,
      reviewedAt: r.reviewedAt,
    });
    if (out.length >= PROTECT_WIRE_LIMITS.maxRecipientCandidates) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lint of the source data (rules/privacy-contacts/contacts.json, fixtures/protect/privacy-contacts.synthetic.json)
// ---------------------------------------------------------------------------

export interface PrivacyContactsLintOptions {
  today: LocalDay;
  policy: PrivacyContactsPolicy;
  /** Synthetic data: only reserved `.test` hosts, no staleness check, never production. */
  synthetic: boolean;
}

export interface PrivacyContactsLintResult {
  errors: string[];
  warnings: string[];
  /** Rows admitted to the table of this kind (production: policy-allowed, enabled and fresh; synthetic: all valid). */
  rows: GeneratedPrivacyContactRow[];
}

/** Generated row of a validated contact (a form as host + path). */
export function generatedContactRow(row: Readonly<PrivacyContactRow>): GeneratedPrivacyContactRow {
  const base = { contactId: row.contactId, contactsVersion: row.contactsVersion, entityName: row.entityName, domains: [...row.domains], channel: row.channel };
  const tail = { jurisdictions: [...row.jurisdictions], accessedAt: row.accessedAt, reviewedAt: row.reviewedAt };
  if (row.channel === 'portal') {
    const parts = portalParts(row.address)!;
    return { ...base, portalHost: parts.portalHost, portalPath: parts.portalPath, ...tail };
  }
  return { ...base, address: row.address, ...tail };
}

const SOURCE_KEYS = ['contactId', 'entityName', 'domains', 'channel', 'address', 'jurisdictions', 'source', 'accessedAt', 'reviewedAt', 'reviewers', 'productionEnabled', 'notes'];
const SYNTHETIC_HOST_RE = /\.test$/;
const REVIEWER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;

function checkSource(source: unknown, domains: readonly string[]): string | null {
  if (typeof source !== 'string' || source.length > 512) return 'source must be an https URL of at most 512 characters';
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return 'source is not a URL';
  }
  if (url.protocol !== 'https:') return 'source must use https';
  if (url.username !== '' || url.password !== '' || url.port !== '') return 'source must not carry userinfo or a port';
  if (!domains.some((d) => hostWithinDomain(url.hostname, d))) return 'source must be a page on one of the domains (' + url.hostname + ')';
  return null;
}

/** Lints the source data of the table; never throws. */
export function lintPrivacyContacts(data: unknown, options: PrivacyContactsLintOptions): PrivacyContactsLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: GeneratedPrivacyContactRow[] = [];
  const { policy, today, synthetic } = options;
  if (!isRecord(data)) return { errors: ['data must be an object'], warnings, rows };
  if (data['schemaVersion'] !== 1) errors.push('schemaVersion must be 1');
  const contactsVersion = data['contactsVersion'];
  if (typeof contactsVersion !== 'string' || !WIRE_CATALOG_VERSION_PATTERN.test(contactsVersion)) errors.push('contactsVersion must match ' + String(WIRE_CATALOG_VERSION_PATTERN));
  const contacts = data['contacts'];
  if (!Array.isArray(contacts)) return { errors: [...errors, 'contacts must be an array'], warnings, rows };
  if (contacts.length > MAX_PRIVACY_CONTACTS) errors.push('at most ' + String(MAX_PRIVACY_CONTACTS) + ' contacts');
  const ids = new Set<string>();
  const addresses = new Set<string>();
  contacts.forEach((raw, i) => {
    const at = 'contacts[' + String(i) + ']';
    if (!isRecord(raw)) {
      errors.push(at + ': not an object');
      return;
    }
    for (const key of Object.keys(raw)) if (!SOURCE_KEYS.includes(key)) errors.push(at + ': unknown field ' + key);
    const id = typeof raw['contactId'] === 'string' ? raw['contactId'] : '';
    const where = at + ' (' + id + ')';
    if (ids.has(id)) errors.push(where + ': duplicate contactId');
    ids.add(id);
    const domains = readDomains(raw['domains']);
    if (domains === null) {
      errors.push(where + ': domains must be 1..' + String(MAX_CONTACT_DOMAINS) + ' unique lowercase DNS names');
      return;
    }
    const sourceError = checkSource(raw['source'], domains);
    if (sourceError !== null) errors.push(where + ': ' + sourceError);
    const reviewers = raw['reviewers'];
    if (!Array.isArray(reviewers) || reviewers.length < policy.minReviewers || !reviewers.every((r) => typeof r === 'string' && REVIEWER_RE.test(r)) || new Set(reviewers).size !== reviewers.length) {
      errors.push(where + ': needs at least ' + String(policy.minReviewers) + ' distinct reviewer(s)');
    }
    if (typeof raw['productionEnabled'] !== 'boolean') errors.push(where + ': productionEnabled must be a boolean');
    // Source data names a form by its full link; the row is checked in its generated form (host + path).
    const parts = raw['channel'] === 'portal' && typeof raw['address'] === 'string' ? portalParts(raw['address']) : null;
    const generated: Record<string, unknown> = { ...raw, contactsVersion: typeof contactsVersion === 'string' ? contactsVersion : 'invalid version' };
    if (raw['channel'] === 'portal') {
      delete generated['address'];
      if (parts !== null) Object.assign(generated, parts);
    }
    const row = parsePrivacyContactRow(generated);
    if (row === null) {
      errors.push(where + ': invalid contactId, entityName, channel/address (the address must lie on one of the domains), jurisdictions or days (accessedAt ≤ reviewedAt)');
      return;
    }
    const key = row.channel + ':' + row.address;
    if (addresses.has(key)) errors.push(where + ': duplicate address');
    addresses.add(key);
    if (row.reviewedAt > today) errors.push(where + ': reviewedAt is in the future');
    if (synthetic) {
      for (const d of row.domains) if (!SYNTHETIC_HOST_RE.test(d)) errors.push(where + ': synthetic contacts use reserved .test domains only');
      if (raw['productionEnabled'] === true) errors.push(where + ': a synthetic contact is never production');
      rows.push(generatedContactRow(row));
      return;
    }
    const age = requestDaysBetween(row.reviewedAt, today);
    const stale = age > policy.maxReviewIntervalDays;
    if (raw['productionEnabled'] === true) {
      if (!policy.allowPrivacyContacts) errors.push(where + ': productionEnabled while the policy does not allow privacy contacts');
      else if (stale) errors.push(where + ': review older than ' + String(policy.maxReviewIntervalDays) + ' days');
      else rows.push(generatedContactRow(row));
    } else if (stale) warnings.push(where + ': review older than ' + String(policy.maxReviewIntervalDays) + ' days');
  });
  return { errors, warnings, rows: errors.length > 0 ? [] : rows };
}

/** Days since the review of a row (UI: «проверено N дней назад»). */
export function privacyContactAgeDays(row: Readonly<Pick<PrivacyContactRow, 'reviewedAt'>>, today: LocalDay): number {
  return requestDaysBetween(row.reviewedAt, today);
}
