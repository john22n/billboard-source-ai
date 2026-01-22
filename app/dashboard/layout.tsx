"use client";
import { TwilioProvider } from "@/components/providers/TwilioProvider";
import { WorkerStatusProvider } from "@/hooks/useWorkerStatus";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkerStatusProvider>
      <TwilioProvider>
        {children}
      </TwilioProvider>
    </WorkerStatusProvider>
  );
}