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
- medications: array of strings (each string is just the medication name and dose, example: "Lisinopril 10mg daily")
- followUp: string
- resources: array of objects each with exactly two keys: "label" (string) and "url" (string)

Return ONLY the JSON object. No markdown, no backticks, no explanation, nothing else.

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
    
    // Force medications to be simple strings
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
