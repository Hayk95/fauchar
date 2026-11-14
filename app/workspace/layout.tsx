import type { Metadata } from "next";
import "@/styles/app.css";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "FAUCHAR Workspace: dental case management and a CAD-style 3D viewer for STL scans. Local preview — files stay in your browser.",
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
