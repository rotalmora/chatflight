// chat.js — Claude as the brain, isolated analysis phase

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, pendingFlights, originalRequest } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });

  const today = new Date().toISOString().split('T')[0];

  // Phase 2: Claude analyses raw flights — completely isolated, no chat history
  if (pendingFlights && originalRequest) {
    return await analyseFlights(pendingFlights, originalRequest, res);
  }

  // Phase 1: Claude understands user intent and extracts search params
  const systemPrompt = `You are an expert flight search assistant for Chatflight, helping Australians find the best value flights.

Today's date is ${today}. Default origin is Sydney (SYD) unless stated otherwise.

AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN, Frankfurt=FRA
Dubai=DXB, Abu Dhabi=AUH, Doha=DOH, Istanbul=IST
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG, KL=KUL
New York=JFK, Los Angeles=LAX, San Francisco=SFO
Toronto=YYZ, Vancouver=YVR, Montreal=YUL, Calgary=YYC

DATE RULES:
- "in June" → departDate: 2026-06-01, flexDays: 0
- "next month" → first day of next month, flexDays: 0
- "anytime in June" or "sometime in June" → departDate: 2026-06-01, flexDays: 14
- "over the next 2 months" → departDate: ${today}, flexDays: 14
- "flexible dates" or "cheapest dates" → flexDays: 7
- Exact dates mentioned → flexDays: 0
- No flexibility mentioned → flexDays: 0

STAY DURATION:
- "1 week" → stayDays: 7, returnDate = departDate + 7
- "2 weeks" → stayDays: 14
- "1 month" → stayDays: 30
- "10 days" → stayDays: 10
- Exact return date given → calculate stayDays as difference
- No return mentioned → stayDays: 14

Be friendly and concise — 1 sentence max before triggering search.
Only ask a question if destination is completely missing.

When ready to search, end your message with:
SEARCH_PARAMS:{"origin":"SYD","destination":"YYZ","departDate":"2026-06-01","returnDate":"2026-06-15","stayDays":14,"flexDays":0,"passengers":1,"cabin":"economy"}`;

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
        max_tokens: 512,
        system: systemPrompt,
        messages: messages.slice(-10)
      })
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
    const data = await response.json();
    const fullReply = data.content[0].text;

    let searchParams = null;
    let reply = fullReply;

    const match = fullReply.match(/SEARCH_PARAMS:(\{[^}]+\})/);
    if (match) {
      try {
        searchParams = JSON.parse(match[1]);
        reply = fullReply.replace(/SEARCH_PARAMS:\{[^}]+\}/, '').trim();
        if (!reply) reply = 'Searching now...';
      } catch (e) {
        console.error('Parse error:', e);
      }
    }

    return res.status(200).json({ reply, searchParams });

  } catch (err) {
    console.error('Chat phase 1 error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function analyseFlights(flights, originalRequest, res) {
  // This runs in complete isolation — no chat history, just the task
  const flightList = flights.map((f, i) =>
    `[${i}] ID:${f.id} | ${f.carrierName} (${f.carrierCode}) | Tier:${f.tier} | ${f.stops === 0 ? 'Direct' : `Stop in ${f.stopoverCity}, ${f.stopoverRegion}`} | Departs:${f.departureDate} ${f.departureTime} | Returns:${f.returnDate} | Stay:${f.stayDays}d | Duration:${f.duration} | A$${f.pricePerPax}/person | Trend:${f.trendNote}`
  ).join('\n');

  const prompt = `A user searched for flights with this request: "${originalRequest}"

Here are all available flights:
${flightList}

Instructions:
1. Read the user's request carefully — note every requirement (stopover location, preferred airlines, max duration, departure time, budget, tier preference, etc.)
2. Filter to flights that match. If user said "stop in the US", only include flights with US stopovers.
3. If NO flights match a specific requirement, clearly explain this and show the best alternatives anyway.
4. Rank matching flights best to worst value considering price, tier, stops and what the user asked for.
5. Write a friendly 2-3 sentence summary of what you found and your top recommendation.

Respond in this exact JSON format with no text before or after:
{
  "message": "Your 2-3 sentence friendly summary and recommendation here",
  "warning": "Brief explanation if any requirement could not be matched, empty string if all matched",
  "rankedIds": ["ID_OF_BEST_FLIGHT", "ID_OF_SECOND_BEST", "ID_OF_THIRD_BEST"]
}

rankedIds should be the actual flight ID values from the list above (the ID: field), ordered best first. Include up to 12.`;

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
        // Fresh isolated conversation — no history pollution
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error(`Analysis error: ${response.status}`);
    const data = await response.json();
    const text = data.content[0].text.trim();

    // Robust JSON extraction — handles extra text around the JSON
    let analysis = null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        analysis = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('JSON parse failed:', e);
      }
    }

    // Re-order flights based on Claude's ranking
    let rankedFlights = [...flights];
    if (analysis?.rankedIds && analysis.rankedIds.length > 0) {
      const ordered = [];
      analysis.rankedIds.forEach(id => {
        const found = flights.find(f => f.id === id);
        if (found) ordered.push(found);
      });
      // Append any unranked flights at the end
      flights.forEach(f => {
        if (!ordered.find(o => o.id === f.id)) ordered.push(f);
      });
      rankedFlights = ordered;
    }

    rankedFlights = rankedFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 }));

    return res.status(200).json({
      reply: analysis?.message || 'Here are the best flights matching your request.',
      warning: analysis?.warning || '',
      rankedFlights,
    });

  } catch (err) {
    console.error('Analysis error:', err);
    // Fallback — always return flights even if analysis fails
    return res.status(200).json({
      reply: 'Here are the available flights for your search.',
      warning: '',
      rankedFlights: flights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
    });
  }
}
