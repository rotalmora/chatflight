// api/search.js — Flight Search with Mock Data + Duffel Live toggle

const MOCK_MODE = !process.env.DUFFEL_API_KEY || process.env.DUFFEL_API_KEY.includes('test');

const AIRLINES = {
  'QR': { name: 'Qatar Airways', tier: 'A', hub: 'DOH' },
  'EK': { name: 'Emirates', tier: 'A', hub: 'DXB' },
  'SQ': { name: 'Singapore Airlines', tier: 'A', hub: 'SIN' },
  'QF': { name: 'Qantas', tier: 'A', hub: 'SIN' },
  'CX': { name: 'Cathay Pacific', tier: 'A', hub: 'HKG' },
  'EY': { name: 'Etihad Airways', tier: 'A', hub: 'AUH' },
  'MH': { name: 'Malaysia Airlines', tier: 'B', hub: 'KUL' },
  'TK': { name: 'Turkish Airlines', tier: 'B', hub: 'IST' },
  'AI': { name: 'Air India', tier: 'B', hub: 'DEL' },
  'KL': { name: 'KLM', tier: 'B', hub: 'AMS' },
  'D7': { name: 'AirAsia X', tier: 'C', hub: 'KUL' },
};

function seedRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function minsToHours(mins) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function generateMockFlights(origin, destination, departDate, returnDate, stayDays, passengers, cabin) {
  const seed = (origin + destination + departDate).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = seedRand(seed);
  const flights = [];
  const cabinMultiplier = { economy: 1, premium_economy: 1.8, business: 3.5, first: 5.5 };
  const mult = cabinMultiplier[cabin] || 1;
  const pax = parseInt(passengers) || 1;
  const airlineCodes = Object.keys(AIRLINES);

  airlineCodes.forEach((code) => {
    const airline = AIRLINES[code];
    const numVariants = Math.floor(rand() * 3) + 1;

    for (let v = 0; v < numVariants; v++) {
      const daysOffset = Math.floor(rand() * 14) - 7;
      const actualDepart = addDays(departDate, daysOffset);
      const stay = stayDays || 30;
      const actualReturn = returnDate
        ? addDays(returnDate, Math.floor(rand() * 6) - 3)
        : addDays(actualDepart, stay + Math.floor(rand() * 6) - 3);

      const basePrices = {
        'QR': 1289, 'EK': 1349, 'SQ': 1399, 'QF': 1459, 'CX': 1319,
        'EY': 1279, 'MH': 1099, 'TK': 1189, 'AI': 989, 'KL': 1229, 'D7': 849
      };
      const base = basePrices[code] || 1200;
      const variance = Math.round((rand() - 0.5) * 300);
      const price = Math.round((base + variance) * mult * pax);

      const stops = (code === 'D7') ? 1 : (rand() > 0.75 ? 0 : 1);
      const durationMins = stops === 0
        ? Math.round(1380 + rand() * 120)
        : Math.round(1560 + rand() * 240);

      const depHour = 6 + Math.floor(rand() * 16);
      const depMin = Math.floor(rand() * 4) * 15;
      const arrMins = (depHour * 60 + depMin + durationMins) % (24 * 60);
      const arrHour = Math.floor(arrMins / 60);
      const arrMin = arrMins % 60;
      const nextDay = (depHour * 60 + depMin + durationMins) >= 24 * 60;

      const trendRoll = rand();
      const trend = trendRoll > 0.6 ? 'down' : trendRoll > 0.3 ? 'stable' : 'up';

      flights.push({
        id: `mock_${code}_${v}_${actualDepart}`,
        carrierCode: code,
        carrierName: airline.name,
        tier: airline.tier,
        stops,
        via: stops > 0 ? airline.hub : null,
        departureDate: formatDisplayDate(actualDepart),
        returnDate: formatDisplayDate(actualReturn),
        departureDateRaw: actualDepart,
        returnDateRaw: actualReturn,
        departureTime: `${String(depHour).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
        arrivalTime: `${String(arrHour).padStart(2,'0')}:${String(arrMin).padStart(2,'0')}${nextDay ? '+1' : ''}`,
        duration: minsToHours(durationMins),
        durationMins,
        price,
        pricePerPax: Math.round(price / pax),
        currency: 'AUD',
        trend,
        trendNote: trend === 'down' ? '↓ Falling' : trend === 'up' ? '↑ Rising' : '— Stable',
        isMock: true,
      });
    }
  });

  return flights
    .sort((a, b) => a.price - b.price)
    .map((f, i) => ({ ...f, rank: i + 1 }));
}

function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return { text: 'N/A', mins: 0 };
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  return { text: `${h}h ${m}m`, mins: h * 60 + m };
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

async function searchDuffel(origin, destination, departDate, returnDate, passengers, cabin) {
  const slices = [{ origin, destination, departure_date: departDate }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });

  const body = {
    data: {
      slices,
      passengers: Array(parseInt(passengers)).fill({ type: 'adult' }),
      cabin_class: cabin || 'economy',
    }
  };

  const response = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DUFFEL_API_KEY}`,
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`Duffel API error: ${response.status}`);

  const data = await response.json();
  const offers = data.data?.offers || [];

  return offers.map(offer => {
    const slice = offer.slices[0];
    const segments = slice?.segments || [];
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const carrierCode = firstSeg?.marketing_carrier?.iata_code || '??';
    const airline = AIRLINES[carrierCode] || { name: firstSeg?.marketing_carrier?.name || carrierCode, tier: 'B' };
    const stops = segments.length - 1;
    const duration = parseDuration(slice?.duration || 'PT0H');
    const price = Math.round(parseFloat(offer.total_amount) * (offer.total_currency === 'USD' ? 1.55 : 1));
    const pax = parseInt(passengers) || 1;

    return {
      id: offer.id,
      carrierCode,
      carrierName: airline.name,
      tier: airline.tier,
      stops,
      via: stops > 0 ? segments[0]?.destination?.iata_code : null,
      departureDate: formatDate(firstSeg?.departing_at),
      returnDate: null,
      departureTime: formatTime(firstSeg?.departing_at),
      arrivalTime: formatTime(lastSeg?.arriving_at),
      duration: duration.text,
      durationMins: duration.mins,
      price,
      pricePerPax: Math.round(price / pax),
      currency: 'AUD',
      trend: 'stable',
      trendNote: '— Live price',
      isMock: false,
    };
  });
}

function generateRecommendation(flights, params) {
  if (!flights.length) return 'No flights found for these criteria.';
  const best = flights[0];
  const tierA = flights.filter(f => f.tier === 'A');
  const directs = flights.filter(f => f.stops === 0);
  const spread = flights[flights.length - 1].price - flights[0].price;
  const falling = flights.filter(f => f.trend === 'down').length;

  let rec = `<strong>Best pick:</strong> ${best.carrierName} departing ${best.departureDate}`;
  if (best.returnDate) rec += ` · return ${best.returnDate}`;
  rec += ` — <strong>A$${best.price.toLocaleString()}</strong> per person`;
  rec += best.stops === 0 ? ', direct.' : `, 1 stop via ${best.via}.`;

  if (spread > 500) rec += ` Big price range (A$${spread.toLocaleString()} spread) — flexible dates pay off here.`;
  if (falling > 3) rec += ` Prices trending down on ${falling} options — good time to book.`;
  if (directs.length && directs[0].id !== best.id) rec += ` Cheapest direct: ${directs[0].carrierName} A$${directs[0].price.toLocaleString()}.`;
  if (tierA.length && tierA[0].id !== best.id) rec += ` Best premium: ${tierA[0].carrierName} A$${tierA[0].price.toLocaleString()}.`;
  if (params.isMock) rec += ` <span style="opacity:.6;font-size:12px">(Demo data)</span>`;

  return rec;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    origin = 'SYD',
    destination,
    departDate,
    returnDate,
    stayDays,
    flexDays = 3,
    passengers = 1,
    cabin = 'economy',
    maxStops = 'any',
  } = req.body;

  if (!destination || !departDate) {
    return res.status(400).json({ error: 'Destination and departure date are required.' });
  }

  try {
    let flights = [];
    const shouldMock = MOCK_MODE;

    if (shouldMock) {
      flights = generateMockFlights(origin, destination, departDate, returnDate, stayDays, passengers, cabin);
    } else {
      const flex = Math.min(parseInt(flexDays) || 0, 3);
      const baseDate = new Date(departDate);
      const datesToSearch = [];
      for (let d = -flex; d <= flex; d++) {
        const sd = new Date(baseDate);
        sd.setDate(baseDate.getDate() + d);
        datesToSearch.push(sd.toISOString().split('T')[0]);
      }
      const results = await Promise.all(
        datesToSearch.map(date =>
          searchDuffel(origin, destination, date, returnDate, passengers, cabin).catch(() => [])
        )
      );
      const all = results.flat();
      const seen = new Set();
      flights = all.filter(f => {
        const key = `${f.carrierCode}-${f.departureTime}-${f.departureDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (maxStops !== 'any') {
      flights = flights.filter(f => f.stops <= parseInt(maxStops));
    }

    flights = flights.sort((a, b) => a.price - b.price).slice(0, 15).map((f, i) => ({ ...f, rank: i + 1 }));
    const recommendation = generateRecommendation(flights, { isMock: shouldMock });

    return res.status(200).json({ flights, recommendation, isMock: shouldMock });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
