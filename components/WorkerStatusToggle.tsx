"use client";

import { useWorkerStatus, type WorkerActivity } from "@/hooks/useWorkerStatus";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_CONFIG: Record<
  WorkerActivity,
  { label: string; dot: string; blink: string }
> = {
  available: { label: "Available", dot: "bg-green-500", blink: "animate-pulse shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]" },
  unavailable: { label: "Away", dot: "bg-yellow-500", blink: "animate-pulse shadow-[0_0_8px_2px_rgba(234,179,8,0.6)]" },
  offline: { label: "Offline", dot: "bg-gray-400", blink: "" },
};

interface WorkerStatusToggleProps {
  className?: string;
}

export function WorkerStatusToggle({ className }: WorkerStatusToggleProps) {
  const { status, isLoading, error, setStatus } = useWorkerStatus();

  const handleChange = async (value: string) => {
    try {
      await setStatus(value as WorkerActivity);
    } catch {
      // Error handled in hook
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select value={status} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className={cn(
          "w-[130px] h-8 text-xs font-medium bg-transparent hover:bg-accent hover:text-accent-foreground",
          isLoading && "opacity-50"
        )}>
          <SelectValue>
            <span className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", STATUS_CONFIG[status].dot, STATUS_CONFIG[status].blink)} />
              {isLoading ? "..." : STATUS_CONFIG[status].label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="available" className="text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Available
            </span>
          </SelectItem>
          <SelectItem value="unavailable" className="text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              Away
            </span>
          </SelectItem>
          <SelectItem value="offline" className="text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              Offline
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {error && (
        <span className="text-xs text-destructive" title={error}>
          !
        </span>
      )}
    </div>
  );
}
