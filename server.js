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

1. If the transcript mentions ANY mental health topic (anxiety, depression, stress, substance use, addiction, alcohol, drugs, mood, sleep issues related to mental health) -> MUST include a link from camh.ca (Centre for Addiction and Mental Health)

2. If the transcript mentions ANY pediatric/child topic (child, kid, infant, baby, teenager, pediatric, vaccination schedule for children) -> MUST include a link from caringforkids.cps.ca AND a link from cheo.on.ca

3. If the transcript mentions ANY medication by name -> MUST include a link from drugs.com for that specific medication

4. If the transcript mentions a complex/specialized condition (cancer, transplant, rare disease, complex surgery) -> MUST include a link from uhn.ca

5. If the transcript mentions heart/cardiovascular topics (blood pressure, hypertension, cholesterol, heart disease, cardiac) -> MUST include a link from heart.org

6. If the transcript mentions diabetes or blood sugar -> MUST include a link from diabetes.ca

7. If the transcript mentions PCOS -> MUST include a link from pcosaa.org

8. For general conditions not covered above, OR in addition to the above -> use mayoclinic.org or medlineplus.gov

9. For clinical/treatment guideline information -> medscape.com is appropriate

IMPORTANT: Do not default to only Mayo Clinic and NIH. Actively scan for the specific categories above and prioritize those specialized sources. Most visits should have a MIX of source types, not just general sources.

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
