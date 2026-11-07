// ADR-053: enable from the module's explicit launcher UI; other widening actions stay Options-only.
import { verifyUiSender } from '../../../vendor/protect-722fae8/packages/background/src/sender';
import type { MessageSenderLike } from '../../../vendor/protect-722fae8/packages/background/src/chrome-api';

const LAUNCHER_PATHS: ReadonlySet<string> = new Set(['/popup.html', '/sidepanel.html', '/options.html']);

/** Browser-supplied extension identity and an exact owned launcher document are both required. */
export function isFirewallLauncherSender(sender: MessageSenderLike, runtimeId: string): boolean {
  if (!verifyUiSender(sender, runtimeId) || typeof sender.url !== 'string') return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.host === runtimeId && url.username === '' && url.password === '' &&
      LAUNCHER_PATHS.has(url.pathname);
  } catch {
    return false;
  }
}
