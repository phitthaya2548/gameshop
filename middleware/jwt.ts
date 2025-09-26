import { expressjwt } from "express-jwt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
export const secret = process.env.JWT_SECRET as string;
export const jwtAuthen = expressjwt({
  secret: secret,
  algorithms: ["HS256"],
}).unless({
  path: ["/register", "/login"],
});

export function generateToken(payload: any): string {
  return jwt.sign(payload, secret, {
    expiresIn: "30d",
    issuer: "Lotto-App",
  });
}

export function verifyToken(token: string): { valid: boolean; decoded?: any; error?: string } {
  try {
    const decodedPayload: any = jwt.verify(token, secret);
    return { valid: true, decoded: decodedPayload };
  } catch (error) {
    return { valid: false, error: JSON.stringify(error) };
  }
}
