import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Box, CircleHelp, Clapperboard, FolderKanban, History, Image, LayoutDashboard, LogOut, PanelsTopLeft, Settings, Sparkles, Tags, Workflow, Plus } from "lucide-react";
import { getCurrentUser, logout, type AuthUser } from "@/entities/auth";

const navigation = [
  { href: "/", label: "工作区", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/canvas", label: "画布", icon: PanelsTopLeft },
  { href: "/assets", label: "Assets", icon: Box },
  { href: "/canvas?panel=layers", label: "Layers", icon: Tags },
  { href: "/image", label: "Effects", icon: Sparkles },
  { href: "/comic-assets", label: "Library", icon: Clapperboard },
  { href: "/queue", label: "History", icon: History },
] as const;

export default function StudioShell({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    void getCurrentUser().then(setUser).catch(() => setUser(null));
    const onUnauthorized = () => setUser(null);
    window.addEventListener("ai-manju:auth-unauthorized", onUnauthorized);
    return () => window.removeEventListener("ai-manju:auth-unauthorized", onUnauthorized);
  }, []);

  async function signOut() { await logout().catch(() => undefined); setUser(null); setLocation("/login"); }

  return <div className="studio-shell">
    <aside className="product-rail">
      <button className="product-brand" onClick={() => setLocation("/")} aria-label="AI 漫工坊工作台"><span className="brand-sigil">漫</span><span><b>AI 漫工坊</b><small>CREATIVE STUDIO</small></span></button>
      <div className="rail-project"><span className="rail-project-orb">∞</span><div><b>Creative Lab</b><small>WORKSPACE / PERSONAL</small></div></div>
      <button className="rail-new-asset" onClick={() => setLocation("/image")}><Plus size={16} />New Asset</button>
      <nav className="product-nav" aria-label="主导航">
        {navigation.map(({ href, label, icon: Icon }) => <button key={href} className={location === href.split("?")[0] || (href !== "/" && location.startsWith(`${href.split("?")[0]}/`)) ? "active" : ""} onClick={() => setLocation(href)}><Icon size={18} /><span>{label}</span></button>)}
      </nav>
      <div className="product-nav product-nav--footer">
        <button className={location === "/settings" ? "active" : ""} onClick={() => setLocation("/settings")}><Settings size={18} /><span>设置</span></button>
        <button onClick={() => setLocation("/prompts")}><CircleHelp size={18} /><span>Help</span></button>
      </div>
    </aside>
    <section className="product-stage">
      <header className="product-header"><div><p>{eyebrow}</p><h1>{title}</h1></div><div className="stage-modes"><span className="active">Workspace</span><span>Export</span><span>Collaboration</span></div><div className="header-account">{user ? <><span className="online-dot" /> <b>{user.display_name || user.username}</b><button onClick={signOut} title="退出登录"><LogOut size={16} /></button></> : <button className="sign-in-link" onClick={() => setLocation("/login")}>连接工作区</button>}</div></header>
      {children}
    </section>
  </div>;
}
