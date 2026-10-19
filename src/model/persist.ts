import { del, get, set } from "idb-keyval";
import { emptyGraph } from "./graph";
import { fromJSON } from "./io";
import { newDbInfo, useStore, type DbInfo } from "./store";
import type { Graph } from "./types";

// IndexedDB layout: an index of all databases, one entry per graph, and the last opened id.
const INDEX = "databases";
const LAST = "lastDatabase";
const key = (id: string) => `db:${id}`;

const listDbs = async () => (await get<DbInfo[]>(INDEX)) ?? [];

/** Opens the last used database and autosaves every change (debounced). */
export async function initPersistence() {
  try {
    let dbs = await listDbs();
    // Version 0.2 kept a single graph under "graph".
    const legacy = await get<Graph>("graph");
    if (legacy?.nodes) {
      const info = newDbInfo();
      await set(key(info.id), legacy);
      await set(INDEX, (dbs = [info, ...dbs]));
      await del("graph");
    }
    const lastId = await get<string>(LAST);
    const info = dbs.find((d) => d.id === lastId) ?? dbs[0];
    const graph = info && (await get<Graph>(key(info.id)));
    useStore.getState().open(graph ?? emptyGraph(), graph ? info : newDbInfo());
    useStore.setState({ dbs });
  } catch (e) {
    useStore.setState({ saveError: String(e) });
  }
  useStore.subscribe((s, prev) => s.revision !== prev.revision && schedule());
  receiveFromExport();
}

/**
 * "Open in GridGraph" in an HTML export opens this app with #import and sends the embedded
 * database by postMessage once we report ready. The user confirms before anything is saved.
 */
export function receiveFromExport() {
  if (location.hash !== "#import" || !window.opener) return;
  history.replaceState(null, "", location.pathname + location.search);
  let done = false;
  window.addEventListener("message", async (e: MessageEvent) => {
    if (done || e.source !== window.opener || e.data?.type !== "gridgraph-data" || typeof e.data.json !== "string") return;
    done = true;
    const name = String(e.data.name || "Imported");
    if (!confirm(`Open "${name}" from the exported file as a new database in this browser?`)) return;
    try {
      await openNew(fromJSON(e.data.json), name);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  });
  window.opener.postMessage({ type: "gridgraph-ready" }, "*");
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

function schedule() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

/** Writes the open database now if it has unsaved changes. */
export async function flush() {
  if (!pending) return;
  pending = false;
  clearTimeout(timer);
  const { graph, db } = useStore.getState();
  const info = { ...db, updatedAt: Date.now() };
  try {
    await set(key(info.id), graph);
    const dbs = [info, ...(await listDbs()).filter((d) => d.id !== info.id)];
    await set(INDEX, dbs);
    await set(LAST, info.id);
    useStore.setState({ dbs, savedAt: new Date(info.updatedAt), saveError: null });
  } catch (e) {
    useStore.setState({ saveError: String(e) });
  }
}

/** Saves the current database, then shows `graph` as a new one (saved right away if it has content). */
export async function openNew(graph: Graph, name?: string) {
  await flush();
  useStore.getState().open(graph, newDbInfo(name), Object.keys(graph.nodes).length > 0);
}

export async function openDatabase(id: string) {
  await flush();
  const info = (await listDbs()).find((d) => d.id === id);
  const graph = await get<Graph>(key(id));
  if (!info || !graph) return;
  useStore.getState().open(graph, info);
  await set(LAST, id);
}

/** Deletes a saved database; if it is open, switches to the most recent other one. */
export async function deleteDatabase(id: string) {
  const dbs = (await listDbs()).filter((d) => d.id !== id);
  await del(key(id));
  await set(INDEX, dbs);
  useStore.setState({ dbs });
  if (useStore.getState().db.id === id) {
    pending = false;
    clearTimeout(timer);
    if (dbs[0]) await openDatabase(dbs[0].id);
    else useStore.getState().open(emptyGraph(), newDbInfo());
  }
}
