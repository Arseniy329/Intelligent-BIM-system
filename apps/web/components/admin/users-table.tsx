"use client";

import { useState } from "react";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useAdminUsersQuery, useUpdateUserMutation } from "@/hooks/useAdminUsers";
import { useCurrentUserQuery } from "@/hooks/useCurrentUser";
import type { ManagedUser, UserRole } from "@/types/admin-user";

export function formatUkrainianDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return isoString;
  }
}

export interface UsersTableProps {
  users?: ManagedUser[];
  currentUserId?: string;
}

export function UsersTable({
  users: initialUsers,
  currentUserId: explicitCurrentUserId,
}: UsersTableProps = {}) {
  const {
    data: fetchedUsers,
    isLoading: isUsersLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useAdminUsersQuery();

  const { data: currentUser, isLoading: isCurrentUserLoading } =
    useCurrentUserQuery();
  const updateUserMutation = useUpdateUserMutation();

  const [userToDeactivate, setUserToDeactivate] = useState<ManagedUser | null>(
    null,
  );

  const users = initialUsers ?? fetchedUsers;
  const currentUserId = explicitCurrentUserId ?? currentUser?.id;
  const isLoading = (initialUsers === undefined && isUsersLoading) || isCurrentUserLoading;

  // Active mutation target tracking
  const pendingUserId =
    updateUserMutation.isPending && updateUserMutation.variables
      ? "userId" in updateUserMutation.variables
        ? updateUserMutation.variables.userId
        : undefined
      : undefined;

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    updateUserMutation.mutate({ userId, role: newRole });
  };

  const handleActivate = (userId: string) => {
    updateUserMutation.mutate({ userId, isActive: true });
  };

  const handleConfirmDeactivate = () => {
    if (!userToDeactivate) return;
    const userId = userToDeactivate.id;
    updateUserMutation.mutate(
      { userId, isActive: false },
      {
        onSettled: () => {
          setUserToDeactivate(null);
        },
      },
    );
  };

  // 1. Loading Skeleton State
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Завантаження списку користувачів"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Email</TableHead>
              <TableHead className="w-[20%]">Роль</TableHead>
              <TableHead className="w-[15%]">Статус</TableHead>
              <TableHead className="w-[20%]">Дата створення</TableHead>
              <TableHead className="w-[15%] text-right">Дії</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 4 }).map((_, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Skeleton className="h-5 w-44" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-8 w-28" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-6 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-32" />
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-8 w-24" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  // 2. Error State
  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-semantic-error-border)] bg-[var(--bim-color-semantic-error-bg)] p-6 text-center text-[var(--bim-color-semantic-error)] shadow-[var(--bim-shadow-sm)]"
      >
        <AlertCircle className="mx-auto size-7" aria-hidden="true" />
        <h3 className="mt-2 text-base font-semibold">
          Не вдалося завантажити список користувачів
        </h3>
        <p className="mt-1 text-xs text-[var(--bim-color-text-secondary)]">
          {error?.message || "Перевірте підключення до мережі та спробуйте ще раз."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="mt-4"
        >
          {isFetching ? "Оновлення…" : "Спробувати знову"}
        </Button>
      </div>
    );
  }

  // 3. Empty State
  if (!users || users.length === 0) {
    return (
      <div className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] p-4 shadow-[var(--bim-shadow-sm)]">
        <EmptyState
          title="Користувачів не знайдено"
          description="У системі поки що немає зареєстрованих користувачів."
        />
      </div>
    );
  }

  // 4. Data Table State
  return (
    <>
      <div className="rounded-[var(--bim-radius-xl)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-default)] shadow-[var(--bim-shadow-sm)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Email</TableHead>
              <TableHead className="w-[20%]">Роль</TableHead>
              <TableHead className="w-[15%]">Статус</TableHead>
              <TableHead className="w-[20%]">Дата створення</TableHead>
              <TableHead className="w-[15%] text-right">Дії</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = Boolean(currentUserId && currentUserId === user.id);
              const isPending = pendingUserId === user.id;

              return (
                <TableRow
                  key={user.id}
                  data-testid={`user-row-${user.id}`}
                  className={!user.isActive ? "opacity-75" : undefined}
                >
                  {/* Email Column */}
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[var(--bim-color-text-primary)]"
                        title={user.email}
                      >
                        {user.email}
                      </span>
                      {isSelf && (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px] font-semibold text-[var(--bim-color-brand-primary)]"
                        >
                          Ви
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Role Selection Column */}
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(val) =>
                        handleRoleChange(user.id, val as UserRole)
                      }
                      disabled={isSelf || isPending}
                    >
                      <SelectTrigger
                        data-testid={`role-select-${user.id}`}
                        aria-label={`Роль користувача ${user.email}`}
                        title={
                          isSelf
                            ? "Ви не можете змінити власну роль (захист від самопониження)"
                            : undefined
                        }
                        className="h-8 w-36 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Адміністратор</SelectItem>
                        <SelectItem value="engineer">Інженер</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>

                  {/* Status Badge Column */}
                  <TableCell>
                    {user.isActive ? (
                      <Badge
                        variant="success"
                        data-testid={`status-badge-${user.id}`}
                      >
                        Активний
                      </Badge>
                    ) : (
                      <Badge
                        variant="muted"
                        data-testid={`status-badge-${user.id}`}
                      >
                        Деактивований
                      </Badge>
                    )}
                  </TableCell>

                  {/* Created Date Column */}
                  <TableCell className="text-xs text-[var(--bim-color-text-secondary)]">
                    {formatUkrainianDate(user.createdAt)}
                  </TableCell>

                  {/* Actions Column */}
                  <TableCell className="text-right">
                    {user.isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`toggle-status-button-${user.id}`}
                        onClick={() => setUserToDeactivate(user)}
                        disabled={isSelf || isPending}
                        title={
                          isSelf
                            ? "Ви не можете деактивувати власний обліковий запис (захист від самоблокування)"
                            : "Деактивувати обліковий запис користувача"
                        }
                        className="h-8 text-xs text-[var(--bim-color-semantic-error)] hover:bg-[var(--bim-color-semantic-error-bg)] hover:text-[var(--bim-color-semantic-error)]"
                      >
                        {isPending ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          "Деактивувати"
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`toggle-status-button-${user.id}`}
                        onClick={() => handleActivate(user.id)}
                        disabled={isSelf || isPending}
                        title={
                          isSelf
                            ? "Ви не можете змінювати власний статус"
                            : "Активувати обліковий запис користувача"
                        }
                        className="h-8 text-xs text-[var(--bim-color-semantic-success)] hover:bg-[var(--bim-color-badge-success-bg)] hover:text-[var(--bim-color-semantic-success)]"
                      >
                        {isPending ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          "Активувати"
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Confirmation Dialog for Deactivation */}
      <Dialog
        open={Boolean(userToDeactivate)}
        onOpenChange={(open) => {
          if (!open && !updateUserMutation.isPending) {
            setUserToDeactivate(null);
          }
        }}
      >
        <DialogContent data-testid="deactivate-confirm-dialog">
          <DialogHeader>
            <div className="flex items-center gap-2 text-[var(--bim-color-semantic-error)]">
              <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
              <DialogTitle>Підтвердження деактивації</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-sm text-[var(--bim-color-text-secondary)]">
              Ви впевнені, що хочете деактивувати користувача{" "}
              <strong className="text-[var(--bim-color-text-primary)]">
                {userToDeactivate?.email}
              </strong>
              ? Деактивований користувач втратить можливість входу в систему та виконання дій.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUserToDeactivate(null)}
              disabled={updateUserMutation.isPending}
            >
              Скасувати
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="confirm-deactivate-button"
              onClick={handleConfirmDeactivate}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Деактивація…
                </span>
              ) : (
                "Деактивувати"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

