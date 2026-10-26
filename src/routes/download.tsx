import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Monitor, Smartphone } from "lucide-react";

export const Route = createFileRoute("/download")({ component: DownloadPage });

/** Built by .github/workflows/native-apps.yml and attached to the newest GitHub release. */
const RELEASES = "https://github.com/xble1n/taxiim/releases/latest/download";
const ANDROID_APK = `${RELEASES}/TAXI-IM.apk`;
const WINDOWS_SETUP = `${RELEASES}/TAXI-IM-Setup.exe`;
const WINDOWS_PORTABLE = `${RELEASES}/TAXI-IM-Portable.exe`;

type Platform = "android" | "windows" | "ios" | "other";

function detect(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  return "other";
}

function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detect()), []);

  const android = (
    <section key="android" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Smartphone className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg font-medium">Android phone</h2>
      </div>
      <p className="mt-1 text-sm text-muted">For drivers. Keeps GPS running with the screen locked.</p>
      <a
        href={ANDROID_APK}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent font-medium text-on-accent"
      >
        <Download className="size-5" aria-hidden /> Download for Android
      </a>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Tap the button above and open the downloaded file <span className="font-mono text-fg">TAXI-IM.apk</span>.</li>
        <li>If Android asks, allow <span className="text-fg">Install unknown apps</span> for your browser, then tap Install.</li>
        <li>Open TAXI IM, sign in, and allow location <span className="text-fg">All the time</span> and notifications.</li>
      </ol>
    </section>
  );

  const windows = (
    <section key="windows" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <Monitor className="size-5 text-accent" aria-hidden />
        <h2 className="text-lg font-medium">Windows computer</h2>
      </div>
      <p className="mt-1 text-sm text-muted">For the control center. Windows 10 or 11, 64-bit.</p>
      <a
        href={WINDOWS_SETUP}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent font-medium text-on-accent"
      >
        <Download className="size-5" aria-hidden /> Download for Windows
      </a>
      <a href={WINDOWS_PORTABLE} className="mt-2 flex h-11 w-full items-center justify-center rounded-md border border-line text-sm">
        Portable version (no install)
      </a>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Run <span className="font-mono text-fg">TAXI-IM-Setup.exe</span>.</li>
        <li>If Windows shows "Windows protected your PC", click <span className="text-fg">More info</span>, then <span className="text-fg">Run anyway</span>.</li>
        <li>A TAXI IM shortcut appears on the desktop.</li>
      </ol>
    </section>
  );

  const ordered = platform === "windows" ? [windows, android] : [android, windows];

  return (
    <main className="min-h-dvh bg-bg px-4 py-8 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] text-fg">
      <div className="mx-auto w-full max-w-[26rem] space-y-4">
        <img
          src="/brand/taxi-im.png"
          alt="TAXI IM"
          width={160}
          height={42}
          draggable={false}
          className="mb-4 block"
          style={{ display: "block", width: 160, height: 42, objectFit: "contain", objectPosition: "left center" }}
        />
        <h1 className="text-2xl font-medium tracking-tight">Get the TAXI IM app</h1>
        <p className="text-sm text-muted">Free. The app always shows the latest TAXI IM, so you only install it once.</p>
        {platform === "ios" ? (
          <section className="rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm">
            There is no iPhone download yet. On iPhone, open TAXI IM in Safari, tap Share, then{" "}
            <span className="font-medium">Add to Home Screen</span>. GPS only runs while TAXI IM is open on screen.
          </section>
        ) : null}
        {ordered}
        <Link to="/login" className="block py-3 text-center text-sm text-accent">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
