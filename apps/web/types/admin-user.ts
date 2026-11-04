/**
 * User Management Admin Panel Types (US26 / BIM-66)
 * Strict typing for user administration contracts and payloads.
 */

export type UserRole = "admin" | "engineer";

export interface ManagedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserPayload {
  role?: UserRole;
  isActive?: boolean;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  role: UserRole;
}

export interface RawManagedUser {
  id?: unknown;
  email?: unknown;
  role?: unknown;
  is_active?: unknown;
  isActive?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
}

