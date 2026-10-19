import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "react-day-picker/style.css";
import "./globals.css";
import { bootScript } from "./boot-script";
export const metadata: Metadata = {
  title: "Enercore · Connected business",
  description: "One workspace for every part of your energy business.",
  manifest: "/manifest.webmanifest",
  // Without an explicit icon the browser probes /favicon.ico, which 404s.
  icons: { icon: "/brands/enercore.svg", shortcut: "/brands/enercore.svg", apple: "/brands/enercore.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102326",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* A plain inline script, so it runs before the first paint (see
            boot-script.ts). */}
        <script id="enercore-boot" dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
