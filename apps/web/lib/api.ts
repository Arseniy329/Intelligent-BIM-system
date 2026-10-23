import { createClient } from "@/lib/supabase/client";

export class ApiAuthenticationError extends Error {
  constructor() {
    super("Authentication is required for this API request.");
    this.name = "ApiAuthenticationError";
  }
}

export class ApiConfigurationError extends Error {
  constructor() {
    super("The API URL is not configured correctly.");
    this.name = "ApiConfigurationError";
  }
}

export class ApiPathError extends Error {
  constructor() {
    super("The API path is invalid.");
    this.name = "ApiPathError";
  }
}

function getApiBaseUrl(): URL {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!configuredUrl) {
    throw new ApiConfigurationError();
  }

  try {
    const baseUrl = new URL(configuredUrl);

    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new ApiConfigurationError();
    }

    return baseUrl;
  } catch {
    throw new ApiConfigurationError();
  }
}

function getApiUrl(path: string): URL {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(path) ||
    /%(?![\da-fA-F]{2})/.test(path)
  ) {
    throw new ApiPathError();
  }

  const baseUrl = getApiBaseUrl();
  const basePath = baseUrl.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  try {
    const url = new URL(`${baseUrl.origin}${basePath}${path}`);

    if (url.origin !== baseUrl.origin || (basePath && !url.pathname.startsWith(`${basePath}/`))) {
      throw new ApiPathError();
    }

    return url;
  } catch {
    throw new ApiPathError();
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = getApiUrl(path);
  let accessToken: string | undefined;

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getSession();

    if (!error) {
      accessToken = data.session?.access_token;
    }
  } catch {
    // Authentication failures are intentionally reported without session details.
  }

  if (!accessToken) {
    throw new ApiAuthenticationError();
  }

  const headers = new Headers(init?.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(url, { ...init, headers });
}
