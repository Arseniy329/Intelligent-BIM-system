import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Реєстрація</h1>
      <p className="mt-2 text-sm text-[var(--bim-color-text-secondary)]">
        Створіть обліковий запис для роботи з кресленнями.
      </p>

      <RegisterForm />

      <p className="mt-6 text-center text-sm text-[var(--bim-color-text-secondary)]">
        Уже маєте обліковий запис?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--bim-color-border-focus)] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)]"
        >
          Увійти
        </Link>
      </p>
    </div>
  );
}
