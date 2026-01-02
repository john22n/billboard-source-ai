"use client";

import { TwilioProvider } from "@/components/providers/TwilioProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TwilioProvider>{children}</TwilioProvider>;
}
