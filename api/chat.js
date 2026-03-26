// api/chat.js — Vercel Serverless Function
// Handles AI chat using Anthropic Claude

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages format' });
  }

  try {
    const systemPrompt = `You are a helpful flight search assistant for Chatflight, an AI-powered flight finder. 
Your job is to help users find the cheapest flights that match their needs.

When a user describes what they want, extract the following search parameters if present:
- origin: IATA airport code (e.g. SYD for Sydney)
- destination: IATA airport code (e.g. LHR for London Heathrow)
- departDate: departure date in YYYY-MM-DD format
- returnDate: return date in YYYY-MM-DD format (if round trip)
- flexDays: date flexibility in days (default 3 if user wants cheapest)
- passengers: number of adult passengers (default 1)
- cabin: economy / premium_economy / business / first
- maxStops: 0 for direct, 1 for max 1 stop, "any" for no preference

Common airport codes:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG
New York=JFK, Los Angeles=LAX, Dubai=DXB, Doha=DOH

Always respond conversationally and helpfully. If you have enough information to search, 
respond with a JSON block at the END of your message in this exact format:
SEARCH_PARAMS:{"origin":"SYD","destination":"LHR","departDate":"2026-06-10","returnDate":"2026-06-25","flexDays":3,"passengers":1,"cabin":"economy","maxStops":"1"}

If you need more information, ask ONE clear question. Keep responses concise and friendly.
Never make up flight prices or availability — the search system will find real options.
If asked about airline quality, use this guide:
- Tier A (Premium): Qatar Airways, Emirates, Singapore Airlines, Qantas, Cathay Pacific, ANA, JAL, Lufthansa, BA, Air France
- Tier B (Quality): Malaysian Airlines, Turkish Airlines, KLM, Air India, Ethiopian Airlines, SriLankan
- Tier C (Budget): AirAsia X, budget carriers`;

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
        system: systemPrompt,
        messages: messages.slice(-10) // keep last 10 messages for context
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const data = await response.json();
    const fullReply = data.content[0].text;

    // Extract search params if present
    let searchParams = null;
    let reply = fullReply;

    const searchMatch = fullReply.match(/SEARCH_PARAMS:(\{.*?\})/s);
    if (searchMatch) {
      try {
        searchParams = JSON.parse(searchMatch[1]);
        // Remove the JSON block from the visible reply
        reply = fullReply.replace(/SEARCH_PARAMS:\{.*?\}/s, '').trim();
      } catch (e) {
        console.error('Failed to parse search params', e);
      }
    }

    return res.status(200).json({ reply, searchParams });

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}
