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

    // First, get the current user's Nutshell ID
    const getUserPayload = {
      jsonrpc: '2.0',
      method: 'getUser',
      params: {},
      id: 'getUser',
    };

    const userResponse = await fetch('https://app.nutshell.com/api/v1/json', {
      method: 'POST',
      headers,
      body: JSON.stringify(getUserPayload),
    });

    const userResult = await userResponse.json();

    if (userResult.error) {
      console.error('Nutshell getUser error:', userResult.error);
      return NextResponse.json(
        { error: userResult.error.message || 'Failed to get user from Nutshell' },
        { status: 400 }
      );
    }

    const nutshellUserId = userResult.result?.id;
    console.log('Nutshell user ID:', nutshellUserId);

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

    // Create the JSON-RPC payload for Nutshell API with assignee
    const jsonRpcPayload = {
      jsonrpc: '2.0',
      method: 'newLead',
      params: {
        lead: {
          description: data.businessDescription || `Billboard Lead - ${data.advertiser || data.name || 'Unknown'}`,
          note: noteParts || undefined,
          assignee: nutshellUserId ? {
            entityType: 'Users',
            id: nutshellUserId,
          } : undefined,
        },
      },
      id: Date.now().toString(),
    };

    const response = await fetch('https://app.nutshell.com/api/v1/json', {
      method: 'POST',
      headers,
      body: JSON.stringify(jsonRpcPayload),
    });

    const result = await response.json();

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
