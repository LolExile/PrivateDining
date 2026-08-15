import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Private Dining Finder · Nowadays",
  description:
    "Search, rank, and compare private dining venues for corporate groups.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      {/*
        suppressHydrationWarning: browser extensions commonly mutate <body>
        before React hydrates — the observed case adds style="isolation:isolate"
        to create a stacking context for their own injected UI. Nothing in this
        app sets a style on <body>, so the mismatch is never ours. This
        suppresses warnings for <body>'s own attributes only, one level deep;
        mismatches inside the app tree still surface normally.
      */}
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
