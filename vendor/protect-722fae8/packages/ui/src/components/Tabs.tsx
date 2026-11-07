// Accessible tab list (roving tabindex, arrow keys, Home/End). Panels are rendered by the parent.

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  idPrefix: string;
  tabs: ReadonlyArray<TabItem>;
  active: string;
  onChange: (id: string) => void;
}

export function tabId(prefix: string, id: string): string {
  return prefix + '-tab-' + id;
}

export function panelId(prefix: string, id: string): string {
  return prefix + '-panel-' + id;
}

export function Tabs(props: TabsProps) {
  const selectAndFocus = (target: TabItem | undefined): void => {
    if (target === undefined) return;
    props.onChange(target.id);
    document.getElementById(tabId(props.idPrefix, target.id))?.focus();
  };
  const move = (delta: number, current: string): void => {
    const index = props.tabs.findIndex((tab) => tab.id === current);
    if (index < 0 || props.tabs.length === 0) return;
    const next = props.tabs[(index + delta + props.tabs.length) % props.tabs.length];
    selectAndFocus(next);
  };
  return (
    <div class="tabs" role="tablist">
      {props.tabs.map((tab) => {
        const selected = tab.id === props.active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(props.idPrefix, tab.id)}
            class={'tabs__tab' + (selected ? ' tabs__tab--active' : '')}
            aria-selected={selected}
            aria-controls={panelId(props.idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onChange(tab.id)}
            onKeyDown={(event) => {
              switch (event.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                  event.preventDefault();
                  move(1, tab.id);
                  break;
                case 'ArrowLeft':
                case 'ArrowUp':
                  event.preventDefault();
                  move(-1, tab.id);
                  break;
                case 'Home':
                  event.preventDefault();
                  selectAndFocus(props.tabs[0]);
                  break;
                case 'End': {
                  event.preventDefault();
                  const last = props.tabs[props.tabs.length - 1];
                  selectAndFocus(last);
                  break;
                }
                default:
                  break;
              }
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
