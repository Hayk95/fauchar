import { Suspense } from "react";
import WorkspaceClient from "@/components/workspace/WorkspaceClient";
import BootScreen, { bootKind } from "@/components/workspace/BootScreen";

export default async function WorkspacePage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const kind = bootKind(`/workspace/${slug.join("/")}`);
  return (
    <Suspense fallback={<BootScreen kind={kind} />}>
      <WorkspaceClient />
    </Suspense>
  );
}
