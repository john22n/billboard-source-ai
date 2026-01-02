// types/sales-call.ts
// Shared types for SalesCallTranscriber components

export interface TranscriptItem {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
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

// Lead type classification enum (business category)
export enum LeadType {
  ESTABLISHED_B2B = "Established B2B",
  ESTABLISHED_B2C = "Established B2C",
  NEW_B2B = "New B2B",
  NEW_B2C = "New B2C",
  NON_PROFIT = "Non-Profit",
  POLITICAL = "Political",
  PERSONAL = "Personal"
}

// Billboard purpose/goal enum
export enum BillboardPurpose {
  DIRECTIONAL = "Directional",
  ENROLLMENT = "Enrollment",
  EVENT = "Event",
  GENERAL_BRAND_AWARENESS = "General Brand Awareness",
  HIRING = "Hiring",
  NEW_LOCATION = "New Location",
  NEW_PRODUCT_SERVICE = "New Product/Service",
  POLITICAL = "Political"
}
