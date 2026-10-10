import { useState, type FormEvent } from "react";
import { post } from "./api";
import { useAction } from "./hooks";
import { Button, ErrorText, Field, Input } from "./ui";

function Frame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-lg font-semibold tracking-[0.2em] text-ink">JARVIS</div>
            <div className="text-xs text-muted">Private operations system</div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <h1 className="text-base font-semibold text-ink">{title}</h1>
          <p className="mt-1 mb-4 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f1830" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#3987e5" strokeWidth="2" />
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="#3987e5" strokeOpacity=".45" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2.6" fill="#8dbcf5" />
    </svg>
  );
}

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [secret, setSecret] = useState<{ totpSecret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const a = useAction();

  const begin = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return a.setError("Passwords do not match.");
    const r = await a.run(() => post("/api/setup", { setupToken: token.trim(), displayName: name, password: pw }));
    if (r) { setSecret(r); setStep(2); }
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    const r = await a.run(() => post("/api/setup/confirm", { setupToken: token.trim(), code }));
    if (r) onDone();
  };

  if (step === 2 && secret) {
    return (
      <Frame title="Enrol your authenticator" subtitle="Add this key to an authenticator app (1Password, Aegis, Google Authenticator), then enter the 6-digit code.">
        <form onSubmit={confirm} className="space-y-3">
          <div className="rounded-lg border border-line-strong bg-bg p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">Setup key (shown once)</div>
            <div className="mt-1 font-mono text-sm break-all text-ink select-all">{secret.totpSecret.match(/.{1,4}/g)?.join(" ")}</div>
            <a className="mt-2 inline-block text-xs text-accent underline" href={secret.otpauthUri}>Open in authenticator app</a>
          </div>
          <Field label="6-digit code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></Field>
          <ErrorText>{a.error}</ErrorText>
          <Button variant="primary" className="w-full" disabled={a.busy || code.length !== 6}>Complete setup</Button>
        </form>
      </Frame>
    );
  }
  return (
    <Frame title="First-run owner setup" subtitle="The setup token is printed once in the server console at startup.">
      <form onSubmit={begin} className="space-y-3">
        <Field label="Setup token"><Input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required /></Field>
        <Field label="Owner name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Password" hint="At least 12 characters. A passphrase is ideal."><Input type="password" autoComplete="new-password" minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
        <ErrorText>{a.error}</ErrorText>
        <Button variant="primary" className="w-full" disabled={a.busy}>Continue</Button>
      </form>
    </Frame>
  );
}

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await a.run(() => post("/api/auth/login", { password: pw, code }));
    if (r) onDone();
  };
  return (
    <Frame title="Owner sign-in" subtitle="Password and authenticator code required.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
        <Field label="Authenticator code"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></Field>
        <ErrorText>{a.error}</ErrorText>
        <Button variant="primary" className="w-full" disabled={a.busy || code.length !== 6}>Sign in</Button>
      </form>
    </Frame>
  );
}
