import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

interface ContactInfo {
  name: string;
  position: string;
  phone: string;
  email: string;
}

interface NutshellLeadRequest {
  // Primary contact info (for backwards compatibility)
  name: string;
  position: string;
  phone: string;
  email: string;

  // Additional contacts
  additionalContacts?: ContactInfo[];

  // Account/Business info
  entityName: string;
  website: string;

  // Lead classification
  typeName: 'business' | 'political' | 'nonprofit' | 'personal' | null;
  businessName: string;
  leadType: 'Availer' | 'Panel Requester' | 'Tire Kicker' | null;

  // Billboard experience
  billboardsBeforeYN: string;
  billboardsBeforeDetails: string;

  // Campaign details
  billboardPurpose: string;
  accomplishDetails: string;
  targetAudience: string;

  // Location
  targetCity: string;
  state: string;
  targetArea: string;

  // Timeline & preferences
  startMonth: string;
  campaignLength: string;
  boardType: string;

  // Business context
  hasMediaExperience: boolean | null;
  yearsInBusiness: string;

  // Decision making
  decisionMaker: 'alone' | 'partners' | 'boss' | 'committee' | null;

  // Notes
  notes: string;
  sendOver: string[];

  // Budget
  budget: string;

  // Ballpark (rate estimate)
  ballpark: string;
}

async function nutshellRequest(
  method: string,
  params: Record<string, unknown>,
  credentials: string
) {
  const response = await fetch('https://app.nutshell.com/api/v1/json', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: `${method}-${Date.now()}`,
    }),
  });
  return response.json();
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.email;
    const data: NutshellLeadRequest = await req.json();

    const nutshellApiKey = process.env.NUTSHELL_API_KEY;
    if (!nutshellApiKey) {
      return NextResponse.json(
        { error: 'Nutshell integration not configured' },
        { status: 500 }
      );
    }

    const credentials = Buffer.from(`${userEmail}:${nutshellApiKey}`).toString('base64');

    // 1. Find Nutshell user
    const userResult = await nutshellRequest('findUsers', {
      query: { email: userEmail },
    }, credentials);

    if (userResult.error) {
      return NextResponse.json(
        { error: userResult.error.message || 'Failed to find user in Nutshell' },
        { status: 400 }
      );
    }

    const users = userResult.result || [];
    const matchingUser = users.find((user: { emails?: string[] }) =>
      user.emails?.some((email: string) => email.toLowerCase() === userEmail.toLowerCase())
    );

    if (!matchingUser?.id) {
      return NextResponse.json(
        { error: `No Nutshell user found for email: ${userEmail}` },
        { status: 400 }
      );
    }

    const nutshellUserId = Number(matchingUser.id);

    // Helper to validate email
    const isValidEmail = (email: string) => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    // Helper to validate URL
    const isValidUrl = (url: string) => {
      const lower = url.toLowerCase();
      if (lower === 'no' || lower === 'yes' || lower === 'n/a' || lower === 'none') {
        return false;
      }
      try {
        const urlToTest = url.startsWith('http') ? url : `https://${url}`;
        new URL(urlToTest);
        return true;
      } catch {
        return false;
      }
    };

    // 2. Find or Create Contacts (People)
    // Helper function to find or create a single contact
    async function findOrCreateContact(contact: ContactInfo): Promise<number | null> {
      const validEmail = contact.email?.trim() && isValidEmail(contact.email.trim()) ? contact.email.trim() : null;
      const hasContactInfo = contact.name?.trim() || contact.phone?.trim() || validEmail;
      
      if (!hasContactInfo) return null;

      let contactId: number | null = null;

      // First try to find existing contact by email
      if (validEmail) {
        const searchResult = await nutshellRequest('searchByEmail', {
          emailAddressString: validEmail,
        }, credentials);
        if (searchResult.result?.contacts?.[0]?.id) {
          contactId = Number(searchResult.result.contacts[0].id);
        }
      }

      // If not found by email, search by name
      if (!contactId && contact.name?.trim()) {
        const searchResult = await nutshellRequest('searchUniversal', {
          string: contact.name.trim(),
        }, credentials);
        const foundContact = searchResult.result?.contacts?.find(
          (c: { name?: string }) => c.name?.toLowerCase() === contact.name?.trim().toLowerCase()
        );
        if (foundContact?.id) {
          contactId = Number(foundContact.id);
        }
      }

      // Create new contact only if not found
      if (!contactId) {
        const contactPayload: Record<string, unknown> = {};
        if (contact.name?.trim()) contactPayload.name = contact.name.trim();
        if (contact.position?.trim()) contactPayload.description = contact.position.trim();
        if (contact.phone?.trim()) contactPayload.phone = [contact.phone.trim()];
        if (validEmail) contactPayload.email = [validEmail];

        const contactResult = await nutshellRequest('newContact', {
          contact: contactPayload,
        }, credentials);

        if (contactResult.result?.id) {
          contactId = Number(contactResult.result.id);
        } else if (contactResult.error) {
          console.error('Failed to create contact:', contactResult.error);
        }
      }

      return contactId;
    }

    // Build list of all contacts (primary + additional)
    const allContacts: ContactInfo[] = [
      { name: data.name, position: data.position, phone: data.phone, email: data.email },
      ...(data.additionalContacts || []),
    ];

    // Find or create all contacts
    const contactIds: number[] = [];
    for (const contact of allContacts) {
      const contactId = await findOrCreateContact(contact);
      if (contactId && contactId > 0) {
        contactIds.push(contactId);
      }
    }

    // 3. Find or Create Account (Business) if we have entity info
    let accountId: number | null = null;
    if (data.entityName?.trim()) {
      // First try to find existing account by name
      const searchResult = await nutshellRequest('searchUniversal', {
        string: data.entityName.trim(),
      }, credentials);
      const foundAccount = searchResult.result?.accounts?.find(
        (a: { name?: string }) => a.name?.toLowerCase() === data.entityName?.trim().toLowerCase()
      );
      if (foundAccount?.id) {
        accountId = Number(foundAccount.id);
      }

      // Create new account only if not found
      if (!accountId) {
        const accountPayload: Record<string, unknown> = {
          name: data.entityName.trim(),
        };
        if (data.website?.trim() && isValidUrl(data.website.trim())) {
          const url = data.website.trim();
          accountPayload.url = [url.startsWith('http') ? url : `https://${url}`];
        }

        const accountResult = await nutshellRequest('newAccount', {
          account: accountPayload,
        }, credentials);

        if (accountResult.result?.id) {
          accountId = Number(accountResult.result.id);
        } else if (accountResult.error) {
          console.error('Failed to create account:', accountResult.error);
        }
      }
    }

    // 4. Build tags based on actual Nutshell tags
    const tags: string[] = [];

    // Type tags (What do you want to advertise?)
    if (data.typeName) {
      const typeTagMap: Record<string, string> = {
        'business': 'Type: Established Business',
        'political': 'Type: Political',
        'nonprofit': 'Type: Non-Profit',
        'personal': 'Type: Personal',
      };
      if (typeTagMap[data.typeName]) {
        tags.push(typeTagMap[data.typeName]);
      }
    }

    // Goal tags (What are you needing to accomplish?)
    if (data.billboardPurpose) {
      const goalTagMap: Record<string, string> = {
        'directional': 'Goal: Directional',
        'enrollment': 'Goal: Enrollment',
        'event': 'Goal: Event',
        'brand awareness': 'Goal: General Brand Awareness',
        'awareness': 'Goal: General Brand Awareness',
        'hiring': 'Goal: Hiring',
        'new location': 'Goal: New Location',
        'location': 'Goal: New Location',
        'new product': 'Goal: New Product/Service',
        'product': 'Goal: New Product/Service',
        'service': 'Goal: New Product/Service',
        'political': 'Goal: Political',
        'calls': 'Goal: Calls',
      };
      const purposeLower = data.billboardPurpose.toLowerCase();
      for (const [key, value] of Object.entries(goalTagMap)) {
        if (purposeLower.includes(key)) {
          tags.push(value);
          break;
        }
      }
    }

    // Request tag based on lead type
    if (data.leadType) {
      const requestTagMap: Record<string, string> = {
        'Availer': 'Request: Availer',
        'Panel Requester': 'Request: Panel Requestor',
        'Tire Kicker': 'Request: Tire-Kicker',
      };
      if (requestTagMap[data.leadType]) {
        tags.push(requestTagMap[data.leadType]);
      }
    }

    // Decision maker tag
    if (data.decisionMaker) {
      const decisionTagMap: Record<string, string> = {
        'alone': 'Decision: Decision Maker',
        'boss': 'Decision: Middle Person',
        'partners': 'Decision: Group (Co-Owners)',
        'committee': 'Decision: Group (Committee or Team)',
      };
      if (decisionTagMap[data.decisionMaker]) {
        tags.push(decisionTagMap[data.decisionMaker]);
      }
    }

    // 5. Find "NEW BSI Pipeline" and determine milestone (stage) based on lead type
    let stagesetId: number | undefined;
    let milestoneId: number | undefined;

    const stagesetsResult = await nutshellRequest('findStagesets', {}, credentials);
    if (stagesetsResult.result) {
      const pipeline = stagesetsResult.result.find(
        (s: { name?: string }) => s.name === 'NEW BSI Pipeline'
      );
      if (pipeline?.id) {
        stagesetId = Number(pipeline.id);

        // Find milestones for this pipeline
        const milestonesResult = await nutshellRequest('findMilestones', {}, credentials);
        if (milestonesResult.result) {
          const pipelineMilestones = milestonesResult.result.filter(
            (m: { stagesetId?: number }) => m.stagesetId === stagesetId
          );

          // Map lead type to stage name
          let targetStageName: string | null = null;
          if (data.leadType === 'Availer' || data.leadType === 'Panel Requester') {
            targetStageName = 'Proposal';
          } else if (data.leadType === 'Tire Kicker') {
            targetStageName = 'Qualify';
          }

          if (targetStageName) {
            const milestone = pipelineMilestones.find(
              (m: { name?: string }) => m.name === targetStageName
            );
            if (milestone?.id) {
              milestoneId = Number(milestone.id);
            }
          }
        }
      }
    }

    // 6. Build custom fields with actual Nutshell field names
    const customFields: Record<string, string> = {};

    // OOH Exp (Ever used billboards before?)
    if (data.billboardsBeforeYN) {
      const experience = data.billboardsBeforeYN === 'Y'
        ? `Yes${data.billboardsBeforeDetails ? ` - ${data.billboardsBeforeDetails}` : ''}`
        : 'No';
      customFields['OOH Exp'] = experience;
    }

    // Target Market(s) - City/State/Area
    const locationParts = [
      data.targetCity,
      data.state,
      data.targetArea ? `- ${data.targetArea}` : '',
    ].filter(Boolean);
    if (locationParts.length > 0) {
      customFields['Target Market(s) - City/State/Area'] = locationParts.join(', ');
    }

    // Potential Start Date?
    if (data.startMonth) {
      customFields['Potential Start Date?'] = data.startMonth;
    }

    // Contract Length? - ensure it's a string, not an array
    if (data.campaignLength) {
      const length = Array.isArray(data.campaignLength)
        ? data.campaignLength[0]
        : data.campaignLength;
      if (length) {
        customFields['Contract Length?'] = String(length);
      }
    }

    // OOH Type of Interest (board type)
    if (data.boardType) {
      customFields['OOH Type of Interest'] = data.boardType;
    }

    // Budget
    if (data.budget) {
      customFields['Budget'] = data.budget;
    }

    // Rate Estimate (Ballpark)
    if (data.ballpark) {
      customFields['Rate Estimate'] = data.ballpark;
    }

    // Business Age (Years in Business)
    if (data.yearsInBusiness) {
      customFields['Business Age'] = data.yearsInBusiness;
    }

    // Consumer Target (Target Audience)
    if (data.targetAudience) {
      customFields['Consumer Target'] = data.targetAudience;
    }

    // Other Ads (Doing other advertising?)
    if (data.hasMediaExperience !== null) {
      customFields['Other Ads'] = data.hasMediaExperience ? 'Yes' : 'No';
    }

    // Promised Deliverables (I'll send over)
    if (data.sendOver && data.sendOver.length > 0) {
      customFields['Promised Deliverables'] = data.sendOver.join(', ');
    }

    // 7. Build note for timeline
    const noteParts: string[] = [];

    if (data.accomplishDetails) {
      noteParts.push(`Goals: ${data.accomplishDetails}`);
    }
    if (data.targetAudience) {
      noteParts.push(`Target Audience: ${data.targetAudience}`);
    }
    if (data.hasMediaExperience !== null) {
      noteParts.push(`Other Advertising: ${data.hasMediaExperience ? 'Yes' : 'No'}`);
    }
    if (data.yearsInBusiness) {
      noteParts.push(`Years in Business: ${data.yearsInBusiness}`);
    }
    if (data.website) {
      noteParts.push(`Has Website: Yes`);
    }
    if (data.sendOver && data.sendOver.length > 0) {
      noteParts.push(`Sending: ${data.sendOver.join(', ')}`);
    }
    if (data.notes) {
      noteParts.push(`Notes: ${data.notes}`);
    }

    // 8. Get or create the source "Call (GPP2)"
    let sourceId: number | null = null;
    const sourceResult = await nutshellRequest('newSource', {
      name: 'Call (GPP2)',
    }, credentials);
    if (sourceResult.result?.id) {
      sourceId = Number(sourceResult.result.id);
    } else if (sourceResult.error) {
      console.error('Failed to get/create source:', sourceResult.error);
    }

    // 9. Create the lead
    const leadDescription = data.businessName?.trim()
      ? `${data.businessName.trim()} - ${data.entityName?.trim() || data.name?.trim() || 'Lead'}`
      : data.entityName?.trim() || data.name?.trim() || 'Billboard Lead';

    const leadPayload: Record<string, unknown> = {
      description: leadDescription,
      assignee: {
        entityType: 'Users',
        id: nutshellUserId,
      },
    };

    // Only add contacts if we have valid contact IDs
    if (contactIds.length > 0) {
      leadPayload.contacts = contactIds.map(id => ({ id }));
    }

    // Only add accounts if we have a valid account ID
    if (accountId && accountId > 0) {
      leadPayload.accounts = [{ id: accountId }];
    }

    // Only add tags if we have any
    if (tags.length > 0) {
      leadPayload.tags = tags;
    }

    // Only add pipeline and milestone if set
    if (stagesetId && stagesetId > 0) {
      leadPayload.stagesetId = stagesetId;
    }
    if (milestoneId && milestoneId > 0) {
      leadPayload.milestoneId = milestoneId;
    }

    // Add source "Call (GPP2)" if available
    if (sourceId && sourceId > 0) {
      leadPayload.sources = [{ id: sourceId }];
    }

    // Only add custom fields if we have any
    if (Object.keys(customFields).length > 0) {
      leadPayload.customFields = customFields;
    }

    // Only add note if we have content
    if (noteParts.length > 0) {
      leadPayload.note = noteParts.join('\n');
    }

    console.log('Creating Nutshell lead with payload:', JSON.stringify(leadPayload, null, 2));

    const leadResult = await nutshellRequest('newLead', { lead: leadPayload }, credentials);

    if (leadResult.error) {
      console.error('Nutshell newLead error:', leadResult.error);
      return NextResponse.json(
        { error: leadResult.error.message || 'Failed to create lead in Nutshell' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      leadId: leadResult.result?.id,
      contactIds,
      accountId,
      message: 'Lead created successfully in Nutshell',
    });
  } catch (error) {
    console.error('Error creating Nutshell lead:', error);
    return NextResponse.json(
      { error: 'Failed to create lead in Nutshell' },
      { status: 500 }
    );
  }
}
