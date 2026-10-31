// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsersTable } from "@/components/admin/users-table";
import type { ManagedUser } from "@/types/admin-user";

const mutateMock = vi.fn();
const refetchMock = vi.fn();

const { usersQueryState, currentUserQueryState, updateMutationState } =
  vi.hoisted(() => ({
    usersQueryState: {
      value: {
        data: undefined as ManagedUser[] | undefined,
        isLoading: false,
        isError: false,
        error: null as Error | null,
        refetch: vi.fn(),
        isFetching: false,
      },
    },
    currentUserQueryState: {
      value: {
        data: undefined as { id: string; email: string; role: "admin" | "engineer" } | undefined,
        isLoading: false,
      },
    },
    updateMutationState: {
      value: {
        mutate: vi.fn(),
        isPending: false,
        variables: undefined as unknown,
      },
    },
  }));

vi.mock("@/hooks/useAdminUsers", () => ({
  useAdminUsersQuery: () => usersQueryState.value,
  useUpdateUserMutation: () => updateMutationState.value,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUserQuery: () => currentUserQueryState.value,
}));

const mockUsers: ManagedUser[] = [
  {
    id: "user_admin",
    email: "admin@company.ua",
    role: "admin",
    isActive: true,
    createdAt: "2026-10-31T09:00:00Z",
  },
  {
    id: "user_engineer",
    email: "engineer@company.ua",
    role: "engineer",
    isActive: true,
    createdAt: "2026-10-30T10:00:00Z",
  },
  {
    id: "user_inactive",
    email: "blocked@company.ua",
    role: "engineer",
    isActive: false,
    createdAt: "2026-10-25T12:00:00Z",
  },
];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("UsersTable Component (BIM-66 Phase 3)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mutateMock.mockReset();
    refetchMock.mockReset();

    usersQueryState.value = {
      data: mockUsers,
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
      isFetching: false,
    };

    currentUserQueryState.value = {
      data: {
        id: "user_admin",
        email: "admin@company.ua",
        role: "admin",
      },
      isLoading: false,
    };

    updateMutationState.value = {
      mutate: mutateMock,
      isPending: false,
      variables: undefined,
    };
  });

  describe("Rendering Columns & Badges", () => {
    it("renders user rows with email, role, status badges, and formatted date", () => {
      renderWithClient(<UsersTable />);

      // Emails rendered
      expect(screen.getByText("admin@company.ua")).toBeInTheDocument();
      expect(screen.getByText("engineer@company.ua")).toBeInTheDocument();
      expect(screen.getByText("blocked@company.ua")).toBeInTheDocument();

      // "Ви" badge for the current admin
      expect(screen.getByText("Ви")).toBeInTheDocument();

      // Status badges
      const activeBadges = screen.getAllByText("Активний");
      expect(activeBadges).toHaveLength(2);

      const inactiveBadges = screen.getAllByText("Деактивований");
      expect(inactiveBadges).toHaveLength(1);
    });

    it("renders loading skeleton while query is loading", () => {
      usersQueryState.value.isLoading = true;
      renderWithClient(<UsersTable />);

      expect(
        screen.getByLabelText("Завантаження списку користувачів"),
      ).toBeInTheDocument();
    });

    it("renders empty state when users list is empty", () => {
      usersQueryState.value.data = [];
      renderWithClient(<UsersTable />);

      expect(screen.getByText("Користувачів не знайдено")).toBeInTheDocument();
    });

    it("renders error state with retry button on error", () => {
      usersQueryState.value.isError = true;
      usersQueryState.value.error = new Error("Помилка мережі");
      renderWithClient(<UsersTable />);

      expect(
        screen.getByText("Не вдалося завантажити список користувачів"),
      ).toBeInTheDocument();
      expect(screen.getByText("Помилка мережі")).toBeInTheDocument();

      const retryBtn = screen.getByRole("button", { name: "Спробувати знову" });
      fireEvent.click(retryBtn);
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Self-Lockout and Self-Demotion Prevention", () => {
    it("disables role selection and status button for the current admin", () => {
      renderWithClient(<UsersTable />);

      // Current admin row controls: user_admin
      const adminRoleSelect = screen.getByTestId("role-select-user_admin");
      expect(adminRoleSelect).toBeDisabled();

      const adminToggleButton = screen.getByTestId(
        "toggle-status-button-user_admin",
      );
      expect(adminToggleButton).toBeDisabled();
      expect(adminToggleButton).toHaveAttribute(
        "title",
        "Ви не можете деактивувати власний обліковий запис (захист від самоблокування)",
      );

      // Other user controls must be enabled: user_engineer
      const engineerRoleSelect = screen.getByTestId(
        "role-select-user_engineer",
      );
      expect(engineerRoleSelect).not.toBeDisabled();

      const engineerToggleButton = screen.getByTestId(
        "toggle-status-button-user_engineer",
      );
      expect(engineerToggleButton).not.toBeDisabled();
    });
  });

  describe("Role Switching Interaction", () => {
    it("calls update mutation when role is changed", async () => {
      renderWithClient(<UsersTable />);

      const engineerRoleSelect = screen.getByTestId(
        "role-select-user_engineer",
      );
      fireEvent.click(engineerRoleSelect);

      const adminOption = screen.queryByRole("option", {
        name: "Адміністратор",
      });
      if (adminOption) {
        fireEvent.click(adminOption);
        expect(mutateMock).toHaveBeenCalledWith({
          userId: "user_engineer",
          role: "admin",
        });
      }
    });
  });

  describe("Deactivation Flow with Confirmation Dialog", () => {
    it("opens confirmation dialog when deactivating an active user", async () => {
      renderWithClient(<UsersTable />);

      const deactivateBtn = screen.getByTestId(
        "toggle-status-button-user_engineer",
      );
      expect(deactivateBtn).toHaveTextContent("Деактивувати");

      // Click "Деактивувати" to open dialog
      fireEvent.click(deactivateBtn);

      // Dialog appears
      const dialog = screen.getByTestId("deactivate-confirm-dialog");
      expect(
        within(dialog).getByText("Підтвердження деактивації"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(/engineer@company.ua/),
      ).toBeInTheDocument();

      // Click "Скасувати" cancels without mutation
      const cancelBtn = screen.getByRole("button", { name: "Скасувати" });
      fireEvent.click(cancelBtn);

      expect(mutateMock).not.toHaveBeenCalled();
    });

    it("confirms deactivation and calls update mutation with isActive: false", async () => {
      renderWithClient(<UsersTable />);

      const deactivateBtn = screen.getByTestId(
        "toggle-status-button-user_engineer",
      );
      fireEvent.click(deactivateBtn);

      const confirmBtn = screen.getByTestId("confirm-deactivate-button");
      fireEvent.click(confirmBtn);

      expect(mutateMock).toHaveBeenCalledTimes(1);
      expect(mutateMock).toHaveBeenCalledWith(
        {
          userId: "user_engineer",
          isActive: false,
        },
        expect.objectContaining({ onSettled: expect.any(Function) }),
      );
    });
  });

  describe("Activation Flow", () => {
    it("calls update mutation with isActive: true when activating an inactive user", () => {
      renderWithClient(<UsersTable />);

      const activateBtn = screen.getByTestId(
        "toggle-status-button-user_inactive",
      );
      expect(activateBtn).toHaveTextContent("Активувати");

      fireEvent.click(activateBtn);

      expect(mutateMock).toHaveBeenCalledTimes(1);
      expect(mutateMock).toHaveBeenCalledWith({
        userId: "user_inactive",
        isActive: true,
      });
    });
  });
});
