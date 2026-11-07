// ADR-047 (S1): chrome.i18n message format for the module's own ru/en catalog (the production UI keeps its tables
// for 21 languages; the module ships ru and en only, port plan §3). Same rules as chrome.i18n.getMessage and the
// production formatMessage: `$$` -> `$`, `$name$` -> the placeholder content with `$1`…`$9` substituted, `$1`…`$9`.

export interface CatalogEntry {
  message: string;
  placeholders?: Readonly<Record<string, { content: string }>>;
}

export type Catalog = Readonly<Record<string, CatalogEntry>>;

export function formatEntry(entry: CatalogEntry, subs: ReadonlyArray<string> = []): string {
  return entry.message.replace(/\$\$|\$([a-z_][a-z0-9_]*)\$|\$([1-9])/gi, (token: string, name: string | undefined, direct: string | undefined) => {
    if (token === '$$') return '$';
    const content = name !== undefined ? entry.placeholders?.[name.toLowerCase()]?.content : '$' + String(direct);
    if (content === undefined) return token;
    return content.replace(/\$([1-9])/g, (_match: string, index: string) => subs[Number(index) - 1] ?? '');
  });
}

/** Fallback outside a catalog entry: the key plus its substitutions (as the vendored i18n helper). */
export function fallbackMessage(key: string, subs?: ReadonlyArray<string>): string {
  return subs !== undefined && subs.length > 0 ? key + '[' + subs.join(', ') + ']' : key;
}
