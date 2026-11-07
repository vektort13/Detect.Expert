// ADR-020 §B (S07): the token alphabet shared by the variant builder (ISOLATED) and the request tokenizer (SW). A token
// is a maximal run of letters and digits (any script) and the characters `@ . + - _ %`; everything else separates.
// A variant with a separator inside is "multi-word": it never equals one token and is found by a rolling window.

/** Whether UTF-16 code unit `c` belongs to a token (letters / digits of any script and @ . + - _ %). */
export function isTokenChar(c: number): boolean {
  if (c < 0x80) {
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 64 || c === 46 || c === 43 || c === 45 || c === 95 || c === 37;
  }
  // Non-ASCII: separators are the Latin-1 punctuation and spaces, general punctuation and the ideographic space.
  if (c <= 0xbf) return c === 0xaa || c === 0xb5 || c === 0xba || (c >= 0xb2 && c <= 0xb3) || c === 0xb9;
  if (c === 0xd7 || c === 0xf7) return false;
  if (c >= 0x2000 && c <= 0x206f) return false;
  if (c === 0x3000 || c === 0xfeff || c === 0xfffd) return false;
  return true;
}

/** True when `text` contains a separator: such a variant never equals one token. */
export function isMultiWord(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isTokenChar(text.charCodeAt(i))) return true;
  return false;
}

/** Characters of a Base64 / base64url run (`=` padding is handled by the caller). */
export function isBase64Char(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47 || c === 45 || c === 95;
}

export function isHexChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}
