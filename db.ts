import dotenv from "dotenv";
import mysql from "mysql2/promise";
dotenv.config();

export const conn = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// debug: ทดสอบ connect ทันทีตอน start
conn.getConnection()
  .then((c) => {
    console.log("✅ DB connected");
    c.release();
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
  });

export type DBPool = typeof conn;
