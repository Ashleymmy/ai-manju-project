import { ApiError } from "@/shared/api/errors";

/** 与注册接口保持一致的账号长度与 bcrypt 密码约束。 */
export const AUTH_ACCOUNT_MIN_LENGTH = 3;
export const AUTH_ACCOUNT_MAX_LENGTH = 32;
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_BYTES = 72;

export type AuthFields = { account: string; password: string; confirmPassword: string };
export type AuthFieldErrors = Partial<Record<keyof AuthFields, string>>;

export function validateAuthFields(fields: AuthFields, isRegister: boolean): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const account = fields.account.trim();
  if (!account) errors.account = "请输入账号";
  else if (isRegister && (account.length < AUTH_ACCOUNT_MIN_LENGTH || account.length > AUTH_ACCOUNT_MAX_LENGTH)) {
    errors.account = `账号需为 ${AUTH_ACCOUNT_MIN_LENGTH}–${AUTH_ACCOUNT_MAX_LENGTH} 位字符`;
  } else if (isRegister && !/^[a-z0-9_.-]+$/i.test(account)) {
    errors.account = "账号仅支持英文字母、数字、下划线、点或短横线";
  }
  if (!fields.password) errors.password = "请输入密码";
  else if (isRegister && fields.password !== fields.password.trim()) errors.password = "密码首尾不能包含空格";
  else if (isRegister && fields.password.length < AUTH_PASSWORD_MIN_LENGTH) {
    errors.password = `密码至少需要 ${AUTH_PASSWORD_MIN_LENGTH} 位`;
  } else if (isRegister && new TextEncoder().encode(fields.password).length > AUTH_PASSWORD_MAX_BYTES) {
    errors.password = "密码过长，请缩短后重试";
  }
  if (isRegister) {
    if (!fields.confirmPassword) errors.confirmPassword = "请再次输入密码";
    else if (fields.confirmPassword !== fields.password) errors.confirmPassword = "两次输入的密码不一致";
  }
  return errors;
}

export function authErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "账号或密码不正确，请重新输入";
    if (error.status === 409) return "该账号已被使用，请更换账号或返回登录";
    if (error.message === "public signup is disabled") return "当前暂未开放注册，请联系管理员开通账号";
    if (error.message === "user is disabled") return "该账号已停用，请联系管理员";
  }
  return error instanceof Error ? error.message : "暂时无法完成操作，请稍后重试";
}
