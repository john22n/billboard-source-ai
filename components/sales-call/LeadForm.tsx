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
  FirstNameInput,
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

  const canAddMoreMarkets = additionalMarkets.length < MAX_ADDITIONAL_MARKETS;
  const canAddMoreContacts = additionalContacts.length < MAX_ADDITIONAL_CONTACTS;

  return (
    <div className="@container w-full xl:flex-[2] flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0 p-1">
        <div className="space-y-0">
        {/* INTRO Section */}
        <div className="mb-0 px-2 sm:px-4">
          <span className="inline-block bg-white border-2 border-b-0 border-black px-2.5 py-1 sm:px-3.5 sm:py-1.5 shadow-sm shadow-black text-sm sm:text-md font-bold rounded-t-md">
            INTRO
          </span>
        </div>
        <div className="bg-white border-2 border-black rounded-b-lg rounded-tr-lg p-3 sm:p-4 shadow-sm shadow-black mx-2 sm:mx-4">
          <div className="space-y-3">
            {/* Name and What do you want to advertise - Stack on mobile */}
            <div className="flex flex-col xl:flex-row gap-3 xl:gap-8">
              <div className="w-full xl:w-60">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">Name</Label>
                <FirstNameInput />
              </div>
              <div className="flex-1">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">
                  What do you want to advertise?
                </Label>
                {/* Stack on mobile, row on md+ */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
                  <FieldInput 
                    field="typeName" 
                    placeholder="Type (Est. B2B, New B2C, etc)"
                    className="w-full sm:w-auto sm:flex-1 lg:w-50"
                  />
                  <Minus className="hidden sm:block mt-2.5 w-2 flex-shrink-0" />
                  <FieldInput 
                    field="businessName" 
                    placeholder="Kind (HVAC, Governor, etc)"
                    className="w-full sm:w-auto sm:flex-1 lg:w-50"
                  />
                  <Minus className="hidden sm:block mt-2.5 w-2 flex-shrink-0" />
                  <FieldInput 
                    field="entityName" 
                    placeholder="Entity Name"
                    className="w-full sm:flex-1"
                  />
                </div>
              </div>
            </div>

            {/* Ever used billboards / What are you needing - Stack on mobile */}
            <div className="flex flex-col md:flex-row gap-3 md:gap-5">
              <div className="w-full md:flex-[0.5]">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 flex items-center gap-1">
                  Ever used billboards before?
                  <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
                </Label>
                <div className="flex gap-1">
                  <FieldInput 
                    field="billboardsBeforeYN" 
                    placeholder="Y/N"
                    className="w-14 text-center flex-shrink-0"
                  />
                  <Minus className="mt-2.5 w-2 flex-shrink-0" />
                  <FieldInput 
                    field="billboardsBeforeDetails" 
                    placeholder="Details"
                    className="flex-1 min-w-0"
                  />
                </div>
              </div>

              <div className="w-full md:flex-[1.2]">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">
                  What are you needing to accomplish?
                </Label>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
                  <FieldInput 
                    field="billboardPurpose" 
                    placeholder="Goal (Hiring, Event, Brand Awareness, etc)"
                    className="w-full sm:flex-[2]"
                  />
                  <Minus className="hidden sm:block mt-2.5 w-2 flex-shrink-0" />
                  <FieldInput 
                    field="accomplishDetails" 
                    placeholder="Details"
                    className="w-full sm:flex-[3]"
                  />
                </div>
              </div>
            </div>

            {/* Who are you trying to target */}
            <div>
              <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 flex items-center gap-1">
                Who are you trying to target?
                <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
              </Label>
              <FieldInput field="targetAudience" />
            </div>

            {/* Bottom 3 fields - Stack on mobile, 3-col on md+ */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-5">
              <div className="w-full sm:flex-[2]">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 flex items-center gap-1">
                  Are you doing any other advertising?
                  <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
                </Label>
                <FieldInput field="hasMediaExperience" />
              </div>
              <div className="w-full sm:flex-1">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">
                  How long in business?
                </Label>
                <FieldInput field="yearsInBusiness" />
              </div>
              <div className="w-full sm:flex-1">
                <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 flex items-center gap-1">
                  Have a website?
                  <CircleQuestionMark className="w-4 h-4 text-gray-400"/>
                </Label>
                <FieldInput field="website" />
              </div>
            </div>
          </div>
        </div>

        {/* Lead Type Bar - Full width stack on mobile */}
        <div className="flex flex-col xl:flex-row gap-3 xl:gap-8 my-4 xl:my-5 xl:-mb-7 px-2 sm:px-4">
          {/* Left spacer - hidden on mobile */}
          <div className="hidden xl:block xl:w-60"></div>

          {/* Lead Type section - full width on mobile */}
          <div className="flex-1 bg-gray-300 border-2 border-black shadow-sm shadow-black rounded-lg p-2.5 sm:p-3.5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
              {/* Lead Type Buttons */}
              <div className="flex-1 min-w-0">
                <LeadTypeButtonGroup />
              </div>
              {/* Ballpark section */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Label className="text-sm sm:text-md font-bold whitespace-nowrap">Ballpark:</Label>
                <BallparkInput />
              </div>
            </div>
          </div>
        </div>

        {/* PROPOSAL Section */}
        <div className="mb-0 mt-3.5 px-2 sm:px-4">
          <span className="inline-block bg-white border-2 border-b-0 border-black shadow-sm shadow-black px-2.5 py-1 sm:px-3.5 sm:py-1.5 text-sm sm:text-md font-bold rounded-t-md">
            PROPOSAL
          </span>
        </div>
        <div className="bg-white border-2 border-black shadow-black rounded-br-lg rounded-tr-lg xl:rounded-b-lg p-3 sm:p-4 shadow-sm mx-2 sm:mx-4">
          {/* Stack on mobile, side-by-side on xl+ */}
          <div className="flex flex-col xl:flex-row gap-4 xl:gap-5 h-full">
            {/* Left: Purpose Recap */}
            <div className="w-full xl:flex-1">
              <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">
                Purpose Recap & Additional Notes
              </Label>
              <FieldTextarea 
                field="notes" 
                className="w-full h-24 sm:h-28 xl:h-[calc(100%-1.75rem)]"
              />
            </div>

            {/* Right: Location & Duration - Shows Active Market */}
            <div className="w-full xl:flex-1 flex flex-col gap-2.5">
              {/* City, State, Area, and Start */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-5">
                {/* Left column: City, State, and Start stacked */}
                <div className="w-full sm:flex-[3] space-y-2.5">
                  {/* City and State row */}
                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">City</Label>
                      <MarketFieldInput marketIndex={activeMarketIndex} field="targetCity" />
                    </div>
                    <div className="w-16 sm:w-18 flex-shrink-0">
                      <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">State</Label>
                      <MarketFieldInput 
                        marketIndex={activeMarketIndex} 
                        field="state" 
                        className="text-center"
                      />
                    </div>
                  </div>

                  {/* Start row */}
                  <div>
                    <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">Start</Label>
                    <MarketFieldInput marketIndex={activeMarketIndex} field="startMonth" />
                  </div>
                </div>

                {/* Right column: Area */}
                <div className="w-full sm:flex-[3]">
                  <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">Area</Label>
                  <MarketFieldTextarea 
                    marketIndex={activeMarketIndex}
                    className="h-20 sm:h-[calc(100%-1.75rem)]"
                  />
                </div>
              </div>

              {/* Duration and Board Type - Stack on mobile */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-5 flex-1">
                {/* Duration */}
                <div className="w-full sm:flex-[3] flex flex-col min-w-0">
                  <Label className="text-blue-600 font-bold text-sm sm:text-md mb-1 block">Duration</Label>
                  <DurationButtonGroup marketIndex={activeMarketIndex} />
                </div>

                {/* Board Type */}
                <div className="w-full sm:flex-[3] flex flex-col items-center">
                  <Label className="text-blue-600 text-center font-bold text-sm sm:text-md mb-1 block">
                    Are you interested in?
                  </Label>
                  <BoardTypeButtonGroup marketIndex={activeMarketIndex} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Market Tabs - Responsive layout */}
        <div className="flex flex-col xl:flex-row gap-2 xl:gap-5 mt-0 pb-2 px-2 sm:px-4 xl:pl-[calc(1rem+18px)] xl:pr-[calc(1rem+18px)]">
          {/* Left spacer - hidden on mobile */}
          <div className="hidden xl:block xl:flex-1 min-w-0"></div>

          {/* Market tabs container */}
          <div className="w-full xl:flex-1 flex flex-col sm:flex-row gap-2 sm:gap-5 min-w-0">
            <div className="flex-1 sm:flex-[3] flex flex-wrap sm:flex-nowrap gap-1 overflow-x-auto pb-1 min-w-0">
              <button
                onClick={() => setActiveMarketIndex(0)}
                className={`inline-block border-2 ${
                  activeMarketIndex === 0 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-sm'
                } border-black shadow-sm shadow-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-xs sm:text-sm font-bold`}
              >
                Mkt #1
              </button>
              {additionalMarkets.map((_, index) => (
                <button
                  key={index + 1}
                  onClick={() => setActiveMarketIndex(index + 1)}
                  className={`inline-block border-2 ${
                    activeMarketIndex === index + 1 ? 'border-t-0 rounded-b-md' : 'bg-gray-300 text-gray-400 border-t-0 rounded-b-sm'
                  } border-black shadow-sm shadow-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-xs sm:text-sm font-bold relative group`}
                >
                  <span>Mkt #{index + 2}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMarket(index + 1);
                    }}
                    className="ml-1 sm:ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    ×
                  </span>
                </button>
              ))}
              {canAddMoreMarkets && (
                <button
                  onClick={addMarket}
                  className="inline-block text-gray-400 hover:text-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-xs sm:text-sm font-bold rounded-b-md transition-colors"
                >
                  + Market
                </button>
              )}
            </div>
            {/* Right spacer */}
            <div className="hidden sm:block sm:flex-[3] xl:mr-11"></div>
          </div>
        </div>

        {/* Contact Tabs */}
        <div className="flex flex-wrap gap-1 sm:gap-2 mt-2 px-2 sm:px-4">
          <button
            onClick={() => setActiveContactIndex(0)}
            className={`inline-block border-2 ${
              activeContactIndex === 0 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
            } border-black shadow-sm shadow-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-sm sm:text-md font-bold`}
          >
            CONTACT INFO
          </button>
          {additionalContacts.map((contact, index) => (
            <button
              key={contact.id}
              onClick={() => setActiveContactIndex(index + 1)}
              className={`inline-block border-2 ${
                activeContactIndex === index + 1 ? 'border-b-0 rounded-t-md bg-gray-300' : 'bg-white text-gray-400 border-b-0 rounded-t-md'
              } border-black shadow-sm shadow-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-xs sm:text-sm font-bold relative group`}
            >
              <span>CONTACT #{index + 2}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  removeContact(index + 1);
                }}
                className="ml-1 sm:ml-1.5 text-red-600 hover:text-red-800 cursor-pointer"
              >
                ×
              </span>
            </button>
          ))}
          {canAddMoreContacts && (
            <button
              onClick={addContact}
              className="inline-block text-gray-400 hover:text-black px-2 py-1 sm:px-2.5 sm:py-1 xl:px-3.5 xl:py-1.5 text-xs sm:text-sm font-bold rounded-t-md transition-colors"
            >
              + Contact
            </button>
          )}
        </div>

        {/* Active Contact - Responsive grid */}
        <div className="bg-gray-300 border-2 border-black shadow-black rounded-b-lg rounded-tr-lg p-3 sm:p-4 shadow-sm mx-2 sm:mx-4">
          <div className="space-y-3">
            {/* Name, Position, Phone, Email - 2x2 on mobile, 4-col on md+ */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
              <div>
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 block">Name</Label>
                <ContactFieldInput contactIndex={activeContactIndex} field="name" />
              </div>
              <div>
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 block">Position</Label>
                <ContactFieldInput contactIndex={activeContactIndex} field="position" />
              </div>
              <div>
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 block">Phone</Label>
                <ContactFieldInput contactIndex={activeContactIndex} field="phone" />
              </div>
              <div>
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 block">Email</Label>
                <ContactFieldInput contactIndex={activeContactIndex} field="email" />
              </div>
            </div>

            {/* Decision making & Send Over - Stack on mobile */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-2.5">
              <div className="w-full sm:flex-1">
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 flex items-center gap-1">
                  <span className="hidden sm:inline">What&apos;s your decision-making process look like?</span>
                  <span className="sm:hidden">Decision-making process?</span>
                  <CircleQuestionMark className="w-3 h-3 sm:w-4 sm:h-4 text-gray-500 flex-shrink-0"/>
                </Label>
                <DecisionMakerButtonGroup contactIndex={activeContactIndex} />
              </div>

              <div className="w-full sm:flex-1">
                <Label className="text-blue-600 font-bold text-xs sm:text-md mb-1 sm:mb-1.5 block">
                  <span className="hidden sm:inline">Thank you! I&apos;ll send over:</span>
                  <span className="sm:hidden">I&apos;ll send over:</span>
                </Label>
                <SendOverButtonGroup contactIndex={activeContactIndex} />
              </div>
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