// Round 5 (ADR-101 amendment): the codec families a Custom media profile reports as unsupported, matched in the codec strings
// of MediaCapabilities configurations, HTMLMediaElement.canPlayType and the isTypeSupported statics.
// The factory is serialized into the page bootstrap and imported by the private backend: keep it self-contained.
// It scans a type string with simple loops (no regular expressions, no coercion of its input, no page-replaceable method
// lookup at call time) and looks at the first 512 UTF-16 units only: a longer string is never inspected.
export function createMediaCodecMatcher() {
  const apply = Reflect.apply, getOwn = Object.getOwnPropertyDescriptor, isArray = Array.isArray;
  const charCode = String.prototype.charCodeAt, slice = String.prototype.slice, lower = String.prototype.toLowerCase, indexOf = String.prototype.indexOf;
  // Bit order = API_MEDIA_CODEC_FAMILIES of the contract; bit 20 marks "names some codec" (used when supported is false).
  const NAMES = ['h264', 'h265', 'av1', 'vp9', 'vp8', 'aac', 'opus', 'vorbis', 'flac', 'mp3', 'dolby'];
  const H264 = 1, H265 = 2, AV1 = 4, VP9 = 8, VP8 = 16, AAC = 32, OPUS = 64, VORBIS = 128, FLAC = 256, MP3 = 512, DOLBY = 1024, ANY = 1 << 20, MAX = 512;
  const cursor = [0]; // nothing below runs page code, so one reusable argument list is safe
  function at(text, index) { cursor[0] = index; return apply(charCode, text, cursor); }
  function space(code) { return code === 32 || code === 9 || code === 10 || code === 13 || code === 12; }
  function trimmed(text, from, to) {
    while (from < to && space(at(text, from))) from++;
    while (to > from && space(at(text, to - 1))) to--;
    return apply(slice, text, [from, to]);
  }
  // One lowercase codec token such as avc1.42E01E, mp4a.40.2 or ac-3 (everything before the first dot names the codec).
  function family(token) {
    const dot = apply(indexOf, token, ['.']), head = dot < 0 ? token : apply(slice, token, [0, dot]);
    switch (head) {
      case 'avc1': case 'avc3': case 'h264': return H264;
      case 'hev1': case 'hvc1': case 'hevc': case 'h265': return H265;
      // Dolby Vision rides on the codec named in the fourcc: a browser that cannot decode that codec cannot play it either.
      case 'dvh1': case 'dvhe': return DOLBY | H265;
      case 'dva1': case 'dvav': return DOLBY | H264;
      case 'dav1': return DOLBY | AV1;
      case 'av01': case 'av1': return AV1;
      case 'vp09': case 'vp9': return VP9;
      case 'vp8': return VP8;
      case 'opus': return OPUS;
      case 'vorbis': return VORBIS;
      case 'flac': return FLAC;
      case 'mp3': return MP3;
      case 'aac': return AAC;
      case 'ac-3': case 'ec-3': case 'ac-4': return DOLBY;
      case 'mp4a': {
        const rest = dot < 0 ? '' : apply(slice, token, [dot + 1]), next = apply(indexOf, rest, ['.']), object = next < 0 ? rest : apply(slice, rest, [0, next]);
        // MPEG-4 audio object types: 40 (AAC family) and the MPEG-2 AAC profiles 66-68; 69 and 6b are MP3; a5 and a6 are AC-3 and E-AC-3.
        if (object === '40' || object === '66' || object === '67' || object === '68') return AAC;
        if (object === '69' || object === '6b') return MP3;
        if (object === 'a5' || object === 'a6') return DOLBY;
        return 0;
      }
      default: return 0;
    }
  }
  function tokens(text, from, to) {
    let result = 0, start = from;
    for (let index = from; index <= to; index++) {
      if (index !== to && at(text, index) !== 44) continue;
      const token = trimmed(text, start, index);
      if (token.length > 0) result |= ANY | family(apply(lower, token, []));
      start = index + 1;
    }
    return result;
  }
  // No codecs parameter: only codec-specific MIME types (and, for a WebRTC configuration, the RTP subtype) name a codec.
  // Container-only types such as video/mp4 or audio/webm name none.
  function bare(text, end, rtc) {
    if (end > 32) return 0;
    const essence = apply(lower, trimmed(text, 0, end), []);
    if (rtc) {
      const slash = apply(indexOf, essence, ['/']), subtype = slash < 0 ? '' : apply(slice, essence, [slash + 1]);
      return subtype.length > 0 ? ANY | family(subtype) : 0;
    }
    switch (essence) {
      case 'audio/mpeg': case 'audio/mp3': case 'audio/x-mp3': return ANY | MP3;
      case 'audio/flac': case 'audio/x-flac': return ANY | FLAC;
      case 'audio/aac': case 'audio/aacp': case 'audio/x-aac': return ANY | AAC;
      default: return 0;
    }
  }
  function families(text, rtc) {
    if (typeof text !== 'string') return 0;
    const length = text.length;
    if (length === 0 || length > MAX) return 0;
    let end = 0;
    while (end < length && at(text, end) !== 59) end++;
    let result = 0, found = false, index = end;
    while (index < length) {
      index++; // the ';' that opens a parameter
      while (index < length && space(at(text, index))) index++;
      const nameStart = index;
      while (index < length && at(text, index) !== 61 && at(text, index) !== 59) index++;
      const nameEnd = index;
      if (index < length && at(text, index) === 61) {
        index++;
        while (index < length && space(at(text, index))) index++;
        const quote = index < length ? at(text, index) : 0;
        let valueStart = index, valueEnd;
        if (quote === 34 || quote === 39) {
          index++; valueStart = index;
          while (index < length && at(text, index) !== quote) { if (quote === 34 && at(text, index) === 92) index++; index++; }
          valueEnd = index < length ? index : length;
          if (index < length) index++; // the closing quote
        } else {
          while (index < length && at(text, index) !== 59) index++;
          valueEnd = index;
        }
        if (nameEnd - nameStart >= 6 && apply(lower, trimmed(text, nameStart, nameEnd), []) === 'codecs') { found = true; result |= tokens(text, valueStart, valueEnd); }
      }
      while (index < length && at(text, index) !== 59) index++;
    }
    return found ? result : bare(text, end, rtc === true);
  }
  function data(object, key) {
    const field = object !== null && typeof object === 'object' ? getOwn(object, key) : undefined;
    return field && getOwn(field, 'value') ? field.value : undefined;
  }
  // The bits to hide for a validated Custom profile: its hidden families, plus "names any codec" when supported is false.
  function mask(profile) {
    let result = 0;
    const hidden = data(profile, 'hidden');
    if (isArray(hidden)) {
      for (let index = 0; index < hidden.length && index < 32; index++) {
        const name = data(hidden, index);
        for (let bit = 0; bit < NAMES.length; bit++) if (NAMES[bit] === name) result |= 1 << bit;
      }
    }
    return data(profile, 'supported') === false ? result | ANY : result;
  }
  return Object.freeze({ families, mask, any: ANY, names: Object.freeze(NAMES) });
}
