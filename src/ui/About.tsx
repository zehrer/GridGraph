import { useEffect, useRef } from "react";

/** Help → About: version and how GridGraph keeps data. */
export function About({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} className="dialog about" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <form method="dialog">
        <h3>GridGraph</h3>
        <p className="version">Version {__APP_VERSION__} · build {__APP_BUILD__}</p>
        <p>A local, schemaless graph database with a spreadsheet interface.</p>

        <h4>Your data stays in this browser</h4>
        <p>
          GridGraph has no server and no account. Your databases are saved only in this browser's storage (IndexedDB) on
          this device. Nothing you enter is uploaded or sent anywhere.
        </p>
        <p>
          This also means that your data is not synced to other browsers or devices, and that clearing this site's data in
          the browser deletes it. Use <b>File → Export as JSON</b> to keep a backup or to move a database.
        </p>

        <p className="hint">
          Open source: <a href="https://github.com/zehrer/GridGraph" target="_blank" rel="noreferrer">github.com/zehrer/GridGraph</a>
        </p>
        <footer>
          <button className="primary">Close</button>
        </footer>
      </form>
    </dialog>
  );
}
