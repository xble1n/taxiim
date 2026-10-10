import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Encode, decrypt, encrypt, hashPassword, hotp, totpAt, verifyPassword, verifyTotp } from "../server/security/crypto.ts";
import { detectSecret, redact } from "../server/security/redact.ts";
import { randomBytes } from "node:crypto";

test("HOTP matches RFC 4226 test vectors", () => {
  const key = Buffer.from("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, i) => assert.equal(hotp(key, i), code));
});

test("TOTP matches RFC 6238 SHA1 vector (T=59s → 94287082, 6-digit 287082)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(verifyTotp(secret, "287082", 59_000), 1);
  assert.equal(verifyTotp(secret, "000000", 59_000), null);
  assert.equal(verifyTotp(secret, "28708", 59_000), null);
});

test("scrypt password hashing verifies and rejects", async () => {
  const h = await hashPassword("a long enough password");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("a long enough password", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
});

test("AES-GCM round trip; tampering is detected", () => {
  const key = randomBytes(32);
  const blob = encrypt("JBSWY3DPEHPK3PXP", key);
  assert.equal(decrypt(blob, key), "JBSWY3DPEHPK3PXP");
  const parts = blob.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join("."), key));
  assert.throws(() => decrypt(blob, randomBytes(32)));
});

test("redact masks secrets by key and by pattern", () => {
  const out = redact({ password: "x", nested: { apiKey: "y", note: "key sk-ant-abcdefghijklmnop123 here" }, ok: 5 });
  assert.equal(out.password, "[REDACTED]");
  assert.equal((out.nested as any).apiKey, "[REDACTED]");
  assert.match((out.nested as any).note, /\[REDACTED:anthropic-key\]/);
  assert.equal(out.ok, 5);
  assert.equal(redact("postgres://u:hunter2@db/x"), "postgres://u:[REDACTED]@db/x");
});

test("detectSecret catches keys and seed phrases but not normal text", () => {
  assert.ok(detectSecret("my key is sk-ant-abcdefghijklmnopqrst"));
  assert.ok(detectSecret("seed phrase: abandon ability able about above absent absorb abstract absurd abuse access accident"));
  assert.ok(detectSecret("abandon ability able about above absent absorb abstract absurd abuse access accident"));
  assert.equal(detectSecret("Owner prefers weekly reports on Monday mornings."), null);
  assert.equal(detectSecret("Tx 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060 confirmed"), null);
});
