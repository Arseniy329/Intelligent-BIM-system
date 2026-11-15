"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUserMutation } from "@/hooks/useAdminUsers";
import { getAdminErrorMessage } from "@/lib/api/admin-users";
import type { UserRole } from "@/types/admin-user";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export interface CreateUserDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

interface FormErrors {
  email?: string;
  password?: string;
}

/**
 * Modal dialog for administrators to create a new user account (US26 Phase 4).
 * Supports email, temporary password (>=8 chars), and role (engineer/admin).
 */
export function CreateUserDialog({
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  trigger,
}: CreateUserDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen =
    setControlledOpen !== undefined ? setControlledOpen : setInternalOpen;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("engineer");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [backendError, setBackendError] = useState<string | null>(null);

  const createUserMutation = useCreateUserMutation();

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setRole("engineer");
    setShowPassword(false);
    setErrors({});
    setBackendError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    setIsOpen(nextOpen);
  };

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      nextErrors.email = "Вкажіть адресу електронної пошти.";
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextErrors.email = "Вкажіть коректну адресу електронної пошти.";
    }

    if (!password) {
      nextErrors.password = "Вкажіть тимчасовий пароль.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Пароль має містити щонайменше ${MIN_PASSWORD_LENGTH} символів.`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBackendError(null);

    if (!validate()) {
      return;
    }

    createUserMutation.mutate(
      {
        email: email.trim(),
        password,
        role,
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
        onError: (err) => {
          setBackendError(getAdminErrorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md" data-testid="create-user-dialog">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <div className="flex items-center gap-2 text-[var(--bim-color-text-primary)]">
              <div className="flex size-9 items-center justify-center rounded-[var(--bim-radius-md)] bg-[var(--bim-color-brand-primary-subtle)] text-[var(--bim-color-brand-primary)]">
                <UserPlus className="size-5" aria-hidden="true" />
              </div>
              <DialogTitle>Створити нового користувача</DialogTitle>
            </div>
            <DialogDescription>
              Створіть обліковий запис для інженера або адміністратора системи.
              Користувач зможе увійти за вказаним паролем.
            </DialogDescription>
          </DialogHeader>

          {/* Backend Error Alert */}
          {backendError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--bim-radius-md)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-3 text-xs text-[var(--bim-color-semantic-error)]"
            >
              <AlertCircle
                className="size-4 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{backendError}</span>
            </div>
          )}

          {/* Email Field */}
          <div className="space-y-1.5">
            <Label htmlFor="create-user-email">
              Електронна пошта{" "}
              <span className="text-[var(--bim-color-semantic-error)]">*</span>
            </Label>
            <Input
              id="create-user-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) {
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              placeholder="engineer@company.ua"
              disabled={createUserMutation.isPending}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={
                errors.email ? "create-user-email-error" : undefined
              }
            />
            {errors.email && (
              <p
                id="create-user-email-error"
                role="alert"
                className="text-xs text-[var(--bim-color-semantic-error)]"
              >
                {errors.email}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-1.5">
            <Label htmlFor="create-user-password">
              Тимчасовий пароль{" "}
              <span className="text-[var(--bim-color-semantic-error)]">*</span>
            </Label>
            <div className="relative">
              <Input
                id="create-user-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) {
                    setErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                placeholder="Щонайменше 8 символів"
                disabled={createUserMutation.isPending}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "create-user-password-error" : undefined
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={createUserMutation.isPending}
                aria-label={
                  showPassword ? "Приховати пароль" : "Показати пароль"
                }
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--bim-color-text-secondary)] hover:text-[var(--bim-color-text-primary)] focus-visible:outline-none"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {errors.password && (
              <p
                id="create-user-password-error"
                role="alert"
                className="text-xs text-[var(--bim-color-semantic-error)]"
              >
                {errors.password}
              </p>
            )}
          </div>

          {/* Role Selection Field */}
          <div className="space-y-1.5">
            <Label htmlFor="create-user-role">Роль у системі</Label>
            <Select
              value={role}
              onValueChange={(val) => setRole(val as UserRole)}
              disabled={createUserMutation.isPending}
            >
              <SelectTrigger
                id="create-user-role"
                data-testid="create-user-role-select"
                aria-label="Вибір ролі користувача"
              >
                <SelectValue placeholder="Виберіть роль" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="engineer">
                  <div className="flex flex-col">
                    <span className="font-medium">Інженер</span>
                    <span className="text-[11px] text-[var(--bim-color-text-secondary)]">
                      Завантаження та перегляд креслень
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex flex-col">
                    <span className="font-medium">Адміністратор</span>
                    <span className="text-[11px] text-[var(--bim-color-text-secondary)]">
                      Повний доступ до панелі керування та користувачів
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dialog Action Buttons */}
          <DialogFooter className="mt-6 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={createUserMutation.isPending}
            >
              Скасувати
            </Button>
            <Button
              type="submit"
              disabled={createUserMutation.isPending}
              data-testid="create-user-submit-button"
            >
              {createUserMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Створення…
                </span>
              ) : (
                "Створити користувача"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
