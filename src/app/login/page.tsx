import { cookies } from "next/headers";
import { isPreview } from "@/lib/db";
import { refreshCookie, safeNext } from "@/lib/auth";
import LoginForm from "@/components/login-form";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const preview = isPreview();
  const next = safeNext((await searchParams)?.next);
  // A device that chose "keep me signed in" is signed back in quietly
  // instead of seeing the form (the refresh itself happens in the browser,
  // where the rotated cookies can be set).
  const resume = !preview && !!(await cookies()).get(refreshCookie)?.value;
  return <LoginForm preview={preview} next={next} resume={resume} />;
}
