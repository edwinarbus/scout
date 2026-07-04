import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

// A rounded, warm type system for a dog-park product: Baloo 2 (bold, rounded
// display) for headlines and the wordmark, Nunito (rounded humanist) for all
// UI text — playful and friendly, but high-legibility, not a kid font.
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-baloo",
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Scout — California dog adoption scout",
  description:
    "Personal, non-commercial monitor for California shelter and rescue dog listings. Always verify availability with the shelter — original listings are the source of truth.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Scout", statusBarStyle: "default" },
  // Personal, single-user tool — never meant to be discoverable or indexed.
  // robots.ts + the X-Robots-Tag header (next.config.ts) back this up so no
  // route (including non-HTML ones) is missed.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export const viewport: Viewport = {
  themeColor: "#1c8047",
  width: "device-width",
  initialScale: 1,
  // "cover" lets content draw under the iOS notch/Dynamic Island/home
  // indicator; safe-area-inset padding (where used) then reclaims that space
  // instead of leaving letterboxed bars around the app shell.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${baloo.variable}`}>
      {/* h-dvh (dynamic viewport height), not h-screen (100vh): iOS Safari's
          address bar shows/hides as you scroll, and 100vh is sized for the
          bar-hidden state — so a fixed-height single-page app shell built on
          100vh gets cut off short whenever the bar is actually showing
          (the default). 100dvh always matches what's really visible. */}
      <body className="h-dvh overflow-hidden antialiased">{children}</body>
    </html>
  );
}
