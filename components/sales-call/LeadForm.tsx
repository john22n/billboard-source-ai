"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BillboardFormData } from "@/hooks/useBillboardFormExtraction";

interface LeadFormProps {
  formData: BillboardFormData;
  updateField: (field: string, value: string | boolean | null) => void;
}

export function LeadForm({ formData, updateField }: LeadFormProps) {
  return (
    <div className="lg:col-span-2 space-y-2.5">
      {/* Lead Type */}
      <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
        <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
          Lead Classification
        </Label>
        <div className={`grid grid-cols-3 gap-2 ${formData.leadType === null ? 'opacity-60' : ''}`}>
          {[
            { value: "tire-kicker", label: "Tire-Kicker", icon: "🔍" },
            { value: "panel-requestor", label: "Panel-Requestor", icon: "📋" },
            { value: "availer", label: "Availer", icon: "✅" }
          ].map((type) => (
            <label
              key={type.value}
              className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                formData.leadType === type.value
                  ? "border-blue-500 bg-blue-50 shadow-md"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="leadType"
                checked={formData.leadType === type.value}
                onChange={() => updateField("leadType", type.value)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-lg">{type.icon}</span>
              <span className="font-semibold text-slate-700 text-xs">{type.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
        <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
          Contact Information
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { field: "name", label: "Full Name", placeholder: "John Doe" },
            { field: "phone", label: "Phone", placeholder: "(555) 123-4567" },
            { field: "email", label: "Email", placeholder: "john@example.com" },
            { field: "website", label: "Website", placeholder: "example.com" }
          ].map((item) => (
            <div key={item.field}>
              <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                {item.label}
              </Label>
              <Input
                value={formData[item.field as keyof typeof formData] as string ?? ""}
                onChange={(e) => updateField(item.field, e.target.value)}
                placeholder={item.placeholder}
                className={`h-9 text-sm transition-all duration-200 ${
                  !formData[item.field as keyof typeof formData]
                    ? 'border-slate-300 bg-slate-50 focus:border-orange-400 focus:ring-orange-400'
                    : 'border-green-500 bg-green-50/30 focus:border-green-600 focus:ring-green-600'
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Business Details */}
      <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
        <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
          Business Details
        </Label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
              Advertiser
            </Label>
            <Input
              value={formData.advertiser ?? ""}
              onChange={(e) => updateField("advertiser", e.target.value)}
              placeholder="Company Name"
              className={`h-9 text-sm ${
                !formData.advertiser
                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
              }`}
            />
          </div>
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
              Years in Business
            </Label>
            <Input
              value={formData.yearsInBusiness ?? ""}
              onChange={(e) => updateField("yearsInBusiness", e.target.value)}
              placeholder="5 years"
              className={`h-9 text-sm ${
                !formData.yearsInBusiness
                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
              }`}
            />
          </div>
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 block">
              Media Experience?
            </Label>
            <div className={`flex gap-2 h-9 items-center px-3 rounded-lg border-2 text-sm ${
              formData.hasMediaExperience === null
                ? 'border-slate-300 bg-slate-50'
                : 'border-green-500 bg-green-50/30'
            }`}>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No" }
              ].map((option) => (
                <label key={String(option.value)} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.hasMediaExperience === option.value}
                    onChange={() => updateField("hasMediaExperience", option.value)}
                    className="w-3.5 h-3.5 text-blue-600"
                  />
                  <span className="font-semibold text-slate-700 text-xs">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 block">
              Done Billboards?
            </Label>
            <div className={`flex gap-2 h-9 items-center px-3 rounded-lg border-2 text-sm ${
              formData.hasDoneBillboards === null
                ? 'border-slate-300 bg-slate-50'
                : 'border-green-500 bg-green-50/30'
            }`}>
              {[
                { value: true, label: "Yes" },
                { value: false, label: "No" }
              ].map((option) => (
                <label key={String(option.value)} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.hasDoneBillboards === option.value}
                    onChange={() => updateField("hasDoneBillboards", option.value)}
                    className="w-3.5 h-3.5 text-blue-600"
                  />
                  <span className="font-semibold text-slate-700 text-xs">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
            Business Description
          </Label>
          <Input
            value={formData.businessDescription ?? ""}
            onChange={(e) => updateField("businessDescription", e.target.value)}
            placeholder="What does the business do?"
            className={`h-9 text-sm ${
              !formData.businessDescription
                ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                : 'border-green-500 bg-green-50/30 focus:border-green-600'
            }`}
          />
        </div>
      </div>

      {/* Campaign Details */}
      <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
        <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
          Campaign Details
        </Label>
        <div className="grid grid-cols-1 gap-2 mb-2">
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
              <span className="text-sm">🎯</span>Billboard Purpose
            </Label>
            <Input
              value={formData.billboardPurpose ?? ""}
              onChange={(e) => updateField("billboardPurpose", e.target.value)}
              placeholder="Brand awareness"
              className={`h-9 text-sm ${
                !formData.billboardPurpose
                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
              }`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                <span className="text-sm">📍</span>Target City & State
              </Label>
              <Input
                value={formData.targetCityAndState ?? ""}
                onChange={(e) => updateField("targetCityAndState", e.target.value)}
                placeholder="Austin, TX"
                className={`h-9 text-sm ${
                  !formData.targetCityAndState
                    ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                    : 'border-green-500 bg-green-50/30 focus:border-green-600'
                }`}
              />
            </div>
            <div>
              <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
                <span className="text-sm">🛣</span>Target Area
              </Label>
              <Input
                value={formData.targetArea ?? ""}
                onChange={(e) => updateField("targetArea", e.target.value)}
                placeholder="I-35 North"
                className={`h-9 text-sm ${
                  !formData.targetArea
                    ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                    : 'border-green-500 bg-green-50/30 focus:border-green-600'
                }`}
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
              <span className="text-sm">📆</span>Campaign Start
            </Label>
            <Input
              value={formData.startMonth ?? ""}
              onChange={(e) => updateField("startMonth", e.target.value)}
              placeholder="January 2025"
              className={`h-9 text-sm ${
                !formData.startMonth
                  ? 'border-slate-300 bg-slate-50 focus:border-orange-400'
                  : 'border-green-500 bg-green-50/30 focus:border-green-600'
              }`}
            />
          </div>
          <div>
            <Label className="text-slate-600 font-semibold text-xs mb-1 flex items-center gap-1">
              <span className="text-sm">⏱</span>Campaign Length
            </Label>
            <div className={`grid grid-cols-6 gap-1.5 p-2 rounded-lg border-2 ${
              formData.campaignLength === null
                ? 'border-slate-300 bg-slate-50'
                : 'border-green-500 bg-green-50/30'
            }`}>
              {["1 Mo", "2 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"].map((length) => (
                <label
                  key={length}
                  className={`flex items-center justify-center px-2 py-1.5 rounded cursor-pointer transition-all ${
                    formData.campaignLength === length
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-white border border-slate-200 text-slate-700 hover:border-blue-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="campaignLength"
                    checked={formData.campaignLength === length}
                    onChange={() => updateField("campaignLength", length)}
                    className="sr-only"
                  />
                  <span className="text-xs font-semibold">{length}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Decision Maker */}
      <div className="bg-white rounded-lg p-3 shadow-sm border border-slate-200">
        <Label className="text-slate-700 font-bold text-xs uppercase tracking-wide mb-2 block">
          Decision Making Authority
        </Label>
        <div className={`grid grid-cols-2 gap-2 ${
          formData.decisionMaker === null ? 'opacity-60' : ''
        }`}>
          {[
            { value: "alone", label: "You Alone", icon: "👤" },
            { value: "partners", label: "Partners", icon: "👥" },
            { value: "boss", label: "My Boss", icon: "👔" },
            { value: "committee", label: "Committee", icon: "🏛" }
          ].map((maker) => (
            <label
              key={maker.value}
              className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                formData.decisionMaker === maker.value
                  ? "border-blue-500 bg-blue-50 shadow-md"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="decisionMaker"
                checked={formData.decisionMaker === maker.value}
                onChange={() => updateField("decisionMaker", maker.value)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-lg">{maker.icon}</span>
              <span className="font-semibold text-slate-700 text-xs">{maker.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg p-3 shadow-sm border-2 border-orange-200">
        <Label className="text-orange-700 font-bold text-xs uppercase tracking-wide mb-2 flex items-center gap-1">
          <span className="text-sm">📝</span>What did I tell the person?
        </Label>
        <Textarea
          value={formData.notes ?? ""}
          onChange={(e) => updateField("notes", e.target.value)}
          rows={3}
          placeholder="Conversation notes, promises made, next steps..."
          className={`text-sm resize-none ${
            !formData.notes
              ? 'border-orange-300 bg-white focus:border-orange-500'
              : 'border-green-500 bg-green-50/30 focus:border-green-600'
          }`}
        />
      </div>
    </div>
  );
}
