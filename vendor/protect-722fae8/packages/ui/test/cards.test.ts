import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_COUNT, TECHNIQUE_IDS } from '@detect-expert/contracts';
import { buildCards, buildVendorCards, countLabel, familyNoteKey, filterCards, filterVendorCards, operationItems, permissionCategoryMessage, selectTopCards } from '../src/view-models/cards';
import { categoriesWithFindings, countsView, hostsOf } from '../src/view-models/counts';
import { TECHNIQUE_INFO } from '../src/view-models/techniques';
import { fallbackMessage } from '../src/i18n';
import { resolveMessage } from '../src/view-models/message';
import { COMMON_SURFACE_TECHNIQUE_IDS } from '../../engine/src/techniques';
import { finding, report, technique, testCatalog, vendor } from './fixtures';
import { PRODUCTION_CATALOG } from '@detect-expert/catalog';
import { catalogAvailable } from '../src/view-models/capabilities';

const r = (m: Parameters<typeof resolveMessage>[1]) => resolveMessage(fallbackMessage, m);
const here = dirname(fileURLToPath(import.meta.url));

describe('technique table', () => {
  it('covers every DET id with a category and an API label', () => {
    for (const id of TECHNIQUE_IDS) {
      const info = TECHNIQUE_INFO[id];
      expect(info.api.length).toBeGreaterThan(0);
      expect(['graphics', 'audio', 'environment', 'permissions', 'storage', 'network']).toContain(info.category);
    }
    expect(Object.keys(TECHNIQUE_INFO)).toHaveLength(69);
  });
});

describe('buildCards: three levels per card', () => {
  it('canvas fingerprinting finding: observation / interpretation / purpose are distinct messages', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-002', count: 4, phases: ['returned-sync'], signalCodes: ['readback-after-text'] })],
      findings: [finding({ findingId: 'f1', techniqueId: 'DET-002', interpretation: 'fingerprinting-pattern' })],
    });
    const [card] = buildCards(rep);
    expect(card).toBeDefined();
    expect(card!.kind).toBe('possible-fingerprinting');
    expect(r(card!.label)).toBe('card_fp_label');
    expect(r(card!.observation)).toBe('card_api_use_canvas_readback[CanvasRenderingContext2D.getImageData, 4]');
    expect(r(card!.interpretation)).toBe('card_fp_canvas_sequence');
    expect(card!.interpretationNote?.key).toBe('card_fp_not_proven');
    expect(r(card!.confidence)).toBe('confidence_medium');
    expect(r(card!.purpose)).toBe('card_api_use_purpose');
    expect(card!.ruleId).toBe('rule-canvas-sequence');
    expect(card!.ruleVersion).toBe('1');
    expect(card!.integrity).toBe('page-controlled');
    expect(card!.evidenceSource).toBe('page-hook');
    expect(card!.limitationCodes).toEqual(['page-controlled-data']);
    expect(card!.counterEvidenceCodes).toEqual(['image-editor']);
  });

  it('a technique without a finding becomes an api-use card with the ordinary-use note', () => {
    // S06: DET-032 got its own wording; DET-027 (no sensor yet) keeps the generic one.
    const rep = report({ techniques: [technique({ techniqueId: 'DET-027', count: 1 })] });
    const [card] = buildCards(rep);
    expect(card!.kind).toBe('api-use');
    expect(r(card!.label)).toBe('card_api_use_label');
    expect(r(card!.observation)).toBe('card_api_use_generic[navigator.plugins / mimeTypes / pdfViewerEnabled, 1]');
    expect(r(card!.interpretation)).toBe('card_api_use_generic_note');
    expect(card!.interpretationNote).toBeNull();
    expect(card!.ruleId).toBeNull();
  });

  it('math, webrtc, local probe and dns use their own observation and purpose wording', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-022', count: 120, countQuality: 'sampled', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' }),
        technique({ techniqueId: 'DET-056', count: 2 }),
        technique({ techniqueId: 'DET-060', count: 9, interpretation: 'local-probe-pattern', interpretationConfidence: 'medium' }),
        technique({ techniqueId: 'DET-061', count: 30, interpretation: 'dns-test-pattern', interpretationConfidence: 'high' }),
      ],
    });
    const byId = Object.fromEntries(buildCards(rep).map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-022']!.observation)).toBe('card_api_use_math[count_value_sampled[120]]');
    expect(r(byId['DET-022']!.interpretation)).toBe('card_fp_math_sequence');
    expect(r(byId['DET-056']!.observation)).toMatch(/^card_api_use_webrtc\[RTCPeerConnection/);
    expect(r(byId['DET-056']!.purpose)).toBe('card_fp_webrtc');
    expect(r(byId['DET-060']!.interpretation)).toBe('card_fp_local_probe');
    expect(r(byId['DET-060']!.purpose)).toBe('card_purpose_local_probe');
    expect(r(byId['DET-061']!.interpretation)).toBe('card_fp_dns_pattern');
    expect(r(byId['DET-061']!.purpose)).toBe('card_purpose_dns');
  });

  it('attempt-only (threw-sync) is flagged; unknown interpretation says not enough data', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-001', count: 1, phases: ['threw-sync'], interpretation: 'unknown' }),
        technique({ techniqueId: 'DET-003', count: 2, phases: ['threw-sync', 'returned-sync'] }),
      ],
    });
    const byId = Object.fromEntries(buildCards(rep).map((c) => [c.techniqueId, c]));
    expect(byId['DET-001']!.attemptOnly).toBe(true);
    expect(byId['DET-001']!.kind).toBe('unknown');
    expect(r(byId['DET-001']!.interpretation)).toBe('card_fp_insufficient');
    expect(byId['DET-003']!.attemptOnly).toBe(false);
  });

  it('ranks fingerprinting patterns above possible above api-use, then by confidence', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-025', count: 50 }),
        technique({ techniqueId: 'DET-002', count: 2 }),
        technique({ techniqueId: 'DET-022', count: 3 }),
        technique({ techniqueId: 'DET-011', count: 1 }),
      ],
      findings: [
        finding({ findingId: 'a', techniqueId: 'DET-002', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' }),
        finding({ findingId: 'b', techniqueId: 'DET-022', interpretation: 'fingerprinting-pattern', interpretationConfidence: 'medium' }),
        finding({ findingId: 'c', techniqueId: 'DET-011', interpretation: 'possible-fingerprinting', interpretationConfidence: 'high' }),
      ],
    });
    expect(buildCards(rep).map((c) => c.id)).toEqual(['f:b', 'f:c', 'f:a', 't:DET-025']);
  });

  it('popup shows at most five cards; the rest is counted', () => {
    const rep = report({
      techniques: TECHNIQUE_IDS.slice(0, 8).map((techniqueId) => technique({ techniqueId })),
    });
    const cards = buildCards(rep);
    expect(cards).toHaveLength(8);
    expect(selectTopCards(cards)).toHaveLength(5);
    expect(selectTopCards(cards, 2)).toHaveLength(2);
    expect(selectTopCards(cards, 0)).toHaveLength(0);
  });

  it('search filters by technique id, API, rule id and vendor id, case-insensitively', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-002' }), technique({ techniqueId: 'DET-032' })],
      findings: [finding({ findingId: 'f1', techniqueId: 'DET-002', ruleId: 'Canvas-Seq', vendorMatchIds: ['threatmetrix'] })],
      vendors: [vendor({ vendorId: 'threatmetrix' })],
    });
    const cards = buildCards(rep);
    expect(filterCards(cards, '').map((c) => c.techniqueId)).toEqual(['DET-002', 'DET-032']);
    expect(filterCards(cards, 'getImageData').map((c) => c.techniqueId)).toEqual(['DET-002']);
    expect(filterCards(cards, 'canvas-seq').map((c) => c.techniqueId)).toEqual(['DET-002']);
    expect(filterCards(cards, 'hardware').map((c) => c.techniqueId)).toEqual(['DET-032']);
    expect(filterCards(cards, 'nothing-here')).toEqual([]);
    expect(filterVendorCards(buildVendorCards(rep, testCatalog(), 'ru'), 'LexisNexis')).toHaveLength(1);
    expect(filterVendorCards(buildVendorCards(rep, testCatalog(), 'ru'), 'akamai')).toHaveLength(0);
  });

  it('count labels respect countQuality and saturation', () => {
    expect(countLabel(3, 'exact')).toBe('3');
    expect(countLabel(3, 'sampled')).toEqual({ key: 'count_value_sampled', subs: [3] });
    expect(countLabel(3, 'lower-bound')).toEqual({ key: 'count_value_lower_bound', subs: [3] });
    expect(countLabel(MAX_COUNT, 'exact')).toEqual({ key: 'count_value_lower_bound', subs: [MAX_COUNT] });
  });
});

describe('operation details (ADR-017)', () => {
  it('maps codes to API names, *-other / *-unclassified to localized phrases, unique and in order', () => {
    const items = operationItems(['param-vendor', 'param-unmasked-renderer', 'param-other', 'ext-other', 'param-unclassified', 'supported-extensions']);
    expect(items.map((item) => (typeof item === 'string' ? item : r(item)))).toEqual([
      'WebGL getParameter(VENDOR)',
      'WebGL getParameter(UNMASKED_RENDERER_WEBGL)',
      'operation_other',
      'operation_unclassified',
      'WebGL getSupportedExtensions',
    ]);
    // S05: permission categories are shown as localized category names; unclassified keeps the shared phrase.
    expect(operationItems(['query', 'state-location', 'state-media', 'state-unclassified']).map((item) => (typeof item === 'string' ? item : r(item)))).toEqual([
      'Permissions.query',
      'permission_category_location',
      'permission_category_media',
      'operation_unclassified',
    ]);
    expect(operationItems([])).toEqual([]);
  });

  it('cards carry operations from the technique summary and are searchable by API name', () => {
    const rep = report({
      techniques: [
        technique({ techniqueId: 'DET-025', operationCodes: ['user-agent', 'languages'] }),
        technique({ techniqueId: 'DET-039', operationCodes: ['query', 'state-notifications'] }),
        technique({ techniqueId: 'DET-029' }),
      ],
    });
    const cards = buildCards(rep);
    const nav = cards.find((card) => card.techniqueId === 'DET-025')!;
    const screen = cards.find((card) => card.techniqueId === 'DET-029')!;
    expect(nav.operations).toEqual(['Navigator.userAgent', 'Navigator.languages']);
    expect(screen.operations).toEqual([]);
    // Only the operation API names contain these strings (the technique labels do not).
    expect(filterCards(cards, 'Navigator.languages').map((card) => card.techniqueId)).toEqual(['DET-025']);
    expect(filterCards(cards, 'PERMISSIONSTATUS.STATE').map((card) => card.techniqueId)).toEqual(['DET-039']);
    expect(filterCards(buildCards(report({ techniques: [technique({ techniqueId: 'DET-039' })] })), 'permissionstatus')).toEqual([]);
  });
});

describe('WebGL cards (E07-03, S04)', () => {
  const locale = (name: string) => JSON.parse(readFileSync(join(here, '../../../apps/extension/_locales', name, 'messages.json'), 'utf8')) as Record<string, { message: string }>;

  it('DET-011 / DET-012 belong to the webgl family with their own observation wording', () => {
    expect(TECHNIQUE_INFO['DET-011']).toEqual({
      category: 'graphics',
      family: 'webgl',
      // I1: getParameter is not wrapped in this build (FAMILY_CONFIG 'off'), so the label does not name it.
      api: 'WebGL getExtension / getSupportedExtensions / getShaderPrecisionFormat',
    });
    expect(TECHNIQUE_INFO['DET-012']).toEqual({ category: 'graphics', family: 'webgl', api: 'WebGL readPixels' });
    const cards = buildCards(report({ techniques: [technique({ techniqueId: 'DET-011', count: 9 }), technique({ techniqueId: 'DET-012', count: 12 })] }));
    const byId = Object.fromEntries(cards.map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-011']!.observation)).toBe('card_api_use_webgl_params[WebGL getExtension / getSupportedExtensions / getShaderPrecisionFormat, 9]');
    expect(r(byId['DET-012']!.observation)).toBe('card_api_use_webgl_readback[12]');
    expect(r(byId['DET-011']!.purpose)).toBe('card_api_use_purpose');
  });

  it('api-use cards keep the generic note and add the webgl family note; other families have none', () => {
    const cards = buildCards(report({ techniques: [technique({ techniqueId: 'DET-012', count: 2 }), technique({ techniqueId: 'DET-002', count: 1 }), technique({ techniqueId: 'DET-027', count: 1 })] }));
    const byId = Object.fromEntries(cards.map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-012']!.interpretation)).toBe('card_api_use_generic_note');
    expect(byId['DET-012']!.familyNote?.key).toBe('card_note_webgl');
    expect(byId['DET-002']!.familyNote).toBeNull();
    // S06: DET-025 now has the environment note; a generic-family technique still has none.
    expect(byId['DET-027']!.familyNote).toBeNull();
    expect(familyNoteKey('webgl')).toBe('card_note_webgl');
    expect(familyNoteKey('canvas')).toBeNull();
  });

  it('a possible-fingerprinting DET-011 finding uses card_fp_webgl_probe, the not-proven note and the counter-evidence', () => {
    const [card] = buildCards(report({
      techniques: [technique({ techniqueId: 'DET-011', count: 40, operationCodes: ['param-unmasked-renderer', 'param-limit', 'ext-debug-renderer-info', 'supported-extensions', 'shader-precision-format'] })],
      findings: [finding({
        findingId: 'webgl-capability-probe-v1-DET-011-possible-fingerprinting',
        techniqueId: 'DET-011',
        ruleId: 'webgl-capability-probe',
        interpretation: 'possible-fingerprinting',
        interpretationConfidence: 'low',
        counterEvidenceCodes: ['repeated-webgl-readback'],
        limitationCodes: ['page-controlled-evidence', 'uncalibrated-threshold'],
      })],
    }));
    expect(card!.kind).toBe('possible-fingerprinting');
    expect(r(card!.interpretation)).toBe('card_fp_webgl_probe');
    expect(card!.interpretationNote?.key).toBe('card_fp_not_proven');
    expect(card!.familyNote?.key).toBe('card_note_webgl');
    expect(r(card!.confidence)).toBe('confidence_low');
    expect(card!.counterEvidenceCodes).toEqual(['repeated-webgl-readback']);
    expect(card!.operations).toEqual([
      'WebGL getParameter(UNMASKED_RENDERER_WEBGL)',
      'WebGL getParameter(MAX_* and other limits)',
      'WebGL getExtension(WEBGL_debug_renderer_info)',
      'WebGL getSupportedExtensions',
      'WebGL getShaderPrecisionFormat',
    ]);
  });

  it('the new keys exist in ru and en with the documented placeholders', () => {
    for (const name of ['ru', 'en']) {
      const table = locale(name);
      for (const key of ['card_api_use_webgl_params', 'card_api_use_webgl_readback', 'card_fp_webgl_probe', 'card_note_webgl', 'alternative_repeated_webgl_readback']) {
        expect(table[key]?.message, name + ':' + key).toBeTruthy();
      }
      expect(table['card_api_use_webgl_params']!.message).toContain('$API$');
      expect(table['card_api_use_webgl_params']!.message).toContain('$COUNT$');
      expect(table['card_api_use_webgl_readback']!.message).toContain('$COUNT$');
      expect(table['card_api_use_webgl_readback']!.message).not.toContain('$API$');
    }
    expect(locale('ru')['card_note_webgl']!.message).toContain('ошибок драйверов');
    expect(locale('en')['card_fp_webgl_probe']!.message).toContain('graphics adapter');
  });
});

describe('Web Audio and Permissions cards (E08-01, E08-03, S05)', () => {
  const locale = (name: string) => JSON.parse(readFileSync(join(here, '../../../apps/extension/_locales', name, 'messages.json'), 'utf8')) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
  const items = (list: ReturnType<typeof operationItems>) => list.map((item) => (typeof item === 'string' ? item : r(item)));

  it('DET-015/016 belong to the audio family and DET-039 to permissions, with their own observation wording', () => {
    expect(TECHNIQUE_INFO['DET-015']).toMatchObject({ category: 'audio', family: 'audio' });
    expect(TECHNIQUE_INFO['DET-016']).toMatchObject({ category: 'audio', family: 'audio' });
    expect(TECHNIQUE_INFO['DET-039']).toEqual({ category: 'permissions', family: 'permissions', api: 'Permissions.query' });
    const cards = buildCards(report({
      techniques: [technique({ techniqueId: 'DET-015', count: 4 }), technique({ techniqueId: 'DET-016', count: 60 }), technique({ techniqueId: 'DET-039', count: 3 })],
    }));
    const byId = Object.fromEntries(cards.map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-015']!.observation)).toBe('card_api_use_audio_graph[4]');
    expect(r(byId['DET-016']!.observation)).toBe('card_api_use_audio_readout[60]');
    expect(r(byId['DET-039']!.observation)).toBe('card_api_use_permissions[3]');
    expect(byId['DET-015']!.familyNote?.key).toBe('card_note_audio');
    expect(byId['DET-016']!.familyNote?.key).toBe('card_note_audio');
    expect(byId['DET-039']!.familyNote?.key).toBe('card_note_permissions');
    expect(familyNoteKey('audio')).toBe('card_note_audio');
    expect(familyNoteKey('permissions')).toBe('card_note_permissions');
    expect(r(byId['DET-039']!.interpretation)).toBe('card_api_use_generic_note');
  });

  it('possible-fingerprinting cards use card_fp_audio_sequence / card_fp_permissions_breadth with the not-proven note', () => {
    const cards = buildCards(report({
      techniques: [
        technique({ techniqueId: 'DET-015', count: 4, operationCodes: ['start-rendering', 'create-oscillator', 'create-dynamics-compressor', 'connect-osc-compressor'] }),
        technique({ techniqueId: 'DET-039', count: 9, operationCodes: ['query', 'state-location', 'state-media', 'state-sensors', 'state-midi', 'state-clipboard', 'state-storage', 'state-other'] }),
      ],
      findings: [
        finding({ findingId: 'audio-offline-graph-v1-DET-015-possible-fingerprinting', techniqueId: 'DET-015', ruleId: 'audio-offline-graph', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', counterEvidenceCodes: [], limitationCodes: ['buffer-origin-unknown'] }),
        finding({ findingId: 'permissions-breadth-v1-DET-039-possible-fingerprinting', techniqueId: 'DET-039', ruleId: 'permissions-breadth', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', counterEvidenceCodes: [], limitationCodes: ['permission-name-from-status'] }),
      ],
    }));
    const byId = Object.fromEntries(cards.map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-015']!.interpretation)).toBe('card_fp_audio_sequence');
    expect(r(byId['DET-039']!.interpretation)).toBe('card_fp_permissions_breadth');
    for (const id of ['DET-015', 'DET-039'] as const) {
      expect(byId[id]!.kind).toBe('possible-fingerprinting');
      expect(byId[id]!.interpretationNote?.key).toBe('card_fp_not_proven');
      expect(r(byId[id]!.confidence)).toBe('confidence_low');
    }
    expect(byId['DET-015']!.operations).toEqual(['OfflineAudioContext.startRendering', 'BaseAudioContext.createOscillator', 'BaseAudioContext.createDynamicsCompressor', 'AudioNode.connect(Oscillator->DynamicsCompressor)']);
    expect(items(byId['DET-039']!.operations)).toEqual([
      'Permissions.query',
      'permission_category_location',
      'permission_category_media',
      'permission_category_sensors',
      'permission_category_midi',
      'permission_category_clipboard',
      'permission_category_storage',
      'permission_category_other',
    ]);
  });

  it('every state-<category> code maps to a permission_category_* key; other codes are not categories', () => {
    expect(items(operationItems(['state-notifications', 'state-other', 'state-unclassified', 'param-other']))).toEqual([
      'permission_category_notifications',
      'permission_category_other',
      'operation_unclassified',
      'operation_other',
    ]);
    expect(permissionCategoryMessage('query')).toBeNull();
    expect(permissionCategoryMessage('state-unclassified')).toBeNull();
  });

  it('the new keys exist in ru and en with the documented placeholders and wording', () => {
    const keys = [
      'card_api_use_audio_graph',
      'card_api_use_audio_readout',
      'card_api_use_permissions',
      'card_fp_audio_sequence',
      'card_fp_permissions_breadth',
      'card_note_audio',
      'card_note_permissions',
      'limitation_buffer_origin_unknown',
      'limitation_permission_name_from_status',
      ...['location', 'notifications', 'media', 'sensors', 'midi', 'clipboard', 'storage', 'other'].map((c) => 'permission_category_' + c),
    ];
    for (const name of ['ru', 'en']) {
      const table = locale(name);
      for (const key of keys) expect(table[key]?.message, name + ':' + key).toBeTruthy();
      for (const key of ['card_api_use_audio_graph', 'card_api_use_audio_readout', 'card_api_use_permissions']) {
        expect(table[key]!.message).toContain('$COUNT$');
        expect(table[key]!.message).not.toContain('$API$');
        expect(table[key]!.placeholders).toEqual({ count: { content: '$1' } });
      }
      // docs/ui-copy.md §8: never claim that audio is being listened to.
      for (const key of keys) expect(table[key]!.message.toLowerCase()).not.toMatch(/прослушива|listened|listening/);
    }
    expect(locale('ru')['card_api_use_audio_graph']!.message).toBe('Web Audio: создание генератора и компрессора, офлайн-обработка — $COUNT$');
    expect(locale('en')['card_fp_permissions_breadth']!.message).toBe('Checking the state of many permission categories looks like collecting browser characteristics');
  });
});

describe('Environment and geometry cards (E08-02, E07-02, S06)', () => {
  const locale = (name: string) => JSON.parse(readFileSync(join(here, '../../../apps/extension/_locales', name, 'messages.json'), 'utf8')) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

  it('families, API labels and the common flag (equal to engine COMMON_SURFACE_TECHNIQUE_IDS)', () => {
    expect(TECHNIQUE_INFO['DET-005']).toMatchObject({ category: 'graphics', family: 'geometry', common: true });
    for (const id of ['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'] as const) {
      expect(TECHNIQUE_INFO[id], id).toMatchObject({ category: 'environment', family: 'environment' });
    }
    expect(TECHNIQUE_INFO['DET-026'].common).toBeUndefined();
    const common = TECHNIQUE_IDS.filter((id) => TECHNIQUE_INFO[id].common === true);
    expect(common).toEqual([...COMMON_SURFACE_TECHNIQUE_IDS]);
  });

  it('each technique has its own observation wording; only DET-005 names the API', () => {
    const ids = ['DET-005', 'DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'] as const;
    const cards = buildCards(report({ techniques: ids.map((techniqueId, i) => technique({ techniqueId, count: i + 2 })) }));
    const byId = Object.fromEntries(cards.map((c) => [c.techniqueId, c]));
    expect(r(byId['DET-005']!.observation)).toBe('card_api_use_geometry[Element.getBoundingClientRect / getClientRects / HTMLElement.offsetWidth / offsetHeight, 2]');
    expect(r(byId['DET-025']!.observation)).toBe('card_api_use_navigator[3]');
    expect(r(byId['DET-026']!.observation)).toBe('card_api_use_ua_hints[4]');
    expect(r(byId['DET-029']!.observation)).toBe('card_api_use_screen[5]');
    expect(r(byId['DET-032']!.observation)).toBe('card_api_use_hardware_concurrency[6]');
    expect(r(byId['DET-033']!.observation)).toBe('card_api_use_device_memory[7]');
    expect(byId['DET-005']!.familyNote?.key).toBe('card_note_geometry');
    for (const id of ['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033']) expect(byId[id]!.familyNote?.key, id).toBe('card_note_environment');
    expect(familyNoteKey('environment')).toBe('card_note_environment');
    expect(familyNoteKey('geometry')).toBe('card_note_geometry');
    for (const card of cards) {
      expect(card.kind).toBe('api-use');
      expect(r(card.interpretation)).toBe('card_api_use_generic_note');
    }
    // A retired hot hook shows a minimum, not an exact count.
    const [retired] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-005', count: 4096, countQuality: 'lower-bound' })] }));
    expect(r(retired!.observation)).toBe('card_api_use_geometry[Element.getBoundingClientRect / getClientRects / HTMLElement.offsetWidth / offsetHeight, count_value_lower_bound[4096]]');
  });

  it('common surfaces never push canvas/WebGL (or other techniques) out of the popup top five within a tier', () => {
    const cards = buildCards(report({
      techniques: [
        technique({ techniqueId: 'DET-005', count: 10_000 }),
        technique({ techniqueId: 'DET-025', count: 50 }),
        technique({ techniqueId: 'DET-029', count: 30 }),
        technique({ techniqueId: 'DET-032', count: 9 }),
        technique({ techniqueId: 'DET-033', count: 9 }),
        technique({ techniqueId: 'DET-002', count: 1 }),
        technique({ techniqueId: 'DET-012', count: 1 }),
        technique({ techniqueId: 'DET-026', count: 1 }),
      ],
    }));
    expect(selectTopCards(cards).map((c) => c.techniqueId)).toEqual(['DET-002', 'DET-012', 'DET-026', 'DET-005', 'DET-025']);
    // Tiers still dominate: an interpretive card ranks above every api-use card, common or not.
    const tiered = buildCards(report({
      techniques: [technique({ techniqueId: 'DET-025', count: 50 }), technique({ techniqueId: 'DET-015', count: 1 })],
      findings: [finding({ findingId: 'a', techniqueId: 'DET-015', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low' })],
    }));
    expect(tiered.map((c) => c.id)).toEqual(['f:a', 't:DET-025']);
  });

  it('the new keys exist in ru and en with the documented placeholders and wording', () => {
    const countOnly = ['card_api_use_navigator', 'card_api_use_ua_hints', 'card_api_use_screen', 'card_api_use_hardware_concurrency', 'card_api_use_device_memory'];
    for (const name of ['ru', 'en']) {
      const table = locale(name);
      for (const key of [...countOnly, 'card_api_use_geometry', 'card_note_environment', 'card_note_geometry', 'limitation_hint_names_not_observed']) {
        expect(table[key]?.message, name + ':' + key).toBeTruthy();
        // docs/ui-copy.md §8: never claim that the processor (or anything else) was identified.
        expect(table[key]!.message.toLowerCase()).not.toMatch(/процессор определ|cpu is identified|processor is identified/);
      }
      for (const key of countOnly) {
        expect(table[key]!.message).toContain('$COUNT$');
        expect(table[key]!.message).not.toContain('$API$');
        expect(table[key]!.placeholders).toEqual({ count: { content: '$1' } });
      }
      expect(table['card_api_use_geometry']!.placeholders).toEqual({ api: { content: '$1' }, count: { content: '$2' } });
    }
    expect(locale('ru')['card_api_use_hardware_concurrency']!.message).toBe('Чтение оценки доступного параллелизма (hardwareConcurrency) — $COUNT$');
    expect(locale('ru')['card_api_use_device_memory']!.message).toBe('Чтение приблизительной категории памяти (deviceMemory) — $COUNT$');
    expect(locale('en')['card_note_environment']!.message).toBe('Compatibility checks, responsive layouts and analytics read browser and screen properties; the extension does not store the values.');
    expect(locale('ru')['limitation_hint_names_not_observed']!.message).toBe('Имена запрошенных подсказок не определяются: для этого пришлось бы повторно читать аргумент страницы.');
  });
});

describe('vendor cards (REQ-007)', () => {
  it('uses the mandatory ThreatMetrix wording (from the catalog) and never counts `none` matches', () => {
    const rep = report({
      catalogVersion: '2026-10-17.ui000001',
      vendors: [vendor({ vendorId: 'threatmetrix' }), vendor({ vendorId: 'akamai', vendorConfidence: 'none' }), vendor({ vendorId: 'datadome', vendorConfidence: 'weak-signal', ruleIds: [], integrity: 'page-controlled', evidenceSource: 'page-dom' })],
    });
    const cards = buildVendorCards(rep, testCatalog(), 'ru');
    expect(cards.map((c) => c.vendorId)).toEqual(['threatmetrix', 'datadome']);
    expect(r(cards[0]!.found)).toBe('card_vendor_found[LexisNexis ThreatMetrix]');
    expect(r(cards[0]!.purpose)).toBe('card_vendor_purpose[card_vendor_threatmetrix_purpose]');
    expect(r(cards[0]!.matchLabel)).toBe('card_vendor_match_documented_resource');
    expect(cards[1]!.name).toBe('DataDome Bot Protect');
    expect(r(cards[1]!.purpose)).toBe('card_vendor_purpose[card_vendor_category_bot]');
    expect(r(cards[1]!.matchLabel)).toBe('card_vendor_match_weak_signal');
    expect(cards[1]!.requestOnly).toBe(false);
  });

  it('S10: names, purpose and rule texts come from the catalog; unknown vendors keep their id and the generic purpose', () => {
    const rep = report({ catalogVersion: '2026-10-17.ui000001', vendors: [vendor({ vendorId: 'threatmetrix', ruleIds: ['tmx-tags-endpoint', 'not-in-ui-catalog'] }), vendor({ vendorId: 'unknown-x', ruleIds: [] })] });
    const [tmx, unknown] = buildVendorCards(rep, testCatalog(), 'en');
    expect(tmx).toMatchObject({
      name: 'LexisNexis ThreatMetrix', requestOnly: true, catalogVersion: '2026-10-17.ui000001',
      rules: [
        { ruleId: 'tmx-tags-endpoint', ruleVersion: '3', meaning: 'The browser received test resource A.', limitations: 'Does not mean A ran.' },
        { ruleId: 'not-in-ui-catalog', ruleVersion: null, meaning: null, limitations: null },
      ],
    });
    expect(buildVendorCards(rep, testCatalog(), 'ru')[0]!.rules[0]!.meaning).toBe('Браузер получил тестовый ресурс A.');
    expect(unknown!.name).toBe('unknown-x');
    expect(r(unknown!.purpose)).toBe('card_vendor_purpose[card_vendor_purpose_generic]');
    // The production catalog has no vendors while the ADR-009 gate is closed: ids are shown verbatim.
    expect(buildVendorCards(rep, PRODUCTION_CATALOG, 'ru')[0]!.name).toBe('threatmetrix');
  });

  it('S10: a browser-observed weak signal says "request to a documented address without an exact resource"', () => {
    const rep = report({ catalogVersion: 'x1', vendors: [vendor({ vendorId: 'datadome', vendorConfidence: 'weak-signal', ruleIds: ['datadome-host'] })] });
    const [card] = buildVendorCards(rep, testCatalog(), 'ru');
    expect(r(card!.matchLabel)).toBe('card_vendor_match_weak_signal_network');
    expect(card!.requestOnly).toBe(true);
    const multi = buildVendorCards(report({ catalogVersion: 'x1', vendors: [vendor({ vendorId: 'datadome', vendorConfidence: 'multi-signal', evidenceSource: 'derived', integrity: 'derived' })] }), testCatalog(), 'ru')[0]!;
    expect(r(multi.matchLabel)).toBe('card_vendor_match_multi_signal');
    expect(multi.requestOnly).toBe(false);
  });
});

describe('counts and badge', () => {
  it('counts distinct techniques, matched vendors and third-party hosts when present', () => {
    const rep = report({
      techniques: [technique({ techniqueId: 'DET-001' }), technique({ techniqueId: 'DET-001', count: 9 }), technique({ techniqueId: 'DET-002' })],
      vendors: [vendor({ vendorId: 'threatmetrix' }), vendor({ vendorId: 'akamai', vendorConfidence: 'none' })],
    });
    // S07 / ADR-018: the projection always carries hosts (here []), so the third-party count is known (0).
    expect(countsView(rep, true)).toEqual({ techniques: 2, services: 1, thirdParty: 0, thirdPartyQuality: 'exact', thirdPartyNote: null });
    const { hosts: _hosts, ...legacy } = rep;
    expect(countsView(legacy as typeof rep, true).thirdParty).toBeNull();
    expect(countsView(null)).toEqual({ techniques: 0, services: null, thirdParty: null, thirdPartyQuality: 'exact', thirdPartyNote: 'unavailable' });
    // S08: third party is decided by the stored relation (never by comparing names with report.host).
    const withHosts = {
      ...rep,
      hosts: [
        { registrableDomain: 'example.com', relation: 'same-site', requestCount: 3 },
        { registrableDomain: 'cdn.vendor.example', relation: 'cross-site', requestCount: 2 },
        { category: 'loopback', relation: 'same-origin', requestCount: 2 },
        { registrableDomain: 'not a host', relation: 'cross-site', requestCount: 1 },
        { registrableDomain: 'x.example', relation: 'cross-site' },
        { registrableDomain: 'y.example', requestCount: 1 },
      ],
    } as unknown as typeof rep;
    expect(hostsOf(withHosts).map((h) => (h.registrableDomain ?? h.category ?? 'unknown'))).toEqual(['example.com', 'cdn.vendor.example', 'loopback']);
    expect(countsView(withHosts).thirdParty).toBe(1);
  });

  it('badge = categories with non-api-use findings', () => {
    const rep = report({
      findings: [
        finding({ findingId: 'a', techniqueId: 'DET-002' }),
        finding({ findingId: 'b', techniqueId: 'DET-001' }),
        finding({ findingId: 'c', techniqueId: 'DET-022' }),
        finding({ findingId: 'd', techniqueId: 'DET-032', interpretation: 'api-use' }),
      ],
    });
    expect(categoriesWithFindings(rep)).toBe(2);
    expect(categoriesWithFindings(null)).toBe(0);
    // S12 / E13-03: same function as the toolbar badge — unknown findings and vendors never count.
    const noisy = report({
      findings: [
        finding({ findingId: 'u', techniqueId: 'DET-039', interpretation: 'unknown' }),
        finding({ findingId: 'n', techniqueId: 'DET-060', interpretation: 'local-probe-pattern' }),
      ],
      vendors: [vendor({ vendorId: 'fixture' })],
    });
    expect(categoriesWithFindings(noisy)).toBe(1);
    expect(categoriesWithFindings(report({ vendors: [vendor({ vendorId: 'fixture' })] }))).toBe(0);
  });
});

it('F059/F062 / S10 distinguishes an unavailable catalog (catalogVersion null) from an evaluated empty result', () => {
  expect(countsView(report()).services).toBeNull();
  expect(countsView(report({ vendors: [vendor({ vendorId: 'fixture' })] })).services).toBeNull();
  expect(countsView(report(), true).services).toBe(0);
  expect(countsView(report({ catalogVersion: 'synthetic-test-1' })).services).toBe(0);
  expect(countsView(report({ catalogVersion: 'synthetic-test-1', vendors: [vendor({ vendorId: 'a' }), vendor({ vendorId: 'b', vendorConfidence: 'none' })] })).services).toBe(1);
  expect(catalogAvailable(null)).toBe(false);
  expect(catalogAvailable(report())).toBe(false);
  expect(catalogAvailable(report({ catalogVersion: '2026-09-12.ca2d4012' }))).toBe(true);
  const { catalogVersion: _v, ...legacy } = report();
  expect(catalogAvailable(legacy as ReturnType<typeof report>)).toBe(false);
});

it('F061 single-read and editor findings cannot assert a series', () => {
  for (const techniqueId of ['DET-001', 'DET-002'] as const) {
    const [card] = buildCards(report({
      techniques: [technique({ techniqueId, count: 1 })],
      findings: [finding({ findingId: 'single', techniqueId, interpretation: 'possible-fingerprinting' })],
    }));
    expect(card!.interpretation.key).toBe('card_fp_insufficient');
  }
});

it('F142 DET-003 asserts API calls, including measureText, rather than drawing', () => {
  const [card] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-003', count: 1 })] }));
  expect(card!.observation.key).toBe('card_api_use_generic');
  expect(card!.api).toContain('measureText');
});

it('F144 exception wording is reserved for nonempty all-threw phases', () => {
  const cases = [
    { phases: ['threw-sync'], threw: true, unknown: false },
    { phases: ['attempted'], threw: false, unknown: true },
    { phases: ['attempted', 'threw-sync'], threw: false, unknown: true },
    { phases: ['settlement-unobserved'], threw: false, unknown: true },
    { phases: ['returned-sync'], threw: false, unknown: false },
    { phases: [], threw: false, unknown: false },
  ] as const;
  for (const item of cases) {
    const [card] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-001', phases: [...item.phases] })] }));
    expect(card!.attemptOnly, item.phases.join(',')).toBe(item.threw);
    expect(card!.completionUnobserved).toBe(item.unknown);
  }
});

describe('browser-network cards (E10, S08)', () => {
  const network = (techniqueId: 'DET-058' | 'DET-059' | 'DET-060' | 'DET-061', overrides: Partial<ReturnType<typeof technique>> = {}) =>
    technique({ techniqueId, count: 4, phases: ['attempted'], evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', ...overrides });

  it('DET-058…061 browser-network summaries say what Chrome registered, with the count as $1', () => {
    const expected = { 'DET-058': 'card_network_socket', 'DET-059': 'card_network_requests', 'DET-060': 'card_network_local', 'DET-061': 'card_network_dns' } as const;
    for (const [techniqueId, key] of Object.entries(expected) as Array<[keyof typeof expected, string]>) {
      const [card] = buildCards(report({ techniques: [network(techniqueId)] }));
      expect(card!.observation, techniqueId).toEqual({ key, subs: ['4'] });
      expect(card!.integrity).toBe('browser-observed');
      expect(card!.completionUnobserved).toBe(true);
    }
    const [lower] = buildCards(report({ techniques: [network('DET-059', { countQuality: 'lower-bound' })] }));
    expect(r(lower!.observation)).toBe('card_network_requests[count_value_lower_bound[4]]');
  });

  it('page-hook summaries of the same ids keep the existing wording', () => {
    const [local] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-060' })] }));
    expect(local!.observation.key).toBe('card_api_use_local_probe');
    const [socket] = buildCards(report({ techniques: [technique({ techniqueId: 'DET-058' })] }));
    expect(socket!.observation.key).toBe('card_api_use_generic');
  });

  it('API labels name the webRequest observation, not the page APIs as hooked', () => {
    expect(TECHNIQUE_INFO['DET-058'].api).toBe('WebSocket handshake (webRequest)');
    expect(TECHNIQUE_INFO['DET-059'].api).toBe('fetch / XMLHttpRequest / sendBeacon (webRequest)');
  });

  it('local-probe and dns patterns keep the not-proven note and their own interpretation', () => {
    const cards = buildCards(report({
      techniques: [network('DET-060'), network('DET-061')],
      findings: [
        finding({ findingId: 'network-observed-v1-DET-060-local-probe-pattern', techniqueId: 'DET-060', ruleId: 'network-observed', interpretation: 'local-probe-pattern', interpretationConfidence: 'low', counterEvidenceCodes: [], limitationCodes: ['outcome-not-observed'] }),
        finding({ findingId: 'network-observed-v1-DET-061-dns-test-pattern', techniqueId: 'DET-061', ruleId: 'network-observed', interpretation: 'dns-test-pattern', interpretationConfidence: 'low', counterEvidenceCodes: [], limitationCodes: ['resolver-unknown'] }),
      ],
    }));
    const byId = new Map(cards.map((card) => [card.techniqueId, card]));
    expect(byId.get('DET-060')!.observation.key).toBe('card_network_local');
    expect(byId.get('DET-060')!.interpretation.key).toBe('card_fp_local_probe');
    expect(byId.get('DET-061')!.observation.key).toBe('card_network_dns');
    expect(byId.get('DET-061')!.interpretation.key).toBe('card_fp_dns_pattern');
    for (const card of cards) expect(card.interpretationNote?.key).toBe('card_fp_not_proven');
  });

  it('the new keys exist in ru and en with $COUNT$ as the only placeholder', () => {
    for (const locale of ['ru', 'en']) {
      const table = JSON.parse(readFileSync(join(here, '..', '..', '..', 'apps', 'extension', '_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
      for (const key of ['card_network_socket', 'card_network_requests', 'card_network_local', 'card_network_dns']) {
        expect(table[key]?.message, locale + ':' + key).toContain('Chrome');
        expect(table[key]?.message).toContain('$COUNT$');
        expect(table[key]?.placeholders).toEqual({ count: { content: '$1' } });
      }
    }
  });
});

describe('S13 card fields for the side panel (E13-02)', () => {
  it('every card carries its raw interpretation axes and documentKey; kindLabelKey matches the chip label', async () => {
    const { kindLabelKey } = await import('../src/view-models/cards');
    const rep = report({
      documentKey: '7:0:doc-z',
      techniques: [
        technique({ techniqueId: 'DET-002', count: 2, signalCodes: ['readback-after-text', 'api-use'] }),
        technique({ techniqueId: 'DET-061', count: 9, evidenceSource: 'browser-network', integrity: 'browser-observed', signalCodes: ['unique-subdomains', 'api-use'], firstBucket: 0, lastBucket: 12 }),
      ],
      findings: [finding({ findingId: 'dns', techniqueId: 'DET-061', interpretation: 'dns-test-pattern', interpretationConfidence: 'low' })],
    });
    const cards = buildCards(rep);
    for (const card of cards) {
      expect(card.documentKey).toBe('7:0:doc-z');
      expect(card.label.key).toBe(kindLabelKey(card.kind));
    }
    const dns = cards.find((card) => card.techniqueId === 'DET-061')!;
    expect(dns).toMatchObject({ kind: 'possible-fingerprinting', interpretationKind: 'dns-test-pattern', confidenceLevel: 'low', firstBucket: null, lastBucket: null, signalCodes: ['api-use', 'unique-subdomains'] });
    const canvas = cards.find((card) => card.techniqueId === 'DET-002')!;
    expect(canvas).toMatchObject({ kind: 'api-use', interpretationKind: 'api-use', confidenceLevel: 'unassessed', firstBucket: 1, lastBucket: 4, signalCodes: ['api-use', 'readback-after-text'] });
  });
});
