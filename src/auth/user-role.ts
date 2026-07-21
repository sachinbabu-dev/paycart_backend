export enum UserRole {
  Customer = 'customer',
  Admin = 'admin',
  SuperAdmin = 'superadmin',
}

export const USER_ROLES = [
  UserRole.Customer,
  UserRole.Admin,
  UserRole.SuperAdmin,
] as const;
