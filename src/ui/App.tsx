import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { ModelTree } from "./ModelTree";
import { Properties } from "./Properties";
import { Viewport } from "./Viewport";
import { Toolbar } from "./Toolbar";
import { Dialogs } from "./Dialogs";
import { useApp } from "../app/store";
import { openFileObject } from "../app/files";

const narrow = () => window.matchMedia("(max-width: 1100px)").matches;

export function App() {
  const toasts = useApp((s) => s.toasts);
  const lang = useApp((s) => s.lang);
  const [hideLeft, setHideLeft] = useState(narrow);
  const [hideRight, setHideRight] = useState(narrow);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Open .cocoacad files dropped anywhere on the window.
  useEffect(() => {
    const over = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) {
        e.preventDefault();
        openFileObject(f);
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      <TopBar onTogglePanel={(side) => (side === "left" ? setHideLeft((v) => !v) : setHideRight((v) => !v))} />
      <main id="mid">
        <ModelTree hidden={hideLeft} />
        <section id="stage">
          <Viewport />
          <Toolbar />
        </section>
        <Properties hidden={hideRight} />
      </main>
      <Dialogs />
      <div id="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast${x.bad ? " bad" : ""}`}>
            {x.text}
          </div>
        ))}
      </div>
    </>
  );
}
