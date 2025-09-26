export type UserRole = "GUEST" | "MEMBER" | "ADMIN";
export type UserStatus = "ACTIVE" | "INACTIVE";

export class User {
  id?: number;
  username: string;
  email: string;
  password: string;
  phone: string;
  full_name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt?: Date | null;

  constructor(
    username: string,
    email: string,
    password: string,
    full_name: string,
    phone: string,
    role: UserRole = "MEMBER",
    id?: number,
    createdAt: Date = new Date(),
    updatedAt?: Date | null
  ) {
    this.id = id;
    this.username = username;
    this.email = email;
    this.password = password;
    this.phone = phone;
    this.full_name = full_name;
    this.role = role;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt ?? null;
  }
}
