// Options host for the existing Inspector; the imported bundle owns its renderer/hooks.
export const validDetectorTabId = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
export function detectorSourceTabId(search) {
  try { const values = new URLSearchParams(search).getAll('tabId'); return values.length === 1 && /^(0|[1-9][0-9]{0,9})$/u.test(values[0]) && validDetectorTabId(Number(values[0])) ? Number(values[0]) : null; } catch { return null; }
}
const webTab = tab => {
  if (!tab || !validDetectorTabId(tab.id) || typeof tab.url !== 'string') return null;
  try { const url = new URL(tab.url); return ['http:', 'https:'].includes(url.protocol) ? { id: tab.id, url: tab.url, label: url.hostname + ' · #' + tab.id } : null; } catch { return null; }
};
export async function resolveDetectorSourceTab(api, tabId) {
  if (!validDetectorTabId(tabId)) return { id: null, url: undefined };
  try { const tab = webTab(await api.tabs.get(tabId)); return tab?.id === tabId ? { id: tab.id, url: tab.url } : { id: null, url: undefined }; } catch { return { id: null, url: undefined }; }
}
export function detectorTabChoices(tabs) {
  const found = new Map();
  if (Array.isArray(tabs)) for (const row of tabs.slice(0, 1024)) { const tab = webTab(row); if (tab && !found.has(tab.id)) found.set(tab.id, { id: tab.id, label: tab.label }); }
  return [...found.values()].sort((left, right) => left.label.localeCompare(right.label, 'en'));
}
export {DETECTOR_LABELS,detectorLabels} from './detector-workspace-labels.js';
import {detectorLabels} from './detector-workspace-labels.js';
import {readObservationControl,createObservationControl} from './observation-control.js';
import {reloadDetectorSource,readDetectorMovementAuthorization} from './detector-source-controller.js';
import {openManagement} from './management-navigation.js';
import {createDetectorPointerUi} from './detector-pointer-ui.js';
import {createDetectorMovementController} from './detector-movement-controller.js';
import {createDetectorHistoryUi} from './detector-history-ui.js';
import {readTourButton} from './ui-tour-slot.js';

export function createDetectorUi({ h, useState, useEffect, useRef, useLocale, translate = key => key, browserApi = globalThis.chrome, importInspector = () => import('./popup.js') }) {
  const nativeNavigation = globalThis.browser?.webNavigation;
  const getNativeFrames = typeof nativeNavigation?.getAllFrames === 'function' ? request => nativeNavigation.getAllFrames(request) : undefined;
  let imported = null, importing = null;
  const loadInspector = async () => {
    if (imported) return imported;
    if (!importing) importing = Promise.resolve().then(importInspector).then(module => { imported = module; return module; }).finally(() => { importing = null; });
    return importing;
  };
  const ObservationControl = createObservationControl({h,useState,useEffect,useRef,useLocale,translate,browserApi});
  const {PointerActivity} = createDetectorPointerUi({h,useLocale});
  const {DetectorHistory} = createDetectorHistoryUi({h,useState,useEffect,useRef,useLocale,browserApi,translate,getHistoryStore:async()=> (await loadInspector()).getProReportHistory()});
  const usable = value => !!value?.report && value.available === true && value.loaded === true && typeof value.report.documentKey === 'string' && value.report.documentKey.length > 0 && ['active','partial','late-start','degraded'].includes(value.report.coverageState);
  function DetectorApp({ active = true, tabId = null }) {
    const labels = detectorLabels(useLocale()), [choices, setChoices] = useState([]), [selected, setSelected] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(null);
    const [observation,setObservation] = useState(null), [observationError,setObservationError] = useState(false), [snapshot,setSnapshot] = useState(null), [reloading,setReloading] = useState(false), [notice,setNotice] = useState(null), [movement,setMovement] = useState(null);
    const host = useRef(null), workspace = useRef(null), sourceSelect = useRef(null), alive = useRef(false), visible = useRef(active), generation = useRef(0), selection = useRef(null), incoming = useRef(undefined), reloadTask = useRef(null), latest = useRef(null);
    visible.current = active; selection.current = selected;
    latest.current = {active,selected,observation,snapshot};
    const fresh = token => alive.current && visible.current && generation.current === token;
    const cancelReload = () => { reloadTask.current?.abort(); reloadTask.current = null; setReloading(false); };
    useEffect(() => { alive.current = true; return () => { alive.current = false; ++generation.current; reloadTask.current?.abort(); }; }, []);
    async function refresh() {
      if (!alive.current || !visible.current) return;
      const token = ++generation.current; setLoading(true); setError(null);
      const provided = validDetectorTabId(tabId) ? tabId : detectorSourceTabId(globalThis.location?.search ?? '');
      const changed = incoming.current !== provided, requested = changed ? provided : selection.current; incoming.current = provided;
      if (changed) { cancelReload(); selection.current = null; setSelected(null); setSnapshot(null); }
      try {
        const next = detectorTabChoices(await browserApi.tabs.query({}));
        const target = await resolveDetectorSourceTab(browserApi, requested);
        if (!fresh(token)) return;
        if (target.id !== null && !next.some(tab => tab.id === target.id)) next.push({ id: target.id, label: new URL(target.url).hostname + ' · #' + target.id });
        setChoices(next); setSelected(target.id); if (requested !== null && target.id === null) setError('unavailable');
      } catch { if (fresh(token)) { setChoices([]); setSelected(null); setSnapshot(null); setError('unavailable'); } }
      finally { if (fresh(token)) setLoading(false); }
    }
    useEffect(() => {
      if (!active) { ++generation.current; cancelReload(); return undefined; }
      void refresh();
      const removed = id => { if (!alive.current || !visible.current) return; setChoices(previous => previous.filter(tab => tab.id !== id)); if (selection.current === id) { ++generation.current; cancelReload(); selection.current = null; setSelected(null); setSnapshot(null); setError('unavailable'); setLoading(false); } };
      const updated = (id,change,tab) => {
        if (!alive.current || !visible.current) return;
        if (typeof change?.url === 'string') {
          const next = webTab({id,url:change.url});
          setChoices(previous => next ? previous.some(row=>row.id===id) ? previous.map(row=>row.id===id?{id,label:next.label}:row) : [...previous,{id,label:next.label}] : previous.filter(row=>row.id!==id));
          if (id===selection.current && !next) { ++generation.current; cancelReload(); selection.current = null; setSelected(null); setSnapshot(null); setError('unavailable'); }
        }
      };
      const committed = details => { if (alive.current && visible.current && details?.tabId === selection.current && details.frameId === 0) setSnapshot(null); };
      browserApi.tabs.onRemoved?.addListener(removed);
      browserApi.tabs.onUpdated?.addListener(updated);
      browserApi.webNavigation?.onCommitted?.addListener(committed);
      return () => { ++generation.current; browserApi.tabs.onRemoved?.removeListener(removed); browserApi.tabs.onUpdated?.removeListener(updated); browserApi.webNavigation?.onCommitted?.removeListener(committed); };
    }, [active, tabId]);
    useEffect(() => {
      if (!active) return undefined;
      let stopped = false, revision = 0;
      const read = async () => { const epoch = ++revision; try { const value = await readObservationControl(browserApi); if (!stopped && alive.current && visible.current && revision === epoch) { setObservation(value); setObservationError(false); } } catch { if (!stopped && revision === epoch) { setObservation(null); setObservationError(true); } } };
      const changed = (changes,area) => { if (area === 'local' && ('scope' in changes || 'data-consent:v1' in changes) || area === 'session' && 'data-consent:pending-v1' in changes) void read(); };
      browserApi.storage?.onChanged?.addListener(changed); void read();
      return () => { stopped = true; ++revision; browserApi.storage?.onChanged?.removeListener(changed); };
    }, [active]);
    useEffect(() => {
      if (!active || !host.current) return undefined;
      let stopped = false, unmount = null;
      const container = host.current;
      void (async () => {
        try {
          const module = await loadInspector();
          if (stopped || !alive.current || !visible.current) return;
          unmount = module.mountDetector(container, { tabId: selected, externalOperator: true,
            onState: value => { if (!stopped && alive.current && visible.current && value?.tabId === selection.current) setSnapshot(value); },
            onError: () => { if (!stopped && alive.current && visible.current) setError('failed'); } });
        } catch { if (!stopped && alive.current && visible.current) setError('failed'); }
      })();
      return () => { stopped = true; unmount?.(); };
    }, [active, selected]);
    async function choose(value) {
      if (!alive.current || !visible.current) return;
      cancelReload(); selection.current = null; setSelected(null); setSnapshot(null); setNotice(null);
      const id = value === '' ? null : Number(value), token = ++generation.current; setError(null);
      const target = await resolveDetectorSourceTab(browserApi, id);
      if (!fresh(token)) return;
      setSelected(target.id); if (value !== '' && target.id === null) setError('unavailable');
    }
    async function reload() {
      if (!alive.current || !visible.current || !validDetectorTabId(selection.current) || reloadTask.current) return;
      const id = selection.current, task = new AbortController(); reloadTask.current = task; setReloading(true); setError(null); setNotice(null);
      const current = () => alive.current && visible.current && selection.current === id && reloadTask.current === task;
      try { const result = await reloadDetectorSource(browserApi,id,{signal:task.signal,isCurrent:current}); if (current()) setNotice(result.accessFailed ? 'accessFailed' : result.lateAttached ? 'lateAttached' : 'reloadDone'); }
      catch { if (current()) setError('reloadFailed'); }
      finally { if (reloadTask.current === task) { reloadTask.current = null; if (alive.current) setReloading(false); } }
    }
    const accessible = observation?.enabled === true && snapshot?.tabId === selected && usable(snapshot);
    const accessRef = useRef(false); accessRef.current = accessible;
    useEffect(() => {
      setMovement(null);
      if (!active || selected === null || !accessible) return undefined;
      let stopped = false; const id = selected;
      const current = () => !stopped && alive.current && visible.current && selection.current === id && accessRef.current;
      const controller = createDetectorMovementController({browserApi,getNativeFrames,tabId:id,isCurrent:current,authorize:()=>readDetectorMovementAuthorization(browserApi,id,{isCurrent:current,expectedDocumentKey:latest.current.snapshot?.mainDocumentKey??latest.current.snapshot?.report?.documentKey}),onChange:value=>{if(current())setMovement(value);}});
      void controller.start();return()=>{stopped=true;void controller.stop();};
    }, [active,selected,accessible,snapshot?.mainDocumentKey??snapshot?.report?.documentKey,JSON.stringify(observation?.scope)]);
    function focusSource(){sourceSelect.current?.focus();try{sourceSelect.current?.showPicker?.();}catch{/* Focus remains available when native picker cannot open. */}}
    function focusMaster(){const button=workspace.current?.querySelector('[data-observation-master]');button?.focus();if(button&&!button.disabled)button.click();}
    const noSource = selected === null, off = observation?.enabled === false;
    const needsAccess = observationError || snapshot?.report?.coverageState==='no-access';
    const guide = noSource ? [labels.noSourceTitle,labels.noSourceHint] : off ? [labels.offTitle,labels.offHint] : observationError ? [labels.failed,labels.accessHint] : observation===null || !snapshot?.loaded ? [labels.loading,''] : !accessible ? needsAccess?[labels.accessTitle,labels.accessHint]:[labels.reloadHint,''] : null;
    const sourceField = h('div',{class:'detector-workspace__source-field',children:[
      noSource?h('svg',{class:'detector-workspace__source-arrow',viewBox:'0 0 32 38',fill:'none',stroke:'currentColor','stroke-width':2.5,'aria-hidden':true,focusable:false,children:h('path',{d:'M2 19h25m-9-8 9 8-9 8'})}):null,
      h('label',{children:[h('span',{children:labels.tab}),h('select',{ref:sourceSelect,value:selected??'','data-detector-source':true,disabled:loading,onChange:event=>choose(event.currentTarget.value),children:[h('option',{value:'',children:labels.select}),...choices.map(tab=>h('option',{value:tab.id,key:tab.id,children:tab.label}))]})]})
    ]});
    const TourButton = readTourButton(); // the Options shell's button (ui-tour-slot.js); the popup and the side panel have none
    return h('section', { class: 'detector-workspace', ref:workspace, hidden: !active, 'data-detector-app': true, 'aria-busy': loading, children: [
      h('header', { class: 'detector-workspace__header', children: [
        h('div',{class:'detector-workspace__master',children:[h('h2',{children:'Detector'}),h('div',{class:'workspace-tools',children:[TourButton?h(TourButton,{tour:'detector'}):null,active?h(ObservationControl,{tabId:selected}):null]})]}),
        h('div', { class: 'detector-workspace__source', children: [sourceField,h('button', { type: 'button', class: 'button', disabled: loading, 'data-detector-refresh': true, onClick: refresh, children: labels.refresh }), h('button',{type:'button',class:'button button--primary','data-detector-reload':true,disabled:noSource||reloading,onClick:reload,children:reloading?labels.reloading:labels.reload})] }),
      ] }),
      error ? h('p', { class: 'detector-workspace__error', role: 'alert', 'data-detector-state': error, children: labels[error] }) : null,
      notice ? h('p',{class:'detector-workspace__status',role:'status','data-detector-notice':true,children:labels[notice]}) : null,
      loading ? h('p', { class: 'detector-workspace__status', role: 'status', children: labels.loading }) : null,
      guide ? h('div',{class:'detector-workspace__guide'+(noSource?' detector-workspace__guide--source':''),'data-detector-state':noSource?'no-source':off?'off':'awaiting-source',children:[
        h('span',{class:'detector-workspace__guide-icon','aria-hidden':true,children:h('svg',{viewBox:'0 0 24 24',width:28,height:28,fill:'none',stroke:'currentColor','stroke-width':1.7,children:[h('circle',{cx:12,cy:12,r:8}),h('path',{d:'M12 7v5l3 2'})]})}),
        h('div',{class:'detector-workspace__guide-copy',children:[h('h3',{children:guide[0]}),guide[1]?h('p',{children:guide[1]}):null]}),
        h('div',{class:'detector-workspace__guide-actions',children:[noSource?h('button',{type:'button',class:'button button--primary','data-detector-choose':true,onClick:focusSource,children:labels.choose}):off?h('button',{type:'button',class:'button button--primary',onClick:focusMaster,children:labels.enable}):needsAccess?h('button',{type:'button',class:'button',onClick:()=>openManagement('settings',selected,browserApi),children:labels.settings}):snapshot?.loaded?h('button',{type:'button',class:'button button--primary',onClick:reload,disabled:reloading,children:labels.reload}):null,
          off?h('button',{type:'button',class:'button',onClick:()=>openManagement('settings',selected,browserApi),children:labels.settings}):null]})
      ]}):null,
      selected !== null ? h(PointerActivity,{report:snapshot?.report,loading:!snapshot?.loaded,available:accessible,movement}) : null,
      h('div', { class: 'detector-workspace__host', ref: host, hidden:!accessible, 'data-detector-host': true }),
      h(DetectorHistory,{active})
    ] });
  }
  return { DetectorApp };
}
