// Presentation only: callers retain their original control nodes, handlers and state.
// ADR-111: the header of a module is one row, title at the start and one cluster at the end: compact tools (icon-only actions such as
// Refresh), then the shared Tour button, then the module switch. The master header draws the Tour button of its own section by itself when the
// Options shell has registered one (ui-tour-slot.js); on a page without a tour layer (popup, side panel, API page) it is exactly the plain header,
// and this module imports nothing of the tour itself.
import { readTourButton } from './ui-tour-slot.js';
import { workspaceToolIcon } from './workspace-tool-icons.js';

/** `TourButton` is for a caller that has its own button (tests); the shell's, read when a header is drawn, is the usual one. */
export function createWorkspaceControlsUi({ h, TourButton: own = null }) {
  /** An icon-only action of a header cluster. The name and the tooltip are `label`; every other property (handlers, data-* hooks, disabled) is the caller's. */
  function ToolButton({ icon, label, className = '', ...props }) {
    return h('button', { type: 'button', ...props, class: 'button workspace-tool workspace-tool--icon' + (className ? ' ' + className : ''), 'aria-label': label, title: label, children: workspaceToolIcon(h, icon) });
  }
  function WorkspaceMaster({ id, label, control = null, tools = null, children = null, busy = false, className = '', tour = true, reserve = false }) {
    const TourButton = tour ? own ?? readTourButton() : null;
    // `reserve` keeps the room of a switch that is not drawn yet, so the buttons beside it do not jump when it appears.
    const cluster = [tools, TourButton ? h(TourButton, { tour: id }) : null, control, reserve && !control ? h('span', { class: 'workspace-master__placeholder', 'aria-hidden': 'true' }) : null].flat().filter(Boolean);
    return h('header', { class: 'workspace-master' + (className ? ' ' + className : ''), 'data-workspace-master': id, 'aria-busy': busy, children: [
      h('div', { class: 'workspace-master__label', children: typeof label === 'string' ? h('h2', { children: label }) : label }),
      cluster.length ? h('div', { class: 'workspace-master__control workspace-tools', children: cluster.length === 1 ? cluster[0] : cluster }) : null,
      children ? h('div', { class: 'workspace-master__state', children }) : null,
    ] });
  }
  return { WorkspaceMaster, ToolButton };
}
