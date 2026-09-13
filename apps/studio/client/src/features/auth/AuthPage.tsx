import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  UserRound,
  UserRoundPlus,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";

import { defaultAuthPathForRole } from "@/components/AuthGuard";
import { useAuth } from "@/contexts/AuthContext";
import {
  getStoredAuthAccount,
  login,
  register,
} from "@/entities/auth";
import { usePublicHealthQuery } from "./model/queries";
import { AUTH_ACCOUNT_MIN_LENGTH, AUTH_ACCOUNT_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, authErrorMessage, validateAuthFields, type AuthFieldErrors } from "./model/form";
import "./styles.css";

export function AuthView() {
  const [location] = useLocation();
  // 切换页面时清空密码与错误，防止登录表单状态带入注册页面。
  return <AuthPage key={location.split("?")[0]} />;
}

function AuthPage() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [locationPath] = location.split("?");
  const nextPath = safeAuthNext(new URLSearchParams(search || window.location.search).get("next"));
  const nextQuery = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  const isRegister = locationPath === "/register";
  const isV2 = locationPath === "/v2-login";
  const [remember, setRemember] = useState(!isRegister);
  const [username, setUsername] = useState(() => isRegister ? "" : getStoredAuthAccount());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const submitInProgress = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const healthQuery = usePublicHealthQuery();
  const signupEnabled = healthQuery.data?.public_signup === true && !healthQuery.isError;
  const signupNotice = healthQuery.isPending ? "正在确认注册服务…"
    : healthQuery.isError ? "暂时无法连接注册服务，请重试。"
      : !signupEnabled ? "当前暂未开放注册，请联系管理员开通账号。" : "";
  const { user, loading, refreshUser } = useAuth();

  useEffect(() => {
    if (loading || !user || submitInProgress.current) return;
    navigate(nextPath || defaultAuthPathForRole(user.role), { replace: true });
  }, [loading, navigate, nextPath, user]);

  function clearFieldError(field: keyof AuthFieldErrors) {
    setFieldErrors(current => ({ ...current, [field]: undefined }));
    setSubmitError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInProgress.current || (isRegister && !signupEnabled)) return;
    const errors = validateAuthFields({ account: username, password, confirmPassword }, isRegister);
    setFieldErrors(errors);
    setSubmitError("");
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
      return;
    }
    submitInProgress.current = true;
    setFormLoading(true);
    try {
      const result = isRegister
        ? await register({ username, password, displayName, remember })
        : await login(username.trim(), password, remember);
      await refreshUser();
      if (isRegister) toast.success("注册成功，欢迎来到 AI 漫工坊");
      navigate(nextPath || defaultAuthPathForRole(result.user.role), { replace: true });
    } catch (err) {
      setSubmitError(authErrorMessage(err));
    } finally {
      setFormLoading(false);
      submitInProgress.current = false;
    }
  }

  return (
    <main className={`auth-page${isRegister ? " is-register" : ""}${isV2 ? " v2" : ""}`}>
      <section className="auth-story">
        <div className="auth-brand">
          <i>
            <Sparkles size={20} />
          </i>
          <span>
            <b>AI 漫工坊</b>
            <small>{isV2 ? "GLACIER ACCESS" : "MANHUA STUDIO"}</small>
          </span>
        </div>
        <div className="auth-story-copy">
          <p className="eyebrow">{isV2 ? "GLACIER / COLLABORATIVE CANVAS" : "A DIRECTOR'S DESK FOR AI COMICS"}</p>
          <h1>{isV2 ? <>连接你的<br />无限创作画布。</> : <>让每一张关键帧<br />都有下一镜。</>}</h1>
          <p>{isV2 ? "在共享工作面里同步画布、构图和导出任务。" : "在同一张工作桌上组织剧本、资产、镜头和等待落地的生成任务。"}</p>
        </div>
        <div className="auth-scene" aria-hidden="true">
          <span className="auth-card first" />
          <span className="auth-card second" />
          <i />
        </div>
        <footer>系统公告：渲染队列目前运行稳定 · 14:20</footer>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={formLoading}>
          <p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : isV2 ? "GLACIER SESSION" : "WELCOME BACK"}</p>
          <h2>{isRegister ? "创建你的账号" : isV2 ? "进入共享画布" : "回到分镜室"}</h2>
          <p className="auth-subline">
            {isRegister
              ? "完成注册，即可进入你的个人创作工作台。"
              : isV2
                ? "确认身份后继续上一段协作会话。"
                : "输入账户信息，继续上一次的创作现场。"}
          </p>
          {isRegister && signupNotice && <div className="auth-notice" role={healthQuery.isError ? "alert" : "status"}>
            <p>{signupNotice}</p>
            {!healthQuery.isPending && <button type="button" disabled={healthQuery.isFetching} onClick={() => void healthQuery.refetch()}>重新检查</button>}
          </div>}
          <fieldset className="auth-fields" disabled={formLoading}>
            {isRegister && <div className="auth-field">
              <label htmlFor="auth-display-name">用户名 <span className="auth-optional">选填</span></label>
              <div className="auth-input-wrap"><UserRound size={16} aria-hidden="true" /><input id="auth-display-name" name="displayName" autoComplete="nickname" placeholder="在工作台中显示的名字" value={displayName} onChange={event => setDisplayName(event.target.value)} /></div>
            </div>}
            <div className="auth-field">
              <label htmlFor="auth-account">账号</label>
              <div className="auth-input-wrap"><UserRound size={16} aria-hidden="true" />
                <input id="auth-account" name="account" required autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={isRegister ? AUTH_ACCOUNT_MAX_LENGTH : undefined}
                  placeholder={isRegister ? "例如：artist01" : "输入账号"} value={username}
                  aria-invalid={Boolean(fieldErrors.account)} aria-describedby={fieldErrors.account ? "auth-account-error" : isRegister ? "auth-account-hint" : undefined}
                  onChange={event => { setUsername(event.target.value); clearFieldError("account"); }} />
              </div>
              {fieldErrors.account ? <p id="auth-account-error" className="auth-field-error">{fieldErrors.account}</p> : isRegister && <p id="auth-account-hint" className="auth-field-hint">{AUTH_ACCOUNT_MIN_LENGTH}–{AUTH_ACCOUNT_MAX_LENGTH} 位，支持英文、数字及 _ . -</p>}
            </div>
            <div className="auth-field">
              <label htmlFor="auth-password">密码</label>
              <div className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" />
                <input id="auth-password" name="password" required type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"}
                  placeholder={isRegister ? `设置密码，至少 ${AUTH_PASSWORD_MIN_LENGTH} 位` : "输入密码"} value={password}
                  aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
                  onChange={event => { setPassword(event.target.value); clearFieldError("password"); }} />
                <button className="auth-password-toggle" type="button" aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
              {fieldErrors.password && <p id="auth-password-error" className="auth-field-error">{fieldErrors.password}</p>}
            </div>
            {isRegister && <div className="auth-field">
              <label htmlFor="auth-confirm-password">确认密码</label>
              <div className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" />
                <input id="auth-confirm-password" name="confirmPassword" required type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder="再次输入密码" value={confirmPassword}
                  aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? "auth-confirm-error" : undefined}
                  onChange={event => { setConfirmPassword(event.target.value); clearFieldError("confirmPassword"); }} />
                <button className="auth-password-toggle" type="button" aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
              {fieldErrors.confirmPassword && <p id="auth-confirm-error" className="auth-field-error">{fieldErrors.confirmPassword}</p>}
            </div>}
          </fieldset>
            <div className="remember-line">
              <label className="remember-toggle">
                <input type="checkbox" checked={remember} disabled={formLoading} onChange={event => setRemember(event.target.checked)} />
                <span className="check-box" aria-hidden="true">
                  {remember && <Check size={13} strokeWidth={3} />}
                </span>
                <span>记住登录和账号</span>
              </label>
              {!isRegister && <button className="auth-forgot" type="button" onClick={() => toast.info("请联系管理员重置密码")}>忘记密码？</button>}
            </div>
          {submitError && <p className="auth-submit-error" role="alert">{submitError}</p>}
          <button type="submit" className="auth-submit" disabled={formLoading || (isRegister && !signupEnabled)}>
            {formLoading ? <><Loader2 size={17} className="spin" aria-hidden="true" />{isRegister ? "正在创建账号…" : "正在登录…"}</> : <>{isRegister && <UserRoundPlus size={17} aria-hidden="true" />}{isRegister ? "注册并进入工作台" : isV2 ? "连接工作面" : "进入工作台"}<ChevronRight size={17} aria-hidden="true" /></>}
          </button>
          {isRegister ? <div className="auth-switch">已有账号？<a href={`/login${nextQuery}`}>返回登录</a></div> : <a className="auth-register-link" href={`/register${nextQuery}`}><UserRoundPlus size={16} aria-hidden="true" />注册账号</a>}
        </form>
      </section>
    </main>
  );
}

function safeAuthNext(value: string | null) {
  if (!value) return "";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "";
  if (value.startsWith("/login") || value.startsWith("/register") || value.startsWith("/v2-login")) return "";
  return value;
}

export default AuthView;
