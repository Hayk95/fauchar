import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const TOKEN_TTL = "7d";

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      name: payload.name || "",
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

export function publicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name || "",
    createdAt: row.created_at,
  };
}
