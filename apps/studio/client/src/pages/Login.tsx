import { FormEvent, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { ApiError, login } from "@/services/api";

export default function Login() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [remember, setRemember] = useState(true); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await login(username, password, remember); setLocation("/"); } catch (reason) { setError((reason as ApiError).message || "登录失败"); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-card"><div className="login-mark">漫</div><p className="login-eyebrow">AI MANHUA STUDIO</p><h1>连接工作区</h1><span>通过 Go API 会话服务认证，令牌将按你的登录偏好存储。</span><form onSubmit={submit}><label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />保持登录状态</label>{error && <p className="login-error">{error}</p>}<button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}登录</button></form><p className="login-foot"><ShieldCheck size={14} />Authorization: Bearer &lt;token&gt;</p></section></main>;
}
