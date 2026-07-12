import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; resetSuccess?: string }>;
}) {
  const { next, resetSuccess } = await searchParams;

  return <LoginForm next={next} showResetSuccess={resetSuccess === "1"} />;
}
