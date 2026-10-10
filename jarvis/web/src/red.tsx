import { useState, type FormEvent } from "react";
import { post } from "./api";
import { useAction } from "./hooks";
import { Button, ErrorText, Field, Input, Modal } from "./ui";

/** RED PROTOCOL step-up dialog: codeword + a fresh authenticator code. */
export function RedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [codeword, setCodeword] = useState("");
  const [code, setCode] = useState("");
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await a.run(() => post("/api/red/activate", { codeword, code }));
    if (r) { setCode(""); setCodeword(""); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={<span className="tracking-[0.25em] text-red">RED PROTOCOL</span>} tone="red">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-2">Master-control session for privileged operations: verifying revenue, permissions, settings, crypto destinations, LEVEL 4 approvals and backups. Expires automatically.</p>
        <Field label="Codeword"><Input value={codeword} onChange={(e) => setCodeword(e.target.value)} autoComplete="off" autoFocus required /></Field>
        <Field label="Fresh authenticator code" hint="Each code works once — if you just signed in, wait for the next code."><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="red" disabled={a.busy || code.length !== 6}>Authenticate</Button>
        </div>
      </form>
    </Modal>
  );
}
