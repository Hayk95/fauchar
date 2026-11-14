import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "fauchar",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

export async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

export default pool;
