// ADR-024: translate public catalogue metadata only; cookie bytes remain outside this path.
const PURPOSE_TERMS = Object.freeze({
  "device storage and access": "cookie_purpose_storage",
  "basic advertising": "cookie_purpose_basic_advertising",
  "advertising profile creation": "cookie_purpose_advertising_profile",
  "personalised advertising": "cookie_purpose_personalised_advertising",
  "content profile creation": "cookie_purpose_content_profile",
  "personalised content": "cookie_purpose_personalised_content",
  "advertising measurement": "cookie_purpose_advertising_measurement",
  "content measurement": "cookie_purpose_content_measurement",
  "audience research": "cookie_purpose_audience_research",
  "service development": "cookie_purpose_service_development",
  "basic content selection": "cookie_purpose_basic_content",
  "security and fraud prevention": "cookie_purpose_security",
  "ad/content delivery": "cookie_purpose_delivery",
  "privacy choices": "cookie_purpose_privacy_choices"
});

export const COOKIE_PURPOSE_TRANSLATION_KEYS = Object.freeze([
  "cookie_purpose_declared", ...Object.values(PURPOSE_TERMS),
  "cookie_purpose_opt_out", "cookie_purpose_without_ids", "cookie_purpose_cookieblock_exception",
  "cookie_purpose_visitor_differentiation", "cookie_purpose_meta_browser_attribution", "cookie_purpose_php_session_identifier"
]);

const DECLARED_PREFIX = "Vendor-declared purposes: ";
const FIXED_PURPOSES = Object.freeze({
  "Vendor-declared cookie storing a choice to opt out of tracking.": "cookie_purpose_opt_out",
  "The vendor declares this cookie and domain without TCF purpose IDs.": "cookie_purpose_without_ids",
  "CookieBlock lists this name as an exception to automated blocking; the exception does not establish its purpose or producer.": "cookie_purpose_cookieblock_exception",
  "Visitor differentiation": "cookie_purpose_visitor_differentiation",
  "Meta advertising browser attribution": "cookie_purpose_meta_browser_attribution",
  "Default PHP session identifier: associates requests with server-side session state, such as a login or shopping cart. Applications can configure a different session name.": "cookie_purpose_php_session_identifier"
});
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const MAX_SOURCE_LENGTH = 512;
const MAX_LOCALIZED_LENGTH = 1200;
const MAX_PURPOSES = 14;

function translated(translate, key, substitutions = []) {
  try {
    const value = translate(key, substitutions);
    return typeof value === "string" && value && value !== key && value.length <= MAX_LOCALIZED_LENGTH &&
      !UNSAFE_TEXT.test(value) && !value.includes("$PURPOSES$") ? value : null;
  } catch { return null; }
}

export function localizeCookiePurposeText(purpose, translate) {
  if (typeof purpose !== "string" || !purpose || purpose.length > MAX_SOURCE_LENGTH ||
      UNSAFE_TEXT.test(purpose) || typeof translate !== "function") return null;
  if (Object.hasOwn(FIXED_PURPOSES, purpose)) return translated(translate, FIXED_PURPOSES[purpose]);
  if (!purpose.startsWith(DECLARED_PREFIX) || !purpose.endsWith(".")) return null;
  const parts = purpose.slice(DECLARED_PREFIX.length, -1).split("; ");
  if (!parts.length || parts.length > MAX_PURPOSES || new Set(parts).size !== parts.length) return null;
  const localized = [];
  for (const part of parts) {
    if (!Object.hasOwn(PURPOSE_TERMS, part)) return null;
    const value = translated(translate, PURPOSE_TERMS[part]);
    if (value === null) return null;
    localized.push(value);
  }
  return translated(translate, "cookie_purpose_declared", [localized.join("; ")]);
}

export function localizeCookiePurpose(entry, translate) {
  // Own data descriptors prevent getters or coercion of unrelated metadata/value fields.
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(entry, "purpose");
    return descriptor && Object.hasOwn(descriptor, "value")
      ? localizeCookiePurposeText(descriptor.value, translate) : null;
  } catch { return null; }
}
