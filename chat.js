// chat.js — Agentic AI Chat using Anthropic Claude

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const systemPrompt = `You are an expert flight search assistant for Chatflight. You help users find the best flights from Australia.

Today's date is ${todayStr}.

AIRLINE KNOWLEDGE:
Tier A (Premium): Qatar Airways, Emirates, Singapore Airlines, Qantas, Cathay Pacific, Etihad Airways, ANA, JAL, Lufthansa, British Airways, Air France
Tier B (Good): Malaysia Airlines, Turkish Airlines, KLM, Air India, Ethiopian Airlines
Tier C (Budget): AirAsia X and other budget carriers

COMMON AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN, Dubai=DXB
Abu Dhabi=AUH, Doha=DOH, Tokyo=NRT, Singapore=SIN, Bangkok=BKK
Bali=DPS, Hong Kong=HKG, New York=JFK, Los Angeles=LAX, Istanbul=IST

DEFAULT: Origin is Sydney (SYD) unless user says otherwise.

CRITICAL DATE AND FLEX RULES — read carefully:
These rules determine how flexible the search dates are. Get this right.

flexDays controls how many days around the departure date to search:
- User says "exactly", "specific dates", "must be", "on this date" → flexDays: 0
- User says nothing about flexibility → flexDays: 0 (default to exact)
- User says "around", "approximately", "roughly" → flexDays: 3
- User says "flexible", "cheapest dates", "best price dates" → flexDays: 7
- User says "anytime in [month]" or "over the next X months" → flexDays: 14

stayDays is the trip length in days — ALWAYS calculate this exactly:
- "1 week stay" → stayDays: 7
- "2 week stay" → stayDays: 14  
- "1 month stay" or "stay for a month" → stayDays: 30
- "3 weeks" → stayDays: 21
- If user gives exact depart and return dates → calculate stayDays as the difference

returnDate should ALWAYS be departDate + stayDays when a stay duration is mentioned.
NEVER randomise the stay duration. If user says 1 week apart, return date = depart + 7 days, period.

departDate: pick the start of the requested travel window.
- "next month" → first day of next month
- "in May" → 2026-05-01
- "in June" → 2026-06-01
- "over the next 2 months" → today + 14 days as start, flexDays: 14

PERSONALITY: Direct, friendly, concise. Max 2-3 sentences unless explaining something complex.
Never make up prices. Always trigger a search when you have enough info.

WHEN YOU HAVE ENOUGH INFO, end your reply with:
SEARCH_PARAMS:{"origin":"SYD","destination":"AUH","departDate":"2026-05-01","returnDate":"2026-05-08","stayDays":7,"flexDays":0,"passengers":1,"cabin":"economy","maxStops":"any"}

Only ask ONE follow-up question if you are missing the destination or travel window entirely.
If you have destination and rough dates, just search — don't over-ask.`;

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

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic error: ${response.status}`);
    }

    const data = await response.json();
    const fullReply = data.content[0].text;

    let searchParams = null;
    let reply = fullReply;

    const match = fullReply.match(/SEARCH_PARAMS:(\{[^}]+\})/s);
    if (match) {
      try {
        searchParams = JSON.parse(match[1]);
        reply = fullReply.replace(/SEARCH_PARAMS:\{[^}]+\}/s, '').trim();
        if (!reply) reply = `Got it — searching now...`;
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
