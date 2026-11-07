// Shared, local UI preference control; storage/application belongs to the controller.
import { THEME_IDS, getThemeSnapshot, subscribeTheme, setTheme, initializeTheme } from './theme-controller.js';
import { getThemeLabels } from './theme-labels.js';

let nextPicker = 0;
const defaults = { getThemeSnapshot, subscribeTheme, setTheme, initializeTheme };
export function createThemePicker({ h, useState, useEffect, useRef, useLocale, themeController = defaults }) {
  function ThemePicker() {
    const locale = useLocale(), labels = getThemeLabels(locale), rtl = /^(ar|ur)(?:[-_]|$)/iu.test(typeof locale === 'string' ? locale : locale?.id ?? '');
    const [snapshot, setSnapshot] = useState(() => themeController.getThemeSnapshot());
    const [open, setOpen] = useState(false), [focusIndex, setFocusIndex] = useState(0), [error, setError] = useState(null), [pendingState, setPendingState] = useState(false);
    const root = useRef(null), trigger = useRef(null), panel = useRef(null), items = useRef([]);
    const mounted = useRef(false), opened = useRef(false), generation = useRef(0), pending = useRef(false), latest = useRef(snapshot), recoveryFrame = useRef(null);
    const identity = useRef(null); if (identity.current === null) identity.current = 'theme-picker-menu-' + ++nextPicker;
    latest.current = snapshot;
    const selectedId = THEME_IDS.includes(snapshot.id) ? snapshot.id : 'system';
    const disabled = snapshot.saving || !snapshot.ready || pendingState;

    function close(restore = false) {
      if (!opened.current) return;
      opened.current = false; ++generation.current; setOpen(false);
      if (recoveryFrame.current !== null) { cancelAnimationFrame(recoveryFrame.current); recoveryFrame.current = null; }
      if (restore) try { trigger.current?.focus({ preventScroll: true }); } catch { /* The view can close. */ }
    }
    function show(index = THEME_IDS.indexOf(selectedId)) {
      opened.current = true; ++generation.current; setFocusIndex(index < 0 ? 0 : index); setOpen(true);
    }
    useEffect(() => {
      mounted.current = true;
      const unsubscribe = themeController.subscribeTheme(next => {
        if (!mounted.current) return;
        const value = next ?? themeController.getThemeSnapshot(); latest.current = value; setSnapshot(value); if (!value.error) setError(null);
      });
      void (async () => { try { await themeController.initializeTheme(); } catch { if (mounted.current) setError('read-failed'); } })();
      return () => { mounted.current = false; opened.current = false; ++generation.current; if (recoveryFrame.current !== null) cancelAnimationFrame(recoveryFrame.current); unsubscribe(); };
    }, []);

    const openGeneration = generation.current;
    useEffect(() => {
      const element = panel.current;
      if (!open || !element || !mounted.current || !opened.current || openGeneration !== generation.current) return undefined;
      const document = globalThis.document, window = globalThis.window;
      const position = () => {
        if (!mounted.current || !opened.current || openGeneration !== generation.current) return;
        const box = trigger.current?.getBoundingClientRect(); if (!box) return;
        const width = window?.innerWidth || document?.documentElement?.clientWidth || 320;
        const height = window?.innerHeight || document?.documentElement?.clientHeight || 600;
        const gutter = Math.min(8, width / 4), panelWidth = Math.max(1, Math.min(304, width - gutter * 2));
        const left = Math.max(gutter, Math.min(rtl ? box.left : box.right - panelWidth, width - panelWidth - gutter));
        const below = Math.max(0, height - box.bottom - gutter * 2), above = Math.max(0, box.top - gutter * 2);
        const wholeViewport = Math.max(below, above) < 160, upwards = above > below && below < 260;
        const maxHeight = Math.max(1, wholeViewport ? height - gutter * 2 : upwards ? above : below);
        element.style.width = panelWidth + 'px'; element.style.maxHeight = maxHeight + 'px';
        const panelHeight = Math.min(element.scrollHeight || maxHeight, maxHeight);
        element.style.left = left + 'px';
        element.style.top = Math.max(gutter, wholeViewport ? gutter : upwards ? box.top - gutter - panelHeight : box.bottom + gutter) + 'px';
      };
      const outside = event => { if (event.type === 'focusin' && pending.current && event.target === document?.body) return; if (!root.current?.contains(event.target)) close(false); };
      const keydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
      const toggle = event => { if (event.newState === 'closed' && openGeneration === generation.current) close(false); };
      element.addEventListener?.('toggle', toggle);
      try {
        if (typeof element.showPopover === 'function') element.showPopover();
        else element.setAttribute('data-theme-popover-fallback', '');
      } catch { element.setAttribute('data-theme-popover-fallback', ''); }
      position();
      const frame = requestAnimationFrame(() => {
        if (mounted.current && opened.current && openGeneration === generation.current) { items.current[focusIndex]?.focus({ preventScroll: true }); position(); }
      });
      document?.addEventListener('pointerdown', outside, true); document?.addEventListener('focusin', outside, true); document?.addEventListener('keydown', keydown, true);
      window?.addEventListener('resize', position); window?.addEventListener('scroll', position, true);
      return () => {
        cancelAnimationFrame(frame);
        document?.removeEventListener('pointerdown', outside, true); document?.removeEventListener('focusin', outside, true); document?.removeEventListener('keydown', keydown, true);
        window?.removeEventListener('resize', position); window?.removeEventListener('scroll', position, true);
        element.removeEventListener?.('toggle', toggle);
        try { element.hidePopover?.(); } catch { /* Already dismissed or detached. */ }
      };
    }, [open, rtl, openGeneration]);

    async function choose(id) {
      if (!mounted.current || !opened.current || pending.current || latest.current.saving || !latest.current.ready) return;
      const before = generation.current, index = THEME_IDS.indexOf(id), chosenElement = items.current[index]; pending.current = true; setPendingState(true); setError(null);
      let saved = false;
      try { await themeController.setTheme(id); saved = true; }
      catch { if (mounted.current) setError('save-failed'); }
      finally { pending.current = false; if (mounted.current) setPendingState(false); }
      if (saved && mounted.current && opened.current && before === generation.current) close(true);
      else if (!saved && mounted.current && opened.current && before === generation.current) recoveryFrame.current = requestAnimationFrame(() => {
        recoveryFrame.current = null;
        if (!mounted.current || !opened.current || before !== generation.current) return;
        const document = globalThis.document, active = document?.activeElement;
        if (!active || active === document.body || active === document.documentElement || active === chosenElement) items.current[index]?.focus({ preventScroll: true });
      });
    }
    function navigate(event, index) {
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = THEME_IDS.length - 1;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') next = (index + (event.key === 'ArrowDown' ? 1 : -1) + THEME_IDS.length) % THEME_IDS.length;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = (index + (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1) + THEME_IDS.length) % THEME_IDS.length;
      else return;
      event.preventDefault(); if (disabled) return;
      setFocusIndex(next); items.current[next]?.focus({ preventScroll: true }); items.current[next]?.scrollIntoView?.({ block: 'nearest' });
    }
    const failure = error ?? snapshot.error;
    const icon = h('svg', { viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'aria-hidden': true, focusable: false, children: [h('path', { d: 'M12 3a9 9 0 1 0 0 18h1.2a2.3 2.3 0 0 0 1.6-3.9 1.5 1.5 0 0 1 1.1-2.6H18A3 3 0 0 0 21 11a9 9 0 0 0-9-8Z' }), ...[[7.5, 11], [10, 7.5], [14.5, 7.5], [17, 11]].map(([cx, cy]) => h('circle', { cx, cy, r: .8, fill: 'currentColor', stroke: 'none' }))] });
    return h('div', { class: 'theme-picker', 'data-theme-picker': true, dir: rtl ? 'rtl' : 'ltr', ref: root, children: [
      h('button', { type: 'button', class: 'theme-picker__trigger', 'data-theme-trigger': true, 'aria-label': labels.theme + ': ' + labels[selectedId], title: labels.theme + ': ' + labels[selectedId], 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': identity.current, onClick: () => opened.current ? close(true) : show(), onKeyDown: event => {
        if (event.key === 'Escape' && opened.current) { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); show(event.key === 'ArrowUp' || event.key === 'End' ? THEME_IDS.length - 1 : 0); }
      }, ref: trigger, children: icon }),
      open ? h('div', { class: 'theme-picker__panel', popover: 'auto', id: identity.current, ref: panel, children: [
        h('div', { class: 'theme-picker__heading', children: labels.theme }),
        h('div', { class: 'theme-picker__options', role: 'menu', 'aria-label': labels.theme, 'aria-busy': Boolean(disabled), children: THEME_IDS.map((id, index) => h('button', { type: 'button', role: 'menuitemradio', class: 'theme-picker__option', 'data-theme-option': id, 'aria-checked': selectedId === id, disabled, tabIndex: index === focusIndex ? 0 : -1, ref: element => { items.current[index] = element; }, onFocus: () => setFocusIndex(index), onKeyDown: event => navigate(event, index), onClick: () => choose(id), key: id, children: [
          h('span', { class: 'theme-picker__preview theme-picker__preview--' + id, 'aria-hidden': true, children: [h('span', { class: 'theme-picker__preview-rail' }), h('span', { class: 'theme-picker__preview-lines', children: [h('i', {}), h('i', {}), h('i', {})] }), h('span', { class: 'theme-picker__preview-dot' })] }),
          h('span', { class: 'theme-picker__option-label', children: labels[id] }), h('span', { class: 'theme-picker__check', 'aria-hidden': true, children: selectedId === id ? '✓' : '' })
        ] })) }),
        failure ? h('p', { class: 'theme-picker__error', role: 'alert', children: failure === 'read-failed' ? labels.loadFailed : labels.saveFailed }) : null
      ] }) : null
    ] });
  }
  return { ThemePicker };
}
