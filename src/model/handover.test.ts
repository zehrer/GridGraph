import { describe, expect, it, vi } from "vitest";
import { receiveFromExport } from "./persist";
import { toHTML } from "./html-export";
import { embeddedJSON } from "./io";
import { sampleGraph } from "./sample";
import { useStore } from "./store";

describe("Open in GridGraph (HTML export → app)", () => {
  it("reports ready to the export page and opens the data it sends, after confirmation", async () => {
    const posted: unknown[] = [];
    const opener = { postMessage: (msg: unknown) => posted.push(msg) };
    Object.defineProperty(window, "opener", { value: opener, configurable: true });
    history.replaceState(null, "", "/#import");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    receiveFromExport();
    expect(posted).toEqual([{ type: "gridgraph-ready" }]);
    expect(location.hash).toBe("");

    const json = embeddedJSON(toHTML(sampleGraph(), "Shared demo", "https://zehrer.github.io/GridGraph/"))!;
    window.dispatchEvent(new MessageEvent("message", { source: opener as unknown as Window, data: { type: "gridgraph-data", name: "Shared demo", json } }));
    await vi.waitFor(() => expect(useStore.getState().db.name).toBe("Shared demo"));
    expect(useStore.getState().graph.nodes.person_alice.props.name).toBe("Alice Schmidt");
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it("ignores messages from other windows", () => {
    Object.defineProperty(window, "opener", { value: { postMessage: () => {} }, configurable: true });
    history.replaceState(null, "", "/#import");
    const before = useStore.getState().db.id;
    receiveFromExport();
    window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "gridgraph-data", name: "X", json: "{}" } }));
    expect(useStore.getState().db.id).toBe(before);
  });
});
