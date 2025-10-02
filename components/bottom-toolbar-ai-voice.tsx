"use client"
import React from "react";
import { SessionStatus } from "@/lib/definitions";
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface BottomToolbarProps {
  sessionStatus?: SessionStatus;
  onToggleConnection?: () => void;
  isPTTActive?: boolean;
  setIsPTTActive?: (val: boolean) => void;
  isPTTUserSpeaking?: boolean;
  handleTalkButtonDown?: () => void;
  handleTalkButtonUp?: () => void;
  isEventsPaneExpanded?: boolean;
  setIsEventsPaneExpanded?: (val: boolean) => void;
  isAudioPlaybackEnabled?: boolean;
  setIsAudioPlaybackEnabled?: (val: boolean) => void;
}

export function BottomToolbar({
  sessionStatus = "CONNECTED",
  onToggleConnection = () => { },
  isPTTActive = true,
  setIsPTTActive = () => { },
  isPTTUserSpeaking = true,
  handleTalkButtonDown = () => { },
  handleTalkButtonUp = () => { },
  isEventsPaneExpanded = true,
  setIsEventsPaneExpanded = () => { },
  isAudioPlaybackEnabled = false,
  setIsAudioPlaybackEnabled = () => { },
}: BottomToolbarProps) {
  const isConnected = sessionStatus === "CONNECTED";
  const isConnecting = sessionStatus === "CONNECTING";


  function getConnectionButtonLabel() {
    if (isConnected) return "Disconnect";
    if (isConnecting) return "Connecting...";
    return "Connect";
  }

  function getConnectionButtonClasses() {
    const baseClasses = "text-white text-base p-2 w-36 rounded-md h-full";
    const cursorClass = isConnecting ? "cursor-not-allowed" : "cursor-pointer";

    if (isConnected) {
      // Connected -> label "Disconnect" -> red
      return `bg-red-600 hover:bg-red-700 ${cursorClass} ${baseClasses}`;
    }
    // Disconnected or connecting -> label is either "Connect" or "Connecting" -> black
    return `bg-black hover:bg-gray-900 ${cursorClass} ${baseClasses}`;
  }

  return (
    <div className="bg-sidebar border-t-current p-4 flex flex-row items-center justify-center gap-x-8">
      <Button
        onClick={onToggleConnection}
        className={getConnectionButtonClasses()}
        disabled={isConnecting}
      >
        {getConnectionButtonLabel()}
      </Button>

      <div className="flex flex-row items-center gap-2">
        <Checkbox
          id="push-to-talk"
          checked={isPTTActive}
          onCheckedChange={(e) => setIsPTTActive(e.target.checked)}
          aria-label="Select row"
          disabled={!isConnected}
          className="w-4 h-4"
        />
        {/*
        <input
          id="push-to-talk"
          type="checkbox"
          checked={isPTTActive}
          onChange={(e) => setIsPTTActive(e.target.checked)}
          disabled={!isConnected}
          className="w-4 h-4"
        />
        */}
        <Label
          htmlFor="push-to-talk"
          className="flex items-center cursor-pointer"
        >
          Push to talk
        </Label>
        <Button
          onMouseDown={handleTalkButtonDown}
          onMouseUp={handleTalkButtonUp}
          onTouchStart={handleTalkButtonDown}
          onTouchEnd={handleTalkButtonUp}
          disabled={!isPTTActive}
          className={
            (isPTTUserSpeaking ? "bg-gray-300" : "bg-gray-200") +
            " py-1 px-4 cursor-pointer rounded-md" +
            (!isPTTActive ? " bg-gray-100 text-gray-400" : "")
          }
        >
          Talk
        </Button>
      </div>

      <div className="flex flex-row items-center gap-1">
        <Checkbox
          id="audio-playback"
          checked={isAudioPlaybackEnabled}
          onChange={(e) => setIsAudioPlaybackEnabled(e.target.checked)}
          disabled={!isConnected}
          className="w-4 h-4"
        />
        <Label
          htmlFor="audio-playback"
          className="flex items-center cursor-pointer"
        >
          Audio playback
        </Label>
      </div>

    </div>
  );
}

export default BottomToolbar;
