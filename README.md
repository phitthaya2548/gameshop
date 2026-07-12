# 🎮 GameShop Backend

REST API Backend สำหรับระบบร้านขายเกม (Game Store) พัฒนาด้วย **Node.js + Express + TypeScript** เชื่อมต่อฐานข้อมูล **MySQL** รองรับระบบสมาชิก, กระเป๋าเงิน (Wallet), ตะกร้าสินค้า, คูปองส่วนลด, และระบบจัดการเกมสำหรับแอดมิน

---

## ✨ ฟีเจอร์หลัก

- 🔐 **Authentication** – ระบบล็อกอิน/สมัครสมาชิก เข้ารหัสรหัสผ่านด้วย bcrypt และยืนยันตัวตนด้วย JWT
- 🎮 **จัดการเกม** – เพิ่ม/แก้ไข/ลบ/ค้นหาเกม พร้อมอัปโหลดรูปปก, หมวดหมู่เกม, สถิติยอดขาย และเกมขายดี (Top Sellers)
- 🛒 **ตะกร้าสินค้า** – เพิ่ม/ลบสินค้าในตะกร้า และ checkout เพื่อสั่งซื้อ
- 💰 **ระบบกระเป๋าเงิน (Wallet)** – เติมเงิน, ดูยอดคงเหลือ, ประวัติธุรกรรม (ledger)
- 🎟️ **คูปองส่วนลด** – สร้าง/แก้ไข/ลบ/ใช้โค้ดส่วนลด พร้อมระบบโควตาการใช้งาน
- 📦 **ประวัติการซื้อ** – ดูประวัติคำสั่งซื้อและเกมที่เป็นเจ้าของ (My Games)
- 🖼️ **อัปโหลดรูปภาพ** – รองรับอัปโหลดรูปโปรไฟล์และรูปปกเกม (jpeg, png, webp) ด้วย Multer
- 👤 **จัดการโปรไฟล์ผู้ใช้** – ดู/แก้ไขข้อมูลส่วนตัวและรูปโปรไฟล์

---

## 🛠️ เทคโนโลยีที่ใช้

| หมวดหมู่ | เทคโนโลยี |
|---|---|
| Runtime | [Node.js](https://nodejs.org) + [TypeScript](https://www.typescriptlang.org) |
| Web Framework | [Express 5](https://expressjs.com) |
| ฐานข้อมูล | [MySQL](https://www.mysql.com) ผ่าน [mysql2](https://www.npmjs.com/package/mysql2) |
| Authentication | [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken), [express-jwt](https://www.npmjs.com/package/express-jwt), [bcryptjs](https://www.npmjs.com/package/bcryptjs) |
| Validation | [zod](https://zod.dev) |
| อัปโหลดไฟล์ | [multer](https://www.npmjs.com/package/multer) |
| Security / อื่น ๆ | [helmet](https://helmetjs.github.io), [cors](https://www.npmjs.com/package/cors), [cookie-parser](https://www.npmjs.com/package/cookie-parser), [express-session](https://www.npmjs.com/package/express-session), [dotenv](https://www.npmjs.com/package/dotenv) |
| ORM (พร้อมใช้งาน) | [Prisma](https://www.prisma.io) |
| Dev Tools | ts-node-dev, tsx, nodemon |

---

## 📂 โครงสร้างโปรเจกต์

```
.
├── app.ts                    # ตั้งค่า Express app, middleware, routes
├── server.ts                 # entry point เริ่ม HTTP server
├── db.ts                     # การเชื่อมต่อฐานข้อมูล MySQL (connection pool)
├── controllers/
│   ├── auth.ts                # เข้าสู่ระบบ (login)
│   ├── register.ts            # สมัครสมาชิก
│   ├── user.ts                # โปรไฟล์, wallet, ตะกร้า, checkout, my games
│   ├── game.ts                # จัดการเกม (CRUD), ค้นหา, ranking, top sellers
│   ├── coupon.ts               # จัดการคูปอง/โค้ดส่วนลด
│   ├── history.ts             # ประวัติธุรกรรม/wallet ledger
│   └── upload.ts              # ฟังก์ชันจัดการอัปโหลดรูปภาพ (multer)
├── middlewares/
│   └── jws.ts                 # JWT authentication middleware
└── uploads/                   # โฟลเดอร์เก็บไฟล์รูปที่อัปโหลด
```

---

## 🔌 API Endpoints

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| `POST` | `/login` | เข้าสู่ระบบ |
| `POST` | `/register` | สมัครสมาชิก (แนบรูป avatar ได้) |
| `GET` | `/me` | ดูข้อมูลโปรไฟล์ตนเอง |
| `PUT` | `/me` | แก้ไขโปรไฟล์ (แนบรูป avatar ได้) |
| `GET` | `/me/balance` | ดูยอดเงินคงเหลือ |
| `POST` | `/me/balance` | เติมเงินเข้ากระเป๋า |
| `GET` | `/me/wallet/history` | ประวัติการทำธุรกรรม |
| `GET` | `/me/cart` | ดูตะกร้าสินค้า |
| `POST` | `/me/cart/add` | เพิ่มเกมลงตะกร้า |
| `DELETE` | `/me/cart/:gameId` | ลบเกมออกจากตะกร้า |
| `POST` | `/me/checkout` | ชำระเงิน/สั่งซื้อ |
| `POST` | `/me/orders/buy` | ซื้อเกมทันที |
| `GET` | `/me/mygames` | รายการเกมที่เป็นเจ้าของ |
| `GET` | `/admin/games` | รายการเกมทั้งหมด |
| `GET` | `/admin/games/:id` | รายละเอียดเกม |
| `POST` | `/admin/addgames` | เพิ่มเกมใหม่ (แนบรูปปก) |
| `PATCH` | `/admin/games/:id` | แก้ไขเกม |
| `DELETE` | `/admin/games/:id` | ลบเกม |
| `GET` | `/admin/search` | ค้นหาเกม |
| `GET` | `/admin/stats/ranking` | สถิติยอดขาย |
| `GET` | `/admin/top-sellers` | เกมขายดี |
| `POST` | `/coupon/create/discount` | สร้างโค้ดส่วนลด |
| `POST` | `/coupon/apply/discount` | ใช้โค้ดส่วนลด |
| `PATCH` | `/coupon/update/discount/:id` | แก้ไขโค้ดส่วนลด |
| `DELETE` | `/coupon/delete/discount/:id` | ลบโค้ดส่วนลด |
| `GET` | `/coupon/list/discount` | รายการโค้ดส่วนลดทั้งหมด |
| `GET` | `/history/wallet/ledger/:userId` | ประวัติธุรกรรม wallet ของผู้ใช้ |
| `GET` | `/history/wallet/search` | ค้นหาธุรกรรม |
| `GET` | `/history/wallet/users` | รายชื่อผู้ใช้ (สำหรับแอดมิน) |

> หมายเหตุ: ทุก endpoint ยกเว้น `/register`, `/login` และ `GET /uploads/*` ต้องแนบ JWT token (`Authorization: Bearer <token>`)

---

## 🚀 การติดตั้งและเริ่มใช้งาน

### สิ่งที่ต้องมี
- [Node.js](https://nodejs.org) เวอร์ชัน 18 ขึ้นไป
- ฐานข้อมูล [MySQL](https://www.mysql.com)

### ขั้นตอน

```bash
# 1) โคลนโปรเจกต์
git clone https://github.com/<username>/gameshop.git
cd gameshop

# 2) ติดตั้ง dependencies
npm install

# 3) สร้างไฟล์ .env ที่ root แล้วตั้งค่าตัวแปรดังนี้
```

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=your_password
DB_NAME=gameshop
JWT_SECRET=your_jwt_secret
port=3000
```

```bash
# 4) รันโหมดพัฒนา (auto-reload)
npm run dev
# หรือ
npm run start:dev

# 5) Build และรันโปรดักชัน
npm run build
npm start
```

เมื่อรันสำเร็จ server จะพร้อมใช้งานที่ `http://localhost:3000`

---

## 📄 License

ISC
