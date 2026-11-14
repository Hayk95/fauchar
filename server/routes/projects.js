import { Router } from "express";
import { query } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

const STATUSES = new Set(["draft", "active", "archived"]);

function mapProject(row) {
  let data = row.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: row.name,
    description: row.description || "",
    status: row.status,
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.use(authRequired);

router.get("/", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, user_id, name, description, status, data, created_at, updated_at
       FROM projects
       WHERE user_id = :user_id
       ORDER BY updated_at DESC`,
      { user_id: req.user.id }
    );
    return res.json({ projects: rows.map(mapProject) });
  } catch (err) {
    console.error("projects.list", err);
    return res.status(500).json({ error: "Could not load projects." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, user_id, name, description, status, data, created_at, updated_at
       FROM projects
       WHERE id = :id AND user_id = :user_id
       LIMIT 1`,
      { id: req.params.id, user_id: req.user.id }
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Project not found." });
    }
    return res.json({ project: mapProject(rows[0]) });
  } catch (err) {
    console.error("projects.get", err);
    return res.status(500).json({ error: "Could not load project." });
  }
});

router.post("/", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Project name is required." });
    }
    const description = String(req.body?.description || "").trim();
    const status = STATUSES.has(req.body?.status) ? req.body.status : "draft";
    const data = req.body?.data ?? null;

    const result = await query(
      `INSERT INTO projects (user_id, name, description, status, data)
       VALUES (:user_id, :name, :description, :status, CAST(:data AS JSON))`,
      {
        user_id: req.user.id,
        name,
        description: description || null,
        status,
        data: data == null ? null : JSON.stringify(data),
      }
    );

    const rows = await query(
      `SELECT id, user_id, name, description, status, data, created_at, updated_at
       FROM projects WHERE id = :id LIMIT 1`,
      { id: result.insertId }
    );
    return res.status(201).json({ project: mapProject(rows[0]) });
  } catch (err) {
    console.error("projects.create", err);
    return res.status(500).json({ error: "Could not create project." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const existing = await query(
      `SELECT id FROM projects WHERE id = :id AND user_id = :user_id LIMIT 1`,
      { id: req.params.id, user_id: req.user.id }
    );
    if (!existing.length) {
      return res.status(404).json({ error: "Project not found." });
    }

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Project name is required." });
    }
    const description = String(req.body?.description || "").trim();
    const status = STATUSES.has(req.body?.status) ? req.body.status : "draft";
    const data = req.body?.data ?? null;

    await query(
      `UPDATE projects
       SET name = :name,
           description = :description,
           status = :status,
           data = CAST(:data AS JSON)
       WHERE id = :id AND user_id = :user_id`,
      {
        id: req.params.id,
        user_id: req.user.id,
        name,
        description: description || null,
        status,
        data: data == null ? null : JSON.stringify(data),
      }
    );

    const rows = await query(
      `SELECT id, user_id, name, description, status, data, created_at, updated_at
       FROM projects WHERE id = :id LIMIT 1`,
      { id: req.params.id }
    );
    return res.json({ project: mapProject(rows[0]) });
  } catch (err) {
    console.error("projects.update", err);
    return res.status(500).json({ error: "Could not update project." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM projects WHERE id = :id AND user_id = :user_id`,
      { id: req.params.id, user_id: req.user.id }
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Project not found." });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("projects.delete", err);
    return res.status(500).json({ error: "Could not delete project." });
  }
});

export default router;
