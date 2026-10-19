/**
 * HTML export: one self-contained file that shows every sheet as a table in any browser,
 * with links between rows. The full database is embedded as JSON, so the file can be
 * opened in GridGraph again (button "Open in GridGraph", or File → Import).
 */
import { columnsOf, displayValue, instancesOf, linkIds, nodeColor, nodeName, typesOf } from "./graph";
import { shownColumn } from "./formula";
import { summarize } from "./summary";
import { toJSON } from "./io";
import { viewTable } from "./views";
import type { Column, Graph, GraphNode } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const anchor = (id: string) => `n-${id.replace(/[^\w-]/g, "_")}`;

function cell(g: Graph, n: GraphNode, colKey: string): string {
  const col = columnsOf(g, n.typeId!).find((c) => c.key === colKey)!;
  const { col: shown, value, error } = shownColumn(g, n, col);
  if (error) return `<td class="err" title="${esc(error)}">#ERROR</td>`;
  if (value === undefined) return "<td></td>";
  if (shown.type === "relation") {
    const links = linkIds(value).filter((id) => g.nodes[id]);
    return `<td>${links.map((id) => `<a class="chip" href="#${anchor(id)}"><i style="background:${esc(nodeColor(g, g.nodes[id]))}"></i>${esc(nodeName(g, g.nodes[id]))}</a>`).join(" ")}</td>`;
  }
  if (shown.type === "boolean") return `<td class="c">${value ? "✓" : ""}</td>`;
  return `<td${shown.type === "number" ? ' class="r"' : ""}>${esc(displayValue(g, shown, value))}</td>`;
}

/** One table; only the "All rows" table carries the row anchors that links point to. */
function table(g: Graph, t: GraphNode, cols: Column[], rows: GraphNode[], anchors: boolean): string {
  const head = `<tr><th class="id">ID</th>${cols.map((c) => `<th${c.key === t.nameKey ? ' class="name"' : ""}>${esc(c.label)}</th>`).join("")}</tr>`;
  const body = rows.map((n) => `<tr${anchors ? ` id="${anchor(n.id)}"` : ""}><td class="id">${n.no ?? ""}</td>${cols.map((c) => cell(g, n, c.key)).join("")}</tr>`).join("\n");
  const foot = cols.some((c) => c.summary)
    ? `<tfoot><tr><td class="id">${rows.length}</td>${cols.map((c) => `<td class="r">${c.summary ? esc(summarize(g, c, rows, c.summary)) : ""}</td>`).join("")}</tr></tfoot>`
    : "";
  return `<div class="scroll"><table>
<thead>${head}</thead>
<tbody>
${body}
</tbody>${foot}
</table></div>`;
}

/**
 * A sheet: the "All rows" table and, for saved filter views, one precomputed table per view
 * (rows, columns, order and summaries) with a selector to switch between them.
 */
function sheet(g: Graph, t: GraphNode): string {
  const cols = columnsOf(g, t.id).filter((c) => !c.hidden || t.views?.length);
  const rows = instancesOf(g, t.id).sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const views = t.views ?? [];
  const count = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;
  const select = views.length
    ? `<select class="views" aria-label="Filter view"><option value="">All rows</option>${views.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}</select>`
    : "";
  const viewTables = views.map((v) => {
    const vt = viewTable(g, t.id, v);
    return `<div class="view" data-view="${esc(v.id)}" data-count="${esc(count(vt.rows.length))}" hidden>${table(g, t, vt.columns, vt.rows, false)}</div>`;
  });
  return `<section id="${anchor(t.id)}">
<h2><i style="background:${esc(t.color)}"></i>${esc(t.label)} <small>${count(rows.length)}</small>${select}</h2>
<div class="view" data-view="" data-count="${esc(count(rows.length))}">${table(g, t, cols, rows, true)}</div>
${viewTables.join("\n")}
</section>`;
}

export function toHTML(g: Graph, name: string, appUrl: string): string {
  const types = typesOf(g);
  const date = new Date().toLocaleString();
  // "</" inside the embedded JSON would end the script element early.
  const json = toJSON(g).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="GridGraph">
<title>${esc(name)}</title>
<style>
  :root { color-scheme: light; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f1f1f; background: #f9fbfd; }
  body { margin: 0 auto; padding: 24px 16px 48px; max-width: 1200px; }
  h1 { font-size: 24px; font-weight: 400; margin: 0; }
  .meta { color: #5f6368; margin: 2px 0 16px; }
  nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  nav a { padding: 4px 12px; border-radius: 14px; background: #e1e9f7; color: #0b57d0; text-decoration: none; }
  .open { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 24px; border-radius: 12px; background: #fff; border: 1px solid #d3e3fd; }
  .open p { margin: 0; flex: 1; min-width: 240px; color: #444746; }
  .open button { border: 0; border-radius: 18px; padding: 8px 18px; background: #0b57d0; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
  .open a { color: #0b57d0; }
  h2 { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 500; margin: 28px 0 8px; }
  h2 i { width: 12px; height: 12px; border-radius: 3px; }
  h2 small { color: #5f6368; font-weight: 400; font-size: 13px; }
  h2 .views { margin-left: auto; font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid #c4c7c5; border-radius: 14px; background: #fff; }
  .scroll { overflow-x: auto; background: #fff; border: 1px solid #e1e3e1; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 5px 10px; border-bottom: 1px solid #eceeef; text-align: left; vertical-align: top; white-space: nowrap; }
  th { background: #f8f9fa; font-weight: 500; position: sticky; top: 0; }
  th.name { color: #0b57d0; }
  td.id, th.id { color: #5f6368; text-align: right; width: 1%; background: #f8f9fa; }
  td.r { text-align: right; } td.c { text-align: center; } td.err { color: #b3261e; }
  tfoot td { background: #f8f9fa; font-weight: 500; border-top: 1px solid #c4c7c5; }
  tr:target td { background: #fff8c5; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 10px; background: #f1f3f4; color: inherit; text-decoration: none; }
  .chip:hover { background: #d3e3fd; }
  .chip i { width: 7px; height: 7px; border-radius: 50%; }
  footer { margin-top: 32px; color: #5f6368; font-size: 12px; }
  .view[hidden] { display: none; }
  @media print { .open, nav, h2 .views { display: none; } body { background: #fff; } th { position: static; } }
</style>
</head>
<body>
<h1>${esc(name)}</h1>
<p class="meta">Exported from GridGraph on ${esc(date)}</p>
<div class="open">
  <p>This is a read-only copy. To edit it, open it in <a href="${esc(appUrl)}">GridGraph</a> – a free app that runs in your browser and stores data only there. If the button does not work, open GridGraph and choose <b>File → Import</b> with this file.</p>
  <button id="open-in-gridgraph" type="button">Open in GridGraph</button>
</div>
<nav>${types.map((t) => `<a href="#${anchor(t.id)}">${esc(t.label)}</a>`).join("")}</nav>
${types.map((t) => sheet(g, t)).join("\n")}
<footer>Made with <a href="${esc(appUrl)}">GridGraph</a> · <a href="https://github.com/zehrer/GridGraph">github.com/zehrer/GridGraph</a></footer>
<script type="application/json" id="gridgraph-data">${json}</script>
<script>
  // Filter views: show the chosen precomputed table of a sheet.
  function showView(section, id) {
    section.querySelectorAll(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== id; });
    var shown = section.querySelector('.view:not([hidden])');
    section.querySelector("h2 small").textContent = shown ? shown.getAttribute("data-count") : "";
  }
  document.querySelectorAll("select.views").forEach(function (sel) {
    sel.onchange = function () { showView(sel.closest("section"), sel.value); };
  });
  // A link to a row that the current view hides switches that sheet back to "All rows".
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.chip");
    var row = a && document.getElementById(a.getAttribute("href").slice(1));
    if (!row || row.offsetParent) return;
    var section = row.closest("section"), sel = section.querySelector("select.views");
    if (sel) { sel.value = ""; showView(section, ""); }
  });
  // Opens GridGraph and hands over the embedded data once it reports that it is ready.
  document.getElementById("open-in-gridgraph").onclick = function () {
    var app = ${JSON.stringify(appUrl)};
    var win = window.open(app + "#import", "_blank");
    if (!win) { alert("Please allow pop-ups, or open GridGraph and use File \\u2192 Import with this file."); return; }
    var data = { type: "gridgraph-data", name: ${JSON.stringify(name)}, json: document.getElementById("gridgraph-data").textContent };
    window.addEventListener("message", function ready(e) {
      if (e.source !== win || !e.data || e.data.type !== "gridgraph-ready") return;
      win.postMessage(data, new URL(app).origin);
      window.removeEventListener("message", ready);
    });
  };
</script>
</body>
</html>
`;
}
