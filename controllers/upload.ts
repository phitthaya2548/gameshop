import type { Request } from "express";
import fs from "fs";
import path from "path";

export function saveImageFromBase64(
  base64OrDataUrl: string,
  ext: "jpg" | "png" | "webp" = "png"
): string {
  if (!base64OrDataUrl || base64OrDataUrl.trim().length === 0) return "";

  // รองรับ data URL
  let detectedExt: "jpg" | "png" | "webp" | null = null;
  const m = base64OrDataUrl.match(/^data:(.+?);base64,(.+)$/i);
  let pureBase64 = m ? m[2] : base64OrDataUrl;

  // ตัดช่องว่าง/ขึ้นบรรทัด ที่อาจทำให้ไฟล์เสีย
  pureBase64 = pureBase64.replace(/\s+/g, "");

  // ถ้ามี MIME ให้ map เป็นนามสกุล
  if (m) {
    const mime = m[1].toLowerCase();
    if (mime.includes("jpeg") || mime.includes("jpg")) detectedExt = "jpg";
    else if (mime.includes("png")) detectedExt = "png";
    else if (mime.includes("webp")) detectedExt = "webp";
  }

  const finalExt = detectedExt ?? ext; // ให้ MIME เป็นตัวกำหนดก่อน
  const filename = `${Date.now()}.${finalExt}`;
  const dir = path.join(process.cwd(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(pureBase64, "base64"));

  return `/uploads/${filename}`;
}
export function toAbsoluteUrl(
  req: Request,
  input?: string | null
): string | null {
  if (!input) return null;

  if (/^https?:\/\//i.test(input)) return input;

  const base = `${req.protocol}://${req.get("host")}`;

  // ทำให้ขึ้นต้นด้วย /uploads เสมอ
  let path = input.trim().replace(/^\/+/, "");
  if (!/^uploads\//i.test(path)) path = `uploads/${path}`;

  return `${base}/${path}`;
}
