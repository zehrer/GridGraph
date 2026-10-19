import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../model/store";
import { CONDITIONS, applyFilters, distinctValues } from "../model/filter";
import type { FilterOp } from "../model/types";
import { currentSheet, setColumnFilter, sortBy } from "./actions";

/** Excel-style filter for one column: sort, filter by condition, filter by values. */
export function FilterPanel({ colKey, at, onClose }: { colKey: string; at: { x: number; y: number }; onClose: () => void }) {
  const graph = useStore((s) => s.graph);
  const m = currentSheet();
  const col = m.all.find((c) => c.key === colKey)!;
  const current = m.type.filters?.[colKey];
  // Like Excel, the list shows the values left by the other columns' filters.
  const values = useMemo(() => distinctValues(graph, col, applyFilters(graph, m.type, m.all, m.base, colKey)), [graph, col, m.type, m.all, m.base, colKey]);
  const [checked, setChecked] = useState(() => new Set(current?.values ?? values.map((v) => v.key)));
  const [search, setSearch] = useState("");
  const [op, setOp] = useState<FilterOp | "">(current?.condition?.op ?? "");
  const [a, setA] = useState(current?.condition?.a ?? "");
  const [b, setB] = useState(current?.condition?.b ?? "");
  const args = CONDITIONS.find(([o]) => o === op)?.[2] ?? 0;
  const shown = values.filter((v) => v.label.toLowerCase().includes(search.trim().toLowerCase()));
  // Dates are listed like in Excel: year ▸ month ▸ day.
  const dateTree = values.some((v) => ISO.test(v.key)) && values.every((v) => v.key === "" || ISO.test(v.key));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = () => {
    const all = values.every((v) => checked.has(v.key));
    setColumnFilter(colKey, {
      ...(!all && { values: values.filter((v) => checked.has(v.key)).map((v) => v.key) }),
      ...(op && { condition: { op, ...(args > 0 && { a }), ...(args > 1 && { b }) } }),
    });
    onClose();
  };
  const toggle = (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  };
  const col1 = m.columns.findIndex((c) => c.key === colKey) + 1;
  const sort = (asc: boolean) => {
    sortBy(col1, asc);
    onClose();
  };

  return (
    <div className="menu-layer" onMouseDown={(e) => e.stopPropagation()}>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="filter-panel" style={{ left: Math.max(8, Math.min(at.x, innerWidth - 300)), top: Math.min(at.y, innerHeight - 460) }}>
        <div className="sorts">
          <button onClick={() => sort(true)}>Sort A → Z</button>
          <button onClick={() => sort(false)}>Sort Z → A</button>
        </div>

        <h4>Filter by condition</h4>
        <select value={op} onChange={(e) => setOp(e.target.value as FilterOp | "")}>
          <option value="">None</option>
          {CONDITIONS.map(([o, label]) => <option key={o} value={o}>{label}</option>)}
        </select>
        {args > 0 && <input autoFocus placeholder={args > 1 ? "From" : "Value"} value={a} onChange={(e) => setA(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />}
        {args > 1 && <input placeholder="To" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />}

        <h4>Filter by values</h4>
        <div className="links">
          <button onClick={() => setChecked(new Set(values.map((v) => v.key)))}>Select all {values.length}</button>
          <button onClick={() => setChecked(new Set())}>Clear</button>
          <span>{checked.size} selected</span>
        </div>
        <input placeholder="Search values" value={search} onChange={(e) => setSearch(e.target.value)} />
        {dateTree && !search.trim() ? (
          <DateTree values={values} checked={checked} setChecked={setChecked} toggle={toggle} />
        ) : (
          <ul>
            {shown.map((v) => (
              <li key={v.key}>
                <label>
                  <input type="checkbox" checked={checked.has(v.key)} onChange={() => toggle(v.key)} />
                  <span className={v.key === "" ? "blank" : ""}>{v.label}</span>
                  <small>{v.count}</small>
                </label>
              </li>
            ))}
            {!shown.length && <li className="none">No matching values</li>}
          </ul>
        )}

        <footer>
          <button onClick={() => (setColumnFilter(colKey, undefined), onClose())} disabled={!current}>Clear filter</button>
          <span />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>OK</button>
        </footer>
      </div>
    </div>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
type Value = { key: string; label: string; count: number };

/** Excel-style date list: years and months with (partial) checkboxes and counts; expand to the days. */
function DateTree({ values, checked, setChecked, toggle }: { values: Value[]; checked: Set<string>; setChecked: (s: Set<string>) => void; toggle: (key: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = new Map<string, Map<string, Value[]>>();
  for (const v of values) {
    if (!v.key) continue;
    const [y, m] = [v.key.slice(0, 4), v.key.slice(0, 7)];
    if (!groups.has(y)) groups.set(y, new Map());
    const months = groups.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(v);
  }
  const blank = values.find((v) => v.key === "");

  const node = (id: string, label: ReactNode, items: Value[], depth: number, children?: ReactNode) => {
    const keys = items.map((v) => v.key);
    const on = keys.filter((k) => checked.has(k)).length;
    const setAll = () => {
      const next = new Set(checked);
      for (const k of keys) on === keys.length ? next.delete(k) : next.add(k);
      setChecked(next);
    };
    const expanded = open.has(id);
    return (
      <li key={id}>
        <label style={{ paddingLeft: 8 + depth * 16 }}>
          <button type="button" className="twisty" onClick={(e) => (e.preventDefault(), setOpen(new Set(expanded ? [...open].filter((x) => x !== id) : [...open, id])))}>
            {expanded ? "▾" : "▸"}
          </button>
          <input type="checkbox" checked={on === keys.length} ref={(el) => void (el && (el.indeterminate = on > 0 && on < keys.length))} onChange={setAll} />
          <span>{label}</span>
          <small>{items.reduce((a, v) => a + v.count, 0)}</small>
        </label>
        {expanded && <ul className="sub">{children}</ul>}
      </li>
    );
  };
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });

  return (
    <ul className="date-tree">
      {blank && (
        <li>
          <label style={{ paddingLeft: 30 }}>
            <input type="checkbox" checked={checked.has("")} onChange={() => toggle("")} />
            <span className="blank">(Blanks)</span>
            <small>{blank.count}</small>
          </label>
        </li>
      )}
      {[...groups].map(([y, months]) =>
        node(y, y, [...months.values()].flat(), 0,
          [...months].map(([m, days]) =>
            node(m, monthName(m), days, 1,
              days.map((d) => (
                <li key={d.key}>
                  <label style={{ paddingLeft: 8 + 2 * 16 + 22 }}>
                    <input type="checkbox" checked={checked.has(d.key)} onChange={() => toggle(d.key)} />
                    <span>{d.label}</span>
                    <small>{d.count}</small>
                  </label>
                </li>
              )),
            ),
          ),
        ),
      )}
    </ul>
  );
}
