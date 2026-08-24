import { Moon, ScanLine, ShieldCheck, Sun, UserRound } from "lucide-react"
import { MotionConfig } from "motion/react"

import { Button } from "@/components/ui/button"
import { appPath } from "@/lib/paths.mjs"

function ThemeButton() {
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark")
    document.documentElement.classList.toggle("dark", next)
    try { localStorage.setItem("theme", next ? "dark" : "light") } catch {}
  }
  return <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换颜色模式"><Moon className="dark:hidden" /><Sun className="hidden dark:block" /></Button>
}

export function AppLoading({ label = "正在加载" }) {
  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-24 sm:px-6 lg:px-8" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid gap-5 motion-safe:animate-pulse" aria-hidden="true">
        <div className="h-36 rounded-3xl bg-muted sm:h-44" />
        <div className="grid gap-5 sm:grid-cols-[0.8fr_1.2fr]">
          <div className="h-64 rounded-3xl bg-muted/80" />
          <div className="space-y-4 rounded-3xl border p-6"><div className="h-5 w-1/3 rounded bg-muted" /><div className="h-12 rounded-xl bg-muted" /><div className="h-12 rounded-xl bg-muted" /><div className="h-12 w-2/3 rounded-xl bg-muted" /></div>
        </div>
      </div>
    </div>
  )
}

export default function AppShell({ children, eyebrow, title, description, session, profile, actions }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href={appPath("/")} className="flex min-h-11 items-center gap-3" aria-label="AAPRICE 首页">
            <span className="grid size-9 place-items-center rounded-[0.8rem] bg-primary font-mono text-xs font-bold tracking-tight text-primary-foreground shadow-[0_8px_24px_color-mix(in_oklab,var(--primary)_22%,transparent)]">AA</span>
            <span><span className="block font-semibold leading-none tracking-[-0.045em]">AAPRICE</span><span className="mt-1 block text-[10px] leading-none text-muted-foreground">日本药妆比价</span></span>
          </a>
          <nav className="flex items-center gap-1" aria-label="主导航">
            <Button asChild variant="ghost" size="sm" className="size-11 rounded-full px-0 sm:w-auto sm:px-2.5 md:h-9"><a href={appPath("/scan/")} aria-label="扫码检索"><ScanLine /><span className="hidden sm:inline">扫码</span></a></Button>
            <Button asChild variant="ghost" size="sm" className="size-11 rounded-full px-0 sm:w-auto sm:px-2.5 md:h-9"><a href={appPath(session ? "/me/" : "/login/")} aria-label={session ? "我的账户" : "登录"}><UserRound /><span className="hidden sm:inline">{session ? "我的" : "登录"}</span></a></Button>
            {profile?.role === "admin" && <Button asChild variant="ghost" size="sm" className="size-11 rounded-full px-0 sm:w-auto sm:px-2.5 md:h-9"><a href={appPath("/admin/")} aria-label="管理后台"><ShieldCheck /><span className="hidden sm:inline">管理</span></a></Button>}
            <ThemeButton />
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {(title || eyebrow) && (
          <section className="app-enter mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            <div className="grid gap-4 border-b pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0 max-w-5xl">
                {eyebrow && <p className="text-xs font-semibold tracking-[0.08em] text-primary">{eyebrow}</p>}
                {title && <h1 className="mt-1 break-words text-2xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-3xl lg:text-4xl">{title}</h1>}
                {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
              </div>
              {actions}
            </div>
          </section>
        )}
        {children}
      </main>
      </div>
    </MotionConfig>
  )
}
