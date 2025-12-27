import type { Metadata } from "next";
import { Theme } from "@radix-ui/themes"
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from 'react-hot-toast'
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false, // Mono font less critical, load async
});

export const metadata: Metadata = {
  title: "Billboard Source AI.",
  description: "Billboard Source Company application integrated with AI",
  robots: {
    index: false,
    follow: false
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Theme accentColor="tomato">
          <Toaster position="top-center" />
          {children}
        </Theme>
      </body>
    </html>
  );
}
