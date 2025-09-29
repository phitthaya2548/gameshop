import mysql from "mysql2";

export const conn = mysql.createPool({
  host: "202.28.34.203",
  port: 3306,                    
  user: "mb68_66011212194",         
  password: "RKbxYKrhHQ1#",      
  database: "mb68_66011212194",  
  waitForConnections: true,
  connectionLimit: 10,
});
// export const conn = mysql.createPool({
//   host: "localhost",       // เดิมใส่ "root" ผิดช่อง ควรเป็น localhost หรือ 127.0.0.1
//   port: 3306,
//   user: "root",
//   password: "",   // ถ้าไม่มีรหัสผ่าน เว้นเป็น "" (ไม่แนะนำ)
//   database: "delivery",
//   waitForConnections: true,
//   connectionLimit: 10,
// });
