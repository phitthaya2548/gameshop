import cors from "cors";
import "dotenv/config";
import express from "express";
import { UnauthorizedError } from "express-jwt";
import path from "path";
import { router as addgame } from "./controllers/addgame";
import { router as auth } from "./controllers/auth";
import { router as register } from "./controllers/register";
import { router as user } from "./controllers/user";
import { jwtAuthen } from "./middlewares/jws";
export const app = express();
// app.use(
//   cors({
//     origin: true,
//     credentials: true,
//     allowedHeaders: ["Content-Type", "Authorization"],
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//   })
// );
app.use(
  cors({
    origin: "*",
  })
);
app.use(jwtAuthen);
app.use(express.json({ limit: "80mb" }));
app.use(express.urlencoded({ extended: true, limit: "80mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/me", user);
app.use("/login", auth);
app.use("/register", register);
app.use("/admin", addgame);
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
    return res.status(500).json({ ok: false, message: "Server error" });
  }
);
app.use((req, res) => {
  res.status(404).json({ message: "Not Found" });
});
