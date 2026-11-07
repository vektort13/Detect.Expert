// Per-family hook configuration fixed by the getter perf-gate (E06-03 part B, S03; ADR-011, ADR-017 §5).
// Decision rule (E06-03, written before the measurements): go -> 'wrap' (permanent hook, limit null),
// go-limited -> 'retire' (hook retires after `retireAfter` observed calls), no-go -> 'off' (member not wrapped; its
// operation codes stay reserved). Evidence: docs/coverage/perf/getters-spike.md. All decisions are PROVISIONAL: only
// the strong hardware class was measured; a release waits for medium/weak. Changing a value = new perf evidence.
// S05/S06 add the keys of their own families here. S06 (E08-02, E07-02): navigator, screen, offset and rect groups,
// all "go" on strong (navigator and screen by the micro criterion only, no realistic scenario).

/** Hook mode of a hot member. */
export type HotMode = 'wrap' | 'retire' | 'off';

export interface FamilyConfig {
  /** Observed calls before a 'retire' member restores its original descriptor (V2 of the S03 spike). */
  readonly retireAfter: number;
  /**
   * WebGLRenderingContext / WebGL2RenderingContext `getParameter` (DET-011 `param-*`). S03 group webgl: no-go
   * (n = 45, V1 1.0981 [1.0732; 1.1104], V2 1.1053 [1.0752; 1.1460] > 1.05) -> 'off'.
   */
  readonly webglGetParameter: HotMode;
  /**
   * Navigator.prototype getters (userAgent, platform, vendor, language, languages, hardwareConcurrency, deviceMemory,
   * userAgentData) and the NavigatorUAData members (DET-025/026/032/033). S03 group navigator: go by micro only
   * (V1 0.92 ns/call [-1.39; 4.22], V2 1.51 ns/call; no realistic scenario) -> 'wrap'.
   */
  readonly navigatorGetters: HotMode;
  /**
   * Screen.prototype getters width, height, availWidth, availHeight, colorDepth, pixelDepth, orientation (DET-029).
   * S03 group screen: go by micro only (V1 10.05 ns/call [6.65; 10.50]; no realistic scenario) -> 'wrap'.
   */
  readonly screenGetters: HotMode;
  /**
   * HTMLElement.prototype offsetWidth / offsetHeight (DET-005). S03 group offset: go (layout-table V1 0.9917
   * [0.9795; 0.9991], micro 2.98 ns/call) -> 'wrap'.
   */
  readonly offsetGetters: HotMode;
  /**
   * Element.prototype getBoundingClientRect / getClientRects (DET-005). S03 group rect: go (layout-table V1 1.0045
   * [0.9879; 1.0141], micro -1.45 ns/call, noise) -> 'wrap'.
   */
  readonly rectMethods: HotMode;
}

export const FAMILY_CONFIG: FamilyConfig = Object.freeze<FamilyConfig>({
  retireAfter: 4096,
  webglGetParameter: 'off',
  navigatorGetters: 'wrap',
  screenGetters: 'wrap',
  offsetGetters: 'wrap',
  rectMethods: 'wrap',
});

/** Hook limit of a member in `mode`: null = permanent ('wrap'), retireAfter for 'retire'. Not called for 'off'. */
export function hotLimit(mode: HotMode, config: FamilyConfig): number | null {
  return mode === 'retire' ? config.retireAfter : null;
}
