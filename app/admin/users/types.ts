export interface AdminOrganization {
  id: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  is_principal: boolean;
  banned: boolean;
  organizations: AdminOrganization[];
}
