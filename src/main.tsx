import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import planegcsWasm from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { App } from "./ui/App";
import { setSolver, useApp, toast, t } from "./app/store";
import { startRegen } from "./app/regen";
import { getPref } from "./app/storage";
import { PlanegcsSolver } from "./core/sketch/solver-planegcs";
import "./styles.css";

useApp.setState({ ortho: getPref("ortho", false) });

make_gcs_wrapper(new URL(planegcsWasm, location.href).href).then(
  (gcs) => setSolver(new PlanegcsSolver(gcs)),
  () => toast(t("The sketch solver failed to load; constraints won't be solved.", "Решатель эскизов не загрузился; ограничения не решаются."), true),
);
startRegen();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Hosted (split-module) builds run inside a frame where service workers are unavailable.
const hosted = !!(globalThis as { __COCOACAD_WASM_PARTS__?: unknown }).__COCOACAD_WASM_PARTS__;
if ("serviceWorker" in navigator && import.meta.env.PROD && !hosted) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
