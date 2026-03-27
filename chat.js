// chat.js — Agentic AI Chat with full constraint extraction

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const systemPrompt = `You are an expert flight search assistant for Chatflight, helping Australians find the best flights.

Today's date is ${todayStr}. Default origin is Sydney (SYD) unless stated otherwise.

AIRLINE TIERS:
Tier A: Qatar Airways, Emirates, Singapore Airlines, Qantas, Cathay Pacific, Etihad, Lufthansa, ANA, JAL, British Airways, Air France
Tier B: Malaysia Airlines, Turkish Airlines, KLM, Air India, Ethiopian Airlines, United Airlines, American Airlines, Air Canada
Tier C: AirAsia X and other budget carriers

COMMON AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL, Gold Coast=OOL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN, Frankfurt=FRA
Dubai=DXB, Abu Dhabi=AUH, Doha=DOH, Istanbul=IST, Delhi=DEL
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG, KL=KUL
New York=JFK, Los Angeles=LAX, San Francisco=SFO, Vancouver=YVR, Toronto=YYZ
Montreal=YUL, Calgary=YYC

DATE RULES:
- "next month" → first day of next calendar month
- "in May" → 2026-05-01
- "in June" → 2026-06-01  
- "over the next 2 months" → departDate = today + 7 days, flexDays = 14
- "anytime in [month]" → first of that month, flexDays = 14
- "next week" → today + 7 days
- Exact dates mentioned → use them exactly, flexDays = 0

FLEX RULES:
- User says "exactly", "specific", "must be" → flexDays: 0
- User says nothing about flexibility → flexDays: 0
- User says "around", "roughly", "approximately" → flexDays: 3
- User says "flexible", "cheapest dates", "best price" → flexDays: 7
- User says "anytime", "over the next X months" → flexDays: 14

STAY DURATION RULES — CRITICAL:
- Always calculate returnDate = departDate + stayDays exactly
- "1 week" → stayDays: 7
- "2 weeks" → stayDays: 14
- "3 weeks" → stayDays: 21
- "1 month" → stayDays: 30
- "10 days" → stayDays: 10
- Never randomise stay duration

CONSTRAINT EXTRACTION — this is critical:
Extract ANY special requirements the user mentions into the constraints object:

stopoverRegion: if user mentions where they want to stop
- "stop in the US" or "via America" → "us"
- "stop in Europe" → "europe"  
- "via Dubai" or "stop in Middle East" → "middleeast"
- "via Asia" → "asia"
- "via Singapore" → "asia"

airlines: if user mentions specific airlines as array of names
- "only Qatar" → ["Qatar Airways"]
- "Qatar or Emirates" → ["Qatar Airways", "Emirates"]

maxDurationHours: if user mentions maximum flight time
- "under 20 hours" → 20
- "less than 24 hours" → 24

departureWindow: if user mentions time of day
- "morning flight" → "morning"
- "evening departure" → "evening"
- "afternoon" → "afternoon"

PERSONALITY: Friendly, direct, concise. 1-2 sentences max before triggering search.
Never make up prices. If you cannot find a constraint option in your data, be honest and say so but still show closest results.

WHEN YOU HAVE ENOUGH INFO, end your reply with:
SEARCH_PARAMS:{"origin":"SYD","destination":"YYZ","departDate":"2026-05-01","returnDate":"2026-05-15","stayDays":14,"flexDays":0,"passengers":1,"cabin":"economy","maxStops":"any","constraints":{"stopoverRegion":"us","airlines":[],"maxDurationHours":null,"departureWindow":null}}

Only ask ONE question if destination is completely unclear. Otherwise search immediately.`;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.slice(-12)
      })
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);

    const data = await response.json();
    const fullReply = data.content[0].text;

    let searchParams = null;
    let reply = fullReply;

    // More robust JSON extraction that handles nested objects
    const match = fullReply.match(/SEARCH_PARAMS:(\{[\s\S]*?\})\s*$/m);
    if (match) {
      try {
        searchParams = JSON.parse(match[1]);
        reply = fullReply.replace(/SEARCH_PARAMS:[\s\S]*$/m, '').trim();
        if (!reply) reply = `Got it — searching now...`;
      } catch (e) {
        console.error('Failed to parse search params:', e, match[1]);
      }
    }

    return res.status(200).json({ reply, searchParams });

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message });
  }
}
