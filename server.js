const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || 'capacitor://localhost,http://localhost,https://localhost')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed.'));
  },
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'welluma-api' });
});

const AZURE_COGNITIVE_RESOURCE = 'https://cognitiveservices.azure.com';

async function getAppServiceManagedIdentityToken() {
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  if (!endpoint || !identityHeader) {
    throw new Error('Azure App Service managed identity is not available.');
  }
  const url = new URL(endpoint);
  url.searchParams.set('api-version', '2019-08-01');
  url.searchParams.set('resource', AZURE_COGNITIVE_RESOURCE);
  const response = await fetch(url, { headers: { 'X-IDENTITY-HEADER': identityHeader } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error('Azure managed identity token request failed.');
  }
  return payload.access_token;
}

async function azureAuthorizationHeaders(key, keyHeaderName) {
  // Production must use the App Service managed identity. A key is accepted
  // only when the operator has deliberately enabled the local-development
  // fallback; this prevents an accidental production regression to secrets.
  if (process.env.ALLOW_AZURE_API_KEYS === 'true') {
    if (!key) throw new Error('The explicitly enabled Azure API key is missing.');
    return { [keyHeaderName]: key };
  }
  const token = await getAppServiceManagedIdentityToken();
  return { Authorization: `Bearer ${token}` };
}

// Audio is held only for the lifetime of this request. It is never written to
// the server filesystem, database, application logs, or a non-Canadian store.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('audio/')) return cb(new Error('Only audio recordings are accepted.'));
    cb(null, true);
  },
});

function requireCanadianAzureConfiguration() {
  const region = (process.env.AZURE_SPEECH_REGION || '').toLowerCase();
  if (!['canadacentral', 'canadaeast'].includes(region)) {
    throw new Error('Canadian Azure Speech region is not configured.');
  }
  if (!process.env.AZURE_SPEECH_ENDPOINT) {
    throw new Error('Azure Speech endpoint is not configured.');
  }
}

async function transcribeInCanadianAzure(file) {
  requireCanadianAzureConfiguration();
  const endpoint = process.env.AZURE_SPEECH_ENDPOINT.replace(/\/$/, '');
  const form = new FormData();
  form.append('audio', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'welluma-visit.m4a');
  form.append('definition', JSON.stringify({
    locales: ['en-CA', 'fr-CA'],
    diarization: { enabled: true, maxSpeakers: 2 },
    profanityFilterMode: 'None',
  }));

  const authHeaders = await azureAuthorizationHeaders(process.env.AZURE_SPEECH_KEY, 'Ocp-Apim-Subscription-Key');
  const response = await fetch(`${endpoint}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const safeMessage = payload?.error?.message || payload?.message || `Azure transcription failed (${response.status}).`;
    throw new Error(safeMessage);
  }
  const transcript = (payload.combinedPhrases || []).map((phrase) => phrase.text || '').join('\n').trim();
  if (!transcript) throw new Error('No speech was detected in the recording.');
  return transcript;
}

async function requestSummaryModel(requestBody) {
  const provider = (process.env.SUMMARY_PROVIDER || 'azure').toLowerCase();
  if (provider !== 'azure') throw new Error('Only Canadian Azure summary processing is enabled.');
  const region = (process.env.AZURE_OPENAI_REGION || '').toLowerCase();
  if (!['canadacentral', 'canadaeast'].includes(region)) {
    throw new Error('Canadian Azure summary region is not configured.');
  }
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !deployment) throw new Error('Azure summary service is not configured.');

  const authHeaders = await azureAuthorizationHeaders(process.env.AZURE_OPENAI_KEY, 'api-key');
  const azureResponse = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        messages: requestBody.messages,
        max_tokens: requestBody.max_tokens,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    }
  );
  const azurePayload = await azureResponse.json().catch(() => ({}));
  if (!azureResponse.ok) {
    throw new Error(azurePayload?.error?.message || `Azure summary generation failed (${azureResponse.status}).`);
  }
  const content = azurePayload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('The Canadian summary service returned no summary.');
  return new Response(JSON.stringify({ content: [{ text: content }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
// Verifies the Supabase session JWT sent from the app in the Authorization
// header. Rejects the request before any downstream API (Azure, Resend,
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

// Raw audio replacement for Android's unreliable live SpeechRecognizer.
// Authentication runs before upload processing and audio is discarded as soon
// as Azure returns the transcript or an error.
app.post('/transcribe-audio', requireAuth, audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio recording was supplied.' });
    const transcript = await transcribeInCanadianAzure(req.file);
    res.json({ transcript });
  } catch (error) {
    console.error('Transcription request failed:', error.message);
    const status = /not configured/i.test(error.message) ? 503 : 422;
    res.status(status).json({ error: error.message });
  }
});

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
  if (!transcript || transcript.trim().length < 30) {
    return res.status(422).json({ error: 'There was not enough recorded speech to create a reliable visit summary.' });
  }
  
  try {
    const response = await requestSummaryModel({
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
MEDICATION & MEDICAL TERMINOLOGY ACCURACY:
The transcript comes from speech-to-text and often mishears medication names, dosages, and clinical terms. Before writing your summary:
- Actively identify likely mis-transcribed medication names using context (e.g., "met for men" → "Metformin", "a torva statin" → "Atorvastatin")
- Cross-reference partial or garbled drug names against common Canadian-prescribed medications for the condition being discussed
- If a dosage or frequency sounds phonetically off, infer the clinically sensible correction
- In the medications array, list your best-corrected interpretation of each medication, not the raw transcript wording
- If you cannot confidently determine what a medication name should be, include it as transcribed but do not fabricate a plausible-sounding drug name that wasn't indicated
- Apply the same correction logic to medical/anatomical terms, lab test names, and condition names throughout the summary

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
    
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_parseError) {
      return res.status(422).json({ error: 'A reliable summary could not be created from this recording. Please review the transcript and try again.' });
    }
    
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

app.post('/local-resources', requireAuth, async (req, res) => {
  const city = String(req.body?.city || '').trim().slice(0, 120);
  const diagnosis = String(req.body?.diagnosis || '').trim().slice(0, 12000);
  const recommendations = Array.isArray(req.body?.recommendations) ? req.body.recommendations.slice(0, 20) : [];
  if (!city || !diagnosis) return res.status(400).json({ error: 'A location and visit summary are required.' });

  const prompt = `You are a Canadian health resource specialist. Return ONLY a JSON object with one key named "resources" containing 6-8 relevant resources.
Patient location: ${city}
Visit summary: ${diagnosis}
Provider recommendations: ${recommendations.join(', ')}
Include verified local resources when confident, relevant provincial/state resources, national Canadian organizations, and relevant US resources only when the location is in the United States.
Each resource must contain: name, description, contact, and type (local, provincial, national, or online).
Never invent an organization, URL, or telephone number. If a specific local service cannot be verified from existing model knowledge, provide a recognized directory or official health-system resource instead.
Required JSON shape: {"resources":[{"name":"...","description":"...","contact":"...","type":"..."}]}`;

  try {
    const response = await requestSummaryModel({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
    const providerPayload = await response.json();
    if (providerPayload.error) throw new Error(providerPayload.error.message || 'Resource search failed.');
    const raw = providerPayload.content?.map((block) => block.text || '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    const resources = Array.isArray(parsed.resources) ? parsed.resources.slice(0, 8) : [];
    res.json({ resources });
  } catch (error) {
    console.error('Local resource request failed:', error.message);
    res.status(422).json({ error: 'Local resources could not be generated right now. Your visit summary is still available.' });
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
      console.error('SRFax API error:', result.Result);
      return res.status(500).json({ error: result.Result || 'Fax failed' });
    }
    res.json({ success: true, faxDetailsId: result.Result });
  } catch (error) {
    console.error('Fax error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError || /Only audio recordings/.test(error.message || '')) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The recording is too large to upload safely.'
      : error.message;
    return res.status(413).json({ error: message });
  }
  console.error('Unhandled request error:', error.message);
  res.status(500).json({ error: 'The request could not be completed.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));
