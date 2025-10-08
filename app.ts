import cors from "cors";
import "dotenv/config";
import express from "express";
import { UnauthorizedError } from "express-jwt";
import path from "path";
import { router as auth } from "./controllers/auth";
import { router as coupon } from "./controllers/coupon";
import { router as addgame } from "./controllers/game";
import { router as register } from "./controllers/register";
import { router as user } from "./controllers/user";
import { router as history } from "./controllers/history";
import { jwtAuthen } from "./middlewares/jws";

export const app = express();

app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json({ limit: "80mb" }));
app.use(express.urlencoded({ extended: true, limit: "80mb" }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/login", auth);
app.use("/register", register);
app.get("/", (_req, res) => {
  res.status(200).json({ ok: "Test Hello GameShop" });
});
app.use("/admin", addgame);
app.use(jwtAuthen);
app.use("/history", history);
app.use("/me", user);

app.use("/coupon", coupon);
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof UnauthorizedError) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    console.error("Unhandled error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
);


app.use((_req, res) => {
  res.status(404).json({ message: "Not Found" });
});
