"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type RegisterErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
  form?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const minPasswordLength = 8;
const inputClassName =
  "mt-2 block h-10 w-full rounded-lg border border-[var(--bim-color-input-border)] bg-[var(--bim-color-input-bg)] px-3 text-sm text-[var(--bim-color-input-text)] hover:border-[var(--bim-color-input-hover-border)] focus-visible:border-[var(--bim-color-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bim-color-input-focus-ring)] aria-invalid:border-[var(--bim-color-input-error-border)] aria-invalid:hover:border-[var(--bim-color-input-error-border)]";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const validationErrors = [errors.email, errors.password, errors.confirmPassword]
    .filter(Boolean)
    .join(" ");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;

    const normalizedEmail = email.trim();
    const nextErrors: RegisterErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = "Вкажіть адресу електронної пошти.";
    } else if (!emailPattern.test(normalizedEmail)) {
      nextErrors.email = "Вкажіть коректну адресу електронної пошти.";
    }

    if (!password) {
      nextErrors.password = "Вкажіть пароль.";
    } else if (password.length < minPasswordLength) {
      nextErrors.password = `Пароль має містити щонайменше ${minPasswordLength} символів.`;
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = "Повторіть пароль.";
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Паролі не збігаються.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/upload`,
        },
      });

      if (error) {
        setErrors({ form: "Не вдалося зареєструватися. Перевірте дані та спробуйте ще раз." });
        setIsLoading(false);
        return;
      }

      if (data.session) {
        router.replace("/upload");
        router.refresh();
        return;
      }

      setIsRegistered(true);
      setIsLoading(false);
    } catch {
      setErrors({ form: "Не вдалося зареєструватися. Перевірте з’єднання та спробуйте ще раз." });
      setIsLoading(false);
    }
  }

  if (isRegistered) {
    return (
      <p
        role="status"
        className="mt-6 rounded-lg border border-[var(--bim-color-semantic-success-border)] bg-[var(--bim-color-semantic-success-bg)] p-4 text-sm text-[var(--bim-color-semantic-success)]"
      >
        Перевірте свою електронну пошту та перейдіть за посиланням у листі, щоб підтвердити обліковий запис.
      </p>
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
      <p role="alert" aria-atomic="true" className="sr-only">
        {validationErrors}
      </p>
      <div>
        <label htmlFor="register-email" className="block text-xs font-medium">
          Електронна пошта
        </label>
        <input
          id="register-email"
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
          aria-describedby={errors.email ? "register-email-error" : undefined}
          className={inputClassName}
        />
        {errors.email && (
          <p id="register-email-error" className="mt-2 text-sm text-[var(--bim-color-semantic-error)]">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="register-password" className="block text-xs font-medium">
          Пароль
        </label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={minPasswordLength}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((current) => ({ ...current, password: undefined, form: undefined }));
          }}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "register-password-hint register-password-error" : "register-password-hint"}
          className={inputClassName}
        />
        <p id="register-password-hint" className="mt-2 text-sm text-[var(--bim-color-text-secondary)]">
          Щонайменше {minPasswordLength} символів.
        </p>
        {errors.password && (
          <p id="register-password-error" className="mt-2 text-sm text-[var(--bim-color-semantic-error)]">
            {errors.password}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="register-confirm-password" className="block text-xs font-medium">
          Підтвердження пароля
        </label>
        <input
          id="register-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setErrors((current) => ({ ...current, confirmPassword: undefined, form: undefined }));
          }}
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? "register-confirm-password-error" : undefined}
          className={inputClassName}
        />
        {errors.confirmPassword && (
          <p id="register-confirm-password-error" className="mt-2 text-sm text-[var(--bim-color-semantic-error)]">
            {errors.confirmPassword}
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
        {isLoading ? "Реєструємо…" : "Зареєструватися"}
      </button>
    </form>
  );
}
