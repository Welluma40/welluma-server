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
          content: `You are a medical visit assistant. Analyze this transcript and return ONLY a raw JSON object with these exact keys:
- summary: string
- recommendations: array of strings
- medications: array of strings (just name and dose, e.g. "Lisinopril 10mg daily")
- followUp: string
- resources: array of 4-8 objects each with "label" and "url"

RESOURCE SELECTION RULES - read carefully and follow exactly:

Scan the transcript for these topic categories and include the matching source for EACH category that applies:

1. If the transcript mentions ANY mental health topic (anxiety, depression, stress, substance use, addiction, alcohol, drugs, mood, sleep issues related to mental health) -> MUST include a link to https://www.camh.ca/ (Centre for Addiction and Mental Health)

2. If the transcript mentions ANY pediatric/child topic (child, kid, infant, baby, teenager, pediatric, vaccination schedule for children) -> MUST include a link to https://caringforkids.cps.ca/ AND a link to https://www.cheo.on.ca/

3. If the transcript mentions ANY medication by name -> MUST include a link to https://www.drugs.com/search.php?searchterm=MEDICATION_NAME for that specific medication, replacing MEDICATION_NAME with the medication name (use + instead of spaces, e.g. https://www.drugs.com/search.php?searchterm=metformin)

4. If the transcript mentions a complex/specialized condition (cancer, transplant, rare disease, complex surgery) -> MUST include a link to https://www.uhn.ca/

5. If the transcript mentions heart/cardiovascular topics (blood pressure, hypertension, cholesterol, heart disease, cardiac) -> MUST include a link to https://www.heart.org/

6. If the transcript mentions diabetes or blood sugar -> MUST include a link to https://www.diabetes.ca/

7. If the transcript mentions PCOS -> MUST include a link to https://www.pcosaa.org/

8. For general conditions not covered above, OR in addition to the above -> use https://www.mayoclinic.org/search/search-results?q=TOPIC or https://medlineplus.gov/search/?query=TOPIC, replacing TOPIC with the relevant search term (use + instead of spaces)

9. For clinical/treatment guideline information -> https://www.medscape.com/ is appropriate

CRITICAL: Every URL you provide must be EXACTLY one of the homepage URLs listed above, OR a search URL built using the exact patterns shown for drugs.com, Mayo Clinic, and MedlinePlus. NEVER invent or guess a specific article/page path (for example, never produce something like https://www.heart.org/en/health-topics/some-page) - these specific paths frequently do not exist and result in broken "page not found" links.

IMPORTANT: Do not default to only Mayo Clinic and MedlinePlus. Actively scan for the specific categories above and prioritize those specialized sources. Most visits should have a MIX of source types, not just general sources.

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
