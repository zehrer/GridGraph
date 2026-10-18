import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initPersistence } from "./model/store";
import { App } from "./ui/App";
import "./styles.css";

initPersistence().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
