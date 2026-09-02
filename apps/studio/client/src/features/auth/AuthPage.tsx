import {
  Check,
  ChevronRight,
  Eye,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import "./styles.css";

export function AuthView() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [locationPath] = location.split("?");
  const nextPath = safeAuthNext(new URLSearchParams(search || window.location.search).get("next"));
  const nextQuery = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  const isRegister = locationPath === "/register";
  const isV2 = locationPath === "/v2-login";
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState(() => getStoredAuthAccount());
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const healthQuery = usePublicHealthQuery();
  const signupEnabled = healthQuery.data?.public_signup ?? true;
  const { user, loading, refreshUser } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    navigate(nextPath || defaultAuthPathForRole(user.role), { replace: true });
  }, [loading, navigate, nextPath, user]);

  useEffect(() => {
    if (isRegister && !signupEnabled) {
      toast.info("当前未开放公开注册，请联系管理员开通账号");
      navigate(`/login${nextQuery}`, { replace: true });
    }
  }, [isRegister, navigate, nextQuery, signupEnabled]);

  async function handleSubmit() {
    if (formLoading) return;
    if (!username.trim()) {
      toast.error("请输入用户名");
      return;
    }
    if (!password) {
      toast.error("请输入密码");
      return;
    }
    setFormLoading(true);
    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          toast.error("两次输入的密码不一致");
          return;
        }
        await register({ username: username.trim(), password, displayName: displayName.trim() || undefined });
        toast.success("注册成功，请登录");
        navigate(`/login${nextQuery}`);
      } else {
        const result = await login(username.trim(), password, remember);
        await refreshUser();
        navigate(nextPath || defaultAuthPathForRole(result.user.role), { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setFormLoading(false);
    }
  }

  return (
    <main className={`auth-page ${isV2 ? "v2" : ""}`}>
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
        <div className="auth-scene">
          <span className="auth-card first" />
          <span className="auth-card second" />
          <i />
        </div>
        <footer>系统公告：渲染队列目前运行稳定 · 14:20</footer>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : isV2 ? "GLACIER SESSION" : "WELCOME BACK"}</p>
          <h2>{isRegister ? "建立你的工作桌" : isV2 ? "进入共享画布" : "回到分镜室"}</h2>
          <p className="auth-subline">
            {isRegister
              ? "创建账户后即可开始组织个人创作空间。"
              : isV2
                ? "确认身份后继续上一段协作会话。"
                : "输入账户信息，继续上一次的创作现场。"}
          </p>
          {isRegister && (
            <label>
              显示名称
              <input placeholder="例如：林叙" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label>
            用户名
            <input placeholder="输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            密码
            <div className="password-field">
              <input
                type="password"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Eye size={16} />
            </div>
          </label>
          {isRegister && (
            <label>
              确认密码
              <div className="password-field">
                <input
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <Eye size={16} />
              </div>
            </label>
          )}
          {!isRegister && (
            <div className="remember-line">
              <button className={remember ? "check-box checked" : "check-box"} onClick={() => setRemember(!remember)}>
                {remember && <Check size={13} />}
              </button>
              <span>记住本次登录</span>
              <button onClick={() => toast.info("密码重置将在正式系统中发送邮件")}>忘记密码？</button>
            </div>
          )}
          <button className="auth-submit" disabled={formLoading} onClick={handleSubmit}>
            {isRegister ? "创建账户" : isV2 ? "连接工作面" : "进入工作台"} <ChevronRight size={17} />
          </button>
          <div className="auth-switch">
            {isRegister ? "已有账户？" : signupEnabled ? "首次使用？" : "注册由管理员开通。"}
            {(isRegister || signupEnabled) && <button onClick={() => navigate(isRegister ? `/login${nextQuery}` : `/register${nextQuery}`)}>
              {isRegister ? "去登录" : "创建账户"}
            </button>}
          </div>
        </div>
      </section>
    </main>
  );
}

function safeAuthNext(value: string | null) {
  if (!value) return "";
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  if (value.startsWith("/login") || value.startsWith("/register") || value.startsWith("/v2-login")) return "";
  return value;
}

export default AuthView;
