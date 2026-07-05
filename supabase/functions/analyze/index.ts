/**
 * Catcher.AI — Analyze Edge Function
 * 
 * Proxies requests to the Claude API (Anthropic) so the API key stays server-side.
 * Handles two request types:
 *   - type: 'analyze'  → Analyze a credit report, return structured JSON
 *   - type: 'letter'   → Generate a dispute letter, return plain text
 * 
 * Auth: Requires valid Supabase JWT. Checks subscription_status before proceeding.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verify JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Check subscription status
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('subscription_status')
      .eq('user_id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const activeStatuses = ['active', 'trialing']
    if (!activeStatuses.includes(profile.subscription_status)) {
      return new Response(JSON.stringify({ error: 'Active subscription required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Parse request body
    const body = await req.json()
    const { type, reportText, disputeData, round, profileJson } = body

    if (!type || !['analyze', 'letter'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid type. Must be "analyze" or "letter".' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Build Claude prompt based on type
    let systemPrompt: string
    let userMessage: string

    if (type === 'analyze') {
      if (!reportText) {
        return new Response(JSON.stringify({ error: 'reportText is required for type "analyze"' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Limit input to prevent token overflow
      const truncated = reportText.slice(0, 50000)

      systemPrompt = `You are an expert credit repair analyst. Analyze the provided credit report and identify all negative, inaccurate, or disputable items. For each item, provide:
- creditor: the creditor/company name
- bureau: which bureau (Equifax, Experian, TransUnion, or All)
- account: account number if visible
- amount: balance or amount
- issue: what's wrong (late payment, collection, inaccurate info, etc.)
- law: which consumer protection law applies (FCRA Section, FDCPA, etc.)
- recommendation: suggested action

Return your analysis as valid JSON with this structure:
{
  "summary": "Brief overview of the report health",
  "score_estimate": number or null,
  "items": [ { "creditor", "bureau", "account", "amount", "issue", "law", "recommendation" } ]
}`

      userMessage = `Here is my credit report text:\n\n${truncated}`

    } else {
      // type === 'letter'
      if (!disputeData) {
        return new Response(JSON.stringify({ error: 'disputeData is required for type "letter"' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const letterRound = round || 1

      systemPrompt = `You are an expert credit repair attorney drafting dispute letters. Generate a professional, legally-sound dispute letter for Round ${letterRound}.

Round guidelines:
- Round 1: Standard dispute requesting verification under FCRA Section 611
- Round 2: Follow-up citing failure to respond within 30 days, escalation warning
- Round 3: Intent to file complaints with CFPB/FTC, legal action warning

The letter should be formal, reference specific laws, and be ready to print and mail. Include placeholders [DATE] for the current date. Do NOT include the sender's address header — that will be added separately.`

      const profileInfo = profileJson ? `\n\nSender info: ${profileJson}` : ''
      userMessage = `Generate a Round ${letterRound} dispute letter for the following:\n\nCreditor: ${disputeData.creditor}\nBureau: ${disputeData.bureau}\nAccount: ${disputeData.account || 'N/A'}\nAmount: ${disputeData.amount || 'N/A'}\nIssue: ${disputeData.issue}\nApplicable Law: ${disputeData.law || 'FCRA Section 611'}${profileInfo}`
    }

    // 5. Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    })

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text()
      console.error('[analyze] Claude API error:', claudeResponse.status, errBody)
      return new Response(JSON.stringify({ error: 'AI service error', details: claudeResponse.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const claudeData = await claudeResponse.json()
    const responseText = claudeData.content?.[0]?.text || ''

    // 6. Return response
    if (type === 'analyze') {
      // Try to parse JSON from Claude's response
      let parsed
      try {
        // Claude sometimes wraps JSON in markdown code blocks
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                          responseText.match(/```\s*([\s\S]*?)\s*```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : responseText
        parsed = JSON.parse(jsonStr)
      } catch {
        // If parsing fails, return raw text wrapped in a structure
        parsed = { summary: responseText, items: [] }
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } else {
      // type === 'letter' — return plain text
      return new Response(JSON.stringify({ text: responseText }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

  } catch (err) {
    console.error('[analyze] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
