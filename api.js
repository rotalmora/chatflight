// api.js — single handler for both /chat and /search actions
// Action is passed in the request body as "action": "chat" or "action": "search"

const MOCK_MODE = false;

const AIRLINES = {
  'QR': { name: 'Qatar Airways', tier: 'A', hub: 'DOH', hubCity: 'Doha', hubRegion: 'Middle East' },
  'EK': { name: 'Emirates', tier: 'A', hub: 'DXB', hubCity: 'Dubai', hubRegion: 'Middle East' },
  'SQ': { name: 'Singapore Airlines', tier: 'A', hub: 'SIN', hubCity: 'Singapore', hubRegion: 'Asia' },
  'QF': { name: 'Qantas', tier: 'A', hub: 'SIN', hubCity: 'Singapore', hubRegion: 'Asia' },
  'CX': { name: 'Cathay Pacific', tier: 'A', hub: 'HKG', hubCity: 'Hong Kong', hubRegion: 'Asia' },
  'EY': { name: 'Etihad Airways', tier: 'A', hub: 'AUH', hubCity: 'Abu Dhabi', hubRegion: 'Middle East' },
  'AA': { name: 'American Airlines', tier: 'B', hub: 'DFW', hubCity: 'Dallas', hubRegion: 'USA' },
  'UA': { name: 'United Airlines', tier: 'B', hub: 'LAX', hubCity: 'Los Angeles', hubRegion: 'USA' },
  'AC': { name: 'Air Canada', tier: 'B', hub: 'YVR', hubCity: 'Vancouver', hubRegion: 'Canada' },
  'MH': { name: 'Malaysia Airlines', tier: 'B', hub: 'KUL', hubCity: 'Kuala Lumpur', hubRegion: 'Asia' },
  'TK': { name: 'Turkish Airlines', tier: 'B', hub: 'IST', hubCity: 'Istanbul', hubRegion: 'Europe' },
  'AI': { name: 'Air India', tier: 'B', hub: 'DEL', hubCity: 'Delhi', hubRegion: 'Asia' },
  'KL': { name: 'KLM', tier: 'B', hub: 'AMS', hubCity: 'Amsterdam', hubRegion: 'Europe' },
  'LH': { name: 'Lufthansa', tier: 'A', hub: 'FRA', hubCity: 'Frankfurt', hubRegion: 'Europe' },
  'D7': { name: 'AirAsia X', tier: 'C', hub: 'KUL', hubCity: 'Kuala Lumpur', hubRegion: 'Asia' },
};

const BASE_PRICES = {
  'QR': 1289, 'EK': 1349, 'SQ': 1399, 'QF': 1459, 'CX': 1319,
  'EY': 1279, 'AA': 1599, 'UA': 1549, 'AC': 1489, 'MH': 1099,
  'TK': 1189, 'AI': 989, 'KL': 1229, 'LH': 1379, 'D7': 849
};

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

function seedRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function minsToHours(mins) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function generateMockFlights(origin, destination, departDate, returnDate, stayDays, flexDays, passengers, cabin) {
  const seed = (origin + destination + departDate).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = seedRand(seed);
  const cabinMult = { economy: 1, premium_economy: 1.8, business: 3.5, first: 5.5 }[cabin] || 1;
  const pax = parseInt(passengers) || 1;
  const flex = parseInt(flexDays) || 0;

  let exactStayDays = parseInt(stayDays) || null;
  if (!exactStayDays && returnDate && departDate) {
    const dep = new Date(departDate + 'T00:00:00');
    const ret = new Date(returnDate + 'T00:00:00');
    exactStayDays = Math.round((ret - dep) / (1000 * 60 * 60 * 24));
  }
  if (!exactStayDays) exactStayDays = 14;

  const flights = [];
  Object.keys(AIRLINES).forEach((code) => {
    const airline = AIRLINES[code];
    const variants = flex > 0 ? 2 : 1;
    for (let v = 0; v < variants; v++) {
      const depOffset = flex > 0 ? Math.floor(rand() * (flex * 2 + 1)) - flex : 0;
      const actualDepart = depOffset !== 0 ? addDays(departDate, depOffset) : departDate;
      const actualReturn = addDays(actualDepart, exactStayDays);
      const base = BASE_PRICES[code] || 1200;
      const variance = Math.round((rand() - 0.5) * 250);
      const price = Math.round((base + variance) * cabinMult * pax);
      const forceStop = ['AA', 'UA', 'AC', 'D7'].includes(code);
      const stops = forceStop ? 1 : (rand() > 0.7 ? 0 : 1);
      const durationMins = stops === 0 ? Math.round(1380 + rand() * 120) : Math.round(1560 + rand() * 300);
      const depHour = 6 + Math.floor(rand() * 16);
      const depMin = Math.floor(rand() * 4) * 15;
      const totalMins = depHour * 60 + depMin + durationMins;
      const arrHour = Math.floor((totalMins % (24 * 60)) / 60);
      const arrMin = totalMins % 60;
      const nextDay = totalMins >= 24 * 60;
      const trendRoll = rand();
      const trend = trendRoll > 0.6 ? 'down' : trendRoll > 0.3 ? 'stable' : 'up';
      flights.push({
        id: `mock_${code}_${v}_${actualDepart}`,
        carrierCode: code, carrierName: airline.name, tier: airline.tier,
        stops, stopoverCity: stops > 0 ? airline.hubCity : null,
        stopoverRegion: stops > 0 ? airline.hubRegion : null,
        stopoverCode: stops > 0 ? airline.hub : null,
        departureDate: formatDisplayDate(actualDepart),
        returnDate: formatDisplayDate(actualReturn),
        stayDays: exactStayDays,
        departureTime: `${String(depHour).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
        arrivalTime: `${String(arrHour).padStart(2,'0')}:${String(arrMin).padStart(2,'0')}${nextDay ? ' +1' : ''}`,
        duration: minsToHours(durationMins), durationMins, price,
        pricePerPax: Math.round(price / pax), currency: 'AUD',
        trend, trendNote: trend === 'down' ? '↓ Falling' : trend === 'up' ? '↑ Rising' : '— Stable',
      });
    }
  });
  return flights.sort((a, b) => a.price - b.price);
}

// ─── LIVE DUFFEL ──────────────────────────────────────────────────────────────

async function fetchDuffelOffers(slices, passengers, cabin) {
  const response = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DUFFEL_API_KEY}`,
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      data: {
        slices,
        passengers: Array(parseInt(passengers)).fill({ type: 'adult' }),
        cabin_class: cabin || 'economy',
      }
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Duffel error: ${response.status} — ${err}`);
  }
  const data = await response.json();
  return data.data?.offers || [];
}

function parseOffer(offer, pax, returnDate, stayDays) {
  const slice = offer.slices[0];
  const segments = slice?.segments || [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  const code = first?.marketing_carrier?.iata_code || '??';
  const airline = AIRLINES[code] || { name: first?.marketing_carrier?.name || code, tier: 'B', hubCity: null, hubRegion: 'Unknown' };
  const stops = segments.length - 1;
  const rawPrice = parseFloat(offer.total_amount);
  const currency = offer.total_currency;
  // Convert to AUD if needed
  const fxRates = { USD: 1.55, EUR: 1.68, GBP: 1.97, AED: 0.42, SGD: 1.15, JPY: 0.0104, CAD: 1.12, NZD: 0.91 };
  const price = currency === 'AUD' ? Math.round(rawPrice) : Math.round(rawPrice * (fxRates[currency] || 1));
  const dur = slice?.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  const durMins = dur ? (parseInt(dur[1] || 0) * 60 + parseInt(dur[2] || 0)) : 0;
  const stopCity = stops > 0 ? (segments[0]?.destination?.city_name || segments[0]?.destination?.iata_code || airline.hubCity) : null;
  return {
    id: offer.id,
    carrierCode: code, carrierName: airline.name, tier: airline.tier,
    stops, stopoverCity: stopCity,
    stopoverRegion: stops > 0 ? airline.hubRegion : null,
    stopoverCode: stops > 0 ? segments[0]?.destination?.iata_code : null,
    departureDate: new Date(first?.departing_at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
    returnDate: returnDate ? new Date(returnDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : null,
    stayDays: stayDays || null,
    departureTime: new Date(first?.departing_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
    arrivalTime: new Date(last?.arriving_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
    duration: minsToHours(durMins), durationMins: durMins,
    price, pricePerPax: Math.round(price / pax),
    currency: 'AUD', originalCurrency: currency, originalPrice: rawPrice,
    trend: 'stable', trendNote: '— Live price',
  };
}

async function searchDuffel(origin, destination, departDate, returnDate, passengers, cabin, stayDays) {
  const pax = parseInt(passengers) || 1;
  if (returnDate) {
    const [outboundOffers, returnOffers] = await Promise.all([
      fetchDuffelOffers([{ origin, destination, departure_date: departDate }], passengers, cabin),
      fetchDuffelOffers([{ origin: destination, destination: origin, departure_date: returnDate }], passengers, cabin),
    ]);
    const returnByCarrier = {};
    returnOffers.forEach(offer => {
      const code = offer.slices[0]?.segments[0]?.marketing_carrier?.iata_code || '??';
      if (!returnByCarrier[code] || parseFloat(offer.total_amount) < parseFloat(returnByCarrier[code].total_amount)) {
        returnByCarrier[code] = offer;
      }
    });
    const cheapestReturn = [...returnOffers].sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount))[0];
    return outboundOffers.map(offer => {
      const code = offer.slices[0]?.segments[0]?.marketing_carrier?.iata_code || '??';
      const matchingReturn = returnByCarrier[code] || cheapestReturn;
      const parsed = parseOffer(offer, 1, returnDate, stayDays);
      const returnParsed = matchingReturn ? parseOffer(matchingReturn, 1, null, null) : null;
      const combinedPrice = returnParsed ? parsed.price + returnParsed.price : parsed.price;
      return { ...parsed, price: Math.round(combinedPrice * pax), pricePerPax: combinedPrice, isReturn: true };
    });
  } else {
    const offers = await fetchDuffelOffers([{ origin, destination, departure_date: departDate }], passengers, cabin);
    return offers.map(offer => parseOffer(offer, pax, null, null));
  }
}

// ─── CHAT HANDLER ─────────────────────────────────────────────────────────────

async function handleChat(body) {
  const { messages, pendingFlights, originalRequest } = body;
  const today = new Date().toISOString().split('T')[0];

  if (pendingFlights && originalRequest) {
    const flightList = pendingFlights.map((f, i) =>
      `[${i}] ID:${f.id} | ${f.carrierName} (${f.carrierCode}) | Tier:${f.tier} | ${f.stops === 0 ? 'Direct' : `Stop in ${f.stopoverCity}, ${f.stopoverRegion}`} | Departs:${f.departureDate} ${f.departureTime} | Returns:${f.returnDate || 'N/A'} | Stay:${f.stayDays || 'N/A'}d | Duration:${f.duration} | A$${f.pricePerPax}/person | Trend:${f.trendNote}`
    ).join('\n');

    const prompt = `A user searched for flights with this request: "${originalRequest}"

Available flights:
${flightList}

Instructions:
1. Read the user's request carefully — note every requirement
2. Filter to flights that match. If user said "stop in the US", only include US stopover flights
3. If NO flights match a specific requirement, clearly explain and show best alternatives
4. Rank matching flights best to worst value
5. Write a friendly 2-3 sentence summary and top recommendation

Respond in this exact JSON format with no text before or after:
{
  "message": "Your 2-3 sentence friendly summary and recommendation",
  "warning": "Brief explanation if any requirement could not be matched, empty string if all matched",
  "rankedIds": ["ID_OF_BEST_FLIGHT", "ID_OF_SECOND_BEST"]
}`;

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

    let rankedFlights = [...pendingFlights];
    if (analysis?.rankedIds?.length > 0) {
      const ordered = [];
      analysis.rankedIds.forEach(id => { const f = pendingFlights.find(f => f.id === id); if (f) ordered.push(f); });
      pendingFlights.forEach(f => { if (!ordered.find(o => o.id === f.id)) ordered.push(f); });
      rankedFlights = ordered;
    }

    return {
      reply: analysis?.message || 'Here are the best flights matching your request.',
      warning: analysis?.warning || '',
      rankedFlights: rankedFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
    };
  }

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
- "anytime in June" → departDate: 2026-06-01, flexDays: 14
- "flexible" or "cheapest dates" → flexDays: 7
- Exact dates or no flexibility mentioned → flexDays: 0

STAY RULES: "1 week"→7, "2 weeks"→14, "1 month"→30. returnDate = departDate + stayDays exactly.

Be friendly and concise. When ready to search end your message with:
SEARCH_PARAMS:{"origin":"SYD","destination":"AUH","departDate":"2026-05-01","returnDate":"2026-05-31","stayDays":30,"flexDays":0,"passengers":1,"cabin":"economy"}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 512, system: systemPrompt, messages: messages.slice(-10) })
  });
  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
  const data = await response.json();
  const fullReply = data.content[0].text;

  let searchParams = null;
  let reply = fullReply;
  const match = fullReply.match(/SEARCH_PARAMS:(\{[^}]+\})/);
  if (match) {
    try { searchParams = JSON.parse(match[1]); reply = fullReply.replace(/SEARCH_PARAMS:\{[^}]+\}/, '').trim() || 'Searching now...'; }
    catch (e) {}
  }
  return { reply, searchParams };
}

// ─── SEARCH HANDLER ───────────────────────────────────────────────────────────

async function handleSearch(body) {
  const { origin = 'SYD', destination, departDate, returnDate, stayDays, flexDays = 0, passengers = 1, cabin = 'economy' } = body;
  if (!destination || !departDate) throw new Error('Destination and departure date are required.');

  let flights = [];
  if (MOCK_MODE) {
    flights = generateMockFlights(origin, destination, departDate, returnDate, stayDays, flexDays, passengers, cabin);
  } else {
    flights = await searchDuffel(origin, destination, departDate, returnDate, passengers, cabin, stayDays);
    const seen = new Set();
    flights = flights.filter(f => {
      const key = `${f.carrierCode}-${f.departureTime}-${f.departureDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return { flights, isMock: MOCK_MODE };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { action, ...body } = req.body;

  try {
    if (action === 'search') {
      const result = await handleSearch(body);
      return res.status(200).json(result);
    } else if (action === 'chat') {
      const result = await handleChat(body);
      return res.status(200).json(result);
    } else {
      return res.status(400).json({ error: 'Invalid action. Use "chat" or "search".' });
    }
  } catch (err) {
    console.error(`Error handling action ${action}:`, err);
    return res.status(500).json({ error: err.message });
  }
}
