import mysql from "mysql2/promise"
import dotenv from "dotenv"

dotenv.config()

const databaseUrl = process.env.DATABASE_URL

const poolConfig = databaseUrl ? {
  uri: databaseUrl,
  dateStrings: ["DATE"],
  waitForConnections: true,
  connectionLimit: 10,
} : {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "smartlink_schools",
  dateStrings: ["DATE"],
  waitForConnections: true,
  connectionLimit: 10,
}

export const pool = mysql.createPool(poolConfig)

export async function pingDatabase() {
  const connection = await pool.getConnection()
  try {
    await connection.ping()
  } finally {
    connection.release()
  }
}
