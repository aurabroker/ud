import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* ── GetResponse contact sync ── */
async function syncGetResponse(data: Record<string, unknown>): Promise<boolean> {
  const apiKey = Deno.env.get('GETRESPONSE_API_KEY');
  const listId = Deno.env.get('GETRESPONSE_LIST_ID');
  if (!apiKey || !listId) return false;

  const fullName = String(data.full_name ?? '');
  const [firstName, ...rest] = fullName.split(' ');
  const payload = {
    name: firstName,
    email: data.email,
    campaign: { campaignId: listId },
    customFieldValues: rest.length ? [{ customFieldId: 'lastname', value: [rest.join(' ')] }] : [],
  };

  const res = await fetch('https://api.getresponse.com/v3/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': `api-key ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  return res.ok || res.status === 409;
}

function yesNo(val: unknown): boolean | null {
  if (val === 'Yes' || val === true) return true;
  if (val === 'No'  || val === false) return false;
  return null;
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // skip if not configured

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return data.success === true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();

    /* Turnstile verification */
    const turnstileToken = String(body['cf-turnstile-response'] ?? '').trim();
    const clientIp = req.headers.get('CF-Connecting-IP') ?? '';
    if (!turnstileToken || !(await verifyTurnstile(turnstileToken, clientIp))) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Weryfikacja bezpieczeństwa nie powiodła się. Odśwież stronę i spróbuj ponownie.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    /* Validate required fields */
    const pesel: string = String(body.pesel ?? '').trim();
    if (!/^\d{11}$/.test(pesel)) {
      return new Response(JSON.stringify({ status: 'error', message: 'Nieprawidłowy PESEL.' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    /* Build explicit column mapping */
    const record: Record<string, unknown> = {
      /* ── basic ── */
      full_name:          body.fullName        ?? body.full_name        ?? null,
      email:              body.email                                     ?? null,
      phone:              body.phone                                     ?? null,
      pesel,
      employment_type:    body.employmentType  ?? body.employment_type  ?? null,
      profession:         body.profession                                ?? null,
      source:             body.source                                   ?? 'direct',
      affiliate_code_used: body.affiliateCode  ?? body.affiliate_code_used ?? null,

      /* ── personal data (new) ── */
      weight:             body.weight                                    ?? null,
      height:             body.height                                    ?? null,
      handedness:         body.handedness                                ?? null,
      tax_form:           body.taxForm         ?? body.tax_form          ?? null,

      /* ── employer ── */
      employs_people:     yesNo(body.employsPeople ?? body.employs_people),

      /* ── employer / B2B details ── */
      b2b_start_date:       body.emp_startDate                           ?? null,
      b2b_industry:         body.emp_industry                            ?? null,
      b2b_character:        body.emp_character                           ?? null,
      b2b_area:             body.emp_area                                ?? null,
      b2b_employees_2024:   body.emp_count_2024                          ?? null,
      b2b_employees_2025:   body.emp_count_current                       ?? null,
      b2b_own_contribution: body.emp_contribution                        ?? null,
      b2b_description:      body.emp_description                         ?? null,

      /* ── medical pre-conditions ── */
      med_heart:          yesNo(body.med_heart          ?? body.medHeart),
      med_diabetes:       yesNo(body.med_diabetes       ?? body.medDiabetes),
      med_bones:          yesNo(body.med_bones          ?? body.medBones),
      med_stomach:        yesNo(body.med_stomach        ?? body.medStomach),
      med_neuro:          yesNo(body.med_neuro          ?? body.medNeuro),
      med_surgery:        yesNo(body.med_surgery        ?? body.medSurgery),
      med_aids:           yesNo(body.med_aids           ?? body.medAids),

      /* ── health screening (new) ── */
      weight_change:      yesNo(body.weightChange       ?? body.weight_change),
      takes_meds:         yesNo(body.takesMeds          ?? body.takes_meds),
      pending_diagnosis:  yesNo(body.pendingDiagnosis   ?? body.pending_diagnosis),
      disability_congenital: yesNo(body.disabilityCongenital ?? body.disability_congenital),
      smoker:             yesNo(body.smoker),

      /* ── medical events last 2 years (new) ── */
      event_hospitalization:   yesNo(body.eventHospitalization   ?? body.event_hospitalization),
      event_sick_leave_30:     yesNo(body.eventSickLeave30       ?? body.event_sick_leave_30),
      event_further_diagnosis: yesNo(body.eventFurtherDiagnosis  ?? body.event_further_diagnosis),

      /* ── sport risks ── */
      risk_caving:              yesNo(body.risk_caving),
      risk_climbing:            yesNo(body.risk_climbing),
      risk_extreme_bike_boat:   yesNo(body.risk_extreme_bike_boat),
      risk_diving:              yesNo(body.risk_diving),
      risk_sailing:             yesNo(body.risk_sailing),
      risk_horse:               yesNo(body.risk_horse),
      risk_skiing:              yesNo(body.risk_skiing),
      risk_hunting:             yesNo(body.risk_hunting),
      risk_quad:                yesNo(body.risk_quad),
      risk_balloon:             yesNo(body.risk_balloon),
      risk_skydiving:           yesNo(body.risk_skydiving),
      risk_paragliding:         yesNo(body.risk_paragliding),
      risk_horse_jumping:       yesNo(body.risk_horse_jumping),
      risk_gravity_bike:        yesNo(body.risk_gravity_bike),
      risk_aviation:            yesNo(body.risk_aviation),

      /* ── coverage selection ── */
      risk_death_invalidity:  yesNo(body.riskDeathInvalidity  ?? body.risk_death_invalidity),
      risk_temp_incapacity:   yesNo(body.riskTempIncapacity   ?? body.risk_temp_incapacity),
      risk_perm_incapacity:   yesNo(body.riskPermIncapacity   ?? body.risk_perm_incapacity),
      temp_incapacity_sum:    body.tempIncapacitySum           ?? body.temp_incapacity_sum  ?? null,
      perm_incapacity_sum:    body.permIncapacitySum           ?? body.perm_incapacity_sum  ?? null,

      /* ── NW clauses (new) ── */
      nw_death_sum:           body.nwDeathSum          ?? body.nw_death_sum          ?? null,
      nw_funeral:             body.nwFuneral           ?? body.nw_funeral            ?? null,
      nw_adaptation:          body.nwAdaptation        ?? body.nw_adaptation         ?? null,
      nw_hospital_daily:      body.nwHospitalDaily     ?? body.nw_hospital_daily     ?? null,
      nw_medical_costs:       body.nwMedicalCosts      ?? body.nw_medical_costs      ?? null,
      nw_unconscious_weekly:  body.nwUnconsciousWeekly ?? body.nw_unconscious_weekly ?? null,
      nw_permanent_damage:    yesNo(body.nwPermanentDamage ?? body.nw_permanent_damage),

      /* ── consents ── */
      exclusions_accepted:  yesNo(body.exclusionsAccepted ?? body.exclusions_accepted),
      informed_accepted:    yesNo(body.informedAccepted   ?? body.informed_accepted),
    };

    /* Strip null values so Supabase uses column defaults */
    const cleanRecord = Object.fromEntries(
      Object.entries(record).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );

    /* Supabase insert */
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { error: dbError } = await supabase.from('ud_clients').insert([cleanRecord]);

    if (dbError) {
      console.error('DB insert error:', dbError.message);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Błąd zapisu. Spróbuj ponownie.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    /* GetResponse sync — non-fatal */
    const grOk = await syncGetResponse(cleanRecord).catch(() => false);

    return new Response(
      JSON.stringify({ status: 'success', supabase: 'ok', getresponse: grOk }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Unhandled error:', err);
    return new Response(
      JSON.stringify({ status: 'error', message: 'Nieoczekiwany błąd serwera.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
