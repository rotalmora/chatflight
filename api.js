// api.js — Chatflight
// Architecture: parallel date scanning → full pool → Claude picks best

const MOCK_MODE = false;

const AIRLINES = {
  'QR': { name: 'Qatar Airways', tier: 'A', hubCity: 'Doha', hubRegion: 'Middle East' },
  'EK': { name: 'Emirates', tier: 'A', hubCity: 'Dubai', hubRegion: 'Middle East' },
  'SQ': { name: 'Singapore Airlines', tier: 'A', hubCity: 'Singapore', hubRegion: 'Asia' },
  'QF': { name: 'Qantas', tier: 'A', hubCity: 'Singapore', hubRegion: 'Asia' },
  'CX': { name: 'Cathay Pacific', tier: 'A', hubCity: 'Hong Kong', hubRegion: 'Asia' },
  'EY': { name: 'Etihad Airways', tier: 'A', hubCity: 'Abu Dhabi', hubRegion: 'Middle East' },
  'AA': { name: 'American Airlines', tier: 'B', hubCity: 'Dallas', hubRegion: 'USA' },
  'UA': { name: 'United Airlines', tier: 'B', hubCity: 'Los Angeles', hubRegion: 'USA' },
  'AC': { name: 'Air Canada', tier: 'B', hubCity: 'Vancouver', hubRegion: 'Canada' },
  'MH': { name: 'Malaysia Airlines', tier: 'B', hubCity: 'Kuala Lumpur', hubRegion: 'Asia' },
  'TK': { name: 'Turkish Airlines', tier: 'B', hubCity: 'Istanbul', hubRegion: 'Europe' },
  'AI': { name: 'Air India', tier: 'B', hubCity: 'Delhi', hubRegion: 'Asia' },
  'KL': { name: 'KLM', tier: 'B', hubCity: 'Amsterdam', hubRegion: 'Europe' },
  'LH': { name: 'Lufthansa', tier: 'A', hubCity: 'Frankfurt', hubRegion: 'Europe' },
  'MU': { name: 'China Eastern', tier: 'B', hubCity: 'Shanghai', hubRegion: 'Asia' },
  'D7': { name: 'AirAsia X', tier: 'C', hubCity: 'Kuala Lumpur', hubRegion: 'Asia' },
};

const FX = { USD: 1.55, EUR: 1.68, GBP: 1.97, AED: 0.42, SGD: 1.15, JPY: 0.0104, CAD: 1.12, NZD: 0.91 };

function toAUD(amount, currency) {
  if (currency === 'AUD') return Math.round(amount);
  return Math.round(amount * (FX[currency] || 1));
}

function minsToHours(mins) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function displayDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function displayTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Generate dates across a window every N days
function generateDateGrid(windowStart, windowEnd, stepDays = 3) {
  const dates = [];
  let current = windowStart;
  while (current <= windowEnd) {
    dates.push(current);
    current = addDays(current, stepDays);
  }
  // Always include the last date if not already there
  if (dates[dates.length - 1] !== windowEnd) dates.push(windowEnd);
  return dates;
}

// ─── DUFFEL ───────────────────────────────────────────────────────────────────

async function duffelSearch(origin, destination, departDate, passengers, cabin) {
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
        slices: [{ origin, destination, departure_date: departDate }],
        passengers: Array(parseInt(passengers)).fill({ type: 'adult' }),
        cabin_class: cabin || 'economy',
      }
    })
  });

  if (!response.ok) return []; // silently skip failed dates
  const data = await response.json();
  return data.data?.offers || [];
}

function parseOffer(offer, pax) {
  const slice = offer.slices[0];
  const segs = slice?.segments || [];
  const first = segs[0];
  const last = segs[segs.length - 1];
  const code = first?.marketing_carrier?.iata_code || '??';
  const airline = AIRLINES[code] || { name: first?.marketing_carrier?.name || code, tier: 'B', hubCity: null, hubRegion: 'Unknown' };
  const stops = segs.length - 1;
  const rawAmount = parseFloat(offer.total_amount);
  const priceAUD = toAUD(rawAmount, offer.total_currency);
  const dur = slice?.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  const durMins = dur ? parseInt(dur[1] || 0) * 60 + parseInt(dur[2] || 0) : 0;
  const stopCity = stops > 0 ? (segs[0]?.destination?.city_name || segs[0]?.destination?.iata_code || airline.hubCity) : null;

  return {
    id: offer.id,
    carrierCode: code,
    carrierName: airline.name,
    tier: airline.tier,
    stops,
    stopoverCity: stopCity,
    stopoverRegion: stops > 0 ? airline.hubRegion : null,
    stopoverCode: stops > 0 ? segs[0]?.destination?.iata_code : null,
    departureDate: displayDate(first?.departing_at),
    departureDateRaw: first?.departing_at?.split('T')[0],
    arrivalDate: displayDate(last?.arriving_at),
    departureTime: displayTime(first?.departing_at),
    arrivalTime: displayTime(last?.arriving_at),
    duration: minsToHours(durMins),
    durationMins: durMins,
    priceAUD,
    pax: parseInt(pax),
  };
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

function generateMockFlights(origin, destination, windowStart, windowEnd, stayDays, passengers, cabin) {
  const BASE = { 'QR':1289,'EK':1349,'SQ':1399,'QF':1459,'CX':1319,'EY':1279,'AA':1599,'UA':1549,'AC':1489,'MH':1099,'TK':1189,'AI':989,'KL':1229,'LH':1379,'MU':999,'D7':849 };
  const cabinMult = { economy:1, premium_economy:1.8, business:3.5, first:5.5 }[cabin] || 1;
  const pax = parseInt(passengers) || 1;
  const outbound = [];
  const inbound = [];

  let seed = (origin + destination).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  const dates = generateDateGrid(windowStart, windowEnd, 3);

  dates.forEach(depDate => {
    Object.keys(AIRLINES).forEach(code => {
      const base = BASE[code] || 1200;
      const variance = Math.round((rand() - 0.5) * 200);
      const price = Math.round((base + variance) * cabinMult);
      const stops = ['AA','UA','AC','D7'].includes(code) ? 1 : (rand() > 0.7 ? 0 : 1);
      const durMins = stops === 0 ? Math.round(1380 + rand() * 120) : Math.round(1560 + rand() * 240);
      const depHour = 6 + Math.floor(rand() * 16);
      const depMin = Math.floor(rand() * 4) * 15;
      const airline = AIRLINES[code];

      outbound.push({
        id: `mock_out_${code}_${depDate}`,
        carrierCode: code, carrierName: airline.name, tier: airline.tier,
        stops, stopoverCity: stops > 0 ? airline.hubCity : null,
        stopoverRegion: stops > 0 ? airline.hubRegion : null,
        stopoverCode: null,
        departureDate: new Date(depDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }),
        departureDateRaw: depDate,
        arrivalDate: null,
        departureTime: `${String(depHour).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
        arrivalTime: `${String((depHour + Math.floor(durMins/60)) % 24).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
        duration: minsToHours(durMins), durationMins: durMins,
        priceAUD: price, pax,
      });

      // Return leg
      const retDate = addDays(depDate, stayDays);
      if (retDate <= addDays(windowEnd, stayDays)) {
        const retPrice = Math.round((base + Math.round((rand() - 0.5) * 200)) * cabinMult);
        inbound.push({
          id: `mock_in_${code}_${retDate}`,
          carrierCode: code, carrierName: airline.name, tier: airline.tier,
          stops, stopoverCity: stops > 0 ? airline.hubCity : null,
          stopoverRegion: stops > 0 ? airline.hubRegion : null,
          stopoverCode: null,
          departureDate: new Date(retDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }),
          departureDateRaw: retDate,
          arrivalDate: null,
          departureTime: `${String(depHour).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
          arrivalTime: `${String((depHour + Math.floor(durMins/60)) % 24).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
          duration: minsToHours(durMins), durationMins: durMins,
          priceAUD: retPrice, pax,
        });
      }
    });
  });

  return { outbound, inbound };
}

// ─── COMBINE OUTBOUND + INBOUND ───────────────────────────────────────────────

function buildCombinations(outbound, inbound, stayDays, maxResults = 20) {
  // Group inbound by carrier for fast lookup
  const inboundByCarrier = {};
  inbound.forEach(f => {
    if (!inboundByCarrier[f.carrierCode]) inboundByCarrier[f.carrierCode] = [];
    inboundByCarrier[f.carrierCode].push(f);
  });

  const combos = [];

  outbound.forEach(out => {
    const expectedReturnDate = addDays(out.departureDateRaw, stayDays);
    
    // Find best matching return — same carrier first, then any carrier
    const sameCarrierReturns = (inboundByCarrier[out.carrierCode] || [])
      .filter(r => r.departureDateRaw === expectedReturnDate);
    const anyReturns = inbound
      .filter(r => r.departureDateRaw === expectedReturnDate);
    
    const candidates = sameCarrierReturns.length > 0 ? sameCarrierReturns : anyReturns;
    if (candidates.length === 0) return;

    // Pick cheapest return for this outbound
    const bestReturn = candidates.sort((a, b) => a.priceAUD - b.priceAUD)[0];
    const totalAUD = out.priceAUD + bestReturn.priceAUD;

    combos.push({
      id: `combo_${out.id}_${bestReturn.id}`,
      carrierCode: out.carrierCode,
      carrierName: out.carrierName,
      tier: out.tier,
      stops: out.stops,
      stopoverCity: out.stopoverCity,
      stopoverRegion: out.stopoverRegion,
      stopoverCode: out.stopoverCode,
      departureDate: out.departureDate,
      departureDateRaw: out.departureDateRaw,
      returnDate: bestReturn.departureDate,
      returnDateRaw: bestReturn.departureDateRaw,
      stayDays,
      departureTime: out.departureTime,
      arrivalTime: out.arrivalTime,
      returnDepartureTime: bestReturn.departureTime,
      duration: out.duration,
      durationMins: out.durationMins,
      returnCarrier: bestReturn.carrierName !== out.carrierName ? bestReturn.carrierName : null,
      price: totalAUD * out.pax,
      pricePerPax: totalAUD,
      currency: 'AUD',
      trend: 'stable',
      trendNote: '— Live price',
    });
  });

  // Deduplicate — keep cheapest per carrier+date combo
  const seen = new Set();
  const deduped = [];
  combos.sort((a, b) => a.pricePerPax - b.pricePerPax).forEach(c => {
    const key = `${c.carrierCode}_${c.departureDateRaw}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(c); }
  });

  return deduped.slice(0, maxResults);
}

// ─── SEARCH HANDLER ───────────────────────────────────────────────────────────

async function handleSearch(body) {
  const {
    origin = 'SYD', destination,
    windowStart, windowEnd, stayDays = 14,
    passengers = 1, cabin = 'economy',
  } = body;

  if (!destination || !windowStart) throw new Error('Destination and travel window required.');

  const end = windowEnd || addDays(windowStart, 30);
  const stay = parseInt(stayDays);
  const pax = parseInt(passengers);

  if (MOCK_MODE) {
    const { outbound, inbound } = generateMockFlights(origin, destination, windowStart, end, stay, passengers, cabin);
    const flights = buildCombinations(outbound, inbound, stay);
    return { flights, isMock: true, datesScanned: generateDateGrid(windowStart, end).length };
  }

  // Live Duffel — scan outbound dates across window
  const outboundDates = generateDateGrid(windowStart, end, 3);
  
  // For each outbound date, the return date is outbound + stayDays
  const inboundDates = [...new Set(outboundDates.map(d => addDays(d, stay)))];

  console.log(`Scanning ${outboundDates.length} outbound dates + ${inboundDates.length} return dates`);

  // Parallel search — all outbound dates simultaneously
  const [outboundResults, inboundResults] = await Promise.all([
    Promise.all(outboundDates.map(date =>
      duffelSearch(origin, destination, date, passengers, cabin)
        .then(offers => offers.map(o => parseOffer(o, pax)))
        .catch(() => [])
    )),
    Promise.all(inboundDates.map(date =>
      duffelSearch(destination, origin, date, passengers, cabin)
        .then(offers => offers.map(o => parseOffer(o, pax)))
        .catch(() => [])
    )),
  ]);

  const outbound = outboundResults.flat();
  const inbound = inboundResults.flat();

  console.log(`Found ${outbound.length} outbound + ${inbound.length} inbound offers`);

  const flights = buildCombinations(outbound, inbound, stay);

  return {
    flights,
    isMock: false,
    datesScanned: outboundDates.length,
    outboundFound: outbound.length,
    inboundFound: inbound.length,
  };
}

// ─── CHAT HANDLER ─────────────────────────────────────────────────────────────

async function handleChat(body) {
  const { messages, pendingFlights, originalRequest } = body;
  const today = new Date().toISOString().split('T')[0];

  // Phase 3: Analyse raw flight pool
  if (pendingFlights && originalRequest) {
    const flightList = pendingFlights.slice(0, 30).map((f, i) =>
      `[${i+1}] ${f.carrierName} (Tier ${f.tier}) | Departs ${f.departureDate} ${f.departureTime} | Returns ${f.returnDate} | ${f.stops === 0 ? 'Direct' : `1 stop via ${f.stopoverCity} (${f.stopoverRegion})`} | Flight time: ${f.duration} | A$${f.pricePerPax}/person`
    ).join('\n');

    const prompt = `User request: "${originalRequest}"

Available return flight combinations found (outbound + return leg combined):
${flightList}

Your job:
1. Read the user's request carefully — note every preference (stopover region, airline, budget, departure time, tier)
2. Filter to flights matching those preferences
3. If nothing matches a preference, say so honestly and show best alternatives
4. Pick your top 3-5 recommendations and explain why
5. Highlight the single best pick clearly

Respond in JSON only, no text before or after:
{
  "message": "2-3 sentence conversational summary with clear top recommendation",
  "warning": "If any preference couldn't be matched, explain briefly. Empty string if all matched.",
  "rankedIds": ["combo_id_1", "combo_id_2", "combo_id_3"]
}

rankedIds = flight id values from the list, best first, up to 12.`;

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

      let rankedFlights = [...pendingFlights];
      if (analysis?.rankedIds?.length > 0) {
        const ordered = [];
        analysis.rankedIds.forEach(id => { const f = pendingFlights.find(f => f.id === id); if (f) ordered.push(f); });
        pendingFlights.forEach(f => { if (!ordered.find(o => o.id === f.id)) ordered.push(f); });
        rankedFlights = ordered;
      }

      return {
        reply: analysis?.message || 'Here are the best combinations found.',
        warning: analysis?.warning || '',
        rankedFlights: rankedFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
      };
    } catch (err) {
      return {
        reply: 'Here are the best flights found for your search.',
        warning: '',
        rankedFlights: pendingFlights.slice(0, 12).map((f, i) => ({ ...f, rank: i + 1 })),
      };
    }
  }

  // Phase 1: Extract intent from user message
  const systemPrompt = `You are a flight search assistant for Chatflight, helping Australians find the cheapest flights.
Today: ${today}. Default origin: Sydney (SYD).

AIRPORT CODES:
Sydney=SYD, Melbourne=MEL, Brisbane=BNE, Perth=PER, Adelaide=ADL
London=LHR, Paris=CDG, Rome=FCO, Amsterdam=AMS, Barcelona=BCN, Frankfurt=FRA
Dubai=DXB, Abu Dhabi=AUH, Doha=DOH, Istanbul=IST
Tokyo=NRT, Singapore=SIN, Bangkok=BKK, Bali=DPS, Hong Kong=HKG, KL=KUL
New York=JFK, Los Angeles=LAX, San Francisco=SFO
Toronto=YYZ, Vancouver=YVR, Montreal=YUL, Calgary=YYC

WINDOW RULES — extract a date range to scan, not a single date:
- "in May" → windowStart: 2026-05-01, windowEnd: 2026-05-31
- "in June" → windowStart: 2026-06-01, windowEnd: 2026-06-30
- "next month" → first to last day of next month
- "over the next 2 months" → today to today+60
- "around May 10" → windowStart: 2026-05-07, windowEnd: 2026-05-14
- "1st of May" or exact date → windowStart = windowEnd = that date
- "anytime" or no date → windowStart: today+7, windowEnd: today+60

STAY DURATION — always set stayDays:
- "1 week" → stayDays: 7
- "2 weeks" → stayDays: 14  
- "3 weeks" → stayDays: 21
- "1 month" → stayDays: 30
- No stay mentioned → stayDays: 14

Be friendly, 1 sentence max. Only ask if destination is completely missing.

When ready, end message with:
SEARCH_PARAMS:{"origin":"SYD","destination":"AUH","windowStart":"2026-05-01","windowEnd":"2026-05-31","stayDays":21,"passengers":1,"cabin":"economy"}`;

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
    try {
      searchParams = JSON.parse(match[1]);
      reply = fullReply.replace(/SEARCH_PARAMS:\{[^}]+\}/, '').trim() || 'Scanning flights across your travel window...';
    } catch (e) {}
  }
  return { reply, searchParams };
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
    console.error(`Error [${action}]:`, err);
    return res.status(500).json({ error: err.message });
  }
}
