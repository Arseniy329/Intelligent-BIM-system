"use client";

import { useState } from "react";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { UsersTable } from "@/components/admin/users-table";
import { Button } from "@/components/ui/button";
import { useAdminUsersQuery } from "@/hooks/useAdminUsers";
import { UserPlus, Users } from "lucide-react";

export default function AdminUsersPage() {
  const { data: users, isLoading } = useAdminUsersQuery();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--bim-color-text-primary)]">
            Керування користувачами
          </h2>
          <p className="mt-1 text-xs text-[var(--bim-color-text-secondary)] sm:text-sm">
            Перегляд списку облікових записів, керування ролями та активацією користувачів
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-[var(--bim-radius-md)] border border-[var(--bim-color-border-default)] bg-[var(--bim-color-surface-subtle)] px-3 py-1.5 text-xs text-[var(--bim-color-text-secondary)]">
            <Users
              className="size-3.5 text-[var(--bim-color-brand-primary)]"
              aria-hidden="true"
            />
            <span>
              {isLoading
                ? "Завантаження…"
                : `Всього користувачів: ${users?.length ?? 0}`}
            </span>
          </div>

          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            data-testid="create-user-button"
            className="gap-1.5"
            aria-label="Створити користувача"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            <span>+ Створити користувача</span>
          </Button>
        </div>
      </div>

      {/* Create User Modal Dialog */}
      <CreateUserDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />

      {/* Main Users Table */}
      <UsersTable />
    </div>
  );
}
