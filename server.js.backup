const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/analyze', async (req, res) => {
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

CANADIAN RESOURCE SELECTION RULES - read carefully and follow exactly:

Scan the transcript for these topic categories and include the matching source for EACH category that applies:

1. If the transcript mentions ANY mental health topic (anxiety, depression, stress, substance use, addiction, alcohol, drugs, mood, sleep issues related to mental health) -> MUST include https://www.camh.ca/ (Centre for Addiction and Mental Health) AND https://cmha.ca/ (Canadian Mental Health Association)

2. If the transcript mentions ANY pediatric/child topic (child, kid, infant, baby, teenager, pediatric, vaccination) -> MUST include https://caringforkids.cps.ca/ (Canadian Paediatric Society) AND https://www.cheo.on.ca/

3. If the transcript mentions ANY medication by name -> MUST include https://www.drugs.com/search.php?searchterm=MEDICATION_NAME replacing MEDICATION_NAME with the medication (use + for spaces)

4. If the transcript mentions cancer -> MUST include https://www.cancer.ca/ (Canadian Cancer Society)

5. If the transcript mentions heart/cardiovascular topics (blood pressure, hypertension, cholesterol, heart disease, cardiac, stroke) -> MUST include https://www.heartandstroke.ca/ (Heart & Stroke Foundation of Canada) AND if hypertension specifically -> also include https://hypertension.ca/ (Hypertension Canada)

6. If the transcript mentions diabetes or blood sugar -> MUST include https://www.diabetes.ca/ (Diabetes Canada)

7. If the transcript mentions lung/respiratory topics (asthma, COPD, emphysema, bronchitis) -> MUST include https://www.lung.ca/ (Canadian Lung Association)

8. If the transcript mentions PCOS -> MUST include https://www.pcosaa.org/

9. If the transcript mentions osteoporosis or bone density -> MUST include https://osteoporosis.ca/ (Osteoporosis Canada)

10. If the transcript mentions arthritis -> MUST include https://arthritis.ca/ (Arthritis Society Canada)

11. If the transcript mentions kidney disease -> MUST include https://kidney.ca/ (Kidney Foundation of Canada)

12. If the transcript mentions Alzheimer's or dementia -> MUST include https://alzheimer.ca/ (Alzheimer Society of Canada)

13. If the transcript mentions a complex/specialized condition (transplant, rare disease, complex surgery) -> MUST include https://www.uhn.ca/

14. For general conditions not covered above -> use https://www.mayoclinic.org/search/search-results?q=TOPIC or https://medlineplus.gov/search/?query=TOPIC replacing TOPIC with relevant search term (use + for spaces)

15. For drug/medication information -> https://www.healthlinkbc.ca/ is a trusted Canadian source

16. For clinical guidelines -> https://www.canada.ca/en/health-canada.html (Health Canada) is appropriate for Canadian guideline context

CRITICAL: Every URL must be EXACTLY one of the homepage URLs listed above, OR a search URL built using the exact patterns shown. NEVER invent or guess a specific article/page path.

IMPORTANT: Prioritize Canadian organizations over American ones in all cases. Most visits should have a MIX of source types.

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));