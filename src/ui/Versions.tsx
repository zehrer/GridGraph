import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../model/store";
import { checkIn, describe, openChanges, summarize, type Commit } from "../model/history";

const LIST_MAX = 200;
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** File → Check in: records the open changes as the next version, with an optional note. */
export function CheckIn({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const { graph, history, setHistory } = useStore();
  const changes = openChanges(history.head, graph);
  const [message, setMessage] = useState("");
  const next = (history.commits.at(-1)?.no ?? 0) + 1;

  return (
    <dialog ref={ref} className="dialog versions" onClose={onClose}>
      <form method="dialog" onSubmit={() => setHistory(checkIn(history, graph, message))}>
        <h3>Check in version {next}</h3>
        {changes.length ? (
          <>
            <p className="hint">{summarize(changes)} since version {next - 1}.</p>
            <ChangeList lines={changes.map((c) => describe(c, graph, history.head))} />
            <label>
              <span>Note</span>
              <input className="wide" autoFocus placeholder="What changed? (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
          </>
        ) : (
          <p>There are no changes since version {next - 1}.</p>
        )}
        <footer>
          <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="primary" disabled={!changes.length}>Check in</button>
        </footer>
      </form>
    </dialog>
  );
}

/** File → History: the checked-in versions, newest first, each with its changes. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const { graph, history } = useStore();
  const open = openChanges(history.head, graph);
  const commits = useMemo(() => [...history.commits].reverse(), [history]);

  return (
    <dialog ref={ref} className="dialog versions" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <form method="dialog">
        <h3>History</h3>
        <p className="hint">
          {open.length ? `Not checked in: ${summarize(open)}.` : "Everything is checked in."} Only data and columns are versioned; widths, formats, filters and views are not.
        </p>
        <ol className="commits">
          {commits.map((c) => <CommitItem key={c.no} commit={c} />)}
        </ol>
        <footer>
          <button className="primary">Close</button>
        </footer>
      </form>
    </dialog>
  );
}

function CommitItem({ commit: c }: { commit: Commit }) {
  const { graph, history } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" className="commit" disabled={!c.changes.length} onClick={() => setOpen(!open)}>
        <b>v{c.no}</b>
        <span className="when">{when(c.at)}</span>
        <span className="msg">{c.message || (c.kind === "initial" ? "Start of history" : "Check-in")}</span>
        <span className="sum">{c.kind === "initial" ? "" : summarize(c.changes)}</span>
      </button>
      {open && <ChangeList lines={c.changes.map((x) => describe(x, graph, history.head))} />}
    </li>
  );
}

function ChangeList({ lines }: { lines: string[] }) {
  return (
    <ul className="changes">
      {lines.slice(0, LIST_MAX).map((l, i) => <li key={i}>{l}</li>)}
      {lines.length > LIST_MAX && <li className="more">… and {lines.length - LIST_MAX} more</li>}
    </ul>
  );
}
