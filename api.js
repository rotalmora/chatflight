// api.js — Chatflight powered by Serpapi
// Features: parallel city search, hard code filters, two-section results

const AIRLINE_TIERS = {
  'Qatar Airways': 'A', 'Emirates': 'A', 'Singapore Airlines': 'A',
  'Qantas': 'A', 'Cathay Pacific': 'A', 'Etihad Airways': 'A',
  'Lufthansa': 'A', 'British Airways': 'A', 'Air France': 'A',
  'ANA': 'A', 'Japan Airlines': 'A', 'Virgin Australia': 'A',
  'Swiss': 'A', 'Austrian Airlines': 'A', 'Finnair': 'A',
  'Malaysia Airlines': 'B', 'Turkish Airlines': 'B', 'KLM': 'B',
  'Air India': 'B', 'Ethiopian Airlines': 'B', 'China Eastern': 'B',
  'China Southern': 'B', 'Korean Air': 'B', 'Thai Airways': 'B',
  'United Airlines': 'B', 'American Airlines': 'B', 'Air Canada': 'B',
  'SriLankan Airlines': 'B', 'Oman Air': 'B', 'Royal Jordanian': 'B',
  'AirAsia X': 'C', 'Scoot': 'C', 'Jetstar': 'C',
};

// Region definitions for stopover filtering
const STOPOVER_REGIONS = {
  us: ['LAX', 'JFK', 'SFO', 'ORD', 'DFW', 'MIA', 'SEA', 'BOS', 'ATL', 'DEN', 'united states', 'america', 'usa'],
  middleeast: ['DXB', 'AUH', 'DOH', 'AMM', 'CAI', 'BAH', 'KWI', 'dubai', 'abu dhabi', 'doha', 'middle east'],
  asia: ['SIN', 'BKK', 'HKG', 'KUL', 'NRT', 'ICN', 'PVG', 'DEL', 'singapore', 'bangkok', 'hong kong', 'asia'],
  europe: ['LHR', 'CDG', 'FRA', 'AMS', 'IST', 'ZRH', 'MUC', 'london', 'paris', 'frankfurt', 'europe'],
  canada: ['YYZ', 'YVR', 'YUL', 'YYC', 'toronto', 'vancouver', 'canada'],
};

// Popular city groups for region searches
const REGION_CITIES = {
  europe: ['LHR', 'CDG', 'FCO', 'AMS', 'ATH', 'BCN', 'MAD', 'LIS', 'VIE', 'ZRH'],
  asia: ['SIN', 'BKK', 'HKG', 'NRT', 'ICN', 'KUL', 'DPS'],
  us: ['JFK', 'LAX', 'SFO', 'ORD', 'MIA'],
  middleeast: ['DXB', 'AUH', 'DOH'],
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

// ─── HARD CODE FILTERS ────────────────────────────────────────────────────────

function applyFilters(flights, filters) {
  if (!filters || Object.keys(filters).length === 0) return { matched: flights, others: [] };

  let matched = [...flights];

  // Filter: specific airline
  if (filters.airline) {
    const name = filters.airline.toLowerCase();
    matched = matched.filter(f => f.carrierName.toLowerCase().includes(name));
  }

  // Filter: max stops
  if (filters.maxStops !== undefined && filters.maxStops !== null) {
    matched = matched.filter(f => f.stops <= parseInt(filters.maxStops));
  }

  // Filter: stopover region
  if (filters.stopoverRegion) {
    const region = filters.stopoverRegion.toLowerCase();
    const keywords = STOPOVER_REGIONS[region] || [region];
    matched = matched.filter(f => {
      if (f.stops === 0) return false; // direct flights don't have stopovers
      if (!f.stopoverCity) return false;
      const city = f.stopoverCity.toLowerCase();
      return keywords.some(k => city.includes(k.toLowerCase()));
    });
  }

  // Filter: departure time window
  if (filters.departureWindow) {
    const windows = {
      morning: { start: 6, end: 12 },
      afternoon: { start: 12, end: 18 },
      evening: { start: 18, end: 24 },
      night: { start: 0, end: 6 },
    };
    const w = windows[filters.departureWindow.toLowerCase()];
    if (w) {
      matched = matched.filter(f => {
        const hour = parseInt((f.departureTime || '00:00').split(':')[0]);
        return hour >= w.start && hour < w.end;
      });
    }
  }

  // Everything that didn't match goes in "others"
  const matchedIds = new Set(matched.map(f => f.id));
  const others = flights.filter(f => !matchedIds.has(f.id));

  return { matched, others };
}

// ─── SERPAPI ──────────────────────────────────────────────────────────────────

async function serpapiSearch(params) {
  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('api_key', process.env.SERPAPI_KEY);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'au');
  url.searchParams.set('currency', 'AUD');
  for (const [key, val] of Object.entries(params)) {
    if (val !== null && val !== undefined) url.searchParams.set(key, String(val));
  }
  const response = await fetch(url.toString());
  if (!response.ok) return null;
  return response.json();
}

function parseFlights(data, destination, returnDate, stayDays) {
  if (!data) return [];
  const all = [...(data.best_flights || []), ...(data.other_flights || [])];
  return all.map((flight, i) => {
    const legs = flight.flights || [];
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    const airlineName = firstLeg?.airline || 'Unknown';
    const stops = legs.length - 1;
    const stopoverCity = stops > 0 ? (legs[0]?.arrival_airport?.name || null) : null;
    const price = Math.round(flight.price || 0);

    return {
      id: `serp_${destination}_${i}_${firstLeg?.departure_airport?.id}`,
      destination: destination,
      carrierName: airlineName,
      carrierCode: airlineName.substring(0, 2).toUpperCase(),
      tier: getAirlineTier(airlineName),
      stops,
      stopoverCity,
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
      isBestFlight: (data.best_flights || []).includes(flight),
    };
  }).filter(f => f.price > 0);
}

// ─── SEARCH HANDLER ───────────────────────────────────────────────────────────

async function handleSearch(body) {
  const {
    origin = 'SYD',
    destinations, // array for parallel search e.g. ['LHR','CDG','FCO']
    destination,  // single destination
    departDate,
    stayDays = 14,
    passengers = 1,
    cabin = 'economy',
    filters = {},
  } = body;

  if (!departDate) throw new Error('Departure date is required.');

  const cabinMap = { economy: '1', premium_economy: '2', business: '3', first: '4' };
  const stay = parseInt(stayDays);
  const returnDate = addDays(departDate, stay);
  const pax = parseInt(passengers);

  // Determine which destinations to search
  const destList = destinations && destinations.length > 0
    ? destinations
    : destination
    ? [destination]
    : [];

  if (destList.length === 0) throw new Error('At least one destination is required.');

  // Parallel search across all destinations
  const searchPromises = destList.map(dest =>
    serpapiSearch({
      departure_id: origin,
      arrival_id: dest,
      outbound_date: departDate,
      return_date: returnDate,
      adults: pax,
      travel_class: cabinMap[cabin] || '1',
      type: '1',
    }).then(data => parseFlights(data, dest, returnDate, stay))
      .catch(() => [])
  );

  const results = await Promise.all(searchPromises);
  const allFlights = results.flat().sort((a, b) => a.price - b.price);

  // Apply hard code filters
  const { matched, others } = applyFilters(allFlights, filters);

  return {
    matched,
    others: others.slice(0, 8),
    totalFound: allFlights.length,
    isMock: false,
    source: 'Google Flights via Serpapi',
    filters,
  };
}

// ─── CHAT HANDLER ─────────────────────────────────────────────────────────────

async function handleChat(body) {
  const { messages, pendingData, originalRequest } = body;
  const today = new Date().toISOString().split('T')[0];

  // Phase 3: Claude analyses filtered results
  if (pendingData && originalRequest) {
    const { matched, others, filters } = pendingData;

    const formatList = (flights) => flights.slice(0, 15).map((f, i) =>
      `[${i + 1}] ID:${f.id} | ${f.carrierName} | Tier ${f.tier} | ${f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}${f.stopoverCity ? ' via ' + f.stopoverCity : ''}`} | ${f.destination ? 'To ' + f.destination + ' | ' : ''}Departs ${f.departureDate} ${f.departureTime} | Returns ${f.returnDate || 'N/A'} | ${f.duration} | A$${f.pricePerPax}/person`
    ).join('\n');

    const matchedSection = matched.length > 0
      ? `Flights matching your requirements (${matched.length} found):\n${formatList(matched)}`
      : `No flights exactly matched your requirements.`;

    const othersSection = others.length > 0
      ? `\nOther available options (${others.length}):\n${formatList(others)}`
      : '';

    const filtersApplied = Object.entries(filters || {})
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');

    const prompt = `User asked: "${originalRequest}"
${filtersApplied ? `Filters applied in code: ${filtersApplied}` : ''}

${matchedSection}${othersSection}

Write a friendly 2-3 sentence summary. If matched flights exist, focus on the best of those. If none matched, explain and highlight the best alternatives from the others section. Be specific — mention airline name, price, and why it's recommended.

Respond in JSON only:
{
  "message": "2-3 sentence summary with clear recommendation",
  "warning": "If no flights matched the requirements, explain briefly. Empty string if matches were found.",
  "rankedMatchedIds": ["id1", "id2"],
  "rankedOtherIds": ["id3", "id4"]
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
      });

      if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
      const data = await response.json();
      const text = data.content[0].text.trim();
      let analysis = null;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) { try { analysis = JSON.parse(jsonMatch[0]); } catch (e) {} }

      const reorderById = (flights, ids) => {
        if (!ids || !ids.length) return flights;
        const ordered = [];
        ids.forEach(id => { const f = flights.find(f => f.id === id); if (f) ordered.push(f); });
        flights.forEach(f => { if (!ordered.find(o => o.id === f.id)) ordered.push(f); });
        return ordered;
      };

      return {
        reply: analysis?.message || `Found ${matched.length} matching flights.`,
        warning: analysis?.warning || '',
        matched: reorderById(matched, analysis?.rankedMatchedIds).map((f, i) => ({ ...f, rank: i + 1 })),
        others: reorderById(others, analysis?.rankedOtherIds).slice(0, 8),
      };

    } catch (err) {
      return {
        reply: matched.length > 0
          ? `Found ${matched.length} flights matching your criteria. Sorted by price.`
          : `No exact matches found. Showing best available alternatives.`,
        warning: matched.length === 0 ? 'No flights matched your specific requirements.' : '',
        matched: matched.map((f, i) => ({ ...f, rank: i + 1 })),
        others: others.slice(0, 8),
      };
    }
  }

  // Phase 1: Extract intent
  const systemPrompt = `You are a flight search assistant for Chatflight, helping Australians find cheap flights.
Today: ${today}. Default origin: Sydney (SYD).

AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Athens=ATH, Barcelona=BCN
Madrid=MAD, Lisbon=LIS, Frankfurt=FRA, Zurich=ZRH, Vienna=VIE
Dubai=DXB, Abu Dhabi=AUH, Doha=DOH, Istanbul=IST
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG, KL=KUL
New York=JFK, Los Angeles=LAX, San Francisco=SFO
Toronto=YYZ, Vancouver=YVR, Montreal=YUL

REGION SEARCH — if user says a region not a specific city, use destinations array:
- "Europe" or "any European city" → destinations: ["LHR","CDG","FCO","AMS","ATH","BCN","MAD","LIS","VIE","ZRH"]
- "Asia" → destinations: ["SIN","BKK","HKG","NRT","ICN","KUL","DPS"]
- "Middle East" → destinations: ["DXB","AUH","DOH"]
- specific city → destination: "LHR" (single)

DATE RULES — single best departure date:
- "in May" → departDate: 2026-05-15
- "early May" → departDate: 2026-05-05
- "late May" → departDate: 2026-05-25
- "first week of May" → departDate: 2026-05-04
- exact date → use exactly
- no date → today + 30 days

STAY: "1 week"→7, "2 weeks"→14, "3 weeks"→21, "1 month"→30, default→14

FILTERS — extract any constraints into filters object:
- "stop in the US" → filters.stopoverRegion: "us"
- "via Dubai" → filters.stopoverRegion: "middleeast"
- "only Etihad" or "Etihad only" → filters.airline: "Etihad"
- "direct only" or "no stops" → filters.maxStops: 0
- "max 1 stop" → filters.maxStops: 1
- "morning flight" → filters.departureWindow: "morning"
- "evening departure" → filters.departureWindow: "evening"
- no constraint → filters: {}

Be friendly, 1 sentence max. Only ask if destination is completely unclear.

When ready end with:
SEARCH_PARAMS:{"origin":"SYD","destination":"AUH","destinations":null,"departDate":"2026-05-15","stayDays":21,"passengers":1,"cabin":"economy","filters":{"stopoverRegion":null,"airline":null,"maxStops":null,"departureWindow":null}}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system: systemPrompt, messages: messages.slice(-10) })
  });

  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
  const data = await response.json();
  const fullReply = data.content[0].text;

  let searchParams = null;
  let reply = fullReply;
  const match = fullReply.match(/SEARCH_PARAMS:(\{[\s\S]*?\})\s*$/m);
  if (match) {
    try {
      searchParams = JSON.parse(match[1]);
      reply = fullReply.replace(/SEARCH_PARAMS:[\s\S]*$/m, '').trim() || 'Searching Google Flights now...';
    } catch (e) {}
  }
  return { reply, searchParams };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action, ...body } = req.body;
  try {
    if (action === 'search') return res.status(200).json(await handleSearch(body));
    if (action === 'chat') return res.status(200).json(await handleChat(body));
    return res.status(400).json({ error: 'Invalid action.' });
  } catch (err) {
    console.error(`Error [${action}]:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
