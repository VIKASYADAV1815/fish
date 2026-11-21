import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nami AI — Quiet Intelligence for Creators",
  description: "Interactive Zen Koi pond hero with glassmorphic AI workspace prompt.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        className={`${inter.className} antialiased min-h-screen bg-[#F9FAF4] text-neutral-900 overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
