import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { ping } from "./db.js";
import authRoutes from "./routes/auth.js";
import contactRoutes, { ensureContactTable } from "./routes/contact.js";
import projectRoutes from "./routes/projects.js";

dotenv.config();

const app = express();
const port = Number(process.env.API_PORT || 4000);
const host = process.env.API_HOST || "127.0.0.1";
const origin = process.env.CORS_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  try {
    await ping();
    res.json({ ok: true, db: "up" });
  } catch (err) {
    console.error("health", err);
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/contact", contactRoutes);

ensureContactTable().catch((err) => {
  console.error("contact table", err);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(port, host, () => {
  console.log(`FAUCHAR API listening on http://${host}:${port}`);
});
