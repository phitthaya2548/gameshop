import fs from "fs";
import path from "path";


export function saveImageFromBase64(base64: string, ext: "jpg" | "png" = "png"): string {
  if (!base64 || base64.trim().length === 0) return "";

  const filename = `${Date.now()}.${ext}`;
  const dir = path.join(process.cwd(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(base64, "base64"));

  return `/uploads/${filename}`;
}
