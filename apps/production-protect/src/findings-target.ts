// ADR-052: a findings window stays bound to one tab's top-level document.
export interface FindingsTarget {
  tabId: number;
  documentKey: string;
}

/** Reject missing, duplicate, extra or cross-tab parameters; never fall back to the active tab. */
export function readFindingsTarget(search: string): FindingsTarget | null {
  if (typeof search !== 'string' || search.length > 512 || !search.startsWith('?')) return null;
  const params = new URLSearchParams(search);
  if ([...params.keys()].length !== 2 || params.getAll('tab').length !== 1 || params.getAll('document').length !== 1) return null;
  const tab = params.get('tab');
  const documentKey = params.get('document');
  if (tab === null || !/^(0|[1-9][0-9]{0,9})$/.test(tab) || documentKey === null || documentKey.length > 128) return null;
  const tabId = Number(tab);
  if (!Number.isSafeInteger(tabId) || tabId > 2 ** 31 - 1) return null;
  if (!documentKey.startsWith(tab + ':0:') || !/^[A-Za-z0-9_-]{1,64}$/.test(documentKey.slice(tab.length + 3))) return null;
  return { tabId, documentKey };
}
