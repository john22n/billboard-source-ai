# Billboard Source AI

Billboard Source AI supports sales reps taking inbound billboard advertising calls. It captures call details as a Lead and helps move that Lead into Nutshell.

## Language

**Lead**:
A sales opportunity captured from a caller inside Billboard Source AI. A Lead may still be in progress during a call and is not the same thing as the CRM record created later.
_Avoid_: Form data, payload

**Lead Intake**:
The information captured during a sales call before a Lead is reviewed and submitted to Nutshell. Lead Intake is intended to map to a Nutshell Lead.
_Avoid_: Form data, payload

**Lead Intake Value**:
An individual piece of information captured for Lead Intake. A Lead Intake Value is part of the Lead even when it still needs review.
_Avoid_: Suggestion, payload field

**Confirmed Lead Intake Value**:
A Lead Intake Value the sales rep explicitly accepted or entered. Confirmed Lead Intake Values should not be changed by later AI extraction.
_Avoid_: Locked field, user-edited field

**Reviewed Lead**:
A Lead whose required Lead Intake fields have been checked by a sales rep and are ready to create a Nutshell Lead. A Reviewed Lead does not require a Pricing Target.
_Avoid_: Complete Lead, qualified Lead

**Lead Intake Snapshot**:
The reviewed view of Lead Intake used when creating a Nutshell Lead. A Lead Intake Snapshot contains canonical Lead information and excludes temporary screen state.
_Avoid_: Store state, form data, payload

**Lead Intent**:
The Caller’s apparent request in the sales conversation: asking what is available, asking about a specific billboard, or browsing for pricing. Lead Intent is not the same as the kind of advertiser.
_Avoid_: Lead type, business type

**Advertiser Type**:
The kind of advertiser the Lead is for, such as an established business, new business, political campaign, nonprofit, or personal advertiser.
_Avoid_: Lead Intent, lead type

**Advertiser Name**:
The business, campaign, nonprofit, organization, or person being advertised by the Lead.
_Avoid_: Company name, entity name

**Advertiser Category**:
The specific category, office, cause, or kind of advertiser within an Advertiser Type, such as HVAC, restaurant, governor race, food bank, or personal announcement.
_Avoid_: Industry, business name

**Campaign Goal**:
What the advertiser wants the billboard campaign to accomplish, such as hiring, event promotion, directional traffic, brand awareness, or a new location launch.
_Avoid_: Advertiser Type, Lead Intent

**Billboard Experience**:
Whether and how the advertiser has used billboards before.
_Avoid_: Media experience

**Other Advertising**:
The non-billboard advertising channels the advertiser uses or has used.
_Avoid_: Media experience

**Promised Deliverables**:
The materials the sales rep agreed to send after the call, such as availability, panel information, or planning rates.
_Avoid_: Send over, follow-up items

**Rate Estimate**:
A rough pricing estimate discussed or entered for the Lead before exact billboard availability is confirmed.
_Avoid_: Ballpark

**Call Notes**:
Concise sales context captured from the conversation, such as concerns, constraints, preferences, urgency, or follow-up context. Call Notes are not the call transcript.
_Avoid_: Transcript, notes field

**Call Transcript**:
The text record of what was said during the sales call. A Call Transcript is source evidence for Lead Intake and Call Notes, not Lead Intake itself.
_Avoid_: Call Notes, Lead Intake

**Nutshell Lead**:
The CRM record created in Nutshell from a reviewed Lead after submission.
_Avoid_: Lead, payload

**Caller**:
The person on the phone during a sales call. The Caller may be the decision maker, a helper gathering information, or someone only probing for pricing.
_Avoid_: Customer, Contact

**Contact**:
A person recorded on a Lead for follow-up. A Contact may be the Caller, the decision maker, or another person the Caller identifies.
_Avoid_: Caller, customer

**Decision Maker**:
The person or group with authority to approve the billboard campaign. A Caller can be the Decision Maker, but a Caller can also be gathering information for someone else.
_Avoid_: Caller, Contact

**Target Market**:
One of the geographies a Caller is considering for a billboard campaign. A Target Market can be broad, like the DFW area, or specific, like downtown Dallas or a particular road.
_Avoid_: Location, market

**Pricing Target**:
The city and state used to request billboard pricing for a Target Market. A broad Target Market may need clarification before it becomes a Pricing Target.
_Avoid_: Location, Target Market

**Billboard Market**:
A market or location represented in the billboard pricing data. It may match a Target Market exactly or provide the closest available pricing context.
_Avoid_: Target Market
