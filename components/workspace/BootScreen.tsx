/** First paint for each workspace route, so the first frame already looks like the page that opens. */
export type BootKind = "intake" | "case" | "workspace";

export function bootKind(path: string): BootKind {
  if (/\/workspace\/cases\/new\/?$/.test(path)) return "intake";
  if (/\/workspace\/case\//.test(path)) return "case";
  return "workspace";
}

export default function BootScreen({ kind, text }: { kind: BootKind; text?: string }) {
  if (kind === "intake") {
    return (
      <main style={{ minHeight: "100vh", background: "#0d1015", color: "#727c8b", fontFamily: "Arial, sans-serif", fontSize: 12 }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", minHeight: 30, padding: "6px 14px", borderBottom: "1px solid #262c37", background: "#0a0d11", color: "#a3acba" }}>
          <span style={{ fontWeight: 700, letterSpacing: 1.6, color: "#ffffff" }}>FAUCHAR</span>
          <span>Dental workspace</span>
        </header>
        <p style={{ margin: 0, padding: "16px 18px" }}>{text || "Opening the appointment…"}</p>
      </main>
    );
  }
  if (kind === "case") {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(ellipse at 52% 38%, #2b3341 0%, #1a1f28 52%, #0d1015 100%)", color: "#a3acba", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        <p style={{ margin: 0 }}>{text || "Opening case…"}</p>
      </main>
    );
  }
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0B1114", color: "#8A929A", fontFamily: "Inter, system-ui, sans-serif" }}>
      <p>{text || "Loading workspace…"}</p>
    </main>
  );
}
