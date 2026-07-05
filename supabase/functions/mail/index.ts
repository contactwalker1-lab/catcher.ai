/**
 * Catcher.AI — Mail Edge Function
 * 
 * Proxies requests to the Mailform API (api.mailform.io) so the API key stays server-side.
 * Sends USPS Certified Mail with Return Receipt for credit dispute letters.
 * 
 * Auth: Requires valid Supabase JWT. Checks subscription_status before proceeding.
 * After successful mailing, updates the letters table with tracking_id and mailed_at.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAILFORM_API_KEY = Deno.env.get('MAILFORM_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MailAddress {
  name: string
  street: string
  city: string
  state: string
  zip: string
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

    // 3. Parse and validate request body
    const body = await req.json()
    const { letterId, from, to, content } = body

    if (!letterId || !from || !to || !content) {
      return new Response(JSON.stringify({ error: 'Missing required fields: letterId, from, to, content' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate addresses
    const validateAddress = (addr: MailAddress, label: string): string | null => {
      if (!addr.name || !addr.street || !addr.city || !addr.state || !addr.zip) {
        return `${label} address is incomplete. Required: name, street, city, state, zip.`
      }
      if (!/^\d{5}(-\d{4})?$/.test(addr.zip)) {
        return `${label} ZIP code is invalid.`
      }
      return null
    }

    const fromError = validateAddress(from, 'Sender')
    if (fromError) {
      return new Response(JSON.stringify({ error: fromError }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const toError = validateAddress(to, 'Recipient')
    if (toError) {
      return new Response(JSON.stringify({ error: toError }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify letter belongs to this user
    const { data: letter, error: letterError } = await supabase
      .from('letters')
      .select('id, user_id')
      .eq('id', letterId)
      .eq('user_id', user.id)
      .single()

    if (letterError || !letter) {
      return new Response(JSON.stringify({ error: 'Letter not found or access denied' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Call Mailform API
    const mailformPayload = {
      from: {
        name: from.name,
        address_line1: from.street,
        city: from.city,
        state: from.state,
        postcode: from.zip,
        country: 'US'
      },
      to: {
        name: to.name,
        address_line1: to.street,
        city: to.city,
        state: to.state,
        postcode: to.zip,
        country: 'US'
      },
      document: content,
      certified: true,
      return_receipt: true
    }

    const mailResponse = await fetch('https://api.mailform.io/letters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MAILFORM_API_KEY}`
      },
      body: JSON.stringify(mailformPayload)
    })

    if (!mailResponse.ok) {
      const errBody = await mailResponse.text()
      console.error('[mail] Mailform API error:', mailResponse.status, errBody)
      return new Response(JSON.stringify({ error: 'Mailing service error', details: mailResponse.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const mailData = await mailResponse.json()
    const trackingId = mailData.id || mailData.tracking_id || mailData.letter_id || null

    // 5. Update letter record with tracking info
    const { error: updateError } = await supabase
      .from('letters')
      .update({
        mailed: true,
        tracking_id: trackingId,
        mailed_at: new Date().toISOString()
      })
      .eq('id', letterId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[mail] Failed to update letter record:', updateError.message)
      // Don't fail the response — the mail was already sent
    }

    // 6. Return success
    return new Response(JSON.stringify({
      success: true,
      tracking_id: trackingId,
      mailed_at: new Date().toISOString(),
      message: 'Letter sent via USPS Certified Mail with Return Receipt'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[mail] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
