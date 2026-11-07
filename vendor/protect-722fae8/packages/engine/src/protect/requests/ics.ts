// ADR-020 §I (S14): calendar file (RFC 5545) for the approximate response deadline of a data request: one all-day
// VEVENT on the due day with a VALARM three days before (TRIGGER:-P3D). The caller passes the summary and description
// texts (UI language); the file names no site, receiver, observation, identifier or letter text. Lines end with CRLF
// and are folded at 75 octets of UTF-8; TEXT values are escaped (backslash, semicolon, comma, line break).

import { REQUEST_ID_PATTERN, isLocalDay } from '@detect-expert/contracts';
import type { LocalDay } from '@detect-expert/contracts';
import { addRequestDays } from './days';

export const REQUEST_ICS_MIME = 'text/calendar';

export interface RequestIcsInput {
  /** Journal id of the request (REQUEST_ID_PATTERN): the stable UID of the event. */
  requestId: string;
  /** Due day (all-day event). */
  day: LocalDay;
  /** Creation time of the file, epoch ms (DTSTAMP, UTC). */
  stampMs: number;
  summary: string;
  description: string;
  alarm: string;
}

/** RFC 5545 §3.3.11 TEXT escaping; control characters are dropped. */
export function escapeIcsText(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n|\r|\n/g, '\n')) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === ';') out += '\\;';
    else if (ch === ',') out += '\\,';
    else if (ch === '\n') out += '\\n';
    else if (c < 0x20 || c === 0x7f) continue;
    else out += ch;
  }
  return out;
}

const encoder = new TextEncoder();

/** RFC 5545 §3.1: content lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 sequence. */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function compactDay(day: LocalDay): string {
  return day.replace(/-/g, '');
}

function utcStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return p(d.getUTCFullYear(), 4) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

/** The .ics text; throws on an invalid id, day or stamp. */
export function buildRequestIcs(input: Readonly<RequestIcsInput>): string {
  if (!REQUEST_ID_PATTERN.test(input.requestId) || !isLocalDay(input.day) || !Number.isFinite(input.stampMs)) throw new Error('request-ics: invalid input');
  const next = addRequestDays(input.day, 1);
  if (next === null) throw new Error('request-ics: day out of range');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//detect.expert//data requests//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + input.requestId + '@requests.detect-expert.invalid',
    'DTSTAMP:' + utcStamp(input.stampMs),
    'DTSTART;VALUE=DATE:' + compactDay(input.day),
    'DTEND;VALUE=DATE:' + compactDay(next),
    'SUMMARY:' + escapeIcsText(input.summary),
    'DESCRIPTION:' + escapeIcsText(input.description),
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P3D',
    'DESCRIPTION:' + escapeIcsText(input.alarm),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** File name of the calendar file. */
export function requestIcsFileName(requestId: string): string {
  return 'detect-expert-request-' + requestId + '.ics';
}
