import type { Metadata } from "next";
import { Theme } from "@radix-ui/themes"
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from 'react-hot-toast'
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
