import "dotenv/config"; 
import http from "http";
import { app } from "./app";

const port = process.env.PORT || 3000;  // ✅ แก้ตัวพิมพ์ใหญ่
const server = http.createServer(app);

server.listen(port, () => {
  console.log(`Server is started on port ${port}`); // ✅ print ค่าจริง จะได้ debug ง่ายขึ้นครั้งหน้า
});
