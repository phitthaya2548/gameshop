import express from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { conn } from "../db";
import { saveImageFromBase64 } from "./upload"; // จะปรับให้รับ base64 ล้วน

export const router = express.Router();

