"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type LoginErrors = {
  email?: string;
  password?: string;
  form?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inputClassName =
  "mt-2 block h-10 w-full rounded-lg border border-[var(--bim-color-input-border)] bg-[var(--bim-color-input-bg)] px-3 text-sm text-[var(--bim-color-input-text)] hover:border-[var(--bim-color-input-hover-border)] focus-visible:border-[var(--bim-color-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bim-color-input-focus-ring)] aria-invalid:border-[var(--bim-color-input-error-border)] aria-invalid:hover:border-[var(--bim-color-input-error-border)]";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const validationErrors = [errors.email, errors.password].filter(Boolean).join(" ");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    const normalizedEmail = email.trim();
    const nextErrors: LoginErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = "Вкажіть адресу електронної пошти.";
    } else if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = "Вкажіть коректну адресу електронної пошти.";
    }

    if (!password) {
      nextErrors.password = "Вкажіть пароль.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setErrors({
          form:
            error.code === "email_not_confirmed"
              ? "Підтвердьте адресу електронної пошти за посиланням у листі."
              : "Не вдалося увійти. Перевірте адресу електронної пошти та пароль.",
        });
        setIsLoading(false);
        return;
      }

      router.replace("/upload");
      router.refresh();
    } catch {
      setErrors({ form: "Не вдалося увійти. Перевірте з’єднання та спробуйте ще раз." });
      setIsLoading(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
      <p role="alert" aria-atomic="true" className="sr-only">
        {validationErrors}
      </p>
      <div>
        <label htmlFor="login-email" className="block text-xs font-medium">
          Електронна пошта
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setErrors((current) => ({ ...current, email: undefined, form: undefined }));
          }}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "login-email-error" : undefined}
          className={inputClassName}
        />
        {errors.email && (
          <p id="login-email-error" className="mt-2 text-sm text-[var(--bim-color-semantic-error)]">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="login-password" className="block text-xs font-medium">
          Пароль
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((current) => ({ ...current, password: undefined, form: undefined }));
          }}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "login-password-error" : undefined}
          className={inputClassName}
        />
        {errors.password && (
          <p id="login-password-error" className="mt-2 text-sm text-[var(--bim-color-semantic-error)]">
            {errors.password}
          </p>
        )}
      </div>

      {errors.form && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-3 text-sm text-[var(--bim-color-semantic-error)]"
        >
          {errors.form}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="flex h-10 w-full items-center justify-center rounded-lg bg-[var(--bim-color-button-primary-bg)] px-4 text-sm font-medium text-[var(--bim-color-button-primary-text)] hover:bg-[var(--bim-color-button-primary-hover-bg)] active:bg-[var(--bim-color-button-primary-pressed-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bim-color-border-focus)] disabled:cursor-not-allowed disabled:bg-[var(--bim-color-button-disabled-bg)] disabled:text-[var(--bim-color-button-disabled-text)]"
      >
        {isLoading ? "Входимо…" : "Увійти"}
      </button>
    </form>
  );
}
