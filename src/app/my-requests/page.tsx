import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { isPreview } from "@/lib/db";
import { previewActor } from "@/lib/fixtures";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const preview = isPreview();
  const actor = preview ? previewActor : await currentActor();
  if (!actor) redirect("/login");
  return <Workspace actor={actor} preview={preview} initialSelfService />;
}
