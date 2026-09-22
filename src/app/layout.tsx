import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@fontsource-variable/inter";
import "react-day-picker/style.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Enercore · Connected business",
  description: "One workspace for every part of your energy business.",
  manifest: "/manifest.webmanifest",
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
        <Script
          id="enercore-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('enercore-theme');document.documentElement.dataset.theme=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';var p=localStorage.getItem('enercore-palette');if(['company','ocean','forest','violet','rose','slate'].includes(p))document.documentElement.dataset.palette=p}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
