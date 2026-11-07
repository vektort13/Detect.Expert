// ADR-020 §I (S14): opens requests.html (optionally with `#new=…` for the composer) in a new tab. No `tabs`
// permission is needed for chrome.tabs.create of an extension page; nothing else is passed (the hash names a source
// kind and an id the SW resolves, never a value).

import { requestPageHash } from '@detect-expert/engine';
import type { RequestPageSource } from '@detect-expert/engine';

export async function openRequestsPage(source: RequestPageSource | null = null): Promise<boolean> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('requests.html' + (source === null ? '' : requestPageHash(source))) });
    return true;
  } catch {
    return false;
  }
}
