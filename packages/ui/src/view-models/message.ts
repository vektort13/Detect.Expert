// Localizable message descriptor. View models return keys (+ substitutions) so that they stay pure and
// testable in Node; components resolve them through the i18n helper (chrome.i18n) at render time.

export interface Message {
  /** Key in _locales/<locale>/messages.json. */
  key: string;
  subs?: ReadonlyArray<MessagePart>;
}

export interface MessageJoin {
  join: ReadonlyArray<Message | string>;
  separator?: string;
}

export type MessagePart = string | number | Message | MessageJoin;

export type Translate = (key: string, subs?: ReadonlyArray<string>) => string;

export function msg(key: string, ...subs: MessagePart[]): Message {
  return subs.length === 0 ? { key } : { key, subs };
}

export function joinMessages(items: ReadonlyArray<Message | string>, separator = ', '): MessageJoin {
  return { join: items, separator };
}

function resolvePart(t: Translate, part: MessagePart): string {
  if (typeof part === 'string') return part;
  if (typeof part === 'number') return String(part);
  if ('join' in part) {
    return part.join.map((item) => (typeof item === 'string' ? item : resolveMessage(t, item))).join(part.separator ?? ', ');
  }
  return resolveMessage(t, part);
}

export function resolveMessage(t: Translate, message: Message): string {
  const subs = message.subs === undefined ? undefined : message.subs.map((part) => resolvePart(t, part));
  return t(message.key, subs);
}
