const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/analyze', async (req, res) => {
  const { transcript } = req.body;
  console.log('Received request');
  console.log('API Key set:', !!process.env.ANTHROPIC_API_KEY);
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Analyze this medical visit transcript and return ONLY a JSON object with keys: summary, recommendations, medications, followUp, topics. No markdown.\n\n${transcript}`
        }]
      })
    });
    
    const text = await response.text();
    console.log('Raw response:', text);
    
    const data = JSON.parse(text);
    
    if (data.error) {
      console.error('API Error:', JSON.stringify(data.error));
      return res.status(500).json({ error: data.error.message });
    }
    
    const content = data.content?.map(b => b.text || '').join('');
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (error) {
    console.error('Caught error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));
