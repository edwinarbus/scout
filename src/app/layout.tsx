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
};

export const viewport: Viewport = { themeColor: "#1c8047" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${baloo.variable}`}>
      <body className="h-screen overflow-hidden antialiased">{children}</body>
    </html>
  );
}
