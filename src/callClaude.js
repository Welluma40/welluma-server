const callClaude = async (transcript) => {
  const response = await fetch(`${process.env.REACT_APP_API_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript })
  });
  if (!response.ok) throw new Error('Analysis failed');
  return response.json();
};

export default callClaude;
