/**
 * HTML export: one self-contained file that shows every sheet as a table in any browser,
 * with links between rows. The full database is embedded as JSON, so the file can be
 * opened in GridGraph again (button "Open in GridGraph", or File → Import).
 */
import { columnsOf, displayValue, instancesOf, linkIds, nodeColor, nodeName, typesOf } from "./graph";
import { shownColumn } from "./formula";
import { summarize } from "./summary";
import { isListUnit, quickKeys, quickValues } from "./filter";
import { toJSON } from "./io";
import { currentLocale, parseNumber } from "./locale";
import { viewTable } from "./views";
import type { Column, Graph, GraphNode, QuickFilter } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const anchor = (id: string) => `n-${id.replace(/[^\w-]/g, "_")}`;

/** Data a summary needs from a cell: data-v marks it filled, data-n holds a number, data-d an ISO date. */
function summaryData(value: unknown, type: string): string {
  if (value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : typeof value === "string" && type !== "date" ? parseNumber(value) : undefined;
  if (num !== undefined) return ` data-v data-n="${num}"`;
  if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return ` data-v data-d="${value}"`;
  return " data-v";
}

function cell(g: Graph, n: GraphNode, colKey: string, summary = false): string {
  const col = columnsOf(g, n.typeId!).find((c) => c.key === colKey)!;
  const { col: shown, value, error } = shownColumn(g, n, col);
  if (error) return `<td class="err" title="${esc(error)}">#ERROR</td>`;
  if (value === undefined) return "<td></td>";
  if (summary) return cellWith(g, shown, value, summaryData(value, shown.type));
  return cellWith(g, shown, value, "");
}

function cellWith(g: Graph, shown: Column, value: NonNullable<GraphNode["props"][string]>, attrs: string): string {
  if (shown.type === "relation") {
    const links = linkIds(value).filter((id) => g.nodes[id]);
    return `<td${attrs}>${links.map((id) => `<a class="chip" href="#${anchor(id)}"><i style="background:${esc(nodeColor(g, g.nodes[id]))}"></i>${esc(nodeName(g, g.nodes[id]))}</a>`).join(" ")}</td>`;
  }
  if (shown.type === "boolean") return `<td class="c"${attrs}>${value ? "✓" : ""}</td>`;
  return `<td${shown.type === "number" ? ' class="r"' : ""}${attrs}>${esc(displayValue(g, shown, value))}</td>`;
}

/** One table; only the "All rows" table carries the row anchors that links point to. */
type Quick = { col: Column; unit: QuickFilter["unit"] };

function table(g: Graph, t: GraphNode, cols: Column[], rows: GraphNode[], anchors: boolean, quicks: Quick[] = [], summaryRow = true): string {
  const sums = summaryRow && cols.some((c) => c.summary);
  // Each row carries the values it matches per quick filter column, for the page's quick filter controls.
  const q = (n: GraphNode) =>
    quicks.length ? ` data-q="${esc(JSON.stringify(Object.fromEntries(quicks.map((x) => [x.col.key, quickKeys(g, n, x.col, x.unit)]))))}"` : "";
  const head = `<tr><th class="id">ID</th>${cols.map((c) => `<th${c.key === t.nameKey ? ' class="name"' : ""}>${esc(c.label)}</th>`).join("")}</tr>`;
  const body = rows.map((n) => `<tr${anchors ? ` id="${anchor(n.id)}"` : ""}${q(n)}><td class="id">${n.no ?? ""}</td>${cols.map((c) => cell(g, n, c.key, sums && !!c.summary)).join("")}</tr>`).join("\n");
  // Precomputed for all rows; the page recomputes it for the rows a quick filter leaves.
  const foot = sums
    ? `<tfoot><tr><td class="id">${rows.length}</td>${cols.map((c) => `<td class="r"${c.summary ? ` data-sum="${c.summary}" data-fmt="${esc(c.format ?? "")}"` : ""}>${c.summary ? esc(summarize(g, c, rows, c.summary)) : ""}</td>`).join("")}</tr></tfoot>`
    : "";
  return `<div class="scroll"><table>
<thead>${head}</thead>
<tbody>
${body}
</tbody>${foot}
</table></div>`;
}

/** Quick filter control: on/off switch, ‹ ›, and the values that occur (in order) with counts. */
function quickControl(g: Graph, quick: Quick, rows: GraphNode[], value: string, on: boolean): string {
  const values = quickValues(g, quick.col, rows, quick.unit);
  if (!isListUnit(quick.unit)) values.sort((a, b) => (quick.unit === "number" ? Number(a.value) - Number(b.value) : a.value.localeCompare(b.value)));
  const options = values.map((v) => `<option value="${esc(v.value)}"${v.value === value ? " selected" : ""}>${esc(v.label)} (${v.count})</option>`).join("");
  return `<span class="qf${on ? "" : " off"}" data-key="${esc(quick.col.key)}"><label class="sw" title="Quick filter on/off"><input type="checkbox"${on ? " checked" : ""}><i></i></label><span class="qcol">${esc(quick.col.label)}</span><button type="button" data-step="-1" title="Previous">‹</button><select aria-label="Quick filter value">${options}</select><button type="button" data-step="1" title="Next">›</button></span>`;
}

/**
 * A sheet: the "All rows" table and, for saved filter views, one precomputed table per view
 * (rows, columns, order and summaries) with a selector to switch between them.
 */
function sheet(g: Graph, t: GraphNode, summaryRow: boolean): string {
  const cols = columnsOf(g, t.id).filter((c) => !c.hidden || t.views?.length);
  const rows = instancesOf(g, t.id).sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  const views = t.views ?? [];
  const count = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;
  const select = views.length
    ? `<select class="views" aria-label="Filter view"><option value="">All rows</option>${views.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}</select>`
    : "";
  // The sheet's quick filters (plus those saved only in views) become interactive controls.
  const defs = new Map<string, QuickFilter>();
  for (const qf of [...(t.quickFilters ?? []), ...views.flatMap((v) => v.quicks ?? []).map((q) => ({ ...q, off: true }))]) if (!defs.has(qf.key)) defs.set(qf.key, qf);
  const all = columnsOf(g, t.id);
  const quicks = [...defs.values()].flatMap((qf) => {
    const col = all.find((c) => c.key === qf.key);
    return col ? [{ col, unit: qf.unit, qf }] : [];
  });
  const control = quicks.map((x) => quickControl(g, x, rows, x.qf.value, !x.qf.off)).join("");
  const viewTables = views.map((v) => {
    const vt = viewTable(g, t.id, v);
    // A view saved with quick filters sets those controls when it is chosen.
    const vq = v.quicks?.length ? ` data-quicks="${esc(JSON.stringify(Object.fromEntries(v.quicks.map((q) => [q.key, { value: q.value, on: !q.off }]))))}"` : "";
    return `<div class="view" data-view="${esc(v.id)}" data-count="${esc(count(vt.rows.length))}"${vq} hidden>${table(g, t, vt.columns, vt.rows, false, quicks, summaryRow)}</div>`;
  });
  return `<section id="${anchor(t.id)}">
<h2><i style="background:${esc(t.color)}"></i>${esc(t.label)} <small>${count(rows.length)}</small>${control}${select}</h2>
<div class="view" data-view="" data-count="${esc(count(rows.length))}">${table(g, t, cols, rows, true, quicks, summaryRow)}</div>
${viewTables.join("\n")}
</section>`;
}

/** `summaryRow` follows View → Summary row in the app. */
export function toHTML(g: Graph, name: string, appUrl: string, { summaryRow = true }: { summaryRow?: boolean } = {}): string {
  // Hidden sheets (lookup tables) are left out of the navigation and come last, so links to them still work.
  const types = [...typesOf(g).filter((t) => !t.hiddenSheet), ...typesOf(g).filter((t) => t.hiddenSheet)];
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
  h2 .qf + .qf { margin-left: 6px; }
  h2 .qf { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px 2px 8px; border-radius: 14px; background: #ceead6; color: #0d652d; font-size: 13px; font-weight: 400; }
  h2 .qf.off { background: #e8eaed; color: #5f6368; }
  h2 .qf .qcol { margin: 0 2px 0 4px; }
  h2 .qf button { border: 0; background: none; color: inherit; font: inherit; font-size: 15px; padding: 0 6px; cursor: pointer; border-radius: 10px; }
  h2 .qf select { border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; max-width: 220px; }
  h2 .qf .sw { position: relative; display: inline-flex; width: 26px; height: 14px; cursor: pointer; }
  h2 .qf .sw input { position: absolute; opacity: 0; }
  h2 .qf .sw i { width: 26px; height: 14px; border-radius: 7px; background: #9aa0a6; }
  h2 .qf .sw i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; }
  h2 .qf .sw input:checked + i { background: #188038; }
  h2 .qf .sw input:checked + i::after { left: 14px; }
  h2 .qf + .views { margin-left: 8px; }
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
  @media print { .open, nav, h2 .views, h2 .qf { display: none; } body { background: #fff; } th { position: static; } }
</style>
</head>
<body>
<h1>${esc(name)}</h1>
<p class="meta">Exported from GridGraph on ${esc(date)}</p>
<div class="open">
  <p>This is a read-only copy. To edit it, open it in <a href="${esc(appUrl)}">GridGraph</a> – a free app that runs in your browser and stores data only there. If the button does not work, open GridGraph and choose <b>File → Import</b> with this file.</p>
  <button id="open-in-gridgraph" type="button">Open in GridGraph</button>
</div>
<nav>${types.filter((t) => !t.hiddenSheet).map((t) => `<a href="#${anchor(t.id)}">${esc(t.label)}</a>`).join("")}</nav>
${types.map((t) => sheet(g, t, summaryRow)).join("\n")}
<footer>Made with <a href="${esc(appUrl)}">GridGraph</a> · <a href="https://github.com/zehrer/GridGraph">github.com/zehrer/GridGraph</a></footer>
<script type="application/json" id="gridgraph-data">${json}</script>
<script>
  // Filter views: show the chosen precomputed table of a sheet.
  function showView(section, id) {
    section.querySelectorAll(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== id; });
    var shown = section.querySelector(".view:not([hidden])");
    // A view saved with quick filters brings their values along.
    var saved = shown && shown.getAttribute("data-quicks") ? JSON.parse(shown.getAttribute("data-quicks")) : {};
    section.querySelectorAll(".qf").forEach(function (qf) {
      var q = saved[qf.getAttribute("data-key")];
      if (q) { qf.querySelector("select").value = q.value; qf.querySelector("input").checked = q.on; }
    });
    applyQuick(section);
  }
  // Summary row over the visible rows, written like in the app (locale and column format).
  var LOCALE = ${JSON.stringify(currentLocale())};
  var SUMS = { sum: "Sum", avg: "Average", min: "Min", max: "Max", count: "Count", empty: "Empty" };
  function formatNumber(n, fmt) {
    var o = fmt === "plain" ? { useGrouping: false, maximumFractionDigits: 10 }
      : fmt === "integer" ? { maximumFractionDigits: 0 }
      : fmt === "decimal2" ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : fmt === "EUR" || fmt === "USD" ? { style: "currency", currency: fmt }
      : fmt === "percent" ? { style: "percent", maximumFractionDigits: 2 } : {};
    return n.toLocaleString(LOCALE, o);
  }
  function recomputeSummary(v) {
    var foot = v.querySelector("tfoot tr");
    if (!foot) return;
    var rows = [].filter.call(v.querySelectorAll("tbody tr"), function (tr) { return !tr.hidden; });
    foot.cells[0].textContent = rows.length;
    [].forEach.call(foot.cells, function (td, i) {
      var kind = td.getAttribute("data-sum");
      if (!kind) return;
      var cells = rows.map(function (tr) { return tr.cells[i]; });
      var filled = cells.filter(function (c) { return c && c.hasAttribute("data-v"); });
      var label = SUMS[kind];
      if (kind === "count") { td.textContent = label + " " + filled.length; return; }
      if (kind === "empty") { td.textContent = label + " " + (cells.length - filled.length); return; }
      var dates = filled.filter(function (c) { return c.hasAttribute("data-d"); });
      if ((kind === "min" || kind === "max") && dates.length && dates.length === filled.length) {
        dates.sort(function (a, b) { return a.getAttribute("data-d").localeCompare(b.getAttribute("data-d")); });
        td.textContent = label + " " + (kind === "min" ? dates[0] : dates[dates.length - 1]).textContent;
        return;
      }
      var nums = filled.filter(function (c) { return c.hasAttribute("data-n"); }).map(function (c) { return Number(c.getAttribute("data-n")); });
      if (!nums.length) { td.textContent = label; return; }
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      var value = { sum: sum, avg: sum / nums.length, min: Math.min.apply(null, nums), max: Math.max.apply(null, nums) }[kind];
      td.textContent = label + " " + formatNumber(Math.round(value * 10000) / 10000, td.getAttribute("data-fmt"));
    });
  }
  // Quick filters: a row stays when it matches every switched-on control; precomputed summaries are hidden meanwhile.
  function applyQuick(section) {
    var active = [];
    section.querySelectorAll(".qf").forEach(function (qf) {
      var on = qf.querySelector("input").checked;
      qf.classList.toggle("off", !on);
      if (on) active.push({ key: qf.getAttribute("data-key"), value: qf.querySelector("select").value });
    });
    var on = active.length > 0;
    section.querySelectorAll(".view").forEach(function (v) {
      var n = 0;
      v.querySelectorAll("tbody tr").forEach(function (tr) {
        var q = JSON.parse(tr.getAttribute("data-q") || "{}");
        var show = active.every(function (a) { return (q[a.key] || []).indexOf(a.value) >= 0; });
        tr.hidden = !show;
        if (show) n++;
      });
      recomputeSummary(v);
      v.setAttribute("data-shown", n + (n === 1 ? " row" : " rows"));
    });
    var shown = section.querySelector(".view:not([hidden])");
    section.querySelector("h2 small").textContent = shown ? shown.getAttribute("data-shown") : "";
  }
  document.querySelectorAll(".qf").forEach(function (qf) {
    var section = qf.closest("section"), sel = qf.querySelector("select"), box = qf.querySelector("input");
    box.onchange = sel.onchange = function () { applyQuick(section); };
    qf.querySelectorAll("button[data-step]").forEach(function (b) {
      b.onclick = function () {
        sel.selectedIndex = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + Number(b.getAttribute("data-step"))));
        box.checked = true;
        applyQuick(section);
      };
    });
    applyQuick(section);
  });
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
    // Still hidden by the quick filter: switch it off.
    if (!row.offsetParent) { section.querySelectorAll(".qf input").forEach(function (i) { i.checked = false; }); applyQuick(section); }
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
