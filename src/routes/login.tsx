import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getPublicConfig } from "@/lib/taxi/api";
import { isFail } from "@/lib/taxi/format";
import { Banner, BootScreen, Btn, Field, fieldClass } from "@/taxi/ui";

export const Route = createFileRoute("/login")({ component: Login });

function isTransientSignInError(message: string) {
  return /fetch|network|timeout|timed out|503|502|500|429|internal|failed to|abort|connect|overload|origin|waking|database/i.test(message);
}

function signInMessage(message: string) {
  if (/invalid email or password|invalid credentials|unauthorized/i.test(message)) {
    return "Email or password is wrong. Capital letters matter: tap the eye to check the password.";
  }
  if (isTransientSignInError(message)) {
    return "The database was still waking. Press Sign in once more.";
  }
  return message || "Sign-in failed.";
}

async function pause(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function wakeDesk() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await getPublicConfig();
      if (result && !isFail(result) && result.success) return;
    } catch {
      /* Neon free tier is asleep until the first query. */
    }
    await pause(1000 * (attempt + 1));
  }
  throw new Error("The desk database is still waking. Wait a few seconds and sign in once.");
}

async function signInEmail(email: string, password: string) {
  return authClient.signIn.email({ email, password });
}

function Login() {
  const { user, isPending } = useCurrentUserState();
  const config = useQuery({ queryKey: ["public-config"], queryFn: () => getPublicConfig() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Sign in");
  const [showPassword, setShowPassword] = useState(false);
  // Already inside the Android or Windows app: no download link.
  const [inApp, setInApp] = useState(true);
  useEffect(() => {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    setInApp(Boolean(w.Capacitor?.isNativePlatform?.()) || /electron/i.test(navigator.userAgent));
  }, []);

  if (isPending) return <BootScreen />;
  if (user) return <Navigate to="/" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus("Waking the desk…");
    const trimmed = email.trim().toLowerCase();
    // Phone keyboards add a space after a suggested word; no TAXI IM password starts or ends with one.
    const pass = password.trim();
    try {
      await wakeDesk();
      setStatus("Signing in…");
      let result = await signInEmail(trimmed, pass);
      if (result.error && isTransientSignInError(result.error.message ?? "")) {
        setStatus("Still connecting…");
        await pause(1500);
        result = await signInEmail(trimmed, pass);
      }
      if (result.error) {
        setError(signInMessage(result.error.message ?? ""));
        return;
      }
      setStatus("Opening the desk…");
      const session = await authClient.getSession();
      if (!session.data?.user) {
        setError("Sign-in did not stick. Press Sign in once more.");
        return;
      }
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
      setStatus("Sign in");
    }
  }

  const ephemeral = Boolean(config.data && !isFail(config.data) && config.data.success && config.data.ephemeral);

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-bg px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-fg">
      <div className="w-full max-w-[22rem]">
        <img
          src="/brand/taxi-im.png"
          alt="TAXI IM"
          width={160}
          height={42}
          draggable={false}
          className="mb-8 block"
          style={{ display: "block", width: 160, height: 42, objectFit: "contain", objectPosition: "left center" }}
        />
        <form className="space-y-3 rounded-lg border border-line bg-surface p-5" onSubmit={(e) => void submit(e)}>
          <h1 className="text-xl font-medium tracking-tight">Sign in</h1>
          {ephemeral ? (
            <Banner>
              This server has no database configured (DATABASE_URL), so sign-ins and data are lost on refresh. Set it in the
              hosting environment.
            </Banner>
          ) : null}
          {error ? <Banner>{error}</Banner> : null}
          <Field label="Email">
            <input
              className={fieldClass}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <div className="relative">
              <input
                className={`${fieldClass} pr-12`}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-fg"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={(e) => {
                  e.preventDefault();
                  setShowPassword((v) => !v);
                }}
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </Field>
          <Btn type="submit" className="w-full" disabled={busy}>
            {busy ? status : "Sign in"}
          </Btn>
        </form>
        {inApp ? null : (
          <Link to="/download" className="mt-4 block py-2 text-center text-sm text-accent">
            Get the app for Android or Windows
          </Link>
        )}
      </div>
    </main>
  );
}
