// ADR-020 §I (S14): renders a data-request letter (subject + body, CRLF line breaks) from a template, the chosen kinds,
// the company name, the ticked facts and the identity choice. The user's identifier and name are taken ONLY from the
// arguments `identifier` / `name` of renderRequestLetter (typed by the user on requests.html, never stored); nothing
// typed on a website is ever put into a letter. While the template is not reviewed by a lawyer, the first line is the
// DRAFT marker. Requests by article, no legal conclusions.

import { JURISDICTION_LETTER_LANGS, JURISDICTION_REQUEST_KINDS, REQUEST_KINDS } from '@detect-expert/contracts';
import type { LocalDay, RequestEvidenceFact, RequestJurisdiction, RequestKind, RequestLetterLang, ScriptRef } from '@detect-expert/contracts';
import { REQUEST_DRAFT_MARKER, REQUEST_FACT_WORDS, REQUEST_KIND_ARTICLES, REQUEST_TEMPLATES, REQUEST_TEMPLATE_TEXTS } from './templates';
import type { RequestFactWords, RequestTemplateText } from './templates';

export const CRLF = '\r\n';
/** Caps of the typed identity values (the contract's e-mail and entity-name caps). */
export const MAX_TYPED_IDENTIFIER_CHARS = 254;
export const MAX_TYPED_NAME_CHARS = 128;

export type RequestIdentityChoice = 'sender-address' | 'typed-identifier';

export interface RenderRequestLetterInput {
  jurisdiction: RequestJurisdiction;
  letterLang: RequestLetterLang;
  kinds: readonly RequestKind[];
  /** Company name the user confirmed or typed (isEntityName). */
  entityName: string;
  /** Ticked facts, in the order to print. */
  facts: readonly RequestEvidenceFact[];
  identity: RequestIdentityChoice;
  /** CCPA: mention the Global Privacy Control signal (ignored by the other laws). */
  mentionGpc: boolean;
  /** Today (152-FZ date line). */
  today: LocalDay;
}

export interface RenderedRequestLetter {
  subject: string;
  body: string;
  templateId: string;
  templateVersion: string;
  /** The template is not reviewed: the first body line is the DRAFT marker. */
  draft: boolean;
}

/**
 * One line of typed text: whitespace runs (line breaks included) collapsed to one space; control, bidi-override and BOM
 * characters dropped; trimmed and capped. Empty → null.
 */
export function cleanTypedValue(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const input = value.length > max * 4 ? value.slice(0, max * 4) : value;
  let out = '';
  let space = false;
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (/\s/u.test(ch)) {
      space = out.length > 0;
      continue;
    }
    // Other control, bidi-override and BOM characters are dropped without a trace.
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) continue;
    if (space) out += ' ';
    space = false;
    out += ch;
  }
  if (out.length > max) {
    out = out.slice(0, max);
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  out = out.trim();
  return out.length > 0 ? out : null;
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Day as written in a letter: ISO for English, DD.MM.YYYY for Russian. */
export function letterDay(day: LocalDay, lang: RequestLetterLang): string {
  return lang === 'ru' ? day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4) : day;
}

function scriptText(script: ScriptRef | null, w: RequestFactWords): string {
  if (script === null) return '';
  if (script.kind === 'external' && script.scheme !== undefined && script.host !== undefined && script.pathTemplate !== undefined) {
    return fill(w.scriptExternal, { address: script.scheme + '://' + script.host + script.pathTemplate });
  }
  return script.kind === 'document' ? w.scriptDocument : '';
}

/** One fact as a sentence of the letter (no value, hash or URL query: enums, domains, a template and a name). */
export function requestFactSentence(f: Readonly<RequestEvidenceFact>, lang: RequestLetterLang): string {
  const w = REQUEST_FACT_WORDS[lang];
  const details: string[] = [];
  if (f.encoding !== null) details.push(w.encoding[f.encoding]);
  if (f.location !== null && w.location[f.location] !== undefined) details.push(w.location[f.location]!);
  if (f.parameterName !== null) details.push(fill(w.parameter, { name: f.parameterName }));
  if (f.endpoint !== null) details.push(fill(w.endpoint, { address: f.endpoint.scheme + '://' + f.endpoint.host + f.endpoint.pathTemplate }));
  if (f.submitTiming !== null && w.timing[f.submitTiming] !== undefined) details.push(w.timing[f.submitTiming]!);
  const values = {
    day: letterDay(f.day, lang),
    site: f.site,
    receiver: f.receiverDomain ?? w.noReceiver,
    data: f.dataKind === null ? '' : w.dataKind[f.dataKind],
    details: details.length > 0 ? ' (' + details.join(', ') + ')' : '',
    script: scriptText(f.script, w),
  };
  let sentence: string;
  switch (f.factKind) {
    case 'value-match':
      sentence = fill(w.valueMatch, values);
      break;
    case 'opaque-after-input':
      sentence = fill(w.opaque, values);
      break;
    case 'password-field-listener':
      sentence = fill(w.passwordListener, values);
      break;
    case 'session-replay':
      sentence = fill(w.replay, values);
      break;
    case 'cross-site-sighting':
      sentence = fill(w.sighting, values);
      break;
  }
  return sentence + ' ' + fill(w.confidenceSentence, { confidence: w.confidence[f.interpretationConfidence] });
}

/** Kinds valid for the law, in REQUEST_KINDS order, without duplicates. */
export function canonicalRequestKinds(jurisdiction: RequestJurisdiction, kinds: readonly RequestKind[]): RequestKind[] {
  const allowed = JURISDICTION_REQUEST_KINDS[jurisdiction];
  return REQUEST_KINDS.filter((k) => kinds.includes(k) && allowed.includes(k));
}

/** The template text of a law in a language, or null when the template has no such language. */
export function requestTemplateText(jurisdiction: RequestJurisdiction, lang: RequestLetterLang): RequestTemplateText | null {
  if (!JURISDICTION_LETTER_LANGS[jurisdiction].includes(lang)) return null;
  return REQUEST_TEMPLATE_TEXTS[jurisdiction][lang] ?? null;
}

/**
 * Letter of a request. `identifier` is used only with identity 'typed-identifier'; `name` only when not null. Both are
 * cleaned to one line (cleanTypedValue). Throws when the law has no template in that language or no kind is valid.
 */
export function renderRequestLetter(input: Readonly<RenderRequestLetterInput>, identifier: string | null, name: string | null): RenderedRequestLetter {
  const text = requestTemplateText(input.jurisdiction, input.letterLang);
  const kinds = canonicalRequestKinds(input.jurisdiction, input.kinds);
  if (text === null || kinds.length === 0) throw new Error('request-letter: no template for this law, language and kinds');
  const template = REQUEST_TEMPLATES[input.jurisdiction];
  const typedName = cleanTypedValue(name, MAX_TYPED_NAME_CHARS);
  const typedIdentifier = input.identity === 'typed-identifier' ? cleanTypedValue(identifier, MAX_TYPED_IDENTIFIER_CHARS) : null;
  const entity = cleanTypedValue(input.entityName, 128) ?? '';
  const draft = template.legalReviewStatus !== 'reviewed';
  const articles = kinds.map((k) => REQUEST_KIND_ARTICLES[input.jurisdiction][k]).filter((a): a is string => a !== undefined);

  const paragraphs: string[][] = [];
  if (draft) paragraphs.push([REQUEST_DRAFT_MARKER[input.letterLang]]);
  const header = [fill(text.addressee, { entity })];
  const formal = typedName !== null ? text.formalHeaderNamed : text.formalHeader;
  if (formal !== null) for (const line of formal) header.push(fill(line, { name: typedName ?? '' }));
  paragraphs.push(header);
  if (text.greeting !== null) paragraphs.push([text.greeting]);
  paragraphs.push([text.intro]);
  for (const kind of kinds) {
    const p = text.kinds[kind];
    if (p !== undefined) paragraphs.push([p]);
  }
  if (input.mentionGpc && text.gpc !== null) paragraphs.push([text.gpc]);
  const identity: string[] = [];
  if (typedIdentifier !== null) identity.push(fill(text.identityTyped, { identifier: typedIdentifier }));
  else identity.push(text.identitySender);
  if (typedName !== null && text.identityName !== null) identity.push(fill(text.identityName, { name: typedName }));
  paragraphs.push(identity);
  if (input.facts.length > 0) {
    paragraphs.push([text.factsIntro, ...input.facts.map((f) => '- ' + requestFactSentence(f, input.letterLang))]);
    paragraphs.push([text.factsOutro]);
  }
  const deadline: string[] = [];
  const optOutOnly = kinds.every((k) => k === 'opt-out-sale-sharing');
  if (text.deadline !== null && !optOutOnly) deadline.push(text.deadline);
  if (text.deadlineOptOut !== null && kinds.includes('opt-out-sale-sharing')) deadline.push(text.deadlineOptOut);
  if (deadline.length > 0) paragraphs.push(deadline);
  const closing = [text.closing];
  if (typedName !== null && text.closingName !== null) closing.push(fill(text.closingName, { name: typedName }));
  paragraphs.push(closing);
  if (text.signature !== null) paragraphs.push(text.signature.map((line) => fill(line, { date: letterDay(input.today, input.letterLang) })));

  return {
    subject: fill(text.subject, { articles: articles.join(', ') }),
    body: paragraphs.map((lines) => lines.join(CRLF)).join(CRLF + CRLF) + CRLF,
    templateId: template.templateId,
    templateVersion: template.version,
    draft,
  };
}
