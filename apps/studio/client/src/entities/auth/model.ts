export type AuthUser = {
  id: string;
  username: string;
  display_name?: string;
  role: "super_admin" | "member";
  status: string;
};

export type LoginResult = { token: string; user: AuthUser };
