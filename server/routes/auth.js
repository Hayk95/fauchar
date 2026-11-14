import { Router } from "express";
import { query } from "../db.js";
import {
  authRequired,
  hashPassword,
  publicUser,
  signToken,
  verifyPassword,
} from "../auth.js";

const router = Router();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function validateCredentials({ email, password, name }, { requireName = false } = {}) {
  const errors = {};
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (!password || String(password).length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }
  if (requireName && !String(name || "").trim()) {
    errors.name = "Name is required.";
  }
  return { errors, cleanEmail, cleanName: String(name || "").trim() };
}

router.post("/signup", async (req, res) => {
  return res.status(403).json({ error: "Signup is temporarily disabled." });
  try {
    const { errors, cleanEmail, cleanName } = validateCredentials(req.body, {
      requireName: true,
    });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: "Validation failed.", errors });
    }

    const existing = await query("SELECT id FROM users WHERE email = :email LIMIT 1", {
      email: cleanEmail,
    });
    if (existing.length) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await hashPassword(req.body.password);
    const result = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES (:email, :password_hash, :name)`,
      {
        email: cleanEmail,
        password_hash: passwordHash,
        name: cleanName,
      }
    );

    const rows = await query(
      "SELECT id, email, name, created_at FROM users WHERE id = :id LIMIT 1",
      { id: result.insertId }
    );
    const user = publicUser(rows[0]);
    const token = signToken(user);
    return res.status(201).json({ user, token });
  } catch (err) {
    console.error("signup", err);
    return res.status(500).json({ error: "Could not create account." });
  }
});

router.post("/signin", async (req, res) => {
  try {
    const { errors, cleanEmail } = validateCredentials(req.body);
    if (errors.email || errors.password) {
      return res.status(400).json({
        error: "Validation failed.",
        errors: {
          email: errors.email,
          password: errors.password || "Password is required.",
        },
      });
    }

    const rows = await query(
      "SELECT id, email, name, password_hash, created_at FROM users WHERE email = :email LIMIT 1",
      { email: cleanEmail }
    );
    if (!rows.length) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const row = rows[0];
    const ok = await verifyPassword(req.body.password, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = publicUser(row);
    const token = signToken(user);
    return res.json({ user, token });
  } catch (err) {
    console.error("signin", err);
    return res.status(500).json({ error: "Could not sign in." });
  }
});

router.get("/me", authRequired, async (req, res) => {
  try {
    const rows = await query(
      "SELECT id, email, name, created_at FROM users WHERE id = :id LIMIT 1",
      { id: req.user.id }
    );
    if (!rows.length) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error("me", err);
    return res.status(500).json({ error: "Could not load profile." });
  }
});

export default router;
