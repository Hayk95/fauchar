"use client";

import BootScreen, { bootKind } from "./BootScreen";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { workspaceHtml } from "@/content/workspaceHtml";
import { clearSession, getStoredUser, me } from "@/lib/api";
import { initViewer } from "@/lib/client/viewer";
import { initWorkspaceApp } from "@/lib/client/workspace-app";

export default function WorkspaceClient() {
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bootedRef = useRef(false);
  const [allowed, setAllowed] = useState(false);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = getStoredUser();
      if (!cached) {
        router.replace("/signin");
        return;
      }
      try {
        await me();
        if (!cancelled) setAllowed(true);
      } catch {
        clearSession();
        router.replace("/signin");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!allowed) return;
    const root = rootRef.current;
    if (!root || bootedRef.current) return;

    const path = window.location.pathname;
    const intake = /\/cases\/new\/?$/.test(path);
    const dentalCase = /\/workspace\/case\//.test(path);
    if (intake) document.documentElement.dataset.dentalIntake = "1";
    else delete document.documentElement.dataset.dentalIntake;
    document.documentElement.toggleAttribute("data-dental-session", dentalCase);

    root.innerHTML = workspaceHtml;
    const view = root.querySelector("#view");
    if (view) {
      view.innerHTML = intake
        ? `<div class="page job-intake dentaldb-intake"><header class="db-application-bar"><span class="db-brand">FAUCHAR</span><span>Dental workspace</span></header><p class="db-chart-help">Opening the appointment…</p></div>`
        : dentalCase
          ? `<div class="case-view dental-case"><div class="cad dental-cad"><div class="vp"><div class="vp-overlay"><h3>Opening case</h3><p>Loading the saved design…</p></div></div></div></div>`
          : `<div class="page"><p class="muted">Loading workspace…</p></div>`;
    }
    delete document.documentElement.dataset.faucharWorkspace;
    document.documentElement.classList.add("js");
    bootedRef.current = true;

    let boot: { done?: Promise<void>; dispose?: () => void } | undefined;
    try {
      if (!root.querySelector("#view")) {
        throw new Error("Workspace shell failed to mount.");
      }
      if (window.location.hash.startsWith("#/")) {
        const legacy = window.location.hash.slice(1);
        window.history.replaceState(null, "", `/workspace${legacy === "/dashboard" ? "" : legacy}`);
      }
      initViewer();
      boot = initWorkspaceApp();
      Promise.resolve(boot?.done).catch((error) => setBootError(error?.message || "Workspace failed to start."));
    } catch (err) {
      console.error(err);
      setBootError((err as Error).message || "Workspace failed to start.");
      bootedRef.current = false;
    }

    return () => {
      boot?.dispose?.();
      delete document.documentElement.dataset.faucharWorkspace;
      delete document.documentElement.dataset.dentalSession;
      document.documentElement.removeAttribute("data-dental-session");
      delete document.documentElement.dataset.dentalIntake;
      bootedRef.current = false;
      root.innerHTML = "";
    };
  }, [allowed]);

  if (!allowed) return <BootScreen kind={bootKind(pathname || "")} />;

  if (bootError) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0B1114",
          color: "#ffb4b4",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div>
          <p>{bootError}</p>
          <a href="/signin" style={{ color: "#B7F34A" }}>
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  const kind = bootKind(pathname || "");
  const background = kind === "intake" || kind === "case" ? "#0d1015" : "#0B1114";
  return (
    <div ref={rootRef} id="workspace-root" style={{ minHeight: "100vh", background }}>
      <BootScreen kind={kind} />
    </div>
  );
}
