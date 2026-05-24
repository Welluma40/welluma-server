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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are a compassionate medical visit assistant. Analyze the transcript and provide a JSON response with these keys: summary, recommendations (array), medications (array), followUp, topics (array). Return ONLY valid JSON, no markdown.`,
        messages: [{ role: 'user', content: `Transcript: ${transcript}` }]
      })
    });
    
    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('');
    res.json(JSON.parse(text));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Welluma server running on port ${PORT}`));
