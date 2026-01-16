"use client";

import { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { CircleQuestionMark, Minus } from 'lucide-react';
import { useFormStore } from "@/stores/formStore";
import {
  FieldInput,
  FieldTextarea,
  ContactFieldInput,
  MarketFieldInput,
  MarketFieldTextarea,
  LeadTypeButtonGroup,
  BallparkInput,
  DecisionMakerButtonGroup,
  BoardTypeButtonGroup,
  DurationButtonGroup,
  SendOverButtonGroup,
  FirstNameInput,  // ✅ NEW: Import FirstNameInput for INTRO section
} from "./formFields";

// ============================================================================
// LIMITS
// ============================================================================

const MAX_ADDITIONAL_MARKETS = 1;
const MAX_ADDITIONAL_CONTACTS = 1;

// ============================================================================
// PROPS
// ============================================================================

interface LeadFormProps {
  resetTrigger?: number;
  inboundPhone?: string;
}

// ============================================================================
// LEAD FORM COMPONENT
// ============================================================================

export function LeadForm({ resetTrigger, inboundPhone }: LeadFormProps) {
  // 🔍 Performance monitoring (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log('🔄 Re-render: LeadForm');
  }

  // ✅ Get only what we need from store - NO form data subscription here
  const activeMarketIndex = useFormStore((s) => s.activeMarketIndex);
  const activeContactIndex = useFormStore((s) => s.activeContactIndex);
  const additionalMarkets = useFormStore((s) => s.additionalMarkets);
  const additionalContacts = useFormStore((s) => s.additionalContacts);

  // Actions
  const prefillPhoneFromTwilio = useFormStore((s) => s.prefillPhoneFromTwilio);
  const setActiveMarketIndex = useFormStore((s) => s.setActiveMarketIndex);
  const setActiveContactIndex = useFormStore((s) => s.setActiveContactIndex);
  const addMarket = useFormStore((s) => s.addMarket);
  const removeMarket = useFormStore((s) => s.removeMarket);
  const addContact = useFormStore((s) => s.addContact);
  const removeContact = useFormStore((s) => s.removeContact);

  // ✅ Handle Twilio phone pre-fill
  useEffect(() => {
    if (inboundPhone) {
      prefillPhoneFromTwilio(inboundPhone);
    }
  }, [inboundPhone, prefillPhoneFromTwilio]);

  // Note: Reset is handled by resetForm() in parent's clearAll().
  // The key prop change causes this component to remount with fresh state.
  // No additional reset needed here to avoid double-reset issues.

  const canAddMoreMarkets = additionalMarkets.length < MAX_ADDITIONAL_MARKETS;
  const canAddMoreContacts = additionalContacts.length < MAX_ADDITIONAL_CONTACTS;

  return (
    <div className="@container lg:flex-[2] flex flex-col overflow-y-auto max-h-[calc(100vh-280px)] p-1">
      <div className="space-y-0">
      {/* INTRO Section */}
      <div className="mb-0 px-4">
        <span className="inline-block bg-white border-2 border-b-0 border-black px-3.5 py-1.5 shadow-sm shadow-black text-md font-bold rounded-t-md">
          INTRO
        </span>
      </div>
      <div className="bg-white border-2 border-black rounded-b-lg rounded-tr-lg p-4 shadow-sm shadow-black mx-4">
        <div className="space-y-3">
          {/* Name and What do you want to advertise */}
          <div className="flex gap-8">
            <div className="w-60">
              <Label className="text-blue-600 font-bold text-md mb-1 block">Name</Label>
              {/* ✅ CHANGED: Use FirstNameInput for INTRO section (first name only) */}
              <FirstNameInput />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                What do you want to advertise?
              </Label>
              <div className="flex">
                <FieldInput 
                  field="typeName" 
                  placeholder="Type (Est. B2B, New B2C, etc)"
                  className="w-50"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="businessName" 
                  placeholder="Kind (HVAC, Governor, etc)"
                  className="w-50"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="entityName" 
                  placeholder="Entity Name"
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          {/* Ever used billboards / What are you needing */}
          <div className="flex gap-5">
            <div className="flex-[0.5]">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Ever used billboards before?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <div className="flex">
                <FieldInput 
                  field="billboardsBeforeYN" 
                  placeholder="Y/N"
                  className="w-14 text-center"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="billboardsBeforeDetails" 
                  placeholder="Details"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex-[1.2]">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                What are you needing to accomplish?
              </Label>
              <div className="flex">
                <FieldInput 
                  field="billboardPurpose" 
                  placeholder="Goal (Hiring, Event, Brand Awareness, etc)"
                  className="flex-[2]"
                />
                <Minus className="mt-2.5 w-2" />
                <FieldInput 
                  field="accomplishDetails" 
                  placeholder="Details"
                  className="flex-[3]"
                />
              </div>
            </div>
          </div>

          {/* Who are you trying to target */}
          <div>
            <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
              Who are you trying to target?
              <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
            </Label>
            <FieldInput field="targetAudience" />
          </div>

          {/* Bottom 3 fields */}
          <div className="flex gap-5">
            <div className="flex-2">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Are you doing any other advertising?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <FieldInput field="hasMediaExperience" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 block">
                How long in business?
              </Label>
              <FieldInput field="yearsInBusiness" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1 flex items-center gap-1">
                Have a website?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <FieldInput field="website" />
            </div>
          </div>
        </div>
      </div>

      {/* Lead Type Bar */}
      <div className="flex gap-8 my-5 -mb-7 px-4">
        {/* Left spacer - matches Name field width */}
        <div className="w-60"></div>

        {/* Right side - matches "What do you want to advertise" section */}
        <div className="flex-1 bg-gray-300 border-2 border-black shadow-sm shadow-black rounded-lg p-3.5">
          <div className="flex items-center gap-4">
            {/* Left: Lead Type Buttons - takes up flex space */}
            <div className="flex-1 min-w-0">
              <LeadTypeButtonGroup />
            </div>
            {/* Right: Ballpark section - fixed width based on content */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Label className="text-md font-bold whitespace-nowrap">Ballpark:</Label>
              <BallparkInput />
            </div>
          </div>
        </div>
      </div>

      {/* PROPOSAL Section */}
      <div className="mb-0 mt-3.5 px-4">
        <span className="inline-block bg-white border-2 border-b-0 border-black shadow-sm shadow-black px-3.5 py-1.5 text-md font-bold rounded-t-md">
          PROPOSAL
        </span>
      </div>
      <div className="bg-white border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm mx-4">
        <div className="flex gap-5 h-full">
          {/* Left: Purpose Recap */}
          <div className="flex-1">
            <Label className="text-blue-600 font-bold text-md mb-1 block">
              Purpose Recap & Additional Notes
            </Label>
            <FieldTextarea 
              field="notes" 
              className="w-full h-[calc(100%-1.75rem)]"
            />
          </div>

          {/* Right: Location & Duration - Shows Active Market */}
          <div className="flex-1 flex flex-col gap-2.5">
            {/* City, State, Area, and Start in a grid layout */}
            <div className="flex gap-5">
              {/* Left column: City, State, and Start stacked */}
              <div className="flex-[3] space-y-2.5">
                {/* City and State row */}
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">City</Label>
                    <MarketFieldInput marketIndex={activeMarketIndex} field="targetCity" />
                  </div>
                  <div className="w-18">
                    <Label className="text-blue-600 font-bold text-md mb-1 block">State</Label>
                    <MarketFieldInput 
                      marketIndex={activeMarketIndex} 
                      field="state" 
                      className="text-center"
                    />
                  </div>
                </div>

                {/* Start row */}
                <div>
                  <Label className="text-blue-600 font-bold text-md mb-1 block">Start</Label>
                  <MarketFieldInput marketIndex={activeMarketIndex} field="startMonth" />
                </div>
              </div>

              {/* Right column: Area (spans full height) */}
              <div className="flex-[3]">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Area</Label>
                <MarketFieldTextarea 
                  marketIndex={activeMarketIndex}
                  className="h-[calc(100%-1.75rem)]"
                />
              </div>
            </div>

            {/* Duration and Are you interested in */}
            <div className="flex gap-5 flex-1">
              {/* Duration - matches City/State/Start column width */}
              <div className="flex-[3] flex flex-col min-w-0">
                <Label className="text-blue-600 font-bold text-md mb-1 block">Duration</Label>
                <DurationButtonGroup marketIndex={activeMarketIndex} />
              </div>

              {/* Are you interested in - matches Area column width */}
              <div className="flex-[3] flex flex-col items-center">
                <Label className="text-blue-600 text-center font-bold text-md mb-1 block">
                  Are you interested in?
                </Label>
                <BoardTypeButtonGroup marketIndex={activeMarketIndex} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Tabs */}
      <div className="flex gap-5 mt-0 pb-2" style={{ paddingLeft: 'calc(1rem + 18px)', paddingRight: 'calc(1rem + 18px)' }}>
        {/* Left spacer - matches Purpose Recap width */}
        <div className="flex-1 min-w-0"></div>

        {/* Right side - matches Location & Duration width with nested structure */}
        <div className="flex-1 flex gap-5 min-w-0">
          {/* Tabs container - matches Duration position (flex-[3]) */}
          <div className="flex-[3] flex flex-nowrap gap-0.5 @4xl:gap-1 @5xl:gap-1.5 overflow-x-auto pb-1 min-w-0" style={{ paddingLeft: '0' }}>
            <button
              onClick={() => setActiveMarketIndex(0)}
              className={`inline-block border-2 ${
                activeMarketIndex === 0 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-sm'
              } border-black shadow-sm shadow-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-xs @lg:text-sm font-bold`}
            >
              Mkt #1
            </button>
            {additionalMarkets.map((_, index) => (
              <button
                key={index + 1}
                onClick={() => setActiveMarketIndex(index + 1)}
                className={`inline-block border-2 ${
                  activeMarketIndex === index + 1 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-sm'
                } border-black shadow-sm shadow-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-xs @lg:text-sm font-bold relative group`}
              >
                <span>Mkt #{index + 2}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMarket(index + 1);
                  }}
                  className="ml-1 @sm:ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
                >
                  ×
                </span>
              </button>
            ))}
            {canAddMoreMarkets && (
              <button
                onClick={addMarket}
                className="inline-block text-gray-400 hover:text-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-xs @lg:text-sm font-bold rounded-b-md transition-colors"
              >
                + Market
              </button>
            )}
          </div>
          {/* Right spacer - matches "Are you interested in" position (flex-[3] mr-11) */}
          <div className="flex-[3] mr-11"></div>
        </div>
      </div>

      {/* Contact Tabs */}
      <div className="flex flex-wrap gap-0.5 mt-2 @sm:gap-1 @lg:gap-2 px-4">
        <button
          onClick={() => setActiveContactIndex(0)}
          className={`inline-block border-2 ${
            activeContactIndex === 0 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
          } border-black shadow-sm shadow-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-sm @lg:text-md font-bold`}
        >
          CONTACT INFO
        </button>
        {additionalContacts.map((contact, index) => (
          <button
            key={contact.id}
            onClick={() => setActiveContactIndex(index + 1)}
            className={`inline-block border-2 ${
              activeContactIndex === index + 1 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
            } border-black shadow-sm shadow-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-sm @lg:text-md font-bold relative group`}
          >
            <span>CONTACT #{index + 2}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeContact(index + 1);
              }}
              className="ml-1 @sm:ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
            >
              ×
            </span>
          </button>
        ))}
        {canAddMoreContacts && (
          <button
            onClick={addContact}
            className="inline-block text-gray-400 hover:text-black px-1.5 py-0.5 @sm:px-2.5 @sm:py-1 @lg:px-3.5 @lg:py-1.5 text-[10px] @sm:text-sm @lg:text-md font-bold rounded-t-md transition-colors"
          >
            + Contact
          </button>
        )}
      </div>

      {/* Active Contact */}
      <div className="bg-gray-300 border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-4 shadow-sm mx-4">
        <div className="space-y-3">
          {/* Name, Position, Phone, Email */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Name</Label>
              {/* ✅ This uses ContactFieldInput which now requires first + last name for green */}
              <ContactFieldInput contactIndex={activeContactIndex} field="name" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Position</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="position" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Phone</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="phone" />
            </div>
            <div className="flex-1">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">Email</Label>
              <ContactFieldInput contactIndex={activeContactIndex} field="email" />
            </div>
          </div>

          {/* Decision making & Thank you */}
          <div className="flex gap-2.5">
            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 flex items-center gap-1">
                What&apos;s your decision-making process look like?
                <CircleQuestionMark className="w-4 h-4 text-gray-500"/>
              </Label>
              <DecisionMakerButtonGroup contactIndex={activeContactIndex} />
            </div>

            <div className="flex-[1]">
              <Label className="text-blue-600 font-bold text-md mb-1.5 block">
                Thank you! I&apos;ll send over:
              </Label>
              <SendOverButtonGroup contactIndex={activeContactIndex} />
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// Export types for parent components
export type { ContactData, MarketData } from "@/stores/formStore";