import { useState } from "react";
import { useStore } from "../model/store";
import { viewModified } from "../model/views";
import * as A from "./actions";
import { MenuList, type MenuItem } from "./Menu";

/** Filter view items for the toolbar selector and the Data menu. */
export function viewItems(): MenuItem[] {
  const { graph, activeTypeId, sort } = useStore.getState();
  const t = graph.nodes[activeTypeId];
  const views = t?.views ?? [];
  const active = views.find((v) => v.id === t?.activeView);
  const modified = viewModified(graph, activeTypeId, sort);
  const check = (on: boolean, label: string) => `${on ? "✓ " : " "}${label}`;
  return [
    { label: check(!active, "All rows"), action: () => A.applyViewById(null) },
    ...views.map((v): MenuItem => ({ label: check(v.id === active?.id, v.name), action: () => A.applyViewById(v.id) })),
    "-",
    { label: "Save as new view…", action: A.saveViewAs },
    { label: active ? `Update “${active.name}”` : "Update view", disabled: !active || !modified, action: A.updateView },
    { label: "Rename view…", disabled: !active, action: A.renameView },
    { label: "Delete view", disabled: !active, action: A.deleteView },
  ];
}

/** Toolbar button showing the active filter view, with a dot when it was changed since it was applied. */
export function ViewSelector({ disabled }: { disabled: boolean }) {
  const { graph, activeTypeId, sort } = useStore();
  // Opened at a viewport point: the toolbar scrolls horizontally and would clip a menu placed inside it.
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const t = graph.nodes[activeTypeId];
  const active = t?.views?.find((v) => v.id === t.activeView);
  const modified = viewModified(graph, activeTypeId, sort);
  return (
    <div className="menu-anchor">
      <button className="view-select" disabled={disabled} title={modified ? "Changed since the view was applied" : "Filter views"} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen({ x: r.left, y: r.bottom + 2 });
        }}>
        {active ? active.name : "All rows"}
        {modified && <span className="dot">•</span>} ▾
      </button>
      {open && <MenuList items={viewItems()} at={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
