import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

/**
 * Display face for headings and headline figures; body text stays on the
 * system stack. Loaded through next/font so it is self-hosted and inlined —
 * a <link> to Google would add a third-party connection and a flash of
 * unstyled text on the airport wifi this app is mostly used on.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Expenses",
  description: "ATO-compliant expense records for an Australian business",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1fb" },
    { media: "(prefers-color-scheme: dark)", color: "#070a14" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
