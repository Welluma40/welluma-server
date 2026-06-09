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
          content: `You are a medical visit assistant. Analyze this transcript and return ONLY a raw JSON object with these exact keys: summary, recommendations (array), medications (array), followUp, resources (array of objects with label and url). Choose 4-8 resources from these trusted sources based on what was discussed: Mayo Clinic (mayoclinic.org), NIH MedlinePlus (medlineplus.gov), CDC (cdc.gov), Caring for Kids CPS (caringforkids.cps.ca) for pediatric topics, CHEO (cheo.on.ca) for child health, University Health Network (uhn.ca) for complex conditions, CAMH (camh.ca) for mental health and addiction, Drugs.com (drugs.com) for medications, Medscape (medscape.com) for clinical info, American Heart Association (heart.org) for heart conditions, Diabetes Canada (diabetes.ca) for diabetes, PCOS Awareness Association (pcosaa.org) for PCOS. Always include at least one Mayo Clinic or NIH link. Transcript: ${transcript}`
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
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));
