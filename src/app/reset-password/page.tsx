import { isPreview } from "@/lib/db";
import ResetPasswordForm from "@/components/reset-password-form";
export const dynamic = "force-dynamic";
export default function ResetPasswordPage() {
  return <ResetPasswordForm preview={isPreview()} />;
}
