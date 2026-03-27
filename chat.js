// chat.js — Claude as the brain
// Flow: user message → extract params → fetch raw flights → Claude analyses → reply

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, pendingFlights, originalRequest } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid messages' });

  const today = new Date().toISOString().split('T')[0];

  // Phase 2: Claude analyses raw flight results against what user asked
  if (pendingFlights && originalRequest) {
    return await analyseFlights(pendingFlights, originalRequest, messages, res);
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
- "anytime in June" → departDate: 2026-06-01, flexDays: 14
- "over the next 2 months" → departDate: today + 7 days, flexDays: 14
- "flexible dates" or "cheapest dates" → flexDays: 7
- Exact dates mentioned → flexDays: 0
- No flexibility mentioned → flexDays: 0

STAY DURATION RULES:
- "1 week" → stayDays: 7, returnDate = departDate + 7
- "2 weeks" → stayDays: 14
- "1 month" → stayDays: 30
- "10 days" → stayDays: 10
- Exact return date given → calculate stayDays as the difference

Be friendly and concise — 1 sentence before triggering search.
Only ask a question if destination is completely unclear.

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

async function analyseFlights(flights, originalRequest, messages, res) {
  // Send raw flights to Claude and ask it to analyse against what user asked
  const flightSummary = flights.map(f =>
    `${f.carrierName} (${f.carrierCode}) | Tier ${f.tier} | ${f.stops === 0 ? 'Direct' : `1 stop via ${f.stopoverCity} (${f.stopoverRegion})`} | Departs ${f.departureDate} ${f.departureTime} | Returns ${f.returnDate} | Stay: ${f.stayDays} days | Duration: ${f.duration} | A$${f.pricePerPax}/person | Trend: ${f.trendNote}`
  ).join('\n');

  const analysisPrompt = `You are a flight search assistant. A user asked: "${originalRequest}"

Here are ALL available flights from our search:
${flightSummary}

Your job:
1. Read what the user asked carefully — note any specific requirements (stopover location, airline preference, travel time, departure time, budget, etc.)
2. Filter the flights to only those that match the user's requirements
3. If NO flights match a specific requirement, clearly say so and show the closest alternatives with an explanation
4. Rank the matching flights from best to worst value
5. Give a clear recommendation in plain English

Return your response in this exact JSON format:
{
  "message": "Your conversational response to the user — explain what you found, flag anything that couldn't be matched, give your recommendation. Be specific and helpful.",
  "warning": "If any requirement couldn't be matched, explain it here briefly. Empty string if everything matched.",
  "rankedFlights": ["carrierCode1_departDate1", "carrierCode2_departDate2"]
}

The rankedFlights array should contain flight IDs in order of your recommendation (best first).
Flight IDs are in format: mock_CARRIERCODE_VARIANT_DATE (e.g. mock_QR_0_2026-06-01)

Be honest. If the user asked for US stopovers and none exist, say so clearly before showing alternatives.`;

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
        messages: [{ role: 'user', content: analysisPrompt }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic analysis error: ${response.status}`);
    const data = await response.json();
    const text = data.content[0].text;

    // Parse Claude's JSON response
    let analysis = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Analysis parse error:', e);
    }

    if (!analysis) {
      // Fallback if JSON parsing fails
      return res.status(200).json({
        reply: text,
        warning: '',
        rankedFlights: flights.slice(0, 10),
      });
    }

    // Re-order flights based on Claude's ranking
    let rankedFlights = flights;
    if (analysis.rankedFlights && analysis.rankedFlights.length > 0) {
      const ordered = [];
      analysis.rankedFlights.forEach(id => {
        const match = flights.find(f => f.id === id || f.id.includes(id));
        if (match) ordered.push(match);
      });
      // Add any flights Claude didn't rank at the end
      flights.forEach(f => {
        if (!ordered.find(o => o.id === f.id)) ordered.push(f);
      });
      rankedFlights = ordered;
    }

    return res.status(200).json({
      reply: analysis.message,
      warning: analysis.warning || '',
      rankedFlights: rankedFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
    });

  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message });
  }
}
