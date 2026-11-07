// ADR-029: native geometry of the shipped resource table, shared by Chrome and Firefox.
export function thirdPartyLayoutMetrics() {
  const table = [...document.querySelectorAll('[data-third-party-table]')].find(node => node.getBoundingClientRect().width > 0);
  if (!table) return null;
  return { display: getComputedStyle(table).display, width: table.getBoundingClientRect().width,
    overflow: table.scrollWidth > table.clientWidth + 1,
    rows: [...table.querySelectorAll('[data-third-party-row]')].map(row => ({
      cells: row.cells.length, overflow: [...row.cells].some(cell => cell.scrollWidth > cell.clientWidth + 1),
      labels: [...row.cells].every(cell => cell.querySelector('.social-cell-label')?.textContent),
      values: [...row.cells].every(cell => cell.querySelector('.social-cell-value')?.textContent)
    })) };
}
