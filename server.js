const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
// Verifies the Supabase session JWT sent from the app in the Authorization
// header. Rejects the request before any downstream API (Anthropic, Resend,
// Documo) is called if the token is missing, malformed, or invalid.
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    req.user = data.user; // available to downstream handlers if needed
    next();
  } catch (e) {
    console.error('Auth check failed:', e.message);
    return res.status(401).json({ error: 'Authentication check failed.' });
  }
}

// == ADMIN CLIENT ==
// Uses the service role key, which can delete auth users. Only ever used
// server-side, inside routes protected by requireAuth, so a user can only
// ever delete their own account.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// == DELETE ACCOUNT ==
// The client deletes visits/providers/profiles rows first, then calls this
// to remove the actual Supabase Auth user, which requires the service role
// key and can never be done from the client app itself.
app.post('/delete-account', requireAuth, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
    if (error) {
      console.error('Delete account error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Delete account error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/analyze', requireAuth, async (req, res) => {
  const { transcript } = req.body;
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a medical visit assistant for Canadian patients. Analyze this transcript and return ONLY a raw JSON object with these exact keys:
- summary: string
- recommendations: array of strings
- medications: array of strings (just name and dose, e.g. "Lisinopril 10mg daily")
- followUp: string
- resources: array of 4-8 objects each with "label" and "url"

CANADIAN LAB VALUES - always use Canadian/SI units in summaries:
- Blood glucose: mmol/L (normal fasting: 3.9-5.5 mmol/L; diabetes diagnosis: ≥7.0 mmol/L)
- HbA1c: % (normal <5.7%; prediabetes 5.7-6.4%; diabetes ≥6.5%)
- Total cholesterol: mmol/L (desirable <5.2 mmol/L)
- LDL cholesterol: mmol/L (optimal <2.6 mmol/L; high risk <2.0 mmol/L)
- HDL cholesterol: mmol/L (low risk >1.55 mmol/L)
- Triglycerides: mmol/L (normal <1.7 mmol/L)
- Blood pressure: mmHg (normal <120/80; hypertension ≥130/80 per Hypertension Canada)
- Hemoglobin: g/L (normal women 120-160 g/L; men 135-175 g/L)
- Creatinine: umol/L (normal women 44-97 umol/L; men 62-115 umol/L)
- eGFR: mL/min/1.73m² (normal ≥60)
- TSH: mU/L (normal 0.4-4.0 mU/L)
- Vitamin D: nmol/L (sufficient >75 nmol/L; deficient <50 nmol/L)
- Potassium: mmol/L (normal 3.5-5.0 mmol/L)
- Sodium: mmol/L (normal 136-145 mmol/L)
- Weight: kg; Height: cm; Temperature: °C
Never use mg/dL, lbs, or Fahrenheit in summaries unless the transcript specifically uses those units.

RESOURCE SELECTION RULES - read carefully and follow exactly:

PRIORITY ORDER: Always include Mayo Clinic first for any condition mentioned. Then add Canadian organizations. Then other sources.

MAYO CLINIC URLS - always use these exact search URL patterns for conditions:
- For any condition/disease/symptom -> https://www.mayoclinic.org/search/search-results?q=CONDITION replacing CONDITION with the topic (use + for spaces)
- Examples:
  https://www.mayoclinic.org/search/search-results?q=hypertension
  https://www.mayoclinic.org/search/search-results?q=high+blood+pressure
  https://www.mayoclinic.org/search/search-results?q=type+2+diabetes
  https://www.mayoclinic.org/search/search-results?q=lisinopril
  https://www.mayoclinic.org/search/search-results?q=anxiety
  https://www.mayoclinic.org/search/search-results?q=high+cholesterol
ALWAYS include at least one Mayo Clinic search URL. It should be the FIRST resource listed.

MEDICATION URLS - for every medication mentioned by name:
- https://www.drugs.com/search.php?searchterm=MEDICATION_NAME replacing MEDICATION_NAME with the drug name (use + for spaces)
- Examples:
  https://www.drugs.com/search.php?searchterm=lisinopril
  https://www.drugs.com/search.php?searchterm=metformin
  https://www.drugs.com/search.php?searchterm=atorvastatin

CANADIAN ORGANIZATION URLS - include for each matching topic:

1. Mental health (anxiety, depression, stress, substance use, addiction, alcohol, drugs, mood, sleep) ->
   https://www.camh.ca/en/health-info/mental-illness-and-addiction-index (CAMH)
   https://cmha.ca/mental-health/ (Canadian Mental Health Association)

2. Pediatric/child topics (child, infant, baby, teenager, vaccination) ->
   https://caringforkids.cps.ca/handouts/browse-by-topic (Canadian Paediatric Society)
   https://www.cheo.on.ca/en/health-information.aspx (CHEO)

3. Cancer ->
   https://cancer.ca/en/cancer-information (Canadian Cancer Society)

4. Heart/cardiovascular (blood pressure, hypertension, cholesterol, heart disease, cardiac, stroke) ->
   https://www.heartandstroke.ca/heart-disease (Heart & Stroke Foundation)

5. Hypertension specifically ->
   https://hypertension.ca/hypertension/ (Hypertension Canada)

6. Diabetes or blood sugar ->
   https://www.diabetes.ca/health-care-providers/clinical-practice-guidelines (Diabetes Canada)

7. Lung/respiratory (asthma, COPD, emphysema, bronchitis) ->
   https://www.lung.ca/lung-health/lung-disease (Canadian Lung Association)

8. PCOS ->
   https://www.pcosaa.org/pcos-overview

9. Osteoporosis or bone density ->
   https://osteoporosis.ca/bone-health-osteoporosis/ (Osteoporosis Canada)

10. Arthritis ->
    https://arthritis.ca/about-arthritis (Arthritis Society Canada)

11. Kidney disease ->
    https://kidney.ca/kidney-health (Kidney Foundation of Canada)

12. Alzheimer's or dementia ->
    https://alzheimer.ca/en/about-dementia (Alzheimer Society of Canada)

13. Complex/specialized conditions (transplant, rare disease, complex surgery) ->
    https://www.uhn.ca/patients/conditions (University Health Network)

14. For any additional conditions not covered above ->
    https://medlineplus.gov/search/?query=TOPIC replacing TOPIC with relevant search term (use + for spaces)

15. For Canadian drug/medication information ->
    https://www.healthlinkbc.ca/medications (HealthLink BC)

16. For clinical guidelines ->
    https://www.canada.ca/en/health-canada.html (Health Canada)

CRITICAL RULES:
- ALWAYS put Mayo Clinic search URL FIRST in the resources array
- Use ONLY the exact URL patterns shown above — never invent or guess article paths
- Every medication mentioned must have a drugs.com search URL
- Include 4-8 resources total
- Most visits should have Mayo Clinic + at least 2 Canadian sources

Return ONLY the JSON object. No markdown, no backticks, no explanation.

Transcript: ${transcript}`
        }]
      })
    });
    
    const text = await response.text();
    const data = JSON.parse(text);
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }
    
    let content = data.content?.map(b => b.text || '').join('');
    content = content.trim();
    if (content.startsWith('```json')) content = content.slice(7);
    if (content.startsWith('```')) content = content.slice(3);
    if (content.endsWith('```')) content = content.slice(0, -3);
    content = content.trim();
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start !== -1 && end !== -1) content = content.slice(start, end + 1);
    
    const parsed = JSON.parse(content);
    
    if (parsed.medications) {
      parsed.medications = parsed.medications.map(m =>
        typeof m === 'object' ? `${m.name || ''}${m.dosage ? ' ' + m.dosage : ''}${m.frequency ? ' - ' + m.frequency : ''}`.trim() : m
      );
    }
    
    res.json(parsed);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// ── SEND SUMMARY EMAIL ─────────────────────────────────────────────────────
app.post('/send-summary-email', requireAuth, async (req, res) => {
  try {
    const { to, providerName, visitDate, summary, recommendations, medications, followUp, patientName, patientDOB } = req.body;
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const recList = (recommendations || []).map((r) => `<li style="margin-bottom:6px">${r}</li>`).join('');
    const medList = medications && medications.length > 0 ? medications.join(', ') : 'None mentioned';

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0B2D56;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:22px">Welluma Health</h1>
          <p style="color:#a0b4c8;margin:4px 0 0;font-size:13px">Patient Visit Summary</p>
        </div>
        <div style="background:#f8f9fa;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0">
          <p style="margin:0 0 16px;font-size:14px;color:#555">Dear ${providerName},</p>
          <p style="margin:0 0 20px;font-size:14px;color:#555">Your patient has shared the following AI-generated visit summary from their appointment on <strong>${visitDate}</strong>, using the Welluma Health app.</p>

          <div style="background:#ffffff;border-radius:8px;padding:16px 20px;margin-bottom:16px;border:1px solid #e0e0e0">
            <p style="margin:0;font-size:13px;color:#555"><strong>Patient:</strong> ${patientName || 'Not provided'}${patientDOB ? ` &nbsp;|&nbsp; <strong>Date of Birth:</strong> ${patientDOB}` : ''}</p>
          </div>

          <div style="background:#ffffff;border-radius:8px;padding:20px;margin-bottom:16px;border:1px solid #e0e0e0">
            <h3 style="color:#0B2D56;margin:0 0 10px;font-size:15px">Visit Summary</h3>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#333">${summary}</p>
          </div>

          <div style="background:#e8f5f0;border-radius:8px;padding:20px;margin-bottom:16px;border:1px solid #c0ddd5">
            <h3 style="color:#0E7C6B;margin:0 0 10px;font-size:15px">Provider Recommendations</h3>
            <ol style="margin:0;padding-left:16px;font-size:14px;color:#333;line-height:1.7">${recList}</ol>
          </div>

          <div style="background:#ffffff;border-radius:8px;padding:20px;margin-bottom:16px;border:1px solid #e0e0e0">
            <h3 style="color:#0B2D56;margin:0 0 10px;font-size:15px">Medications</h3>
            <p style="margin:0;font-size:14px;color:#333">${medList}</p>
          </div>

          <div style="background:#ffffff;border-radius:8px;padding:20px;margin-bottom:20px;border:1px solid #e0e0e0">
            <h3 style="color:#0B2D56;margin:0 0 10px;font-size:15px">Follow-Up</h3>
            <p style="margin:0;font-size:14px;color:#333">${followUp}</p>
          </div>

          <div style="background:#fff8e1;border-radius:8px;padding:16px;margin-bottom:12px;border:1px solid #ffe082">
            <p style="margin:0;font-size:12px;color:#856404;line-height:1.6">⚠️ <strong>Disclaimer:</strong> This summary was generated by Welluma AI and shared at the patient's request. It may contain speech recognition errors. It is not a substitute for clinical documentation and should not be added to the patient's medical record without verification. Please treat this information with appropriate confidentiality.</p>
          </div>

          <div style="background:#f1f3f5;border-radius:8px;padding:16px;border:1px solid #dde1e4">
            <p style="margin:0;font-size:11px;color:#666;line-height:1.6">This email and any attachments are confidential and intended solely for the use of the individual to whom it is addressed. If you have received this email in error, please notify the sender immediately and delete this email from your system. Any unauthorized copying, disclosure, or distribution of this information is strictly prohibited.</p>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#999;text-align:center">Shared via Welluma Health — wellumahealth.com</p>
        </div>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: 'Welluma Health <noreply@wellumahealth.com>',
      to: [to],
      subject: `Patient Visit Summary — ${visitDate}`,
      html,
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (error) {
    console.error('Email error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── SEND SUMMARY FAX ───────────────────────────────────────────────────────
app.post('/send-summary-fax', requireAuth, async (req, res) => {
  try {
    const { faxNumber, providerName, visitDate, summary, recommendations, medications, followUp, patientName, patientEmail, patientDOB, patientPhone } = req.body;
    const recText = (recommendations || []).map((r, i) => `${i+1}. ${r}`).join('\n');
    const medText = medications && medications.length > 0 ? medications.join(', ') : 'None mentioned';
    const sentAt = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'full', timeStyle: 'short' });

    const faxContent = `================================================================================
                        WELLUMA HEALTH — CONFIDENTIAL FAX
================================================================================

COVER PAGE

To:        ${providerName}
Fax:       ${faxNumber}
From:      Welluma Health (on behalf of patient)
Date/Time: ${sentAt}
Re:        Patient Visit Summary — ${visitDate}
Pages:     2 (including cover page)

--------------------------------------------------------------------------------
CONFIDENTIALITY NOTICE
--------------------------------------------------------------------------------

This facsimile transmission contains confidential health information belonging
to the patient identified below. It is intended solely for the use of the
individual or entity named above.

If you have received this fax in error, please:
  1. Do NOT read, copy, or distribute the contents
  2. Destroy this document immediately and securely
  3. Notify Welluma Health of the error by contacting:
     Email: privacy@wellumahealth.com
     Web:   wellumahealth.com

Unauthorized review, use, disclosure, or distribution of this information
is strictly prohibited and may be unlawful under PHIPA and applicable
Canadian privacy legislation.

--------------------------------------------------------------------------------
PATIENT INFORMATION
--------------------------------------------------------------------------------

Patient Name:  ${patientName || 'Not provided'}
Date of Birth: ${patientDOB || 'Not provided'}
Phone Number:  ${patientPhone || 'Not provided'}
Patient Email: ${patientEmail || 'Not provided'}
Visit Date:    ${visitDate}

This summary was generated by Welluma AI and shared at the patient's
written request. The patient has authorized this transmission.

================================================================================
                           VISIT SUMMARY — PAGE 2
================================================================================

SUMMARY:
${summary}

--------------------------------------------------------------------------------
PROVIDER RECOMMENDATIONS:
${recText}

--------------------------------------------------------------------------------
MEDICATIONS:
${medText}

--------------------------------------------------------------------------------
FOLLOW-UP:
${followUp}

--------------------------------------------------------------------------------
IMPORTANT DISCLAIMER:

This summary was generated by artificial intelligence (Welluma Health) based
on a patient-recorded audio transcript. It may contain speech recognition
errors, particularly with medical terminology, medication names, or proper
nouns. This document is NOT a substitute for clinical documentation and should
NOT be added to the patient medical record without independent verification.

Please review for accuracy before acting on this information.

Shared via Welluma Health — wellumahealth.com
privacy@wellumahealth.com
================================================================================`;

    const SRFAX_ACCESS_ID = process.env.SRFAX_ACCESS_ID;
    const SRFAX_ACCESS_PWD = process.env.SRFAX_ACCESS_PWD;
    const SRFAX_FAX_NUMBER = process.env.SRFAX_FAX_NUMBER;

    if (!SRFAX_ACCESS_ID || !SRFAX_ACCESS_PWD || !SRFAX_FAX_NUMBER) {
      return res.status(500).json({ error: 'Fax service not configured yet.' });
    }

    const normalizedFaxNumber = faxNumber.replace(/[^0-9]/g, '');
    const toFaxNumber = normalizedFaxNumber.length === 10 ? '1' + normalizedFaxNumber : normalizedFaxNumber;

    const srFaxParams = new URLSearchParams({
      action: 'Queue_Fax',
      access_id: SRFAX_ACCESS_ID,
      access_pwd: SRFAX_ACCESS_PWD,
      sCallerID: SRFAX_FAX_NUMBER,
      sSenderEmail: 'support@wellumahealth.com',
      sFaxType: 'SINGLE',
      sToFaxNumber: toFaxNumber,
      sResponseFormat: 'JSON',
      sCPSubject: `CONFIDENTIAL — Patient Visit Summary — ${visitDate}`,
      sFileName_1: 'VisitSummary.txt',
      sFileContent_1: Buffer.from(faxContent).toString('base64'),
    });

    const response = await fetch('https://secure.srfax.com/SRF_SecWebSvc.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: srFaxParams.toString(),
    });

    const result = await response.json();

    if (result.Status !== 'Success') {
      return res.status(500).json({ error: result.Result || 'Fax failed' });
    }
    res.json({ success: true, faxDetailsId: result.Result });
  } catch (error) {
    console.error('Fax error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));