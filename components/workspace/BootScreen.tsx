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
      <main style={{ minHeight: "100vh", background: "#f7f7f8", color: "#8a8492", fontFamily: "Arial, sans-serif", fontSize: 12 }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", minHeight: 30, padding: "6px 14px", borderBottom: "1px solid #e6e6e8", color: "#6a6570" }}>
          <span style={{ fontWeight: 700, letterSpacing: 1.6, color: "#3a3842" }}>FAUCHAR</span>
          <span>Dental workspace</span>
        </header>
        <p style={{ margin: 0, padding: "16px 18px" }}>{text || "Opening the appointment…"}</p>
      </main>
    );
  }
  if (kind === "case") {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(ellipse at 55% 40%, #8b78a0 0%, #675278 48%, #3d2c50 100%)", color: "#efe8f5", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
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
