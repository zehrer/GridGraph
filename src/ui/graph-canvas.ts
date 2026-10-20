import { columnsOf, edgesOf, instancesOf, nodeColor, nodeName, typesOf } from "../model/graph";
import { metaRelations } from "../model/meta";
import type { Column, DerivedEdge, Graph, GraphNode } from "../model/types";

interface Body { x: number; y: number; vx: number; vy: number; pinned?: boolean }

/** "data": rows and their links; "model": types as cards with their properties, linked by link columns. */
export type GraphMode = "data" | "model";

const FONT = "Roboto, -apple-system, 'Segoe UI', Arial, sans-serif";
const radius = (n: GraphNode) => (n.isType ? 14 : 22);

// Model cards: a title bar and one line per property.
const CARD_W = 200;
const CARD_HEAD = 28;
const CARD_LINE = 16;
const CARD_MAX_LINES = 14;
const ICON: Record<Column["type"], string> = { text: "Aa", number: "#", date: "◷", boolean: "☑", relation: "↗", formula: "ƒ" };

/** Layout positions survive view switches; they are not part of the saved data. Model cards have their own ("m:" keys). */
const bodies = new Map<string, Body>();

export interface CanvasEvents {
  select: (id: string | null) => void;
  open: (id: string) => void;
  connect: (source: string, target: string) => void;
}

interface Card { cols: Column[]; rows: number; w: number; h: number }

/** Canvas renderer with a force-directed layout, pan/zoom, drag and shift-drag to connect. */
export class GraphCanvas {
  private ctx: CanvasRenderingContext2D;
  private g: Graph = { nodes: {}, edges: {} };
  /** Nodes and edges currently drawn: without type nodes and typeOf edges when types are hidden. */
  private nodes: GraphNode[] = [];
  private edges: DerivedEdge[] = [];
  private cards = new Map<string, Card>();
  private mode: GraphMode = "data";
  private showTypes = true;
  private hiddenTypes = new Set<string>();
  private hiddenNodes = new Set<string>();
  private pan = { x: 0, y: 0 };
  private zoom = 1;
  private alpha = 1;
  private frame = 0;
  private drag: { id?: string; connect?: boolean; px: number; py: number; moved?: boolean } | null = null;
  private pointer = { x: 0, y: 0 };
  private sized = false;
  private fitWhenSized = false;
  selected: string | null = null;
  /** Frame the whole graph once the layout has settled. */
  fitOnSettle = false;

  constructor(private canvas: HTMLCanvasElement, private on: CanvasEvents) {
    this.ctx = canvas.getContext("2d")!;
    for (const [type, fn] of this.listeners) canvas.addEventListener(type, fn as EventListener, { passive: false });
    this.observer.observe(canvas.parentElement!);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn as EventListener);
  }

  private body(id: string) {
    return bodies.get(this.mode === "model" ? `m:${id}` : id);
  }

  setGraph(g: Graph) {
    this.g = g;
    this.refresh();
    let added = 0;
    for (const n of this.nodes) {
      if (this.body(n.id)) continue;
      const near = this.mode === "data" && n.typeId ? this.body(n.typeId) : undefined;
      const spread = near ? 120 : this.mode === "model" ? 700 : 400;
      bodies.set(this.mode === "model" ? `m:${n.id}` : n.id, { x: (near?.x ?? 0) + (Math.random() - 0.5) * spread, y: (near?.y ?? 0) + (Math.random() - 0.5) * spread, vx: 0, vy: 0 });
      added++;
    }
    this.kick();
    // New nodes: let the layout settle off-screen first (bounded by the O(n²) cost), so the first frame is already tidy.
    if (added) {
      for (let i = Math.min(250, 400_000 / this.nodes.length ** 2); i > 0; i--) {
        this.step();
        this.alpha *= 0.985;
      }
    }
  }

  setMode(mode: GraphMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.selected = null;
    this.fitOnSettle = true;
    this.setGraph(this.g);
  }

  private refresh() {
    if (this.mode === "model") {
      this.nodes = typesOf(this.g);
      this.cards = new Map(this.nodes.map((t) => {
        const cols = columnsOf(this.g, t.id);
        const lines = Math.min(cols.length, CARD_MAX_LINES) + (cols.length > CARD_MAX_LINES ? 1 : 0);
        return [t.id, { cols, rows: instancesOf(this.g, t.id).length, w: CARD_W, h: CARD_HEAD + Math.max(lines, 1) * CARD_LINE + 8 }];
      }));
      this.edges = metaRelations(this.g).map((r) => ({
        id: r.id, source: r.from, target: r.to, relation: `${r.column.label}${r.many ? " *" : ""}`, kind: "column", colKey: r.column.key,
      }));
      return;
    }
    const hidden = (n: GraphNode) => this.hiddenTypes.has(n.isType ? n.id : (n.typeId ?? "")) || this.hiddenNodes.has(n.id);
    this.nodes = Object.values(this.g.nodes).filter((n) => (this.showTypes || !n.isType) && !hidden(n));
    const shown = new Set(this.nodes.map((n) => n.id));
    this.edges = edgesOf(this.g).filter((e) => shown.has(e.source) && shown.has(e.target));
  }

  /** Leaves the nodes of these types (and their edges) out of drawing and layout. */
  setHiddenTypes(ids: string[]) {
    const next = new Set(ids);
    if (next.size === this.hiddenTypes.size && ids.every((id) => this.hiddenTypes.has(id))) return;
    this.hiddenTypes = next;
    this.refresh();
    this.kick();
  }

  /** Leaves single rows out, e.g. those hidden by their sheet's filters. */
  setHiddenNodes(ids: Set<string>) {
    if (ids.size === this.hiddenNodes.size && [...ids].every((id) => this.hiddenNodes.has(id))) return;
    this.hiddenNodes = new Set(ids);
    this.refresh();
    this.kick();
  }

  setShowTypes(show: boolean) {
    if (show === this.showTypes) return;
    this.showTypes = show;
    this.refresh();
    this.fitOnSettle = true;
    this.kick();
  }

  focus(id: string) {
    const b = this.body(id);
    this.selected = id;
    if (b) this.pan = { x: this.canvas.clientWidth / 2 - b.x * this.zoom, y: this.canvas.clientHeight / 2 - b.y * this.zoom };
    this.draw();
  }

  zoomBy(f: number) {
    const [cx, cy] = [this.canvas.clientWidth / 2, this.canvas.clientHeight / 2];
    this.zoomAt(cx, cy, f);
  }

  fit() {
    // Before the first resize the canvas still has its default size (300×150); fit once it is laid out.
    if (!this.sized) {
      this.fitWhenSized = true;
      return;
    }
    const pts = this.nodes.map((n) => this.body(n.id)!).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const [w, h] = [this.canvas.clientWidth, this.canvas.clientHeight];
    const margin = this.mode === "model" ? 360 : 200;
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.zoom = Math.min(Math.max(Math.min(w / (maxX - minX + margin), h / (maxY - minY + margin)), 0.2), 1.6);
    this.pan = { x: w / 2 - ((minX + maxX) / 2) * this.zoom, y: h / 2 - ((minY + maxY) / 2) * this.zoom };
    this.draw();
  }

  // --- Simulation ---

  private kick() {
    this.alpha = 1;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.step();
    this.draw();
    this.alpha *= 0.985;
    this.frame = this.alpha > 0.005 || this.drag ? requestAnimationFrame(this.tick) : 0;
    if (!this.frame && this.fitOnSettle) {
      this.fitOnSettle = false;
      this.fit();
    }
  };

  private step() {
    const model = this.mode === "model";
    const ns = this.nodes;
    const bs = ns.map((n) => this.body(n.id)!);
    const a = this.alpha;
    for (let i = 0; i < bs.length; i++) {
      const u = bs[i];
      for (let j = i + 1; j < bs.length; j++) {
        const v = bs[j];
        let dx = v.x - u.x, dy = v.y - u.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) (dx = Math.random() - 0.5), (dy = Math.random() - 0.5), (d2 = 1);
        const strength = model ? 90000 : ns[i].isType || ns[j].isType ? 18000 : 12000;
        const f = (strength / (d2 + 100)) * a / Math.sqrt(d2);
        u.vx -= dx * f; u.vy -= dy * f; v.vx += dx * f; v.vy += dy * f;
      }
      u.vx -= u.x * 0.02 * a;
      u.vy -= u.y * 0.02 * a;
    }
    for (const e of this.edges) {
      if (e.source === e.target) continue;
      const u = this.body(e.source), v = this.body(e.target);
      if (!u || !v) continue;
      const dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy) || 1;
      const f = ((d - (model ? 300 : e.kind === "typeOf" ? 100 : 130)) * 0.04 * a) / d;
      u.vx += dx * f; u.vy += dy * f; v.vx -= dx * f; v.vy -= dy * f;
    }
    for (const b of bs) {
      if (b.pinned) { b.vx = b.vy = 0; continue; }
      b.vx *= 0.82; b.vy *= 0.82;
      const s = Math.hypot(b.vx, b.vy);
      if (s > 25) (b.vx *= 25 / s), (b.vy *= 25 / s);
      b.x += b.vx; b.y += b.vy;
    }
  }

  // --- Input ---

  private world(e: { offsetX: number; offsetY: number }) {
    return { x: (e.offsetX - this.pan.x) / this.zoom, y: (e.offsetY - this.pan.y) / this.zoom };
  }

  private hit(e: { offsetX: number; offsetY: number }) {
    const p = this.world(e);
    return [...this.nodes].reverse().find((n) => {
      const b = this.body(n.id)!;
      const card = this.mode === "model" ? this.cards.get(n.id) : undefined;
      if (card) return Math.abs(b.x - p.x) <= card.w / 2 && Math.abs(b.y - p.y) <= card.h / 2;
      return Math.hypot(b.x - p.x, b.y - p.y) <= radius(n) + 4;
    });
  }

  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const n = this.hit(e);
    this.drag = { id: n?.id, connect: !!n && e.shiftKey, px: e.offsetX, py: e.offsetY };
    if (n && !e.shiftKey) this.body(n.id)!.pinned = true;
  };

  private moveHandler = (e: PointerEvent) => {
    this.pointer = this.world(e);
    const d = this.drag;
    if (!d) {
      this.canvas.style.cursor = this.hit(e) ? "pointer" : "grab";
      return;
    }
    d.moved ||= Math.hypot(e.offsetX - d.px, e.offsetY - d.py) > 3;
    if (d.connect) this.draw();
    else if (d.id) {
      Object.assign(this.body(d.id)!, this.pointer);
      this.kick();
    } else {
      this.pan.x += e.offsetX - d.px;
      this.pan.y += e.offsetY - d.py;
      [d.px, d.py] = [e.offsetX, e.offsetY];
      this.draw();
    }
  };

  private up = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.id) this.body(d.id)!.pinned = false;
    const target = this.hit(e);
    // In the model a type may link to itself (e.g. Person → manager).
    if (d.connect && d.id && target && d.moved && (target.id !== d.id || this.mode === "model")) this.on.connect(d.id, target.id);
    else if (!d.moved) {
      this.selected = d.id ?? null;
      this.on.select(this.selected);
    }
    this.draw();
  };

  private dbl = (e: MouseEvent) => {
    const n = this.hit(e);
    if (n) this.on.open(n.id);
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.002));
  };

  private zoomAt(sx: number, sy: number, f: number) {
    const z = Math.min(Math.max(this.zoom * f, 0.15), 4);
    this.pan = { x: sx - ((sx - this.pan.x) * z) / this.zoom, y: sy - ((sy - this.pan.y) * z) / this.zoom };
    this.zoom = z;
    this.draw();
  }

  private get listeners() {
    return [["pointerdown", this.down], ["pointermove", this.moveHandler], ["pointerup", this.up], ["dblclick", this.dbl], ["wheel", this.wheel]] as const;
  }
  private observer = new ResizeObserver(() => this.resize());

  private resize() {
    const { width, height } = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    Object.assign(this.canvas, { width: width * dpr, height: height * dpr });
    Object.assign(this.canvas.style, { width: `${width}px`, height: `${height}px` });
    if (!this.sized) this.pan = { x: width / 2, y: height / 2 };
    this.sized = width > 0 && height > 0;
    if (this.sized && this.fitWhenSized) {
      this.fitWhenSized = false;
      this.fit();
    }
    this.draw();
  }

  // --- Rendering ---

  private draw() {
    const { ctx, canvas, zoom, pan } = this;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const grid = 40 * zoom;
    if (grid > 12) {
      ctx.fillStyle = "#dadce0";
      for (let x = ((pan.x % grid) + grid) % grid; x < canvas.clientWidth; x += grid)
        for (let y = ((pan.y % grid) + grid) % grid; y < canvas.clientHeight; y += grid) ctx.fillRect(x, y, 1.5, 1.5);
    }

    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    for (const e of this.edges) (this.mode === "model" ? this.drawRelation(e) : this.drawEdge(e));
    const d = this.drag;
    if (d?.connect && d.id) {
      const b = this.body(d.id)!;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#1a73e8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of this.nodes) (this.mode === "model" ? this.drawCard(n) : this.drawNode(n));
  }

  private arrow(x: number, y: number, nx: number, ny: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - nx * 9 - ny * 5, y - ny * 9 + nx * 5);
    ctx.lineTo(x - nx * 9 + ny * 5, y - ny * 9 - nx * 5);
    ctx.fill();
  }

  private label(text: string, x: number, y: number, active: boolean) {
    const { ctx } = this;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - w / 2, y - 8, w, 16);
    ctx.fillStyle = active ? "#1a73e8" : "#5f6368";
    ctx.fillText(text, x, y);
  }

  private drawEdge(e: DerivedEdge) {
    const { ctx, g } = this;
    const [u, v] = [this.body(e.source), this.body(e.target)];
    if (!u || !v) return;
    const dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    const [rs, rt] = [radius(g.nodes[e.source]) + 2, radius(g.nodes[e.target]) + 4];
    const [x1, y1, x2, y2] = [u.x + nx * rs, u.y + ny * rs, v.x - nx * rt, v.y - ny * rt];
    const active = this.selected === e.source || this.selected === e.target;
    const typeOf = e.kind === "typeOf";

    ctx.strokeStyle = ctx.fillStyle = active ? "#1a73e8" : typeOf ? "#bdc1c6" : "#80868b";
    ctx.lineWidth = active ? 2 : 1.4;
    ctx.setLineDash(typeOf ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    this.arrow(x2, y2, nx, ny);
    if (this.zoom > 0.5 && !typeOf) this.label(e.relation, (x1 + x2) / 2, (y1 + y2) / 2, active);
  }

  /** Where the line from a card's center towards (dx, dy) leaves the card. */
  private cardEdge(id: string, dx: number, dy: number) {
    const card = this.cards.get(id)!;
    const t = Math.min(card.w / 2 / Math.abs(dx || 1e-9), card.h / 2 / Math.abs(dy || 1e-9));
    return { x: dx * t, y: dy * t };
  }

  /** Model edge: from the source card to the target card, labelled with the link column; self-links as a loop. */
  private drawRelation(e: DerivedEdge) {
    const { ctx } = this;
    const [u, v] = [this.body(e.source), this.body(e.target)];
    if (!u || !v) return;
    const active = this.selected === e.source || this.selected === e.target;
    ctx.strokeStyle = ctx.fillStyle = active ? "#1a73e8" : "#80868b";
    ctx.lineWidth = active ? 2 : 1.5;
    if (e.source === e.target) {
      const card = this.cards.get(e.source)!;
      const [x, y] = [u.x + card.w / 2, u.y - card.h / 2 + 14];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 60, y - 40, x + 60, y + 40, x, y + 18);
      ctx.stroke();
      this.arrow(x, y + 18, -1, 0.2);
      if (this.zoom > 0.4) this.label(e.relation, x + 50, y + 9, active);
      return;
    }
    const dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy) || 1;
    const a = this.cardEdge(e.source, dx, dy), b = this.cardEdge(e.target, -dx, -dy);
    const [x1, y1, x2, y2] = [u.x + a.x, u.y + a.y, v.x + b.x - (dx / d) * 2, v.y + b.y - (dy / d) * 2];
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    this.arrow(x2, y2, dx / d, dy / d);
    if (this.zoom > 0.4) this.label(e.relation, (x1 + x2) / 2, (y1 + y2) / 2, active);
  }

  /** Model node: a card with the type's name, row count and properties. Hidden sheets are drawn faint. */
  private drawCard(t: GraphNode) {
    const { ctx } = this;
    const b = this.body(t.id)!;
    const card = this.cards.get(t.id)!;
    const color = t.color ?? "#5f6368";
    const sel = this.selected === t.id;
    const [x, y] = [b.x - card.w / 2, b.y - card.h / 2];
    ctx.save();
    if (t.hiddenSheet) ctx.globalAlpha = 0.55;
    ctx.shadowColor = "rgb(60 64 67 / 25%)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(x, y, card.w, card.h, 8);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? "#1a73e8" : color;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x, y, card.w, CARD_HEAD, [8, 8, 0, 0]);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(this.fitText(t.label ?? "", card.w - 70), x + 10, y + CARD_HEAD / 2);
    ctx.textAlign = "right";
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`${card.rows}${t.hiddenSheet ? " · hidden" : ""}`, x + card.w - 10, y + CARD_HEAD / 2);

    ctx.textAlign = "left";
    const shown = card.cols.slice(0, CARD_MAX_LINES);
    shown.forEach((c, i) => {
      const ly = y + CARD_HEAD + 4 + CARD_LINE * i + CARD_LINE / 2;
      const isName = c.key === t.nameKey;
      ctx.fillStyle = isName ? "#0b57d0" : "#5f6368";
      ctx.font = `11px ${FONT}`;
      ctx.fillText(isName ? "◆" : ICON[c.type], x + 10, ly);
      ctx.fillStyle = "#202124";
      ctx.font = `${isName ? "600 " : ""}12px ${FONT}`;
      const target = c.type === "relation" && c.targetTypeId ? ` → ${this.g.nodes[c.targetTypeId]?.label ?? "?"}` : "";
      ctx.fillText(this.fitText(`${c.label}${target}`, card.w - 40), x + 30, ly);
    });
    if (card.cols.length > CARD_MAX_LINES) {
      ctx.fillStyle = "#5f6368";
      ctx.font = `italic 11px ${FONT}`;
      ctx.fillText(`+ ${card.cols.length - CARD_MAX_LINES} more`, x + 30, y + CARD_HEAD + 4 + CARD_LINE * CARD_MAX_LINES + CARD_LINE / 2);
    }
    ctx.restore();
  }

  private fitText(text: string, max: number) {
    const { ctx } = this;
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
  }

  private drawNode(n: GraphNode) {
    const { ctx } = this;
    const b = this.body(n.id)!;
    const color = nodeColor(this.g, n);
    const r = radius(n);
    const sel = this.selected === n.id;

    ctx.beginPath();
    if (n.isType) ctx.roundRect(b.x - r, b.y - r, r * 2, r * 2, 5);
    else ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = n.isType ? color : "#fff";
    ctx.fill();
    ctx.lineWidth = sel ? 4 : 2;
    ctx.strokeStyle = sel ? "#1a73e8" : color;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = n.isType ? "#fff" : color;
    const name = nodeName(this.g, n);
    if (!n.isType) ctx.fillText((name.trim()[0] ?? "?").toUpperCase(), b.x, b.y);
    ctx.font = `${n.isType ? "600 11" : "12"}px ${FONT}`;
    ctx.fillStyle = "#202124";
    ctx.fillText(name || "—", b.x, b.y + r + 12);
  }
}
