import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Вхід</h1>
      <p className="mt-2 text-sm text-[var(--bim-color-text-secondary)]">
        Увійдіть, щоб продовжити роботу з кресленнями.
      </p>

      {error === "callback" && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-3 text-sm text-[var(--bim-color-semantic-error)]"
        >
          Не вдалося підтвердити вхід за посиланням. Спробуйте увійти ще раз.
        </p>
      )}

      <LoginForm />

      <p className="mt-6 text-center text-sm text-[var(--bim-color-text-secondary)]">
        Ще немає облікового запису?{" "}
        <Link
          href="/register"
          className="font-medium text-[var(--bim-color-border-focus)] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
        >
          Зареєструватися
        </Link>
      </p>
    </div>
  );
}
