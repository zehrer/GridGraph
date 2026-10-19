import { useStore } from "../model/store";
import { periodLabel } from "../model/filter";
import { clearQuickFilter, currentSheet, stepQuickFilter, toggleQuickUnit } from "./actions";

/** Toolbar chip of the sheet's quick filter: column, period and ‹ › to browse like a calendar. */
export function QuickFilterChip() {
  useStore((s) => s.graph);
  useStore((s) => s.activeTypeId);
  const m = currentSheet();
  const qf = m.type.quickFilter;
  const col = qf && m.all.find((c) => c.key === qf.key);
  if (!qf || !col) return null;
  return (
    <div className="quick-filter" title={`Quick filter on ${col.label}: ${m.rows.length} of ${m.total} rows`}>
      <span className="col">{col.label}</span>
      <button title="Previous" onClick={() => stepQuickFilter(-1)}>‹</button>
      <button className="period" disabled={qf.unit === "number"} title={qf.unit === "number" ? undefined : qf.unit === "year" ? "Show months" : "Show whole year"} onClick={toggleQuickUnit}>
        {periodLabel(qf.unit, qf.value)}
      </button>
      <button title="Next" onClick={() => stepQuickFilter(1)}>›</button>
      <button className="clear" title="Remove quick filter" onClick={clearQuickFilter}>✕</button>
    </div>
  );
}
