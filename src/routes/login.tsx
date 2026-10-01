import { useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getPublicConfig } from "@/lib/taxi/api";
import { isFail } from "@/lib/taxi/format";
import { Banner, BootScreen, Btn, Field, fieldClass } from "@/components/taxi/ui";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const config = useQuery({ queryKey: ["public-config"], queryFn: () => getPublicConfig() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return <BootScreen />;
  if (user) return <Navigate to="/" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email: email.trim(), password, callbackURL: "/" });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
      return;
    }
    window.location.assign("/");
  }

  const demo = config.data && !isFail(config.data) && config.data.success ? config.data.logins : [];

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
          {error ? <Banner>{error}</Banner> : null}
          <Field label="Email">
            <input className={fieldClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className={fieldClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Btn type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Btn>
          {demo.length ? (
            <div className="border-t border-line pt-3">
              <p className="text-xs text-muted">Driver accounts · password {demo[0]?.password}</p>
              <ul className="mt-2">
                {demo.map((d) => (
                  <li key={d.email}>
                    <button
                      type="button"
                      className="flex h-10 w-full items-center justify-between text-left text-sm"
                      onClick={() => {
                        setEmail(d.email);
                        setPassword(d.password);
                      }}
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-accent">Use</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </div>
    </main>
  );
}
