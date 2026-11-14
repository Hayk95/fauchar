import type { Metadata } from "next";
import { ProjectsClient } from "@/components/auth/ProjectsClient";

export const metadata: Metadata = {
  title: "Projects",
  robots: { index: false, follow: false },
};

export default function ProjectsPage() {
  return <ProjectsClient />;
}
