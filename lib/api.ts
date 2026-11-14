const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TOKEN_KEY = "fauchar_token";
const USER_KEY = "fauchar_user";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  createdAt?: string;
};

export type Project = {
  id: number;
  userId: number;
  name: string;
  description: string;
  status: "draft" | "active" | "archived";
  data: unknown;
  createdAt: string;
  updatedAt: string;
};

type ApiError = {
  error?: string;
  errors?: Record<string, string>;
};

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    const message = data.error || `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number; errors?: Record<string, string> };
    err.status = res.status;
    err.errors = data.errors;
    throw err;
  }
  return data;
}

export async function signup(input: { name: string; email: string; password: string }) {
  const data = await request<{ user: AuthUser; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
  setSession(data.token, data.user);
  return data;
}

export async function signin(input: { email: string; password: string }) {
  const data = await request<{ user: AuthUser; token: string }>("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify(input),
  });
  setSession(data.token, data.user);
  return data;
}

export async function me() {
  return request<{ user: AuthUser }>("/api/auth/me");
}

export async function listProjects() {
  return request<{ projects: Project[] }>("/api/projects");
}

export async function getProject(id: number | string) {
  return request<{ project: Project }>(`/api/projects/${id}`);
}

export async function createProject(input: {
  name: string;
  description?: string;
  status?: Project["status"];
  data?: unknown;
}) {
  return request<{ project: Project }>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(
  id: number | string,
  input: {
    name: string;
    description?: string;
    status?: Project["status"];
    data?: unknown;
  }
) {
  return request<{ project: Project }>(`/api/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteProject(id: number | string) {
  return request<void>(`/api/projects/${id}`, { method: "DELETE" });
}
