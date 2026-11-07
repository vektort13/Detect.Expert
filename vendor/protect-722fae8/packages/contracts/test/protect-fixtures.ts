// Test-only fixtures of the «Защита» request journal (ADR-020 §I): one value-match fact and one request input.

type Json = Record<string, unknown>;

export const FACT: Json = {
  factKind: 'value-match',
  day: '2026-10-17',
  site: 'shop.example',
  receiverDomain: 'collect.example',
  endpoint: { scheme: 'https', host: 'px.collect.example', pathTemplate: '/tr' },
  script: { kind: 'external', scheme: 'https', host: 'cdn.tracker.example', pathTemplate: '/js/pixel.js' },
  dataKind: 'email',
  encoding: 'sha256-hex',
  location: 'query',
  parameterName: 'ud[em]',
  submitTiming: 'before-submit',
  techniqueIds: [],
  vendorId: null,
  evidenceSource: 'derived',
  integrity: 'derived',
  interpretationConfidence: 'high',
};

export const REQUEST: Json = {
  sourceKind: 'evidence',
  jurisdiction: 'gdpr-eu-eea',
  kinds: ['access', 'erasure'],
  letterLang: 'en',
  templateId: 'gdpr-access-erasure',
  templateVersion: '2026-10-17',
  subject: { role: 'receiver', vendorId: null, domain: 'collect.example', entityName: 'Collect Example Ltd' },
  recipient: { source: 'manual', channel: 'email', address: 'privacy@collect.example' },
  facts: [FACT],
  identityKinds: ['sender-address'],
  delivery: 'mailto',
  mentionGpc: false,
};
