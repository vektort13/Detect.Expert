// ADR-104 follow-up: static Windows font family NAMES for the Strict `canvas-font-policy` allow-list. Pure data, no
// browser calls. A name is a fact about a Windows install, not a font and not a measurement; the policy only lets a
// canvas text request that names one of these resolve natively, it never creates or renders a font.
//
// Provenance: Windows font family names: Microsoft published lists (learn.microsoft.com/typography/fonts/
// windows_10_font_list and windows_11_font_list, read 2026-11-05) + Camoufox essential-fonts.json / font-groups.json
// (MIT, names only). Selection rules (independent re-implementation, nothing copied but names):
//  - core: the Windows 11 base minus (a) names that are not ASCII (localized CJK/Korean aliases; heuristic, unverified: a non-CJK Windows
//    UI is assumed not to list them), (b) Firefox-only aliases and legacy raster families that are not on Microsoft's
//    lists (Twemoji Mozilla, Helv, MS Shell Dlg, MS Shell Dlg 2, Roman, Small Fonts, Tms Rmn), (c) names absent from Microsoft's lists
//    (Nirmala Text, Nirmala Text Semilight, MingLiU_MSCS-ExtB) and (d) the Windows 11 only names; plus (e) five platform aliases.
//    Every core name except those five is on Microsoft's Windows 10 and 11 lists as a family or font name ("Yu Gothic UI" appears there
//    as "Yu Gothic UI Regular"); each of the 14 names of the earlier fixed list is included.
//    The five aliases are Courier, Helvetica, MS Sans Serif, MS Serif and Times. They are NOT on Microsoft's lists: Windows answers for them
//    through its font substitution table, and a genuine Windows browser resolves exactly these five (measured on Windows 11: Chrome 153 and
//    156, Firefox 138; Firefox also resolves the four of (b) that are named above). The owner decided on 2026-11-07 to show them
//    (docs/decisions/ADR-110-font-css-shield.md, addendum). Profiles saved before that carry the core list without them
//    (fingerprint-device-presets.js still recognizes those lists as Windows lists).
//  - win11: names present only on Windows 11. Segoe Fluent Icons and Segoe UI Variable (+ Display/Small/Text) are on
//    Microsoft's Windows 11 list; "Sans Serif Collection" is in the Camoufox Windows 11 base only (unverified here).
//  - office: Microsoft Office families (Camoufox group "office", observed on about 60% of its sampled machines, so
//    it is OPTIONAL and off by default). 86 of the 115 names are families in Microsoft's font library index; the
//    other 29 are weight/width variants of those families (unverified individually).
//  - panEuropean: the optional Pan-European supplemental Windows fonts (on Microsoft's lists; rare, off by default).
//  - regionJa, regionKo, regionZhHans, regionZhHant (ADR-110 addendum 2, owner decision 2026-11-07): the families of the Feature On Demand packages
//    "Japanese", "Korean", "Chinese (Simplified)" and "Chinese (Traditional)" Supplemental Fonts, which Windows installs when the matching language is
//    enabled. Source: Microsoft Learn, "Windows 10 font list" (learn.microsoft.com/en-us/typography/fonts/windows_10_font_list, page updated
//    2024-03-18) and "Windows 11 font list" (learn.microsoft.com/en-us/typography/fonts/windows_11_font_list, page updated 2022-06-16), sections
//    "Japanese Supplemental Fonts", "Korean Supplemental Fonts", "Chinese (Simplified) Supplemental Fonts" and "Chinese (Traditional) Supplemental
//    Fonts"; read 2026-11-07 (the two pages list the same families in these four sections). English ASCII family names only, no localized names. A name
//    is a family or a legacy family name of the table ("BIZ UDPGothic", "Meiryo UI", "UD Digi Kyokasho NK-B", "Yu Mincho Light", "DengXian Light"),
//    never a style ("Meiryo Bold"). FangSong (Chinese Simplified set) is left out: its name is the CSS generic keyword `fangsong`, which @font-face
//    cannot shadow (font-probe-names.js drops it for the same reason). The base families of the same scripts (MS Gothic, Yu Gothic, Malgun Gothic,
//    Microsoft YaHei, SimSun, Microsoft JhengHei, MingLiU-ExtB ...) are in core for every claim. A regional group joins a list only for a claimed region
//    (REGION_FONT_GROUPS: Japan; Korea; China and Singapore; Taiwan, Hong Kong and Macao); any other region and "Auto" get no regional group.
// Deliberately NOT included: developer/web/LibreOffice/terminal groups (they would expose installed software) and
// the other Feature-on-Demand script packs (Arabic, Bangla, Canadian Aboriginal, Cherokee, Devanagari, Ethiopic, Gujarati, Gurmukhi, Hebrew,
// Kannada, Khmer, Lao, Malayalam, Odia, Sinhala, Syriac, Tamil, Telugu, Thai), which exist only when the matching Windows language is enabled.

export const WINDOWS_FONT_GROUPS = Object.freeze({
  core: Object.freeze([
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria', 'Cambria Math', 'Candara',
    'Candara Light', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Corbel Light', 'Courier', 'Courier New', 'Ebrima',
    'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Helvetica', 'Impact', 'Ink Free', 'Javanese Text',
    'Leelawadee UI', 'Leelawadee UI Semilight', 'Lucida Console', 'Lucida Sans Unicode', 'MS Gothic', 'MS PGothic',
    'MS Sans Serif', 'MS Serif', 'MS UI Gothic', 'MV Boli', 'Malgun Gothic', 'Malgun Gothic Semilight', 'Marlett', 'Microsoft Himalaya',
    'Microsoft JhengHei', 'Microsoft JhengHei Light', 'Microsoft JhengHei UI', 'Microsoft JhengHei UI Light',
    'Microsoft New Tai Lue', 'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei',
    'Microsoft YaHei Light', 'Microsoft YaHei UI', 'Microsoft YaHei UI Light', 'Microsoft Yi Baiti', 'MingLiU-ExtB',
    'MingLiU_HKSCS-ExtB', 'Mongolian Baiti', 'Myanmar Text', 'NSimSun', 'Nirmala UI', 'Nirmala UI Semilight',
    'PMingLiU-ExtB', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script', 'Segoe UI',
    'Segoe UI Black', 'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Light', 'Segoe UI Semibold',
    'Segoe UI Semilight', 'Segoe UI Symbol', 'SimSun', 'SimSun-ExtB', 'Sitka Banner', 'Sitka Display',
    'Sitka Heading', 'Sitka Small', 'Sitka Subheading', 'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma',
    'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic', 'Yu Gothic Light',
    'Yu Gothic Medium', 'Yu Gothic UI', 'Yu Gothic UI Light', 'Yu Gothic UI Semibold', 'Yu Gothic UI Semilight',
  ]),
  win11: Object.freeze([
    'Sans Serif Collection', 'Segoe Fluent Icons', 'Segoe UI Variable', 'Segoe UI Variable Display',
    'Segoe UI Variable Small', 'Segoe UI Variable Text',
  ]),
  office: Object.freeze([
    'Bodoni MT Condensed', 'Stencil', 'Perpetua Titling MT', 'Haettenschweiler', 'Matura MT Script Capitals',
    'Elephant', 'Gill Sans MT Ext Condensed Bold', 'Palace Script MT', 'Modern No. 20', 'Perpetua', 'Wide Latin',
    'Kunstler Script', 'Rockwell Extra Bold', 'Bell MT', 'Harrington', 'Vivaldi', 'Gill Sans Ultra Bold',
    'Bookshelf Symbol 7', 'Rage Italic', 'Agency FB', 'Eras Bold ITC', 'Old English Text MT', 'Broadway',
    'Copperplate Gothic Light', 'Snap ITC', 'Forte', 'Gigi', 'Rockwell Condensed', 'Colonna MT', 'Bauhaus 93',
    'Poor Richard', 'Gill Sans MT', 'Centaur', 'MS Reference Specialty', 'Imprint MT Shadow',
    'Copperplate Gothic Bold', 'Playbill', 'Harlow Solid Italic', 'Footlight MT Light', 'Viner Hand ITC',
    'Bradley Hand ITC', 'Calisto MT', 'Eras Light ITC', 'Parchment', 'Bodoni MT Black', 'Engravers MT', 'Mistral',
    'Goudy Stout', 'Pristina', 'Brush Script MT', 'High Tower Text', 'Niagara Solid', 'Ravie',
    'Gill Sans MT Condensed', 'Informal Roman', 'Algerian', 'Maiandra GD', 'Tw Cen MT Condensed',
    'Edwardian Script ITC', 'Britannic Bold', 'OCR A Extended', 'Bodoni MT Poster Compressed', 'Tempus Sans ITC',
    'Eras Demi ITC', 'Jokerman', 'Niagara Engraved', 'Magneto', 'French Script MT', 'Tw Cen MT',
    'Berlin Sans FB Demi', 'Tw Cen MT Condensed Extra Bold', 'Castellar', 'Script MT Bold', 'Freestyle Script',
    'Blackadder ITC', 'Gloucester MT Extra Condensed', 'Bernard MT Condensed', 'Curlz MT', 'Felix Titling',
    'Baskerville Old Face', 'Vladimir Script', 'Rockwell', 'Onyx', 'Kristen ITC', 'Bodoni MT', 'Cooper Black',
    'Eras Medium ITC', 'Californian FB', 'Goudy Old Style', 'Gill Sans Ultra Bold Condensed', 'Papyrus', 'Chiller',
    'Showcard Gothic', 'Juice ITC', 'Berlin Sans FB', 'MT Extra', 'Book Antiqua', 'Bookman Old Style', 'Century',
    'Century Gothic', 'Century Schoolbook', 'Dubai', 'Franklin Gothic Book', 'Franklin Gothic Demi',
    'Franklin Gothic Demi Cond', 'Franklin Gothic Heavy', 'Garamond', 'Lucida Bright', 'Lucida Calligraphy',
    'Lucida Fax', 'Lucida Handwriting', 'Lucida Sans Typewriter', 'Monotype Corsiva', 'MS Outlook',
    'MS Reference Sans Serif',
  ]),
  panEuropean: Object.freeze([
    'Arial Nova', 'Georgia Pro', 'Gill Sans Nova', 'Neue Haas Grotesk Text Pro', 'Rockwell Nova', 'Verdana Pro',
  ]),
  regionJa: Object.freeze([
    'BIZ UDGothic', 'BIZ UDPGothic', 'BIZ UDMincho Medium', 'BIZ UDPMincho Medium', 'Meiryo', 'Meiryo UI', 'MS Mincho', 'MS PMincho',
    'UD Digi Kyokasho N-B', 'UD Digi Kyokasho NK-B', 'UD Digi Kyokasho NK-R', 'UD Digi Kyokasho NP-B', 'UD Digi Kyokasho NP-R',
    'UD Digi Kyokasho N-R', 'Yu Mincho', 'Yu Mincho Light', 'Yu Mincho Demibold',
  ]),
  regionKo: Object.freeze([
    'Batang', 'BatangChe', 'Dotum', 'DotumChe', 'Gulim', 'GulimChe', 'Gungsuh', 'GungsuhChe',
  ]),
  regionZhHans: Object.freeze([
    'DengXian', 'DengXian Light', 'KaiTi', 'SimHei',
  ]),
  regionZhHant: Object.freeze([
    'DFKai-SB', 'MingLiU', 'MingLiU_HKSCS', 'PMingLiU',
  ]),
});

// The regional groups and which claimed region (ISO 3166-1 alpha-2, the codes of fingerprint-region-data.js) takes which one. That data module is
// generated, so the table lives here. Nothing is detected or measured: the region is the one the profile claims (the time zone rows).
export const REGION_FONT_GROUP_KEYS = Object.freeze(['regionJa', 'regionKo', 'regionZhHans', 'regionZhHant']);
export const REGION_FONT_GROUPS = Object.freeze({ JP: 'regionJa', KR: 'regionKo', KP: 'regionKo', CN: 'regionZhHans', SG: 'regionZhHans', TW: 'regionZhHant', HK: 'regionZhHant', MO: 'regionZhHant' });
// The base-script families (they are in core for every claim) that a profile of that region cannot lack: with the group they are what font noise
// never leaves out for the claimed region (fingerprint-font-noise.js). A prefix covers its variants ("Yu Gothic" covers "Yu Gothic UI Light").
export const REGION_BASE_FAMILIES = Object.freeze({
  regionJa: Object.freeze(['MS Gothic', 'MS PGothic', 'Yu Gothic']),
  regionKo: Object.freeze(['Malgun Gothic']),
  regionZhHans: Object.freeze(['Microsoft YaHei', 'SimSun', 'NSimSun', 'SimSun-ExtB']),
  regionZhHant: Object.freeze(['Microsoft JhengHei', 'MingLiU-ExtB', 'MingLiU_HKSCS-ExtB', 'PMingLiU-ExtB']),
});
// The group key of a claimed region, or null (any other region, "Auto", anything that is not two ASCII letters).
export function regionFontGroup(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/u.test(code)) return null;
  const key = code.toUpperCase();
  return Object.hasOwn(REGION_FONT_GROUPS, key) ? REGION_FONT_GROUPS[key] : null;
}
// The names that font noise never leaves out for a regional group: its own families and the base-script families of that region (a fresh array).
export function regionFontRoots(group) {
  return REGION_FONT_GROUP_KEYS.includes(group) ? [...WINDOWS_FONT_GROUPS[group], ...REGION_BASE_FAMILIES[group]] : [];
}

// Bounds that the Custom validator also enforces (families: at most 256 names, each at most 256 characters).
export const WINDOWS_FONT_MAX_NAMES = 256;
const flag = (options, key) => options !== null && typeof options === 'object' && Object.getOwnPropertyDescriptor(options, key)?.value === true;

// Names for one Windows claim: core always, win11 when the claimed Windows is 11, office / panEuropean only when asked, and one regional group when
// `regionGroup` names it (a key of REGION_FONT_GROUP_KEYS; callers turn a claimed region into a key with regionFontGroup).
// The result is de-duplicated, ASCII and stable in order (core, win11, office, panEuropean, the regional group).
export function windowsFonts(options = {}) {
  const names = [...WINDOWS_FONT_GROUPS.core];
  if (flag(options, 'windows11')) names.push(...WINDOWS_FONT_GROUPS.win11);
  if (flag(options, 'office')) names.push(...WINDOWS_FONT_GROUPS.office);
  if (flag(options, 'panEuropean')) names.push(...WINDOWS_FONT_GROUPS.panEuropean);
  const group = options !== null && typeof options === 'object' ? Object.getOwnPropertyDescriptor(options, 'regionGroup')?.value : undefined;
  if (REGION_FONT_GROUP_KEYS.includes(group)) names.push(...WINDOWS_FONT_GROUPS[group]);
  return [...new Set(names)].slice(0, WINDOWS_FONT_MAX_NAMES);
}
