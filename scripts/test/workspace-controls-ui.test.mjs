// Shared presentation preserves the real action nodes; it owns no state or side effects.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { createWorkspaceControlsUi } from '../../apps/production-extension/workspace-controls-ui.js';
import { provideTourButton, readTourButton } from '../../apps/production-extension/ui-tour-slot.js';

test('WorkspaceMaster retains the original control and status nodes without invoking an action', () => {
  const h = (type, props) => ({ type, props }), { WorkspaceMaster } = createWorkspaceControlsUi({ h });
  let calls = 0;
  const control = h('button', { 'data-existing-action': true, role: 'switch', 'aria-checked': false, disabled: true, onClick: () => calls++, children: 'OFF' });
  const status = h('p', { role: 'status', children: 'Pending local draft' });
  const result = WorkspaceMaster({ id: 'fixture', label: 'Fixture', control, children: status, busy: true });
  assert.equal(result.type, 'header'); assert.equal(result.props['data-workspace-master'], 'fixture'); assert.equal(result.props['aria-busy'], true);
  assert.equal(result.props.children[1].props.children, control); assert.equal(result.props.children[2].props.children, status);
  assert.equal(control.props.disabled, true); assert.equal(control.props['aria-checked'], false); assert.equal(calls, 0);
});

test('WorkspaceMaster supports an existing labelled heading and unknown/loading controls without inventing a switch', () => {
  const h = (type, props) => ({ type, props }), { WorkspaceMaster } = createWorkspaceControlsUi({ h });
  const label = h('h2', { id: 'existing-heading', dir: 'ltr', children: 'Existing title' });
  const result = WorkspaceMaster({ id: 'fixture', label });
  assert.equal(result.props.children[0].props.children, label); assert.equal(result.props.children[1], null); assert.equal(result.props.children[2], null);
});

test('master card CSS parses for both engines, stays internal and explicitly keeps dormant endpoints hidden', async () => {
  const css = readFileSync(new URL('../../apps/production-extension/workspace-controls-ui.css', import.meta.url), 'utf8');
  const parsed = await transform(css, { loader: 'css', target: ['chrome153', 'firefox138'] }); assert.deepEqual(parsed.warnings, []);
  assert.doesNotMatch(css, /(?:^|\})\s*(?:body|:root|\.inspector|\.protect|\.fw)\s*\{/u);
  assert.match(css, /\.management-shell \.workspace-master \[hidden\] \{ display: none !important;/u);
  assert.doesNotMatch(css, /(?:transform|filter)\s*:/u);
});

// ADR-111: the header cluster. Compact tools, the shared Tour button, then the module switch, in one row; no strip under the header.
const h = (type, props) => ({ type, props });
function ShellTourButton() { return null; }
const withShellButton = run => { provideTourButton(ShellTourButton); try { return run(); } finally { provideTourButton(null); } };
test('WorkspaceMaster draws one cluster at the end of the header: tools, then the Tour button of its own section, then the switch; the button is the one the shell registered', () => withShellButton(() => {
  const { WorkspaceMaster, ToolButton } = createWorkspaceControlsUi({ h });
  const control = h('button', { role: 'switch', 'data-existing-action': true, children: 'OFF' }), refresh = ToolButton({ icon: 'refresh', label: 'Refresh', 'data-test-refresh': true, onClick() {} });
  const result = WorkspaceMaster({ id: 'proxy', label: 'Proxy', control, tools: refresh });
  const cluster = result.props.children[1];
  assert.match(cluster.props.class, /^workspace-master__control workspace-tools$/u);
  assert.deepEqual(cluster.props.children.map(node => node.type === ShellTourButton ? 'tour:' + node.props.tour : node === control ? 'switch' : node === refresh ? 'refresh' : '?'), ['refresh', 'tour:proxy', 'switch'], 'the Tour button sits immediately before the switch, tools before it');
  const several = WorkspaceMaster({ id: 'proxy', label: 'Proxy', tools: [refresh, ToolButton({ icon: 'export', label: 'Export' })], control: [control, null] }).props.children[1].props.children;
  assert.deepEqual(several.map(node => node.type === ShellTourButton ? 'tour' : node.props['aria-label'] ?? 'switch'), ['Refresh', 'Export', 'tour', 'switch'], 'several tools and several controls flatten into one row, nothing null');
  assert.equal(WorkspaceMaster({ id: 'proxy', label: 'Proxy', control, tour: false }).props.children[1].props.children, control, 'without a tour a lone control is exactly the plain header');
  const waiting = WorkspaceMaster({ id: 'antidetect', label: 'Antidetect', tools: refresh, reserve: true }).props.children[1].props.children;
  assert.deepEqual(waiting.map(node => node.props.class ?? node.type.name), ['button workspace-tool workspace-tool--icon', 'ShellTourButton', 'workspace-master__placeholder'], 'the room of a switch that is not drawn yet is kept, so the buttons do not jump');
  assert.equal(waiting.at(-1).props['aria-hidden'], 'true');
  assert.equal(WorkspaceMaster({ id: 'antidetect', label: 'Antidetect', control, reserve: true }).props.children[1].props.children.some(node => node.props?.class === 'workspace-master__placeholder'), false, 'the placeholder gives way to the real switch');
}));

test('the Tour button is read from the slot when a header is drawn, not when the section is built; a page without a shell button draws the plain header', () => {
  const control = h('button', { role: 'switch', children: 'OFF' });
  provideTourButton(null);
  const { WorkspaceMaster } = createWorkspaceControlsUi({ h }); // built before the shell registered anything, as the sections of the popup and the Options page are
  assert.equal(WorkspaceMaster({ id: 'proxy', label: 'Proxy', control }).props.children[1].props.children, control, 'no shell button: exactly the plain header');
  assert.equal(WorkspaceMaster({ id: 'proxy', label: 'Proxy' }).props.children[1], null, 'no control, no tools, no tour: no cluster at all');
  withShellButton(() => assert.deepEqual(WorkspaceMaster({ id: 'proxy', label: 'Proxy', control }).props.children[1].props.children.map(node => node.type === ShellTourButton ? 'tour' : 'switch'), ['tour', 'switch'], 'registered later, drawn from then on'));
  assert.equal(readTourButton(), null, 'the helper released the slot');
  for (const bad of [undefined, 'button', {}, 42, true]) { provideTourButton(ShellTourButton); provideTourButton(bad); assert.equal(readTourButton(), null, 'only a function is kept: ' + typeof bad); }
  // A caller's own button (the unit tests of a section) wins over the shell's, and the shell's is not needed for it.
  function OwnButton() { return null; }
  const own = createWorkspaceControlsUi({ h, TourButton: OwnButton }).WorkspaceMaster({ id: 'proxy', label: 'Proxy', control }).props.children[1].props.children;
  assert.deepEqual(own.map(node => node.type === OwnButton ? 'own' : 'switch'), ['own', 'switch']);
});

test('ToolButton is an icon-only button: one decorative glyph, the label is both the accessible name and the tooltip, every other property belongs to the caller', () => {
  const h = (type, props) => ({ type, props }), { ToolButton } = createWorkspaceControlsUi({ h });
  const calls = [], button = ToolButton({ icon: 'export', label: 'Export profile metadata', disabled: true, onClick: () => calls.push('click'), 'data-proxy-export': true, className: 'extra' });
  assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button'); assert.equal(button.props['aria-label'], 'Export profile metadata'); assert.equal(button.props.title, 'Export profile metadata');
  assert.equal(button.props.class, 'button workspace-tool workspace-tool--icon extra'); assert.equal(button.props.disabled, true); assert.equal(button.props['data-proxy-export'], true);
  button.props.onClick(); assert.deepEqual(calls, ['click']);
  const glyph = button.props.children; assert.equal(glyph.type, 'svg'); assert.equal(glyph.props['aria-hidden'], 'true'); assert.equal(glyph.props['data-tool-glyph'], 'export'); assert.equal(glyph.props.focusable, 'false');
  for (const name of ['refresh', 'export', 'tour']) assert.ok(ToolButton({ icon: name, label: name }).props.children?.props.children.length >= 1, name + ' has a glyph');
  assert.equal(ToolButton({ icon: 'unknown', label: 'x' }).props.children, null, 'an unknown glyph draws nothing but the button keeps its name');
});

test('header cluster CSS: one nowrap row, a quiet icon-only tool, the label hidden (not removed) in narrow windows, the Firewall Tour button a child of the launcher row between its title and its 46px switch, logical properties only', () => {
  const css = readFileSync(new URL('../../apps/production-extension/workspace-controls-ui.css', import.meta.url), 'utf8');
  const rule = selector => { const start = css.indexOf(selector + ' {'); assert.ok(start >= 0, selector); return css.slice(start, css.indexOf('}', start)); };
  assert.match(rule('.management-shell .workspace-tools'), /flex-wrap: nowrap/u); assert.match(rule('.management-shell .workspace-tools'), /justify-content: flex-end/u);
  assert.match(rule(':root:root[data-ui-theme] body #root#root .management-shell .workspace-tool'), /min-height: 32px/u); assert.match(rule(':root:root[data-ui-theme] body #root#root .management-shell .workspace-tool--icon'), /width: 32px/u);
  assert.match(rule('.management-shell .workspace-master__placeholder'), /width: 46px; height: 28px/u, 'the room of the switch (46 x 28 in every palette)');
  const narrow = css.slice(css.indexOf('@media (max-width: 560px)'), css.indexOf('@media (max-width: 480px)'));
  assert.match(narrow, /\.workspace-tool__label \{ position: absolute; width: 1px; height: 1px;[^}]*clip-path: inset\(50%\)/u, 'visually hidden, still in the accessibility tree'); assert.doesNotMatch(narrow, /display: none/u);
  assert.match(narrow, /\.workspace-tool--tour \{ width: 32px; padding: 0; \}/u);
  // The Firewall header (ADR-111): the module draws it and the shell's Tour button is a child of its row (`toolSlot`), so nothing places the button from outside any more:
  // no neighbour of the launcher, no absolute position, no offset that had to equal the switch (46 px) plus the gap, nothing anchored to the header.
  assert.doesNotMatch(css, /workspace-master--firewall\s*>\s*\.workspace-tool/u, 'no rule for a neighbour of the launcher');
  assert.doesNotMatch(css, /inset-inline-end: 54px/u, 'no offset that had to follow the switch'); assert.doesNotMatch(css, /\.workspace-master--firewall \{ position: relative/u, 'nothing is anchored to the Firewall header');
  assert.doesNotMatch(css, /workspace-master--firewall[^{]*\{[^}]*position: absolute/u, 'no absolute position in the Firewall header');
  const host = readFileSync(new URL('../../apps/production-extension/workspace-controls-host.css', import.meta.url), 'utf8');
  const hostRule = selector => { const start = host.indexOf(selector + ' {'); assert.ok(start >= 0, selector); return host.slice(start, host.indexOf('}', start)); };
  const row = hostRule('.management-shell .workspace-master--firewall .blocking-launcher__controls');
  assert.match(row, /display: flex/u, 'the row is flex, so one, two or three children share it'); assert.match(row, /flex-wrap: nowrap/u, 'and it never wraps'); assert.match(row, /align-items: center/u); assert.match(row, /gap: 8px/u, 'Tour button and switch are 8 px apart, as in every other header cluster');
  assert.doesNotMatch(row, /grid-template-columns/u, 'no fixed two-column grid: the Tour button is the third child');
  assert.match(hostRule('.management-shell .workspace-master--firewall .blocking-launcher__controls > :not(.blocking-launcher__open)'), /flex: none/u, 'the Tour button and the switch keep their size');
  const title = hostRule(':root body .management-shell .workspace-master--firewall .blocking-launcher__open');
  assert.match(title, /flex: 1 1 auto/u, 'the title takes the free room'); assert.match(title, /min-width: 0/u, 'and may shrink, so a narrow window never pushes the switch out');
  const redesign = readFileSync(new URL('../../apps/production-extension/redesign.css', import.meta.url), 'utf8');
  assert.ok(redesign.includes('.workspace-master :is(.blocking-master, .workspace-master-toggle, [role=switch]) { width: 46px; min-width: 46px; max-width: 46px; height: 28px; min-height: 28px; }'), 'the switch is 46 x 28 in every palette, which the row relies on');
  // The island is outside the host's hover and press rules, so the Tour button in it gets the same ones of its own (paint-only transition, a momentary press below 1).
  const motion = redesign.slice(redesign.indexOf('@media screen and (prefers-reduced-motion: no-preference) {'));
  assert.match(motion, /body #root#root \.protect-island \.workspace-tool--tour \{ transition-property: color, background-color, border-color, box-shadow, opacity; transition-duration: var\(--rd-dur-1\); transition-timing-function: var\(--rd-ease-out\); \}/u, 'the Tour button in the island fades like the others');
  assert.match(motion, /body #root#root \.protect-island \.workspace-tool--tour:not\(:disabled\):not\(\[aria-disabled=true\]\):active \{ transform: scale\(\.97\); \}/u, 'and has the same momentary press');
  assert.match(rule(':root:root[data-ui-theme] body #root#root .management-shell .cookies-workspace-actions > .workspace-tool--tour'), /margin-inline-start: auto/u, 'the Cookies Tour button ends the full-width action row of narrow windows');
  assert.doesNotMatch(css, /workspace-secondary-actions/u, 'the strip is gone');
  const added = css.slice(css.indexOf('/* ADR-111')); assert.doesNotMatch(added, /\b(?:margin|padding|border)-(?:left|right)\b|(?<![-a-z])(?:left|right):\s*[0-9]|text-align:\s*(?:left|right)|float:\s*(?:left|right)/u, 'right-to-left: logical properties only');
  assert.match(css, /\.workspace-titlebar > \.workspace-tools[^{]*\{ margin-inline-start: auto; \}/u);
});
