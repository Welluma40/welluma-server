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
- summary: plain language summary string
- recommendations: array of strings
- medications: array of strings
- followUp: string
- resources: array of objects with keys "label" (friendly name) and "url" (real Mayo Clinic URL). Include 3-6 resources relevant to ALL conditions, medications, tests, and abbreviations mentioned. For example if PCOS is mentioned use https://www.mayoclinic.org/diseases-conditions/pcos/symptoms-causes/syc-20353439. If A1C is mentioned use diabetes URL. If TSH is mentioned use thyroid URL. Always use real valid mayoclinic.org URLs.

Transcript: ${transcript}`
        }]
      })
    });
    
    const text = await response.text();
    const data = JSON.parse(text);
    
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }
    
    const content = data.content?.map(b => b.text || '').join('');
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));
