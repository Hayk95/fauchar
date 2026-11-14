import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace/WorkspaceClient";

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
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
          <p>Loading workspace…</p>
        </main>
      }
    >
      <WorkspaceClient />
    </Suspense>
  );
}
