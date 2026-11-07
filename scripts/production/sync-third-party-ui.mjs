// ADR-029: shared live inventory and Pro projection, without changing API frame selection.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
for (const name of ['popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  if (name !== 'report.js') {
    source = source.replace('useSocial, CookiePanel, SocialPanel,', 'useSocial, useThirdParty, CookiePanel, SocialPanel, ThirdPartyPanel,');
    const state = 'social = useSocial(session, mode.mode === "light" && identificationPanel === "social"), counts';
    if (source.includes(state)) source = source.replace(state, 'social = useSocial(session, mode.mode === "light" && identificationPanel === "social"), thirdParty = useThirdParty(session, mode.mode === "light", identificationPanel === "third-party"), counts');
    source = source.replace('cookieState: cookies.state, socialState: social.state }', 'cookieState: cookies.state, socialState: social.state, thirdPartyState: thirdParty.state }');
    const opening = 'hidden: identificationPanel !== "third-party", children: [\n';
    if (!source.includes('u3(ThirdPartyPanel, { thirdParty })')) {
      if (!source.includes(opening)) throw new Error(name + ': missing Third Party panel');
      source = source.replace(opening, opening + '        u3(ThirdPartyPanel, { thirdParty }),\n');
    }
    source = source.replace('children: t3("identification_third_party") }),\n        /* @__PURE__ */ u3("p", { class: "small muted", children: t3("inspector_other_documents_desc") }),', 'children: t3("third_party_children") }),');
    source = source.replace('session.frameOverviews.filter((frame) => frame.frameId > 0)', 'session.frameOverviews.filter((frame) => frame.frameId > 0 && session.frames.some(current => current.frameId === frame.frameId && current.documentKey === frame.documentKey))');
    source = source.replace('        otherGroups.length === 0 && !session.frameOverviewsTruncated ? u3("p", { class: "inspector-empty", children: t3(session.loaded ? "identification_third_empty" : "statusLoading") }) : null\n', '');
    source = source.replace('/* @__PURE__ */ u3(FramePicker, { session, id: prefix + "-document" }),', 'identificationPanel !== "third-party" ? u3(FramePicker, { session, id: prefix + "-document" }) : null,');
  } else {
    source = source.replace('var { ProCookieSnapshot, ProSocialSnapshot, ProTagManagerSection }', 'var { ProCookieSnapshot, ProSocialSnapshot, ProTagManagerSection, ProThirdPartySnapshot }');
    if (!source.includes('u3(ProThirdPartySnapshot, { page })')) {
      const marker = '        u3(ProSocialSnapshot, { snapshots: page.socialNetworks }),';
      if (!source.includes(marker)) throw new Error('report: missing Pro inventory boundary');
      source = source.replace(marker, marker + '\n        u3(ProThirdPartySnapshot, { page }),');
    }
  }
  // Explicit owner instruction: remove editorial caveats from these views.
  source = source.replace('/* @__PURE__ */ u3("p", { id: id2 + "-hint", class: "small muted", children: t3("frame_separate_hint") }),', 'null,');
  source = source.replace('        "aria-describedby": id2 + "-hint",\n', '');
  source = source.replace(',\n              /* @__PURE__ */ u3("p", { class: "small muted", children: t3("card_vendor_not_linked") })', '');
  source = source.replace(',\n        /* @__PURE__ */ u3("p", { class: "small muted", children: t3("card_vendor_no_trust") })', '');
  source = source.replace(',\n        /* @__PURE__ */ u3("p", { class: "small muted", children: t3("disclaimerNoVerdict") })', '');
  if (process.argv.includes('--check')) { if (source !== before) throw new Error(name + ': third-party UI needs synchronization'); }
  else if (source !== before) writeFileSync(file, source);
  console.log((process.argv.includes('--check') ? 'checked ' : 'synchronized ') + name + ' third-party UI');
}
