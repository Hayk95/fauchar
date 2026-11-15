"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { workspaceHtml } from "@/content/workspaceHtml";
import { clearSession, getStoredUser, me } from "@/lib/api";
import { initViewer } from "@/lib/client/viewer";
import { initWorkspaceApp } from "@/lib/client/workspace-app";

export default function WorkspaceClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

    root.style.visibility = "hidden";
    root.innerHTML = workspaceHtml;
    delete document.documentElement.dataset.faucharWorkspace;
    document.documentElement.classList.add("js");
    bootedRef.current = true;

    try {
      if (!root.querySelector("#view")) {
        throw new Error("Workspace shell failed to mount.");
      }
      // Clear legacy hash routes if present.
      if (window.location.hash.startsWith("#/")) {
        const legacy = window.location.hash.slice(1);
        window.history.replaceState(null, "", `/workspace${legacy === "/dashboard" ? "" : legacy}`);
      }
      initViewer();
      Promise.resolve(initWorkspaceApp()).then(() => {
        if (root.isConnected) root.style.visibility = "visible";
      }).catch((error) => setBootError(error.message || "Workspace failed to start."));
    } catch (err) {
      console.error(err);
      setBootError((err as Error).message || "Workspace failed to start.");
      bootedRef.current = false;
    }

    return () => {
      delete document.documentElement.dataset.faucharWorkspace;
      delete document.documentElement.dataset.dentalSession;
      delete document.documentElement.dataset.dentalIntake;
      bootedRef.current = false;
      root.innerHTML = "";
    };
  }, [allowed]);

  // Keep SPA router in sync when Next.js path changes (browser back/forward via Next).
  useEffect(() => {
    if (!allowed || !bootedRef.current) return;
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [allowed, pathname, searchParams]);

  if (!allowed) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0B1114",
          color: "#8A929A",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <p>Checking account…</p>
      </main>
    );
  }

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

  return <div ref={rootRef} id="workspace-root" />;
}
