"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, authApi } from "@/lib/api";

export function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.title = "管理员登录";
  }, []);

  useEffect(() => {
    if (!loading) {
      passwordInputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await authApi.getSession();
        if (res.success && res.data?.isLoggedIn) {
          router.replace("/admin");
          return;
        }
      } catch (sessionError) {
        console.error("Login session check failed:", sessionError);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, [router]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    try {
      const res = await authApi.login(password);
      if (res.success) {
        router.replace("/admin");
      }
    } catch (loginError) {
      if (loginError instanceof ApiError) {
        if (loginError.code === "INVALID_CREDENTIALS") {
          setError("密码错误");
          return;
        }
        if (loginError.code === "SETUP_REQUIRED") {
          setError("管理员账号尚未初始化");
          return;
        }
        if (loginError.code === "NETWORK_ERROR") {
          setError("网络错误，请检查连接");
          return;
        }
        setError(loginError.message);
        return;
      }

      setError("登录失败");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f3ea]">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3ea]">
      <header className="glass-header sticky top-0 z-30">
        <div className="shell flex items-center justify-between gap-4 py-3 sm:py-4">
          <h1 className="text-[1rem] font-medium tracking-[-0.03em] text-[#1f2430] sm:text-[1.15rem]">管理员登录</h1>
          <a href="/" className="text-sm font-semibold text-[#64b7ea] hover:text-[#4c9ecf]">
            返回公开首页
          </a>
        </div>
      </header>

      <main className="shell safe-bottom-pad flex min-h-[calc(100vh-72px)] items-center justify-center py-8 sm:min-h-[calc(100vh-80px)] sm:py-16">
        <div className="w-full max-w-md">
          <div className="surface-card-soft w-full p-6 sm:p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[#1f2430]">
                密码
              </label>
              <input
                ref={passwordInputRef}
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                className="field-input w-full px-4 py-3"
                placeholder="输入密码"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              className="primary-action-button w-full px-4 py-3"
            >
              登录
            </button>
          </form>
          </div>
        </div>
      </main>
    </div>
  );
}
