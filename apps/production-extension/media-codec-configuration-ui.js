// Round 5 (ADR-101 amendment): typed controls for the Custom media-capabilities value (type media-codecs) in the Custom value editor.
// Local state only: nothing is probed in the browser (REQ-001). The controls edit the same JSON the textarea shows - every change goes
// through the modal's draft and its Save validation. A Custom value can only LOWER what this browser reports; the note says so and
// names what is not covered (Workers, documents with an opaque origin).
import { API_MEDIA_CODEC_FAMILIES, validateApiValue } from './api-configuration.js';

/** Codec names are not translated. Dolby names what the family really covers (the matcher in api-custom-media-codecs.js). */
export const MEDIA_CODEC_FAMILY_LABELS = Object.freeze({
  h264: 'H.264', h265: 'H.265 / HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', aac: 'AAC', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', mp3: 'MP3', dolby: 'Dolby (AC-3, E-AC-3, AC-4, Dolby Vision)'
});
/** The browser's own answer: nothing lowered, nothing hidden. A new value starts here (the first preset lowers everything). */
export const MEDIA_CODEC_IDENTITY = Object.freeze({ hidden: Object.freeze([]), powerEfficient: true, smooth: true, supported: true });
export const MEDIA_CODEC_START = Object.freeze({ kind: 'value', value: MEDIA_CODEC_IDENTITY });
// English fallback of media_codecs_* in the message tables (scripts/production-locales-media.mjs keeps the 21 languages; a test keeps this equal).
const COPY = Object.freeze({
  flags: 'Answer given to the page', supported: 'Supported', smooth: 'Smooth playback', power: 'Power efficient', families: 'Hide codec families',
  note: 'A Custom value can only lower what this browser reports. Hidden families are reported as unsupported by MediaCapabilities, canPlayType and isTypeSupported in windows and same-origin frames; Workers and documents with an opaque origin (about:, blob:, data:) are not covered.',
  all_off: 'Supported is off: every codec is reported as unsupported, whatever is ticked below.',
  json_invalid: 'The JSON below is not a valid value. Fix it to use these controls.'
});
export const MEDIA_CODEC_FALLBACK = COPY;
export function mediaCodecText(translate, key) { const id = 'media_codecs_' + key, result = translate?.(id); return result && result !== id ? result : COPY[key] ?? key; }
/** The canonical media-codecs value (sorted keys, hidden in contract order) of any JSON value the contract accepts; null otherwise. */
export function readMediaCodec(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const checked = validateApiValue('media-capabilities', { kind: 'value', value });
  return checked.ok ? checked.value.value : null;
}
/** The same for the text of the JSON view; null while the text is not valid JSON or not a valid value. */
export function readMediaCodecInput(text) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  try { return readMediaCodec(JSON.parse(text)); } catch { return null; }
}
export function createMediaCodecConfigurationUi({ h, useRef, translate }) {
  const t = key => mediaCodecText(translate, key);
  /**
   * `value` is the last valid value (shown even while the JSON view is being edited); `invalid` locks the controls until the JSON is valid
   * again, so a control never overwrites text the user is typing. Smooth and power efficient are off and locked while Supported is off, and
   * come back as they were when it is switched on again.
   */
  function MediaCodecFields({ value, onChange, disabled = false, invalid = false }) {
    const remembered = useRef(null), current = readMediaCodec(value) ?? MEDIA_CODEC_IDENTITY, locked = disabled || invalid, supported = current.supported === true;
    const commit = next => { if (locked) return; const read = readMediaCodec(next); if (read) onChange(read); };
    function setSupported(on) {
      if (!on) { remembered.current = { smooth: current.smooth, powerEfficient: current.powerEfficient }; commit({ ...current, supported: false, smooth: false, powerEfficient: false }); return; }
      const back = remembered.current ?? { smooth: false, powerEfficient: false };
      commit({ ...current, supported: true, smooth: back.smooth, powerEfficient: back.powerEfficient });
    }
    // A control that is shown off and locked (nothing is supported) ignores a queued event, like a disabled control does in the page.
    function setFamily(family, hide) { if (supported) commit({ ...current, hidden: API_MEDIA_CODEC_FAMILIES.filter(name => name === family ? hide : current.hidden.includes(name)) }); }
    const flag = (key, label, checked, off, set) => h('label', { key, class: 'media-codec-check', children: [
      h('input', { type: 'checkbox', checked, disabled: locked || off, 'data-media-codec-field': key, onChange: event => set(event.currentTarget.checked) }), h('span', { children: label })] });
    return h('div', { class: 'media-codec-fields', 'data-media-codec-fields': true, children: [
      h('fieldset', { class: 'media-codec-section', disabled: locked, 'data-media-codec-flags': true, children: [h('legend', { children: t('flags') }),
        flag('supported', t('supported'), supported, false, setSupported),
        flag('smooth', t('smooth'), current.smooth, !supported, on => { if (supported) commit({ ...current, smooth: on }); }),
        flag('powerEfficient', t('power'), current.powerEfficient, !supported, on => { if (supported) commit({ ...current, powerEfficient: on }); })] }),
      h('fieldset', { class: 'media-codec-section', disabled: locked || !supported, 'aria-describedby': 'media-codec-note', 'data-media-codec-families': true, children: [h('legend', { children: t('families') }),
        supported ? null : h('p', { class: 'media-codec-note', 'data-media-codec-all-off': true, children: t('all_off') }),
        h('div', { class: 'media-codec-families', children: API_MEDIA_CODEC_FAMILIES.map(family => h('label', { key: family, class: 'media-codec-check', children: [
          h('input', { type: 'checkbox', checked: current.hidden.includes(family), disabled: locked || !supported, 'data-media-codec-family': family, onChange: event => setFamily(family, event.currentTarget.checked) }),
          h('span', { dir: 'ltr', children: MEDIA_CODEC_FAMILY_LABELS[family] })] })) }),
        h('p', { id: 'media-codec-note', class: 'media-codec-note', 'data-media-codec-note': true, children: t('note') })] }),
      invalid ? h('p', { class: 'media-codec-note media-codec-invalid', role: 'status', 'data-media-codec-invalid': true, children: t('json_invalid') }) : null
    ] });
  }
  return { MediaCodecFields };
}
