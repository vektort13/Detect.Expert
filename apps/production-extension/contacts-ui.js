import { CONTACT_LINKS } from './contacts-data.js';
import { contactsLabels } from './contacts-labels.js';
import { createTourEntry } from './ui-tour.js';

const IDLE = Object.freeze({ id: null, status: 'idle', epoch: -1 });
const destinations = new Map(CONTACT_LINKS.map(link => [link.id, link.href]));

export function createContactCopyController({ onChange, isActive = () => true, getEpoch = () => 0, getClipboard = () => globalThis.navigator?.clipboard, timeout = 4000 } = {}) {
  let disposed = false, revision = 0, slot = null;
  const emit = value => { try { onChange?.(Object.freeze(value)); } catch { /* A detached view cannot affect the native write. */ } };
  const valid = (operation, epoch) => !disposed && isActive() && getEpoch() === epoch && revision === operation;
  function copy(id) {
    if (disposed || !isActive() || !destinations.has(id)) return Promise.resolve(false);
    const epoch = getEpoch(), operation = ++revision;
    if (slot) { emit({ id, status: 'error', epoch }); return Promise.resolve(false); }
    let clipboard, native;
    try {
      clipboard = getClipboard();
      if (typeof clipboard?.writeText !== 'function') throw Error('unavailable');
      // Keep the native call in the original click's user-activation stack.
      native = clipboard.writeText(destinations.get(id));
    } catch {
      if (valid(operation, epoch)) emit({ id, status: 'error', epoch });
      return Promise.resolve(false);
    }
    const token = { timer: null, timedOut: false };
    slot = token;
    emit({ id, status: 'copying', epoch });
    token.timer = setTimeout(() => {
      token.timedOut = true;
      if (valid(operation, epoch)) emit({ id, status: 'error', epoch });
    }, timeout);
    return Promise.resolve(native).then(() => {
      if (!token.timedOut && valid(operation, epoch)) emit({ id, status: 'copied', epoch });
      return !token.timedOut;
    }, () => {
      if (valid(operation, epoch)) emit({ id, status: 'error', epoch });
      return false;
    }).finally(() => {
      clearTimeout(token.timer);
      if (slot === token) slot = null;
    });
  }
  return Object.freeze({ copy, dispose() { disposed = true; revision++; if (slot) clearTimeout(slot.timer); } });
}

export const CONTACT_SOCIAL_SERVICES = Object.freeze([
  Object.freeze({ id: 'telegram', name: 'Telegram', color: 'blue' }),
  Object.freeze({ id: 'discord', name: 'Discord', color: 'indigo' }),
  Object.freeze({ id: 'github', name: 'GitHub', color: 'violet' }),
  Object.freeze({ id: 'youtube', name: 'YouTube', color: 'rose' }),
]);

export function createContactsUi({ h, useState, useEffect, useRef, useLocale, translate }) {
  const { TourButton } = createTourEntry({ h, useState, useEffect, useLocale });
  function icon(name, className = '') {
    const paths = {
      sites: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
      social: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-8a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87',
      identity: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 17a4 4 0 0 1 8 0m-1-8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      fingerprint: 'M5 9a7 7 0 0 1 14 1v3m-10 6v-9a3 3 0 0 1 6 0v8M5 13v3m0 4v1m4 0v-2m3-9v12m7-5v3m-3 1v1',
      education: 'm2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6m4-2v8',
      wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01',
      copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
      check: 'm5 12 4 4L19 6',
      open: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
    };
    return h('svg', { class: 'contacts-icon ' + className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true, focusable: 'false', children: h('path', { d: paths[name] }) });
  }
  function mark(link) {
    const social = CONTACT_SOCIAL_SERVICES.some(service => service.id === link.icon);
    const file = link.icon === 'detect' ? 'brand-symbol.svg' : social ? 'icons/contacts/' + link.icon + '.svg' : null;
    return h('span', { class: 'contacts-mark contacts-mark--' + link.color + (file ? link.icon === 'detect' ? ' contacts-mark--vector' : ' contacts-mark--brand contacts-mark--' + link.icon : ''), 'aria-hidden': true, children: file ? h('img', { src: file, alt: '', width: 28, height: 28, draggable: false }) : icon(link.icon) });
  }
  function flag(code) {
    if (code !== 'cn') return h('img', { src: 'icons/countries/' + code + '.svg', alt: '', width: 18, height: 13, draggable: false });
    return h('svg', { class: 'contacts-flag', viewBox: '0 0 30 20', 'aria-hidden': true, focusable: 'false', children: [
      h('path', { fill: '#de2910', d: 'M0 0h30v20H0z' }),
      h('path', { fill: '#ffde00', d: 'm5 2 .7 2.1H8L6.15 5.4l.7 2.2L5 6.3 3.15 7.6l.7-2.2L2 4.1h2.3Z' }),
      ...[[10, 2, 23], [12, 4, 46], [12, 7, 70], [10, 9, 22]].map(([x, y, angle]) => h('path', { fill: '#ffde00', d: 'm0-1 .24.7h.76l-.62.45.24.73L0 .43l-.62.45.24-.73L-1-.3h.76Z', transform: 'translate(' + x + ' ' + y + ') rotate(' + angle + ')' })),
    ] });
  }
  function ContactsApp({ active = true }) {
    const locale = useLocale(), t = contactsLabels(locale);
    const [copyState, setCopyState] = useState(IDLE);
    const lifetime = useRef({ active, epoch: 0 }), controller = useRef(null);
    if (lifetime.current.active !== active) lifetime.current = { active, epoch: lifetime.current.epoch + 1 };
    if (!controller.current) controller.current = createContactCopyController({ onChange: setCopyState, isActive: () => lifetime.current.active, getEpoch: () => lifetime.current.epoch });
    useEffect(() => () => controller.current.dispose(), []);
    const state = active && copyState.epoch === lifetime.current.epoch ? copyState : IDLE;
    const label = link => t[link.label] ?? link.label;
    const named = link => label(link) + (link.language ? ' · ' + link.language.name : '');
    const copied = CONTACT_LINKS.find(link => link.id === state.id);
    const card = (link, heading = 'h4') => h('article', { key: link.id, class: 'contacts-card' + (state.id === link.id && state.status === 'copied' ? ' is-copied' : ''), 'data-contact': link.id, children: [
      h('a', { class: 'contacts-card__link', href: link.href, target: '_blank', rel: 'noopener noreferrer', 'data-contact-link': link.id, children: [mark(link), h('div', { class: 'contacts-card__body', children: [h(heading, { class: 'contacts-card__title', children: [label(link), link.language ? h('span', { class: 'contacts-language', children: [flag(link.language.flag), h('bdi', { children: link.language.name })] }) : null] }), h('code', { class: 'contacts-card__url', dir: 'ltr', children: link.href.replace(/^https:\/\//u, '').replace(/\/$/u, '') })] }), icon('open', 'contacts-card__open')] }),
      h('button', { type: 'button', class: 'contacts-copy' + (state.id === link.id && state.status === 'copying' ? ' is-copying' : ''), title: state.id === link.id && state.status === 'copied' ? t.copied : t.copy, 'aria-label': (state.id === link.id && state.status === 'copied' ? t.copied : t.copy) + ': ' + named(link), disabled: !active || state.status === 'copying', 'aria-busy': state.id === link.id && state.status === 'copying', 'data-contact-copy': link.id, 'data-contact-copy-state': state.id === link.id ? state.status : 'idle', onClick: () => controller.current.copy(link.id), children: icon(state.id === link.id && state.status === 'copied' ? 'check' : 'copy') }),
      state.id === link.id && state.status === 'error' ? h('small', { class: 'contacts-error', role: 'alert', 'data-contact-copy-error': link.id, children: t.copyFailed }) : null,
    ] });
    return h('main', { class: 'management-contacts contacts-workspace', 'data-contacts-app': true, children: [
      h('header', { class: 'contacts-header', children: [h('h2', { class: 'management-page-title', children: translate('management_tab_contacts') }), h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': true, children: state.status === 'copied' && copied ? t.copied + ': ' + named(copied) : '' }), h('div', { class: 'workspace-tools', children: h(TourButton, { tour: 'contacts' }) })] }),
      ...['sites', 'social'].map(group => h('section', { key: group, class: 'contacts-group contacts-group--' + group, 'aria-labelledby': 'contacts-' + group, 'data-contacts-group': group, children: [
        h('header', { class: 'contacts-group__header', children: [h('span', { class: 'contacts-group__icon', children: icon(group) }), h('h3', { id: 'contacts-' + group, children: t[group] }), h('small', { class: 'badge contacts-count', children: CONTACT_LINKS.filter(link => link.group === group).length })] }),
        group === 'social' ? h('div', { class: 'contacts-social-groups', children: CONTACT_SOCIAL_SERVICES.map(service => {
          const links = CONTACT_LINKS.filter(link => link.group === 'social' && link.icon === service.id);
          return h('section', { key: service.id, class: 'contacts-social-group contacts-social-group--' + service.id, 'data-contacts-service': service.id, 'aria-labelledby': 'contacts-service-' + service.id, children: [
            h('header', { class: 'contacts-social-group__header', children: [mark({ icon: service.id, color: service.color }), h('h4', { id: 'contacts-service-' + service.id, children: service.name }), h('small', { class: 'badge contacts-count', children: links.length })] }),
            h('div', { class: 'contacts-social-list', children: links.map(link => card(link, 'h5')) }),
          ] });
        }) }) : h('div', { class: 'contacts-grid', children: CONTACT_LINKS.filter(link => link.group === group).map(link => card(link)) }),
      ] })),
    ] });
  }
  return { ContactsApp };
}
