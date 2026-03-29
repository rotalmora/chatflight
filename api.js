// api.js — Chatflight powered by Serpapi (Google Flights)
// Simple architecture: query Serpapi → get all flights → Claude summarises

const AIRLINE_TIERS = {
  'Qatar Airways': 'A', 'Emirates': 'A', 'Singapore Airlines': 'A',
  'Qantas': 'A', 'Cathay Pacific': 'A', 'Etihad Airways': 'A',
  'Lufthansa': 'A', 'British Airways': 'A', 'Air France': 'A',
  'ANA': 'A', 'Japan Airlines': 'A', 'Virgin Australia': 'A',
  'Malaysia Airlines': 'B', 'Turkish Airlines': 'B', 'KLM': 'B',
  'Air India': 'B', 'Ethiopian Airlines': 'B', 'China Eastern': 'B',
  'China Southern': 'B', 'Korean Air': 'B', 'Thai Airways': 'B',
  'United Airlines': 'B', 'American Airlines': 'B', 'Air Canada': 'B',
  'SriLankan Airlines': 'B', 'Oman Air': 'B',
  'AirAsia X': 'C', 'Scoot': 'C', 'Jetstar': 'C',
};

function getAirlineTier(name) {
  if (!name) return 'B';
  for (const [airline, tier] of Object.entries(AIRLINE_TIERS)) {
    if (name.toLowerCase().includes(airline.toLowerCase())) return tier;
  }
  return 'B';
}

function minsToHours(mins) {
  if (!mins) return 'N/A';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── SERPAPI SEARCH ───────────────────────────────────────────────────────────

async function serpapiSearch(params) {
  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('api_key', process.env.SERPAPI_KEY);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'au');
  url.searchParams.set('currency', 'AUD');

  for (const [key, val] of Object.entries(params)) {
    if (val !== null && val !== undefined) url.searchParams.set(key, val);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Serpapi error: ${response.status} — ${err}`);
  }
  return response.json();
}

function parseSerpapiFlights(data, returnDate, stayDays) {
  const allFlights = [
    ...(data.best_flights || []),
    ...(data.other_flights || []),
  ];

  return allFlights.map((flight, i) => {
    const legs = flight.flights || [];
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    const airlineName = firstLeg?.airline || 'Unknown';
    const stops = legs.length - 1;
    const stopoverCity = stops > 0 ? legs[0]?.arrival_airport?.name : null;
    const price = Math.round(flight.price || 0);

    return {
      id: `serp_${i}_${firstLeg?.departure_airport?.id}_${firstLeg?.departure_token || i}`,
      carrierName: airlineName,
      carrierCode: firstLeg?.airline_logo ? airlineName.substring(0, 2).toUpperCase() : '??',
      tier: getAirlineTier(airlineName),
      stops,
      stopoverCity: stops > 0 ? stopoverCity : null,
      stopoverRegion: null,
      departureDate: firstLeg?.departure_airport?.time?.split(' ')[0] || '',
      returnDate: returnDate || null,
      stayDays: stayDays || null,
      departureTime: firstLeg?.departure_airport?.time?.split(' ')[1]?.substring(0, 5) || '',
      arrivalTime: lastLeg?.arrival_airport?.time?.split(' ')[1]?.substring(0, 5) || '',
      duration: minsToHours(flight.total_duration),
      durationMins: flight.total_duration || 0,
      price,
      pricePerPax: price,
      currency: 'AUD',
      trend: 'stable',
      trendNote: '— Live price',
      departureToken: flight.departure_token || null,
      isBestFlight: (data.best_flights || []).includes(flight),
    };
  }).filter(f => f.price > 0);
}

// ─── SEARCH HANDLER ───────────────────────────────────────────────────────────

async function handleSearch(body) {
  const {
    origin = 'SYD',
    destination,
    departDate,
    returnDate,
    stayDays = 14,
    passengers = 1,
    cabin = 'economy',
  } = body;

  if (!destination || !departDate) {
    throw new Error('Destination and departure date are required.');
  }

  const cabinMap = {
    economy: '1',
    premium_economy: '2',
    business: '3',
    first: '4',
  };

  const actualReturn = returnDate || addDays(departDate, parseInt(stayDays));

  // Single Serpapi call for return flights
  const data = await serpapiSearch({
    departure_id: origin,
    arrival_id: destination,
    outbound_date: departDate,
    return_date: actualReturn,
    adults: parseInt(passengers),
    travel_class: cabinMap[cabin] || '1',
    type: '1', // 1 = round trip
  });

  const flights = parseSerpapiFlights(data, actualReturn, stayDays);

  return {
    flights,
    isMock: false,
    source: 'Google Flights via Serpapi',
  };
}

// ─── CHAT HANDLER ─────────────────────────────────────────────────────────────

async function handleChat(body) {
  const { messages, pendingFlights, originalRequest } = body;
  const today = new Date().toISOString().split('T')[0];

  // Phase 3: Claude analyses flight results
  if (pendingFlights && originalRequest) {
    if (!pendingFlights.length) {
      return {
        reply: "I couldn't find any flights for that search. Try different dates or a nearby airport.",
        warning: '',
        rankedFlights: [],
      };
    }

    const flightList = pendingFlights.slice(0, 25).map((f, i) =>
      `[${i + 1}] ID:${f.id} | ${f.carrierName} | Tier ${f.tier} | ${f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}${f.stopoverCity ? ' via ' + f.stopoverCity : ''}`} | Departs ${f.departureDate} ${f.departureTime} | Returns ${f.returnDate || 'N/A'} | ${f.duration} | A$${f.pricePerPax}/person${f.isBestFlight ? ' ★ Google best pick' : ''}`
    ).join('\n');

    const prompt = `User asked: "${originalRequest}"

Available return flights from Google Flights (already sorted cheapest first):
${flightList}

Your job:
1. Check if the user had any specific requirements (airline, stopover location, departure time, budget, tier preference)
2. If they did — filter to only matching flights. If none match, say so clearly and show the cheapest alternatives
3. If no specific requirements — just pick the best value options
4. Write a friendly 2-3 sentence summary highlighting the top pick and why

Respond in JSON only — no text before or after:
{
  "message": "2-3 sentence summary with clear top recommendation including price and airline",
  "warning": "If a specific requirement couldn't be matched, explain briefly. Empty string otherwise.",
  "rankedIds": ["id_of_best", "id_of_second", "id_of_third"]
}

rankedIds = the id field values, best first, up to 12.`;

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
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
      const data = await response.json();
      const text = data.content[0].text.trim();

      let analysis = null;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch (e) {}
      }

      let rankedFlights = [...pendingFlights];
      if (analysis?.rankedIds?.length > 0) {
        const ordered = [];
        analysis.rankedIds.forEach(id => {
          const f = pendingFlights.find(f => f.id === id);
          if (f) ordered.push(f);
        });
        pendingFlights.forEach(f => {
          if (!ordered.find(o => o.id === f.id)) ordered.push(f);
        });
        rankedFlights = ordered;
      }

      return {
        reply: analysis?.message || 'Here are the best flights found.',
        warning: analysis?.warning || '',
        rankedFlights: rankedFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
      };

    } catch (err) {
      // Fallback — show flights sorted by price, no AI commentary
      return {
        reply: `Found ${pendingFlights.length} flight options. Sorted by price — cheapest first.`,
        warning: '',
        rankedFlights: pendingFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
      };
    }
  }

  // Phase 1: Extract search intent
  const systemPrompt = `You are a flight search assistant for Chatflight, helping Australians find cheap flights.
Today: ${today}. Default origin: Sydney (SYD).

AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN, Frankfurt=FRA
Dubai=DXB, Abu Dhabi=AUH, Doha=DOH, Istanbul=IST
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG, KL=KUL
New York=JFK, Los Angeles=LAX, San Francisco=SFO
Toronto=YYZ, Vancouver=YVR, Montreal=YUL, Calgary=YYC

DATE RULES — pick a single best departure date:
- "in May" or "sometime in May" → departDate: 2026-05-15 (middle of month)
- "early May" → departDate: 2026-05-05
- "late May" → departDate: 2026-05-25
- "next month" → middle of next month
- exact date given → use it exactly
- no date → today + 30 days

STAY RULES:
- "1 week" → stayDays: 7
- "2 weeks" → stayDays: 14
- "3 weeks" → stayDays: 21
- "1 month" or "30 days" → stayDays: 30
- no stay mentioned → stayDays: 14

CABIN:
- "business" → cabin: business
- "first class" → cabin: first
- "premium economy" → cabin: premium_economy
- default → cabin: economy

Be friendly, 1 sentence. Only ask if destination is completely unclear.

When ready end with:
SEARCH_PARAMS:{"origin":"SYD","destination":"AUH","departDate":"2026-05-15","stayDays":21,"passengers":1,"cabin":"economy"}`;

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
        reply = fullReply.replace(/SEARCH_PARAMS:\{[^}]+\}/, '').trim() || 'Searching Google Flights now...';
      } catch (e) {}
    }

    return { reply, searchParams };

  } catch (err) {
    throw new Error(`Chat error: ${err.message}`);
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ...body } = req.body;

  try {
    if (action === 'search') {
      const result = await handleSearch(body);
      return res.status(200).json(result);
    } else if (action === 'chat') {
      const result = await handleChat(body);
      return res.status(200).json(result);
    } else {
      return res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (err) {
    console.error(`Error [${action}]:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
