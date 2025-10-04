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
export type DBPool = typeof conn;
