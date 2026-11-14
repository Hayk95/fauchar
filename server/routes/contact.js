import { Router } from "express";
import { query } from "../db.js";

const router = Router();

const TOPICS = new Set(["Investor", "Dental laboratory", "Dental professional", "Other"]);

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS contact_inquiries (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    organization VARCHAR(120) NULL,
    email VARCHAR(160) NOT NULL,
    topic VARCHAR(40) NOT NULL,
    message VARCHAR(2000) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_contact_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let tableReady = null;

export function ensureContactTable() {
  if (!tableReady) {
    tableReady = query(CREATE_TABLE).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

const hits = new Map();

function tooMany(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const recent = (hits.get(ip) || []).filter((at) => now - at < windowMs);
  if (recent.length >= 8) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    if (String(body.company_website || "").trim()) {
      return res.json({ ok: true });
    }

    const name = String(body.name || "").trim();
    const organization = String(body.organization || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const topic = TOPICS.has(body.topic) ? body.topic : "";
    const message = String(body.message || "").trim();

    const errors = {};
    if (name.length < 2 || name.length > 80) errors.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
      errors.email = "Enter a valid email address.";
    }
    if (!topic) errors.topic = "Choose who you are.";
    if (message.length < 12 || message.length > 2000) {
      errors.message = "Add a short message, at least a sentence.";
    }
    if (organization.length > 120) errors.organization = "Organization is too long.";
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: "Validation failed.", errors });
    }

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (tooMany(ip)) {
      return res.status(429).json({ error: "Too many messages. Please try again shortly." });
    }

    await ensureContactTable();
    await query(
      `INSERT INTO contact_inquiries (name, organization, email, topic, message)
       VALUES (:name, :organization, :email, :topic, :message)`,
      {
        name,
        organization: organization || null,
        email,
        topic,
        message,
      }
    );

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("contact", err);
    return res.status(500).json({ error: "Could not save your message." });
  }
});

export default router;
