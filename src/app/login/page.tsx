import { isPreview } from "@/lib/db";
import LoginForm from "@/components/login-form";
export const dynamic = "force-dynamic";
export default function Login() {
  return <LoginForm preview={isPreview()} />;
}
