# Lead Form Data Persistence Fix

## Problem
Lead form data was disappearing when switching between tabs (Lead Form → Maps → Transcripts).

## Root Cause Analysis

### Primary Issue: Missing `forceMount` on TabsContent
The Radix UI `Tabs` component by default **unmounts hidden tab content**. This means:
- When switching away from the "form" tab, the entire `LeadForm` component was being unmounted
- When switching back, a new instance would mount and potentially lose state

Even though Zustand persists the global state, component unmounting can cause:
- Loss of local component state (non-Zustand state)
- Unneeded side effects on remounting
- Visual state inconsistencies

### Secondary Issue: Unnecessary `key` Props
The `LeadForm` component had:
```tsx
<LeadForm
  key={resetTrigger}  // ❌ Problem: causes remount every time resetTrigger changes
  resetTrigger={resetTrigger}
  inboundPhone={callerPhone}
/>
```

This meant the component would remount unnecessarily, even during normal form operations.

## Solution

### 1. Add `forceMount` to TabsContent
```tsx
<TabsContent value="form" className="..." forceMount>
  {/* Tab content is now mounted even when hidden */}
</TabsContent>
```

This keeps the `LeadForm` component mounted at all times, preserving local state and avoiding remounting side effects.

### 2. Remove the `key={resetTrigger}` Prop
```tsx
// ❌ Before
<LeadForm key={resetTrigger} resetTrigger={resetTrigger} />

// ✅ After
<LeadForm resetTrigger={resetTrigger} />
```

The `resetTrigger` prop itself is sufficient to signal a reset action. The `key` prop was causing unnecessary remounts.

### 3. Remove the `key` from PricingPanel for Consistency
```tsx
// ❌ Before
<PricingPanel key={`pricing-${activeMarketIndex}-${additionalMarkets.length}`} />

// ✅ After
<PricingPanel />
```

State is subscribed via Zustand, so the component will re-render when relevant store values change without needing a key.

## Files Modified
- `components/SalesCallTranscriber.tsx` (lines 489-510)

## How This Works

### State Management Flow
1. **Zustand Store** (`stores/formStore.ts`) - Global form state
2. **Form Field Components** - Subscribe to individual Zustand fields
3. **Tab Navigation** - No longer causes unmounting with `forceMount`
4. **Result** - Form data persists across all tab switches

### Key Principles Applied
- ✅ Zustand store handles all form data persistence
- ✅ Components subscribe to only the fields they need (via selectors)
- ✅ Components stay mounted to avoid state loss
- ✅ Keys are only used when actually changing component identity

## Testing Checklist
- [ ] Enter data in lead form fields
- [ ] Switch to Google Map tab and back → data still present
- [ ] Switch to BSI Map tab and back → data still present  
- [ ] Switch to Transcript tab and back → data still present
- [ ] AI extraction populates fields → data persists on tab switch
- [ ] Manually edit fields after AI extraction → changes persist
- [ ] Click "Clear All" → form actually resets
- [ ] Add additional market/contact → data persists on tab switch

## Performance Improvements
- ✅ Fewer component remounts = less re-initialization
- ✅ Zustand subscribers only re-render when their specific fields change
- ✅ Tab switching no longer triggers any component mounts/unmounts
- ✅ Less CPU usage during tab navigation

## Related Code
- Form store: `stores/formStore.ts`
- Form fields: `components/sales-call/formFields.tsx`
- LeadForm: `components/sales-call/LeadForm.tsx`
- Transcriber: `components/SalesCallTranscriber.tsx`
