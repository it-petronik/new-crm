import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { previewActor } from "@/lib/fixtures";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home({
  params,
  searchParams,
}: {
  params?: Promise<{ path?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preview = isPreview();
  const actor = preview ? previewActor : await currentActor();
  if (!actor) redirect("/login");
  // The route is resolved on the server so the first paint is the right page.
  const segments = (await params)?.path;
  const path = segments?.length ? `/workspace/${segments.join("/")}` : "/";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries((await searchParams) || {}))
    if (typeof value === "string") query.set(key, value);
  return (
    <Workspace
      actor={actor}
      preview={preview}
      initialPath={path}
      initialSearch={query.toString()}
    />
  );
}
