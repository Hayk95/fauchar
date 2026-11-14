"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/site/Logo";
import {
  AuthUser,
  Project,
  clearSession,
  createProject,
  deleteProject,
  getStoredUser,
  listProjects,
  me,
} from "@/lib/api";
import "@/styles/auth.css";
import "@/styles/style.css";

export function ProjectsClient() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const cached = getStoredUser();
      if (!cached) {
        router.replace("/signin");
        return;
      }
      const profile = await me();
      setUser(profile.user);
      const list = await listProjects();
      setProjects(list.projects);
    } catch {
      clearSession();
      router.replace("/signin");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { project } = await createProject({
        name,
        description,
        status: "draft",
        data: { source: "web" },
      });
      setProjects((prev) => [project, ...prev]);
      setName("");
      setDescription("");
    } catch (err) {
      setError((err as Error).message || "Could not create project.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm("Delete this project?")) return;
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError((err as Error).message || "Could not delete project.");
    }
  }

  function onSignOut() {
    clearSession();
    router.push("/signin");
  }

  if (loading) {
    return (
      <main className="auth-page">
        <p className="auth-lead">Loading projects…</p>
      </main>
    );
  }

  return (
    <main className="auth-page" style={{ alignItems: "start", paddingTop: "3rem" }}>
      <div className="auth-card" style={{ width: "min(100%, 720px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
          <Logo href="/" />
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "#8a929a", fontSize: "0.9rem" }}>{user?.email}</span>
            <Link className="btn btn-ghost" href="/workspace">
              Workspace
            </Link>
            <button className="btn btn-ghost" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>

        <h1 style={{ marginTop: "1.5rem" }}>Your projects</h1>
        <p className="auth-lead">Saved in MySQL for your account. Open the workspace to continue design work.</p>

        {error ? <p className="form-error">{error}</p> : null}

        <form className="auth-form" onSubmit={onCreate} style={{ marginBottom: "1.75rem" }}>
          <label>
            Project name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </label>
          <label>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Create project"}
          </button>
        </form>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
          {projects.length === 0 ? (
            <li style={{ color: "#8a929a" }}>No projects yet.</li>
          ) : (
            projects.map((project) => (
              <li
                key={project.id}
                style={{
                  border: "1px solid rgba(245,244,239,0.12)",
                  padding: "0.9rem 1rem",
                  display: "grid",
                  gap: "0.35rem",
                }}
              >
                <strong>{project.name}</strong>
                <span style={{ color: "#8a929a", fontSize: "0.88rem" }}>
                  {project.status} · updated {new Date(project.updatedAt).toLocaleString()}
                </span>
                {project.description ? (
                  <span style={{ color: "#c5c8c4", fontSize: "0.92rem" }}>{project.description}</span>
                ) : null}
                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.35rem" }}>
                  <Link className="btn btn-ghost" href="/workspace">
                    Open workspace
                  </Link>
                  <button className="btn btn-ghost" type="button" onClick={() => void onDelete(project.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </main>
  );
}
