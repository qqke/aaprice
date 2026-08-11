import { motion } from "motion/react"
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LogOut, Mail, UserPlus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import AppShell from "@/components/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fetchCurrentProfile,
  friendlyApiError,
  getSession,
  sendPasswordResetEmail,
  signInWithEmailPassword,
  signOut,
  signUpWithEmailPassword,
  subscribeAuthState,
  turnstileEnabled,
  turnstileSiteKey,
  updatePassword,
} from "@/lib/aprice-api.mjs"
import { appPath } from "@/lib/paths.mjs"

const copy = {
  login: ["登录账号", "使用 AAPRICE 邮箱密码继续。", "登录", "还没有账号？注册"],
  register: ["创建账号", "注册后通过邮件确认即可使用。", "注册", "已有账号？登录"],
  resetRequest: ["找回密码", "发送密码重置邮件到注册邮箱。", "发送重置邮件", "返回登录"],
  reset: ["设置新密码", "为当前重置会话设置新密码。", "更新密码", "返回登录"],
}

function Turnstile({ onToken }) {
  const mountRef = useRef(null)
  const widgetRef = useRef(null)
  useEffect(() => {
    if (!turnstileEnabled) return undefined
    let active = true
    const render = () => {
      if (!active || !mountRef.current || !window.turnstile || widgetRef.current !== null) return
      widgetRef.current = window.turnstile.render(mountRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token) => onToken(String(token || "")),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      })
    }
    if (window.turnstile) render()
    else {
      let script = document.querySelector("script[data-aprice-turnstile]")
      if (!script) {
        script = document.createElement("script")
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        script.async = true
        script.defer = true
        script.dataset.apriceTurnstile = "true"
        document.head.append(script)
      }
      script.addEventListener("load", render, { once: true })
    }
    return () => {
      active = false
      if (widgetRef.current !== null) window.turnstile?.remove(widgetRef.current)
      widgetRef.current = null
      onToken("")
    }
  }, [])
  return turnstileEnabled ? <div ref={mountRef} className="min-h-[65px]" aria-label="人机验证" /> : null
}

export default function AuthApp() {
  const [mode, setMode] = useState("login")
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")
  const [status, setStatus] = useState("")
  const [statusType, setStatusType] = useState("info")
  const [loading, setLoading] = useState(true)
  const [redirectPath, setRedirectPath] = useState("")

  useEffect(() => {
    const initialMode = new URLSearchParams(window.location.search).get("mode")
    const requestedRedirect = new URLSearchParams(window.location.search).get("redirect") || ""
    setRedirectPath(requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//") ? requestedRedirect : "")
    if (initialMode === "reset") setMode("reset")
    let active = true
    let unsubscribe = () => {}
    getSession().then(async (value) => {
      if (!active) return
      setSession(value)
      if (value) setProfile(await fetchCurrentProfile())
    }).catch((error) => { setStatusType("error"); setStatus(friendlyApiError(error)) }).finally(() => setLoading(false))
    subscribeAuthState(async (value) => {
      if (!active) return
      setSession(value)
      setProfile(value ? await fetchCurrentProfile().catch(() => null) : null)
    }).then((stop) => { unsubscribe = stop }).catch((error) => {
      if (!active) return
      setStatusType("error")
      setStatus(friendlyApiError(error))
    })
    return () => { active = false; unsubscribe() }
  }, [])

  const switchMode = (next) => {
    setMode(next)
    setStatus("")
    setStatusType("info")
    setPassword("")
    setConfirm("")
    setShowPassword(false)
    setCaptchaToken("")
  }

  const submit = async (event) => {
    event.preventDefault()
    if (mode !== "resetRequest" && password.length < 8) { setStatusType("error"); setStatus("密码至少需要 8 位。"); return }
    if ((mode === "register" || mode === "reset") && password !== confirm) { setStatusType("error"); setStatus("两次输入的密码不一致。"); return }
    if (turnstileEnabled && mode !== "reset" && !captchaToken) { setStatusType("error"); setStatus("请先完成人机验证。"); return }
    setLoading(true)
    setStatus("")
    setStatusType("info")
    try {
      if (mode === "login") {
        const value = await signInWithEmailPassword(email.trim(), password, captchaToken)
        setSession(value)
        setProfile(await fetchCurrentProfile())
        if (redirectPath) window.location.assign(redirectPath)
      } else if (mode === "register") {
        await signUpWithEmailPassword(email.trim(), password, captchaToken)
        setStatusType("success")
        setStatus("注册邮件已发送，请确认邮箱后登录。")
      } else if (mode === "resetRequest") {
        await sendPasswordResetEmail(email.trim(), captchaToken)
        setStatusType("success")
        setStatus("密码重置邮件已发送。")
      } else {
        await updatePassword(password)
        setStatusType("success")
        setStatus("密码已更新，可以继续使用当前账号。")
        setMode("login")
      }
    } catch (error) {
      setStatusType("error")
      setStatus(friendlyApiError(error))
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await signOut()
    setSession(null)
    setProfile(null)
  }

  const [title, description, submitLabel, toggleLabel] = copy[mode]
  return (
    <AppShell session={session} profile={profile}>
      <section className="mx-auto max-w-lg px-4 py-10 pb-24 sm:px-6 sm:py-16">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border bg-card p-6 shadow-[0_20px_60px_oklch(0.18_0.03_178_/_0.06)] sm:p-8">
          {loading && !session ? <div className="flex min-h-64 items-center justify-center text-muted-foreground"><LoaderCircle className="mr-2 animate-spin" /> 读取会话</div> : session && mode === "login" ? (
            <div className="flex min-h-64 flex-col justify-between">
              <div><Badge className="gap-1"><CheckCircle2 className="size-3" /> 已登录</Badge><h2 className="mt-5 text-2xl font-semibold">{profile?.full_name || session.user.email}</h2><p className="mt-2 text-muted-foreground">角色：{profile?.role || "user"}</p></div>
              <div className="mt-8 flex flex-wrap gap-3"><Button asChild><a href={redirectPath || appPath(profile?.role === "admin" ? "/admin/" : "/me/")}>继续使用 <ArrowRight /></a></Button><Button variant="outline" onClick={logout}><LogOut /> 退出登录</Button></div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>
              <div className="mt-8 space-y-4">
                {mode !== "reset" && <label className="block"><span className="mb-2 block text-sm font-medium">邮箱</span><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" placeholder="name@example.com" /></label>}
                {mode !== "resetRequest" && <label className="block"><span className="mb-2 block text-sm font-medium">密码</span><span className="relative block"><Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 8 位" className="pr-12" /><Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowPassword((value) => !value)} className="absolute right-0 top-1/2 -translate-y-1/2" aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff /> : <Eye />}</Button></span></label>}
                {(mode === "register" || mode === "reset") && <label className="block"><span className="mb-2 block text-sm font-medium">确认密码</span><Input type={showPassword ? "text" : "password"} value={confirm} onChange={(event) => setConfirm(event.target.value)} required autoComplete="new-password" placeholder="再次输入" /></label>}
                {mode !== "reset" && <Turnstile key={mode} onToken={setCaptchaToken} />}
                {status && <p className={`rounded-xl border px-4 py-3 text-sm ${statusType === "error" ? "border-destructive/25 bg-destructive/5 text-destructive" : statusType === "success" ? "border-primary/25 bg-primary/5 text-foreground" : "bg-muted"}`} role={statusType === "error" ? "alert" : "status"} aria-live="polite">{status}</p>}
              </div>
              <Button type="submit" className="mt-6 w-full" disabled={loading || (turnstileEnabled && mode !== "reset" && !captchaToken)}>{loading ? <LoaderCircle className="animate-spin" /> : mode === "register" ? <UserPlus /> : <Mail />}{loading ? "正在处理" : submitLabel}</Button>
              <div className="mt-4 flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => switchMode(mode === "login" ? "register" : "login")}>{toggleLabel}</Button>{mode === "login" && <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("resetRequest")}>忘记密码</Button>}</div>
            </form>
          )}
        </motion.div>
      </section>
    </AppShell>
  )
}
