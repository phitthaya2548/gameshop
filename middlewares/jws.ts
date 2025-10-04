import dotenv from "dotenv";
import { expressjwt } from "express-jwt";
import jwt from "jsonwebtoken";
dotenv.config();
export const secret = process.env.JWT_SECRET as string;
export const jwtAuthen = expressjwt({
  secret: secret,
  algorithms: ["HS256"],
}).unless({
  path: ["/register", "/login", { url: /^\/uploads\/.*/, methods: ["GET"] }],
});

export function generateToken(payload: any): string {
  return jwt.sign(payload, secret, {
    expiresIn: "30d",
    issuer: "Game-shop",
  });
}

export function verifyToken(token: string): {
  valid: boolean;
  decoded?: any;
  error?: string;
} {
  try {
    const decodedPayload: any = jwt.verify(token, secret);
    return { valid: true, decoded: decodedPayload };
  } catch (error) {
    return { valid: false, error: JSON.stringify(error) };
  }
}
