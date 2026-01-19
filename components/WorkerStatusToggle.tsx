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
  { label: string; short: string; dot: string; blink: string }
> = {
  available: { label: "Available", short: "Avail", dot: "bg-green-500", blink: "animate-pulse" },
  unavailable: { label: "Away", short: "Away", dot: "bg-yellow-500", blink: "animate-pulse" },
  offline: { label: "Offline", short: "Off", dot: "bg-gray-400", blink: "" },
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
    <div className={cn("flex items-center gap-1 sm:gap-2", className)}>
      <Select value={status} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className={cn(
          "w-[85px] sm:w-[130px] h-7 sm:h-8 text-[10px] sm:text-xs font-medium bg-transparent hover:bg-accent hover:text-accent-foreground",
          isLoading && "opacity-50"
        )}>
          <SelectValue>
            <span className="flex items-center gap-1.5 sm:gap-2">
              <span className={cn("w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full", STATUS_CONFIG[status].dot, STATUS_CONFIG[status].blink)} />
              <span className="sm:hidden">{isLoading ? "..." : STATUS_CONFIG[status].short}</span>
              <span className="hidden sm:inline">{isLoading ? "..." : STATUS_CONFIG[status].label}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="available" className="text-[10px] sm:text-xs">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-green-500" />
              Available
            </span>
          </SelectItem>
          <SelectItem value="unavailable" className="text-[10px] sm:text-xs">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-yellow-500" />
              Away
            </span>
          </SelectItem>
          <SelectItem value="offline" className="text-[10px] sm:text-xs">
            <span className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gray-400" />
              Offline
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {error && (
        <span className="text-[10px] sm:text-xs text-destructive" title={error}>
          !
        </span>
      )}
    </div>
  );
}