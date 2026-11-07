// ADR-110: the fixed list of well-known font family NAMES that the HTML/CSS font shield can hide. Pure data, no browser calls.
// A name here is a fact about the font market, not a measurement of this machine: the shield only makes a listed family
// resolve like a missing one (api-custom-font-shield-runtime.js). Fonts whose names are not in this list stay visible to a page
// that knows their exact names; the list is bounded and says so (docs/coverage/antidetect.md).
//
// Provenance. The names are collected from public sources and compiled here in our own grouping and order:
//  - the family-name tables Microsoft publishes for Windows 10/11 and Office (learn.microsoft.com/typography/fonts), via
//    fingerprint-font-groups.js (core, Windows 11, Office, Pan-European and the four regional CJK groups of ADR-110 addendum 2: imported, not
//    repeated), so every family that any Windows list can allow is a name the shield can hide for a claim that does not allow it;
//  - the font probe lists of the open source fingerprinting libraries FingerprintJS and fingerprintjs2 (MIT) and the CreepJS font
//    tables, read as lists of names only (facts, no code or text copied);
//  - Apple's macOS font list (developer.apple.com/fonts), the Google Fonts catalogue and the default font sets of Ubuntu, Fedora,
//    Android and ChromeOS, for names that appear on developer machines and in public probe lists.
// Names are ASCII, free of quotes, backslashes, commas and semicolons (the Custom validator rejects those in family names), and
// every one is a family name a page can put into font-family. Unverified whether each family exists on a given system: a name
// that is not installed simply changes nothing.
import { WINDOWS_FONT_GROUPS } from './fingerprint-font-groups.js';

export const FONT_PROBE_LIST_VERSION = 1;
export const FONT_PROBE_MAX_NAMES = 720;

// Families that the Windows platform itself answers through its font substitution table (measured on Windows 11 with Chrome 153 and
// 156: Helvetica, Times, Courier, MS Sans Serif and MS Serif resolve to installed fonts; Firefox 138 also resolves the other four).
// Since 2026-11-07 (owner decision, docs/decisions/ADR-110-font-css-shield.md, addendum) the five that Chrome resolves (Courier, Helvetica,
// MS Sans Serif, MS Serif, Times) are part of the core group of the Windows allow-list (fingerprint-font-groups.js), so a profile with a
// Windows list shows them as a genuine Windows browser does. The other four
// (Helv, MS Shell Dlg, MS Shell Dlg 2, Tms Rmn: Firefox only) are in no list and stay hidden. A profile whose list does not name an alias (an
// empty list for a non-Windows claim, a short custom list) hides it like every other name, so the shield, the Canvas font policy and the
// claimed list agree.
export const PLATFORM_ALIASES = Object.freeze(['Courier', 'Helv', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'MS Shell Dlg', 'MS Shell Dlg 2', 'Times', 'Tms Rmn']);

// CSS generic families and the system-font keywords can never be shadowed by @font-face.
const RESERVED = Object.freeze(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial', 'unset', 'revert', 'default']);

export const FONT_PROBE_GROUPS = Object.freeze({
  // Windows families outside the default install: Office-era and legacy names, language-pack fonts (Feature on Demand), Terminal fonts.
  windowsExtra: Object.freeze([
    'Arial Narrow', 'Arial Rounded MT Bold', 'Arial Unicode MS', 'Arial Hebrew', 'Abadi MT Condensed Light', 'Aharoni', 'Aldhabi', 'Andalus', 'Angsana New', 'AngsanaUPC',
    'Aparajita', 'Arabic Typesetting', 'Batang', 'BatangChe', 'Browallia New', 'BrowalliaUPC', 'Cordia New', 'CordiaUPC', 'DaunPenh', 'David', 'DFKai-SB', 'DilleniaUPC',
    'DokChampa', 'Dotum', 'DotumChe', 'Estrangelo Edessa', 'EucrosiaUPC', 'Euphemia', 'FangSong', 'FrankRuehl', 'FreesiaUPC', 'Gautami', 'Gisha', 'Gulim', 'GulimChe', 'Gungsuh',
    'GungsuhChe', 'IrisUPC', 'Iskoola Pota', 'JasmineUPC', 'KaiTi', 'Kalinga', 'Kartika', 'Khmer UI', 'KodchiangUPC', 'Kokila', 'Lao UI', 'Latha', 'Leelawadee', 'Levenim MT',
    'LilyUPC', 'Mangal', 'Meiryo', 'Meiryo UI', 'Microsoft Uighur', 'MingLiU', 'MingLiU_HKSCS', 'Miriam', 'MS Mincho', 'MS PMincho', 'Narkisim', 'Nyala', 'Plantagenet Cherokee',
    'PMingLiU', 'Raavi', 'Rod', 'Sakkal Majalla', 'Shonar Bangla', 'Shruti', 'SimHei', 'Simplified Arabic', 'Traditional Arabic', 'Tunga', 'Urdu Typesetting', 'Vijaya', 'Vrinda',
    'Yu Mincho', 'Cascadia Code', 'Cascadia Mono', 'Segoe Marker', 'Fixedsys', 'System', 'Terminal', 'Small Fonts', 'Wingdings 2', 'Wingdings 3', 'Comic Sans', 'Lucida Sans',
    'Times New Roman PS',
  ]),
  // macOS (Apple developer font list); many of these also ship with iOS.
  apple: Object.freeze([
    'Helvetica Neue', 'Lucida Grande', 'Geneva', 'Monaco', 'Menlo', 'Optima', 'Baskerville', 'Big Caslon', 'Didot', 'Futura', 'Gill Sans', 'Hoefler Text', 'American Typewriter',
    'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Apple Chancery', 'Apple Color Emoji', 'Apple SD Gothic Neo', 'AppleGothic', 'AppleMyungjo', 'Apple Symbols', 'Bradley Hand',
    'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Cochin', 'Copperplate', 'Damascus', 'DIN Alternate', 'DIN Condensed', 'Euphemia UCAS', 'Farah', 'Geeza Pro', 'Gurmukhi MN',
    'Herculanum', 'Hiragino Kaku Gothic Pro', 'Hiragino Kaku Gothic ProN', 'Hiragino Maru Gothic Pro', 'Hiragino Mincho Pro', 'Hiragino Mincho ProN', 'Hiragino Sans',
    'Hiragino Sans GB', 'Kailasa', 'Kefa', 'Khmer MN', 'Kohinoor Devanagari', 'Krungthep', 'Lao MN', 'Marker Felt', 'Noteworthy', 'Palatino', 'Party LET', 'Phosphate',
    'PingFang HK', 'PingFang SC', 'PingFang TC', 'Savoye LET', 'SignPainter', 'Silom', 'Skia', 'Snell Roundhand', 'STHeiti', 'STIXGeneral', 'Superclarendon', 'Thonburi',
    'Trattatello', 'Zapf Dingbats', 'Zapfino', 'SF Pro', 'SF Pro Display', 'SF Pro Text', 'SF Pro Rounded', 'SF Mono', 'New York', 'Charter', 'Seravek', 'Iowan Old Style',
    'Andale Mono', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Devanagari MT', 'Diwan Kufi', 'Gujarati MT', 'Heiti SC', 'Heiti TC', 'Osaka', 'Nadeem',
  ]),
  // Linux distributions, Android and ChromeOS.
  linux: Object.freeze([
    'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'DejaVu Sans Condensed', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Liberation Sans Narrow',
    'Noto Sans', 'Noto Serif', 'Noto Mono', 'Noto Sans Mono', 'Noto Color Emoji', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Noto Sans CJK TC',
    'Noto Serif CJK SC', 'Noto Serif CJK JP', 'Noto Sans Arabic', 'Noto Sans Hebrew', 'Noto Sans Thai', 'Noto Sans Devanagari', 'Noto Naskh Arabic', 'Ubuntu', 'Ubuntu Mono',
    'Ubuntu Condensed', 'Cantarell', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'Droid Sans Fallback', 'FreeMono', 'FreeSans', 'FreeSerif', 'Nimbus Sans', 'Nimbus Sans L',
    'Nimbus Roman', 'Nimbus Roman No9 L', 'Nimbus Mono', 'Nimbus Mono L', 'URW Gothic', 'URW Bookman', 'C059', 'P052', 'Z003', 'TeX Gyre Heros', 'TeX Gyre Termes',
    'TeX Gyre Pagella', 'Bitstream Vera Sans', 'Bitstream Vera Serif', 'Bitstream Vera Sans Mono', 'Bitstream Charter', 'Lohit Devanagari', 'Lohit Tamil', 'Oxygen',
    'Oxygen Mono', 'Terminus', 'Cousine', 'Arimo', 'Tinos', 'Carlito', 'Caladea', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'AR PL UMing CN', 'AR PL UKai CN',
    'Source Han Sans', 'Source Han Serif', 'IPAGothic', 'IPAMincho', 'VL Gothic', 'TakaoGothic', 'UnDotum', 'NanumGothic', 'Samsung Sans', 'SamsungOne',
  ]),
  // Adobe and commercial type that designers keep installed.
  adobe: Object.freeze([
    'Adobe Garamond Pro', 'Adobe Caslon Pro', 'Adobe Arabic', 'Adobe Hebrew', 'Adobe Fan Heiti Std', 'Adobe Fangsong Std', 'Adobe Kaiti Std', 'Adobe Song Std',
    'Adobe Myungjo Std', 'Adobe Gothic Std', 'Adobe Heiti Std', 'Adobe Ming Std', 'Adobe Naskh', 'Adobe Devanagari', 'Adobe Clean', 'Minion Pro', 'Minion', 'Myriad Pro',
    'Myriad', 'Myriad Pro Cond', 'Kozuka Gothic Pro', 'Kozuka Mincho Pro', 'Letter Gothic Std', 'Lithos Pro', 'Trajan Pro', 'Trajan Pro 3', 'Orator Std', 'Tekton Pro',
    'Chaparral Pro', 'Cooper Std', 'Acumin Pro', 'Bickham Script Pro', 'Futura PT', 'Gotham', 'Gotham Bold', 'Proxima Nova', 'Museo', 'Museo Sans', 'Frutiger', 'Univers',
    'Univers Condensed', 'Interstate', 'DIN', 'Eurostile', 'Optima LT', 'Whitney', 'Archer', 'Arno Pro', 'Sabon', 'Bembo', 'Galliard', 'Mrs Eaves', 'ITC Franklin Gothic',
    'ITC Avant Garde Gothic', 'ITC Bookman', 'ITC Century', 'ITC Garamond',
  ]),
  // Families from the Google Fonts catalogue and other web type that are often installed on a developer or designer machine.
  web: Object.freeze([
    'Roboto', 'Roboto Mono', 'Roboto Condensed', 'Roboto Slab', 'Roboto Light', 'Roboto Medium', 'Roboto Thin', 'Roboto Black', 'Open Sans', 'Open Sans Condensed', 'Lato',
    'Montserrat', 'Raleway', 'Oswald', 'Poppins', 'Nunito', 'Nunito Sans', 'Merriweather', 'PT Sans', 'PT Sans Narrow', 'PT Serif', 'PT Mono', 'Playfair Display', 'Rubik',
    'Work Sans', 'Quicksand', 'Inter', 'Mukta', 'Karla', 'Barlow', 'DM Sans', 'Josefin Sans', 'Libre Baskerville', 'Lora', 'Bebas Neue', 'Anton', 'Archivo', 'Cabin',
    'Crimson Text', 'Exo 2', 'Fjalla One', 'Hind', 'Indie Flower', 'Lobster', 'Pacifico', 'Titillium Web', 'Yanone Kaffeesatz', 'Arvo', 'Bitter', 'Dosis', 'Muli', 'Signika',
    'Varela Round', 'Zilla Slab', 'Comfortaa', 'Fira Sans', 'Fira Sans Condensed', 'Maven Pro', 'Questrial', 'Teko', 'Abel', 'Asap', 'Assistant', 'Catamaran', 'EB Garamond',
    'Heebo', 'Kanit', 'Prompt', 'Sarabun', 'Source Sans Pro', 'Source Sans 3', 'Source Serif Pro', 'IBM Plex Sans', 'IBM Plex Serif', 'Cormorant Garamond', 'Space Grotesk',
    'Manrope', 'Outfit', 'Lexend', 'Public Sans', 'Overpass', 'Alegreya', 'Caveat', 'Dancing Script', 'Permanent Marker', 'Press Start 2P', 'Orbitron', 'Cinzel', 'Spectral',
    'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC', 'Noto Sans TC', 'Noto Serif JP', 'Noto Serif KR', 'Noto Serif SC', 'Verdana Pro Cond', 'Gill Sans Nova',
  ]),
  // Monospace families of programmers, terminals and editors.
  developer: Object.freeze([
    'Fira Code', 'Fira Mono', 'JetBrains Mono', 'Source Code Pro', 'Hack', 'Inconsolata', 'Anonymous Pro', 'Operator Mono', 'Input Mono', 'Iosevka', 'Victor Mono', 'Meslo LG S',
    'MesloLGS NF', 'FiraCode Nerd Font', 'Hack Nerd Font', 'JetBrainsMono Nerd Font', 'CaskaydiaCove Nerd Font', 'Space Mono', 'Go Mono', 'Overpass Mono', 'IBM Plex Mono',
    'Courier Prime', 'Courier 10 Pitch', 'PragmataPro', 'Lucida Typewriter', 'Letter Gothic',
  ]),
  // Other legacy and commercial names that appear in public probe lists (Bitstream, Monotype, Corel and Office add-ons).
  legacy: Object.freeze([
    'Amazone BT', 'AmerType Md BT', 'Bank Gothic', 'BankGothic Md BT', 'Bauer Bodoni', 'Charter BT', 'CG Times', 'Clarendon', 'English 111 Vivace BT', 'Futura Bk BT',
    'Futura Md BT', 'Galliard BT', 'Geometr231 BT', 'Humanst521 BT', 'Incised901 BT', 'Kabel Bk BT', 'Korinna BT', 'Lydian BT', 'News Gothic', 'Pegasus', 'Serifa',
    'Swis721 BlkEx BT', 'Zurich BlkEx BT', 'ZapfHumnst BT', 'ZapfEllipt BT', 'Academy Engraved LET', 'Albertus Medium', 'Antique Olive', 'Bazooka', 'Calligrapher',
    'Coronet', 'Matisse ITC', 'Pickwick', 'Poster', 'Sceptre', 'Sherwood', 'Signboard', 'Storybook', 'Technical', 'Tristan', 'Westminster', 'Cezanne',
  ]),
});

const lower = value => value.toLowerCase();
const SAFE = /^[\u0020-\u007e]{1,128}$/u;
const FORBIDDEN = /["'\\,;{}<>]/u;
const reservedKeys = new Set(RESERVED);

function compile() {
  const seen = new Set(), out = [];
  const add = name => {
    if (typeof name !== 'string' || !SAFE.test(name) || FORBIDDEN.test(name) || name !== name.trim()) throw new Error('Unsafe font probe name: ' + JSON.stringify(name));
    const key = lower(name);
    if (seen.has(key) || reservedKeys.has(key)) return;
    seen.add(key); out.push(name);
  };
  // The groups of the Windows allow-list come first so that every family a "Windows" profile does or does not allow is covered.
  for (const group of Object.keys(WINDOWS_FONT_GROUPS)) for (const name of WINDOWS_FONT_GROUPS[group]) add(name);
  for (const group of Object.values(FONT_PROBE_GROUPS)) for (const name of group) add(name);
  for (const name of PLATFORM_ALIASES) add(name);
  if (out.length > FONT_PROBE_MAX_NAMES) throw new Error('Font probe list exceeds ' + FONT_PROBE_MAX_NAMES + ' names');
  return Object.freeze(out);
}

// Every shadowable family name, de-duplicated without regard to case, in a fixed order.
export const FONT_PROBE_NAMES = compile();

// The probe names that a profile with this allow-list hides: all of them minus the allowed families (compared without regard to
// case). `allowed` is the `families` array of a canvas-font-policy value; anything that is not an array of strings hides every name.
export function hiddenFontNames(allowed) {
  const keep = new Set();
  if (Array.isArray(allowed)) for (const name of allowed) if (typeof name === 'string') keep.add(lower(name.trim()));
  return Object.freeze(FONT_PROBE_NAMES.filter(name => !keep.has(lower(name))));
}
