// types/sales-call.ts
// Shared types for SalesCallTranscriber components

export interface TranscriptItem {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  speaker?: 'agent' | 'caller';
}

export interface TwilioState {
  twilioReady: boolean;
  callActive: boolean;
  userEmail: string;
}

// Lead sentiment classification enum
export enum LeadSentiment {
  AVAILER = "Availer",
  PANEL_REQUESTER = "Panel Requester",
  TIRE_KICKER = "Tire Kicker"
}
