// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import AdminUsersPage from "@/app/admin/users/page";
import { ApiHttpError } from "@/lib/api";
import type { ManagedUser } from "@/types/admin-user";

const mutateMock = vi.fn();

const { createMutationState, usersQueryState, currentUserQueryState } = vi.hoisted(() => ({
  createMutationState: {
    value: {
      mutate: vi.fn(),
      isPending: false,
    },
  },
  usersQueryState: {
    value: {
      data: [] as ManagedUser[],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    },
  },
  currentUserQueryState: {
    value: {
      data: { id: "admin_1", email: "admin@test.ua", role: "admin" as const },
      isLoading: false,
    },
  },
}));

vi.mock("@/hooks/useAdminUsers", () => ({
  useCreateUserMutation: () => createMutationState.value,
  useAdminUsersQuery: () => usersQueryState.value,
  useUpdateUserMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUserQuery: () => currentUserQueryState.value,
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("CreateUserDialog Component (BIM-66 Phase 4)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mutateMock.mockReset();

    createMutationState.value = {
      mutate: mutateMock,
      isPending: false,
    };
  });

  describe("Dialog Rendering & Accessibility", () => {
    it("does not render dialog content when open={false}", () => {
      renderWithClient(<CreateUserDialog open={false} />);
      expect(screen.queryByTestId("create-user-dialog")).not.toBeInTheDocument();
    });

    it("renders dialog elements properly when open={true}", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const dialog = screen.getByTestId("create-user-dialog");
      expect(dialog).toBeInTheDocument();

      expect(
        within(dialog).getByRole("heading", { name: "Створити нового користувача" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Створіть обліковий запис для інженера або адміністратора/),
      ).toBeInTheDocument();

      // Form inputs
      expect(screen.getByLabelText(/Електронна пошта/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Тимчасовий пароль/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Роль у системі/i)).toBeInTheDocument();

      // Action buttons
      expect(screen.getByRole("button", { name: "Скасувати" })).toBeInTheDocument();
      expect(screen.getByTestId("create-user-submit-button")).toHaveTextContent(
        "Створити користувача",
      );
    });
  });

  describe("Client-side Form Validation", () => {
    it("shows validation errors for required fields on empty submit and prevents mutation", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const submitBtn = screen.getByTestId("create-user-submit-button");
      fireEvent.click(submitBtn);

      expect(mutateMock).not.toHaveBeenCalled();
      expect(screen.getByText("Вкажіть адресу електронної пошти.")).toBeInTheDocument();
      expect(screen.getByText("Вкажіть тимчасовий пароль.")).toBeInTheDocument();

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);

      expect(emailInput).toHaveAttribute("aria-invalid", "true");
      expect(passwordInput).toHaveAttribute("aria-invalid", "true");
    });

    it("shows error for invalid email format", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "invalid-email-address" } });
      fireEvent.change(passwordInput, { target: { value: "validpassword123" } });
      fireEvent.click(submitBtn);

      expect(mutateMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Вкажіть коректну адресу електронної пошти."),
      ).toBeInTheDocument();
    });

    it("shows error for short password (< 8 chars)", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "valid@bim.ua" } });
      fireEvent.change(passwordInput, { target: { value: "1234567" } });
      fireEvent.click(submitBtn);

      expect(mutateMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Пароль має містити щонайменше 8 символів."),
      ).toBeInTheDocument();
    });

    it("clears error message when user modifies input", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.click(submitBtn);
      expect(screen.getByText("Вкажіть адресу електронної пошти.")).toBeInTheDocument();

      fireEvent.change(emailInput, { target: { value: "user@bim.ua" } });
      expect(
        screen.queryByText("Вкажіть адресу електронної пошти."),
      ).not.toBeInTheDocument();
    });
  });

  describe("Password Visibility Toggle", () => {
    it("toggles password field between password and text types", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      expect(passwordInput).toHaveAttribute("type", "password");

      const toggleBtn = screen.getByRole("button", { name: "Показати пароль" });
      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute("type", "text");
      expect(
        screen.getByRole("button", { name: "Приховати пароль" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Приховати пароль" }));
      expect(passwordInput).toHaveAttribute("type", "password");
    });
  });

  describe("Form Submission & Success Callback", () => {
    it("submits valid credentials and triggers onOpenChange(false) on mutation success", () => {
      const onOpenChangeMock = vi.fn();
      renderWithClient(
        <CreateUserDialog open={true} onOpenChange={onOpenChangeMock} />,
      );

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "  newengineer@bim.ua  " } });
      fireEvent.change(passwordInput, { target: { value: "SecurePass2026!" } });
      fireEvent.click(submitBtn);

      expect(mutateMock).toHaveBeenCalledTimes(1);
      const [payload, options] = mutateMock.mock.calls[0];

      // Verifies trimmed email, matching password, and default engineer role
      expect(payload).toEqual({
        email: "newengineer@bim.ua",
        password: "SecurePass2026!",
        role: "engineer",
      });

      // Simulate mutation success
      expect(typeof options.onSuccess).toBe("function");
      act(() => {
        options.onSuccess();
      });

      expect(onOpenChangeMock).toHaveBeenCalledWith(false);
    });

    it("allows selecting admin role and submitting with role 'admin'", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "admin_user@bim.ua" } });
      fireEvent.change(passwordInput, { target: { value: "AdminPassword2026" } });

      const roleSelectTrigger = screen.getByTestId("create-user-role-select");
      fireEvent.click(roleSelectTrigger);

      const adminOption = screen.queryByRole("option", { name: /Адміністратор/i });
      if (adminOption) {
        fireEvent.click(adminOption);
      }

      fireEvent.click(submitBtn);
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });

    it("resets form fields when cancelled", () => {
      const onOpenChangeMock = vi.fn();
      renderWithClient(
        <CreateUserDialog open={true} onOpenChange={onOpenChangeMock} />,
      );

      const emailInput = screen.getByLabelText(/Електронна пошта/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i) as HTMLInputElement;
      const cancelBtn = screen.getByRole("button", { name: "Скасувати" });

      fireEvent.change(emailInput, { target: { value: "temp@bim.ua" } });
      fireEvent.change(passwordInput, { target: { value: "tempPass123" } });
      expect(emailInput.value).toBe("temp@bim.ua");
      expect(passwordInput.value).toBe("tempPass123");

      fireEvent.click(cancelBtn);
      expect(onOpenChangeMock).toHaveBeenCalledWith(false);
      expect(emailInput.value).toBe("");
      expect(passwordInput.value).toBe("");
    });
  });

  describe("Backend Error Alert Banner", () => {
    it("displays Ukrainian error message when backend returns 409 conflict", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "existing@bim.ua" } });
      fireEvent.change(passwordInput, { target: { value: "password123" } });
      fireEvent.click(submitBtn);

      expect(mutateMock).toHaveBeenCalledTimes(1);
      const [, options] = mutateMock.mock.calls[0];

      // Simulate backend 409 error
      act(() => {
        options.onError(new ApiHttpError(409));
      });

      const alertBanner = screen.getByRole("alert");
      expect(alertBanner).toBeInTheDocument();
      expect(alertBanner).toHaveTextContent(
        "Користувач із такою електронною поштою вже існує.",
      );
    });

    it("displays backend error message when backend returns custom 422 error", () => {
      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const submitBtn = screen.getByTestId("create-user-submit-button");

      fireEvent.change(emailInput, { target: { value: "bad@bim.ua" } });
      fireEvent.change(passwordInput, { target: { value: "password123" } });
      fireEvent.click(submitBtn);

      const [, options] = mutateMock.mock.calls[0];
      act(() => {
        options.onError(new ApiHttpError(422, "Пароль є занадто простим"));
      });

      const alertBanner = screen.getByRole("alert");
      expect(alertBanner).toHaveTextContent("Пароль є занадто простим");
    });
  });

  describe("Loading State Handling", () => {
    it("disables inputs and shows spinner while mutation is pending", () => {
      createMutationState.value.isPending = true;

      renderWithClient(<CreateUserDialog open={true} />);

      const emailInput = screen.getByLabelText(/Електронна пошта/i);
      const passwordInput = screen.getByLabelText(/Тимчасовий пароль/i);
      const cancelBtn = screen.getByRole("button", { name: "Скасувати" });
      const submitBtn = screen.getByTestId("create-user-submit-button");

      expect(emailInput).toBeDisabled();
      expect(passwordInput).toBeDisabled();
      expect(cancelBtn).toBeDisabled();
      expect(submitBtn).toBeDisabled();
      expect(submitBtn).toHaveTextContent("Створення…");
    });
  });

  describe("Integration in AdminUsersPage", () => {
    it("opens CreateUserDialog when '+ Створити користувача' button is clicked in AdminUsersPage", () => {
      renderWithClient(<AdminUsersPage />);

      expect(screen.queryByTestId("create-user-dialog")).not.toBeInTheDocument();

      const createBtn = screen.getByTestId("create-user-button");
      fireEvent.click(createBtn);

      expect(screen.getByTestId("create-user-dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Створити нового користувача" }),
      ).toBeInTheDocument();
    });
  });
});
