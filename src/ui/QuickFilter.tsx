import { useState } from "react";
import { useStore } from "../model/store";
import { isListUnit, quickLabel } from "../model/filter";
import { clearQuickFilter, currentSheet, quickChoices, setQuickValue, stepQuickFilter, toggleQuickFilter, toggleQuickUnit } from "./actions";
import { MenuList } from "./Menu";

/**
 * Toolbar chip of the sheet's quick filter: column, current value and ‹ ›. Dates browse like a
 * calendar (clicking the period switches year/month); links and texts step through the existing
 * values, and clicking the value lists them all.
 */
export function QuickFilterChip() {
  const graph = useStore((s) => s.graph);
  useStore((s) => s.activeTypeId);
  const [list, setList] = useState<{ x: number; y: number } | null>(null);
  const m = currentSheet();
  const qf = m.type.quickFilter;
  const col = qf && m.all.find((c) => c.key === qf.key);
  if (!qf || !col) return null;

  const listed = isListUnit(qf.unit);
  const choices = listed ? quickChoices() : [];
  const at = choices.findIndex((v) => v.value === qf.value);
  const label = quickLabel(graph, qf.unit, qf.value);

  return (
    <div className={`quick-filter${qf.off ? " off" : ""}`} title={qf.off ? `Quick filter on ${col.label} is off` : `Quick filter on ${col.label}: ${m.rows.length} of ${m.total} rows`}>
      <label className="switch" title={qf.off ? "Switch the quick filter on" : "Switch the quick filter off (show all rows)"}>
        <input type="checkbox" checked={!qf.off} onChange={toggleQuickFilter} />
        <i />
      </label>
      <span className="col">{col.label}</span>
      <button title="Previous" disabled={listed && at <= 0} onClick={() => stepQuickFilter(-1)}>‹</button>
      <button
        className="period"
        disabled={qf.unit === "number"}
        title={listed ? "Choose a value" : qf.unit === "year" ? "Show months" : qf.unit === "month" ? "Show whole year" : undefined}
        onClick={(e) => {
          if (!listed) return toggleQuickUnit();
          const r = e.currentTarget.getBoundingClientRect();
          setList({ x: r.left, y: r.bottom + 4 });
        }}
      >
        {label}
      </button>
      <button title="Next" disabled={listed && (at < 0 || at >= choices.length - 1)} onClick={() => stepQuickFilter(1)}>›</button>
      <button className="clear" title="Remove quick filter" onClick={clearQuickFilter}>✕</button>
      {list && (
        <MenuList
          at={list}
          onClose={() => setList(null)}
          items={choices.map((v) => ({ label: `${v.value === qf.value ? "✓ " : " "}${v.label}`, shortcut: String(v.count), action: () => setQuickValue(v.value) }))}
        />
      )}
    </div>
  );
}
