// ADR-020 §C (S08): the firewall lane of the module «Защита» — decisions in IndexedDB, DNR rule compilation through
// the dnr-port, prompts, outcomes (`stopped` only by §11) and the strict preset. See service.ts.

export { FirewallService, createFirewallService } from './service';
export type { FirewallServiceOptions } from './service';
export { FIREWALL_STATS_KEY, FirewallDecisionStore, localDayOf, readDecision } from './store';
export { FIREWALL_LANE, FirewallOnceRules, MAX_DISMISSED_SITES } from './once';
export type { OnceChange } from './once';
export { FIREWALL_PERSIST_MS, FirewallPromptBook, newFirewallId } from './prompts';
export type { TabFirewallState } from './prompts';
