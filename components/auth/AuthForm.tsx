"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/site/Logo";
import { signin } from "@/lib/api";
import "@/styles/auth.css";
import "@/styles/style.css";

export function AuthForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      await signin({ email, password });
      router.push("/projects");
      router.refresh();
    } catch (err) {
      const e = err as Error & { errors?: Record<string, string> };
      setError(e.message || "Something went wrong.");
      if (e.errors) setFieldErrors(e.errors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Logo href="/" />
        <h1>Sign in</h1>
        <p className="auth-lead">Access your FAUCHAR projects and continue where you left off.</p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <p className="form-error">{error}</p> : null}

          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {fieldErrors.email ? <span className="field-error">{fieldErrors.email}</span> : null}
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            {fieldErrors.password ? (
              <span className="field-error">{fieldErrors.password}</span>
            ) : null}
          </label>

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>

        <p className="auth-foot">
          <Link href="/">Back to FAUCHAR</Link>
        </p>
      </div>
    </main>
  );
}
