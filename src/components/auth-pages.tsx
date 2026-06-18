"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";

type AuthMode = "login" | "register";

type AuthPagesProps = {
  mode: AuthMode;
};

type AuthFormState = {
  email: string;
  password: string;
  confirmPassword: string;
};

type AuthResponse = {
  user?: {
    email?: string;
  };
};

const authEndpoints = {
  login: "/api/auth/login",
  register: "/api/auth/register",
};

async function postAuth(endpoint: string, body: Record<string, string>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data
      ? String((data as { error?: string }).error)
      : response.status === 404
        ? "认证接口尚未接入，暂时无法完成操作。"
        : "请求失败，请稍后重试。";
    throw new Error(error);
  }
  return data as AuthResponse;
}

function validateEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function AuthPages({ mode }: AuthPagesProps) {
  const router = useRouter();
  const [form, setForm] = useState<AuthFormState>({ email: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";
  const title = isRegister ? "创建账号" : "登录工作台";
  const description = isRegister
    ? "使用邮箱和密码创建普通用户账号。"
    : "使用普通用户账号进入创作工作台。";
  const submitLabel = isRegister ? "注册" : "登录";
  const alternateHref = isRegister ? "/login" : "/register";
  const alternateText = isRegister ? "已有账号，去登录" : "没有账号，去注册";

  const fieldError = useMemo(() => {
    if (form.email && !validateEmail(form.email)) return "请输入有效邮箱。";
    if (form.password && form.password.length < 8) return "密码至少需要 8 个字符。";
    if (isRegister && form.confirmPassword && form.confirmPassword !== form.password) return "两次输入的密码不一致。";
    return "";
  }, [form.confirmPassword, form.email, form.password, isRegister]);

  const canSubmit = validateEmail(form.email)
    && form.password.length >= 8
    && (!isRegister || (form.confirmPassword.length >= 8 && form.confirmPassword === form.password));

  const updateField = (field: keyof AuthFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || loading) {
      setError(fieldError || "请先完整填写表单。");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await postAuth(authEndpoints[mode], {
        email: form.email.trim(),
        password: form.password,
        ...(isRegister ? { confirmPassword: form.confirmPassword } : {}),
      });
      router.replace("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page min-h-screen bg-[var(--background)] px-4 py-6 text-[var(--foreground)] md:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl items-center">
        <section className="auth-shell">
          <div className="auth-intro">
            <Link href="/" className="auth-brand">
              <BrandLogo className="auth-brand__logo" />
              <span>奥皇 AI</span>
            </Link>
            <div>
              <p className="auth-eyebrow">Account</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            <div className="auth-note" role="note">
              <ShieldCheck className="size-5" aria-hidden="true" />
              <span>当前仓库尚未提供普通用户认证接口。页面会保留真实错误，不会伪造登录成功。</span>
            </div>
          </div>

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <div className="auth-form__head">
              <LockKeyhole className="size-5 text-[var(--primary)]" aria-hidden="true" />
              <div>
                <h2>{title}</h2>
                <p>{isRegister ? "注册后将进入工作台。" : "登录成功后将进入工作台。"}</p>
              </div>
            </div>

            <label className="auth-field" htmlFor="auth-email">
              <span>邮箱</span>
              <div className="auth-input-wrap">
                <Mail className="size-4" aria-hidden="true" />
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  autoComplete={isRegister ? "email" : "username"}
                  placeholder="name@example.com"
                  aria-invalid={Boolean(form.email && !validateEmail(form.email))}
                />
              </div>
            </label>

            <PasswordField
              id="auth-password"
              label="密码"
              value={form.password}
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              onChange={(value) => updateField("password", value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
            />

            {isRegister ? (
              <PasswordField
                id="auth-confirm-password"
                label="确认密码"
                value={form.confirmPassword}
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((value) => !value)}
                onChange={(value) => updateField("confirmPassword", value)}
                autoComplete="new-password"
              />
            ) : null}

            {fieldError ? <p className="auth-field-error">{fieldError}</p> : null}
            {error ? <p className="auth-submit-error" role="alert">{error}</p> : null}

            <button className="auth-submit" type="submit" disabled={!canSubmit || loading}>
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
              {loading ? `${submitLabel}中` : submitLabel}
            </button>

            <Link className="auth-alt-link" href={alternateHref}>
              {alternateText}
            </Link>
          </form>
        </section>
      </div>
    </main>
  );
}

function PasswordField({
  id,
  label,
  value,
  visible,
  autoComplete,
  onToggle,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  autoComplete: string;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}</span>
      <div className="auth-input-wrap">
        <LockKeyhole className="size-4" aria-hidden="true" />
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder="至少 8 个字符"
          aria-invalid={Boolean(value && value.length < 8)}
        />
        <button type="button" className="auth-password-toggle" onClick={onToggle} aria-label={visible ? "隐藏密码" : "显示密码"}>
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </label>
  );
}
