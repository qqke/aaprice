import { Moon, ScanLine, ShieldCheck, Sun, UserRound } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

function ThemeButton() {
  const [dark, setDark] = useState(false)
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), [])
  const toggle = () => {
    const next = !dark
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
    setDark(next)
  }
  return <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "切换浅色模式" : "切换深色模式"}>{dark ? <Sun /> : <Moon />}</Button>
}

export default function AppShell({ children, eyebrow, title, description, session, profile, actions }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-3" aria-label="AAPRICE 首页">
            <span className="grid size-9 place-items-center rounded-[0.8rem] bg-primary font-mono text-xs font-bold tracking-tight text-primary-foreground shadow-[0_8px_24px_color-mix(in_oklab,var(--primary)_22%,transparent)]">AA</span>
            <span><span className="block font-semibold leading-none tracking-[-0.045em]">AAPRICE</span><span className="mt-1 block text-[10px] leading-none text-muted-foreground">日本药妆比价</span></span>
          </a>
          <nav className="flex items-center gap-1" aria-label="主导航">
            <Button asChild variant="ghost" size="sm" className="size-9 rounded-full px-0 sm:w-auto sm:px-2.5"><a href="/scan/" aria-label="扫码检索"><ScanLine /><span className="hidden sm:inline">扫码</span></a></Button>
            <Button asChild variant="ghost" size="sm" className="size-9 rounded-full px-0 sm:w-auto sm:px-2.5"><a href={session ? "/me/" : "/login/"} aria-label={session ? "我的账户" : "登录"}><UserRound /><span className="hidden sm:inline">{session ? "我的" : "登录"}</span></a></Button>
            {profile?.role === "admin" && <Button asChild variant="ghost" size="sm" className="size-9 rounded-full px-0 sm:w-auto sm:px-2.5"><a href="/admin/" aria-label="管理后台"><ShieldCheck /><span className="hidden sm:inline">管理</span></a></Button>}
            <ThemeButton />
          </nav>
        </div>
      </header>
      <main>
        {(title || eyebrow) && (
          <section className="app-enter mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
            <div className="grid gap-5 border-b pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0 max-w-5xl">
                {eyebrow && <p className="text-xs font-semibold tracking-[0.08em] text-primary">{eyebrow}</p>}
                {title && <h1 className="mt-2 break-words text-3xl font-semibold leading-[1.05] tracking-[-0.045em] sm:text-4xl lg:text-[2.8rem]">{title}</h1>}
                {description && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>}
              </div>
              {actions}
            </div>
          </section>
        )}
        {children}
      </main>
    </div>
  )
}
