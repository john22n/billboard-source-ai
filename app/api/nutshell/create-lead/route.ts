import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

interface NutshellLeadRequest {
  name: string;
  phone: string;
  email: string;
  website: string;
  advertiser: string;
  businessDescription: string;
  yearsInBusiness: string;
  billboardPurpose: string;
  targetCityAndState: string;
  targetArea: string;
  startMonth: string;
  campaignLength: string;
  notes: string;
  leadType: string;
  hasMediaExperience: boolean | null;
  hasDoneBillboards: boolean | null;
  decisionMaker: string;
}

export async function POST(req: NextRequest) {
  try {
    // Verify authentication and get user email for Nutshell auth
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.email;
    const data: NutshellLeadRequest = await req.json();

    // Validate required env var - only API key needed, email comes from session
    const nutshellApiKey = process.env.NUTSHELL_API_KEY;

    if (!nutshellApiKey) {
      console.error('Nutshell API key not configured');
      return NextResponse.json(
        { error: 'Nutshell integration not configured' },
        { status: 500 }
      );
    }

    const credentials = Buffer.from(`${userEmail}:${nutshellApiKey}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Find the Nutshell user by email address
    const findUsersPayload = {
      jsonrpc: '2.0',
      method: 'findUsers',
      params: {
        query: {
          email: userEmail,
        },
      },
      id: 'findUsers',
    };

    console.log('Searching for Nutshell user with email:', userEmail);

    const userResponse = await fetch('https://app.nutshell.com/api/v1/json', {
      method: 'POST',
      headers,
      body: JSON.stringify(findUsersPayload),
    });

    const userResult = await userResponse.json();
    console.log('Nutshell findUsers response:', JSON.stringify(userResult, null, 2));

    if (userResult.error) {
      console.error('Nutshell findUsers error:', userResult.error);
      return NextResponse.json(
        { error: userResult.error.message || 'Failed to find user in Nutshell' },
        { status: 400 }
      );
    }

    // findUsers returns an array of users - find the one matching our email
    const users = userResult.result || [];
    const matchingUser = users.find((user: { emails?: string[] }) =>
      user.emails?.some((email: string) => email.toLowerCase() === userEmail.toLowerCase())
    );

    const nutshellUserId = matchingUser?.id;
    console.log('Found Nutshell user:', matchingUser?.name, 'ID:', nutshellUserId);

    if (!nutshellUserId) {
      console.error(`No Nutshell user found for email: ${userEmail}`);
      return NextResponse.json(
        { error: `No Nutshell user found for email: ${userEmail}` },
        { status: 400 }
      );
    }

    // Build note with all lead details
    const noteParts = [
      data.name && `Contact: ${data.name}`,
      data.phone && `Phone: ${data.phone}`,
      data.email && `Email: ${data.email}`,
      data.website && `Website: ${data.website}`,
      data.advertiser && `Advertiser: ${data.advertiser}`,
      data.yearsInBusiness && `Years in Business: ${data.yearsInBusiness}`,
      data.billboardPurpose && `Billboard Purpose: ${data.billboardPurpose}`,
      data.targetCityAndState && `Target Location: ${data.targetCityAndState}`,
      data.targetArea && `Target Area: ${data.targetArea}`,
      data.startMonth && `Start Month: ${data.startMonth}`,
      data.campaignLength && `Campaign Length: ${data.campaignLength}`,
      data.leadType && `Lead Type: ${data.leadType}`,
      data.hasMediaExperience !== null && `Has Media Experience: ${data.hasMediaExperience ? 'Yes' : 'No'}`,
      data.hasDoneBillboards !== null && `Has Done Billboards: ${data.hasDoneBillboards ? 'Yes' : 'No'}`,
      data.decisionMaker && `Decision Maker: ${data.decisionMaker}`,
      data.notes && `Notes: ${data.notes}`,
    ].filter(Boolean).join('\n');

    // Ensure user ID is a number (Nutshell API expects numeric ID)
    const assigneeId = nutshellUserId ? Number(nutshellUserId) : null;

    // Create the JSON-RPC payload for Nutshell API with assignee
    const jsonRpcPayload = {
      jsonrpc: '2.0',
      method: 'newLead',
      params: {
        lead: {
          description: data.businessDescription || `Billboard Lead - ${data.advertiser || data.name || 'Unknown'}`,
          note: noteParts || undefined,
          assignee: assigneeId ? {
            entityType: 'Users',
            id: assigneeId,
          } : undefined,
        },
      },
      id: Date.now().toString(),
    };

    console.log('Nutshell newLead request payload:', JSON.stringify(jsonRpcPayload, null, 2));

    const response = await fetch('https://app.nutshell.com/api/v1/json', {
      method: 'POST',
      headers,
      body: JSON.stringify(jsonRpcPayload),
    });

    const result = await response.json();
    console.log('Nutshell newLead response:', JSON.stringify(result, null, 2));

    // JSON-RPC returns errors in the response body, not via HTTP status
    if (result.error) {
      console.error('Nutshell API error:', result.error);
      return NextResponse.json(
        { error: result.error.message || 'Failed to create lead in Nutshell' },
        { status: 400 }
      );
    }

    if (!response.ok) {
      console.error('Nutshell API error:', response.status, result);
      return NextResponse.json(
        { error: `Failed to create lead in Nutshell: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      leadId: result.result?.id,
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
