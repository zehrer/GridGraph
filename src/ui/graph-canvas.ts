import { edgesOf, nodeColor, nodeName } from "../model/graph";
import type { DerivedEdge, Graph, GraphNode } from "../model/types";

interface Body { x: number; y: number; vx: number; vy: number; pinned?: boolean }

const FONT = "Roboto, -apple-system, 'Segoe UI', Arial, sans-serif";
const radius = (n: GraphNode) => (n.isType ? 30 : 22);

/** Layout positions survive view switches; they are not part of the saved data. */
const bodies = new Map<string, Body>();

export interface CanvasEvents {
  select: (id: string | null) => void;
  open: (id: string) => void;
  connect: (source: string, target: string) => void;
}

/** Canvas renderer with a force-directed layout, pan/zoom, drag and shift-drag to connect. */
export class GraphCanvas {
  private ctx: CanvasRenderingContext2D;
  private g: Graph = { nodes: {}, edges: {} };
  private edges: DerivedEdge[] = [];
  private pan = { x: 0, y: 0 };
  private zoom = 1;
  private alpha = 1;
  private frame = 0;
  private drag: { id?: string; connect?: boolean; px: number; py: number; moved?: boolean } | null = null;
  private pointer = { x: 0, y: 0 };
  private sized = false;
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

  setGraph(g: Graph) {
    this.g = g;
    this.edges = edgesOf(g);
    for (const n of Object.values(g.nodes)) {
      if (bodies.has(n.id)) continue;
      const near = n.typeId ? bodies.get(n.typeId) : undefined;
      const spread = near ? 120 : 400;
      bodies.set(n.id, { x: (near?.x ?? 0) + (Math.random() - 0.5) * spread, y: (near?.y ?? 0) + (Math.random() - 0.5) * spread, vx: 0, vy: 0 });
    }
    this.kick();
  }

  focus(id: string) {
    const b = bodies.get(id);
    this.selected = id;
    if (b) this.pan = { x: this.canvas.clientWidth / 2 - b.x * this.zoom, y: this.canvas.clientHeight / 2 - b.y * this.zoom };
    this.draw();
  }

  zoomBy(f: number) {
    const [cx, cy] = [this.canvas.clientWidth / 2, this.canvas.clientHeight / 2];
    this.zoomAt(cx, cy, f);
  }

  fit() {
    const pts = Object.keys(this.g.nodes).map((id) => bodies.get(id)!).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const [w, h] = [this.canvas.clientWidth, this.canvas.clientHeight];
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    this.zoom = Math.min(Math.max(Math.min(w / (maxX - minX + 200), h / (maxY - minY + 200)), 0.2), 1.6);
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
    const ns = Object.values(this.g.nodes);
    const bs = ns.map((n) => bodies.get(n.id)!);
    const a = this.alpha;
    for (let i = 0; i < bs.length; i++) {
      const u = bs[i];
      for (let j = i + 1; j < bs.length; j++) {
        const v = bs[j];
        let dx = v.x - u.x, dy = v.y - u.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) (dx = Math.random() - 0.5), (dy = Math.random() - 0.5), (d2 = 1);
        const f = (((ns[i].isType || ns[j].isType) ? 18000 : 12000) / (d2 + 100)) * a / Math.sqrt(d2);
        u.vx -= dx * f; u.vy -= dy * f; v.vx += dx * f; v.vy += dy * f;
      }
      u.vx -= u.x * 0.02 * a;
      u.vy -= u.y * 0.02 * a;
    }
    for (const e of this.edges) {
      const u = bodies.get(e.source), v = bodies.get(e.target);
      if (!u || !v) continue;
      const dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy) || 1;
      const f = ((d - (e.kind === "typeOf" ? 100 : 130)) * 0.04 * a) / d;
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
    return Object.values(this.g.nodes).reverse().find((n) => {
      const b = bodies.get(n.id)!;
      return Math.hypot(b.x - p.x, b.y - p.y) <= radius(n) + 4;
    });
  }

  private down = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const n = this.hit(e);
    this.drag = { id: n?.id, connect: !!n && e.shiftKey, px: e.offsetX, py: e.offsetY };
    if (n && !e.shiftKey) bodies.get(n.id)!.pinned = true;
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
      Object.assign(bodies.get(d.id)!, this.pointer);
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
    if (d.id) bodies.get(d.id)!.pinned = false;
    const target = this.hit(e);
    if (d.connect && d.id && target && target.id !== d.id) this.on.connect(d.id, target.id);
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
    this.sized = true;
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
    for (const e of this.edges) this.drawEdge(e);
    const d = this.drag;
    if (d?.connect && d.id) {
      const b = bodies.get(d.id)!;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#1a73e8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(this.pointer.x, this.pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of Object.values(this.g.nodes)) this.drawNode(n);
  }

  private drawEdge(e: DerivedEdge) {
    const { ctx, g } = this;
    const [u, v] = [bodies.get(e.source), bodies.get(e.target)];
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
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - nx * 9 - ny * 5, y2 - ny * 9 + nx * 5);
    ctx.lineTo(x2 - nx * 9 + ny * 5, y2 - ny * 9 - nx * 5);
    ctx.fill();

    if (this.zoom > 0.5 && !typeOf) {
      const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
      ctx.font = `11px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(e.relation).width + 10;
      ctx.fillStyle = "#fff";
      ctx.fillRect(mx - w / 2, my - 8, w, 16);
      ctx.fillStyle = active ? "#1a73e8" : "#5f6368";
      ctx.fillText(e.relation, mx, my);
    }
  }

  private drawNode(n: GraphNode) {
    const { ctx } = this;
    const b = bodies.get(n.id)!;
    const color = nodeColor(this.g, n);
    const r = radius(n);
    const sel = this.selected === n.id;

    ctx.beginPath();
    if (n.isType) ctx.roundRect(b.x - r, b.y - r, r * 2, r * 2, 8);
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
    ctx.fillText(n.isType ? "T" : (name.trim()[0] ?? "?").toUpperCase(), b.x, b.y);
    ctx.font = `${n.isType ? "600 " : ""}12px ${FONT}`;
    ctx.fillStyle = "#202124";
    ctx.fillText(name || "—", b.x, b.y + r + 12);
  }
}
