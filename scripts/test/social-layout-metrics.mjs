// REQ-013 / ADR-028: geometry checks on the actual shipped Social DOM.
// Self-contained so Playwright and installed Firefox can execute the same probe.
export function socialLayoutMetrics() {
  const table = document.querySelector('[data-social-table]');
  if (!table) return null;
  const box = element => { const rect = element.getBoundingClientRect(); return { width: rect.width, x: rect.x }; };
  const rows = [...table.querySelectorAll('tbody tr[data-social-row]')];
  return {
    tableDisplay: getComputedStyle(table).display,
    headerDisplay: getComputedStyle(table.tHead).display,
    headerPosition: getComputedStyle(table.tHead).position,
    width: box(table).width,
    overflow: table.scrollWidth > table.clientWidth + 1,
    roles: [table.getAttribute('role'), table.tHead.getAttribute('role'), table.tBodies[0].getAttribute('role')],
    headers: [...table.querySelectorAll('thead th')].map(header => ({ text: header.textContent, role: header.getAttribute('role'), wrap: getComputedStyle(header).overflowWrap })),
    rows: rows.map(row => ({
      role: row.getAttribute('role'), cells: [...row.cells].map(cell => ({
        role: cell.getAttribute('role'), width: box(cell).width,
        overflow: cell.scrollWidth > cell.clientWidth + 1,
        label: cell.querySelector('.social-cell-label')?.textContent,
        labelDisplay: cell.querySelector('.social-cell-label') && getComputedStyle(cell.querySelector('.social-cell-label')).display,
        labelHiddenFromAT: cell.querySelector('.social-cell-label')?.getAttribute('aria-hidden'),
        value: cell.querySelector('.social-cell-value')?.textContent
      }))
    }))
  };
}
