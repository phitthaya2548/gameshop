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

