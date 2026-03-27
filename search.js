// search.js — Flight Search with constraint awareness

const MOCK_MODE = true; // Set to false when ready for live Duffel data

const AIRLINES = {
  'QR': { name: 'Qatar Airways', tier: 'A', hub: 'DOH', hubCity: 'Doha', hubRegion: 'middleeast' },
  'EK': { name: 'Emirates', tier: 'A', hub: 'DXB', hubCity: 'Dubai', hubRegion: 'middleeast' },
  'SQ': { name: 'Singapore Airlines', tier: 'A', hub: 'SIN', hubCity: 'Singapore', hubRegion: 'asia' },
  'QF': { name: 'Qantas', tier: 'A', hub: 'SIN', hubCity: 'Singapore', hubRegion: 'asia' },
  'CX': { name: 'Cathay Pacific', tier: 'A', hub: 'HKG', hubCity: 'Hong Kong', hubRegion: 'asia' },
  'EY': { name: 'Etihad Airways', tier: 'A', hub: 'AUH', hubCity: 'Abu Dhabi', hubRegion: 'middleeast' },
  'AA': { name: 'American Airlines', tier: 'B', hub: 'DFW', hubCity: 'Dallas', hubRegion: 'us' },
  'UA': { name: 'United Airlines', tier: 'B', hub: 'LAX', hubCity: 'Los Angeles', hubRegion: 'us' },
  'AC': { name: 'Air Canada', tier: 'B', hub: 'YVR', hubCity: 'Vancouver', hubRegion: 'canada' },
  'MH': { name: 'Malaysia Airlines', tier: 'B', hub: 'KUL', hubCity: 'Kuala Lumpur', hubRegion: 'asia' },
  'TK': { name: 'Turkish Airlines', tier: 'B', hub: 'IST', hubCity: 'Istanbul', hubRegion: 'europe' },
  'AI': { name: 'Air India', tier: 'B', hub: 'DEL', hubCity: 'Delhi', hubRegion: 'asia' },
  'KL': { name: 'KLM', tier: 'B', hub: 'AMS', hubCity: 'Amsterdam', hubRegion: 'europe' },
  'LH': { name: 'Lufthansa', tier: 'A', hub: 'FRA', hubCity: 'Frankfurt', hubRegion: 'europe' },
  'D7': { name: 'AirAsia X', tier: 'C', hub: 'KUL', hubCity: 'Kuala Lumpur', hubRegion: 'asia' },
};

const BASE_PRICES = {
  'QR': 1289, 'EK': 1349, 'SQ': 1399, 'QF': 1459, 'CX': 1319,
  'EY': 1279, 'AA': 1599, 'UA': 1549, 'AC': 1489, 'MH': 1099,
  'TK': 1189, 'AI': 989, 'KL': 1229, 'LH': 1379, 'D7': 849
};

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
  const flights = [];
  const cabinMult = { economy: 1, premium_economy: 1.8, business: 3.5, first: 5.5 }[cabin] || 1;
  const pax = parseInt(passengers) || 1;
  const flex = parseInt(flexDays) || 0;

  let exactStayDays = stayDays;
  if (!exactStayDays && returnDate) {
    const dep = new Date(departDate + 'T00:00:00');
    const ret = new Date(returnDate + 'T00:00:00');
    exactStayDays = Math.round((ret - dep) / (1000 * 60 * 60 * 24));
  }
  if (!exactStayDays) exactStayDays = 14;

  Object.keys(AIRLINES).forEach((code) => {
    const airline = AIRLINES[code];
    const variants = flex > 0 ? 2 : 1;

    for (let v = 0; v < variants; v++) {
      const depOffset = flex > 0 ? Math.floor(rand() * (flex * 2 + 1)) - flex : 0;
      const actualDepartDate = depOffset !== 0 ? addDays(departDate, depOffset) : departDate;
      const actualReturnDate = addDays(actualDepartDate, exactStayDays);

      const base = BASE_PRICES[code] || 1200;
      const variance = Math.round((rand() - 0.5) * 250);
      const price = Math.round((base + variance) * cabinMult * pax);

      const stops = (code === 'D7' || code === 'AA' || code === 'UA' || code === 'AC') ? 1 : (rand() > 0.7 ? 0 : 1);
      const durationMins = stops === 0
        ? Math.round(1380 + rand() * 120)
        : Math.round(1560 + rand() * 300);

      const depHour = 6 + Math.floor(rand() * 16);
      const depMin = Math.floor(rand() * 4) * 15;
      const totalMins = depHour * 60 + depMin + durationMins;
      const arrHour = Math.floor((totalMins % (24 * 60)) / 60);
      const arrMin = totalMins % 60;
      const nextDay = totalMins >= 24 * 60;

      const trendRoll = rand();
      const trend = trendRoll > 0.6 ? 'down' : trendRoll > 0.3 ? 'stable' : 'up';

      flights.push({
        id: `mock_${code}_${v}_${actualDepartDate}`,
        carrierCode: code,
        carrierName: airline.name,
        tier: airline.tier,
        stops,
        via: stops > 0 ? airline.hub : null,
        viaCity: stops > 0 ? airline.hubCity : null,
        viaRegion: stops > 0 ? airline.hubRegion : null,
        departureDate: formatDisplayDate(actualDepartDate),
        returnDate: formatDisplayDate(actualReturnDate),
        departureDateRaw: actualDepartDate,
        returnDateRaw: actualReturnDate,
        stayDays: exactStayDays,
        departureTime: `${String(depHour).padStart(2,'0')}:${String(depMin).padStart(2,'0')}`,
        arrivalTime: `${String(arrHour).padStart(2,'0')}:${String(arrMin).padStart(2,'0')}${nextDay ? ' +1' : ''}`,
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
  return new Date(isoString).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

async function searchDuffel(origin, destination, departDate, returnDate, passengers, cabin) {
  const slices = [{ origin, destination, departure_date: departDate }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });

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

  if (!response.ok) throw new Error(`Duffel API error: ${response.status}`);
  const data = await response.json();
  const pax = parseInt(passengers) || 1;

  return (data.data?.offers || []).map(offer => {
    const slice = offer.slices[0];
    const segments = slice?.segments || [];
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const carrierCode = firstSeg?.marketing_carrier?.iata_code || '??';
    const airline = AIRLINES[carrierCode] || { name: firstSeg?.marketing_carrier?.name || carrierCode, tier: 'B', hubRegion: 'unknown' };
    const stops = segments.length - 1;
    const duration = parseDuration(slice?.duration || 'PT0H');
    const price = Math.round(parseFloat(offer.total_amount) * (offer.total_currency === 'USD' ? 1.55 : 1));
    const stopAirport = stops > 0 ? segments[0]?.destination?.iata_code : null;

    return {
      id: offer.id,
      carrierCode,
      carrierName: airline.name,
      tier: airline.tier,
      stops,
      via: stopAirport,
      viaCity: stopAirport,
      viaRegion: airline.hubRegion || 'unknown',
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

function generateRecommendation(flights, isMock) {
  if (!flights.length) return null;
  const best = flights[0];
  const tierA = flights.filter(f => f.tier === 'A');
  const directs = flights.filter(f => f.stops === 0);
  const spread = flights[flights.length - 1].pricePerPax - flights[0].pricePerPax;
  const falling = flights.filter(f => f.trend === 'down').length;

  let rec = `<strong>Best pick:</strong> ${best.carrierName}`;
  rec += ` departing ${best.departureDate}`;
  if (best.returnDate) rec += ` · returning ${best.returnDate} (${best.stayDays}-day stay)`;
  rec += ` — <strong>A$${best.pricePerPax.toLocaleString()} per person</strong>`;
  rec += best.stops === 0 ? ', direct.' : `, 1 stop via ${best.viaCity || best.via}.`;
  if (spread > 400) rec += ` Prices range A$${flights[0].pricePerPax.toLocaleString()}–A$${flights[flights.length-1].pricePerPax.toLocaleString()}.`;
  if (falling > 2) rec += ` ${falling} airlines showing falling prices.`;
  if (directs.length && directs[0].id !== best.id) rec += ` Cheapest direct: ${directs[0].carrierName} A$${directs[0].pricePerPax.toLocaleString()}.`;
  if (tierA.length && tierA[0].id !== best.id) rec += ` Best premium: ${tierA[0].carrierName} A$${tierA[0].pricePerPax.toLocaleString()}.`;
  if (isMock) rec += ` <span style="opacity:.55;font-size:12px">(Demo data)</span>`;

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
    flexDays = 0,
    passengers = 1,
    cabin = 'economy',
    maxStops = 'any',
    constraints = {},
  } = req.body;

  if (!destination || !departDate) {
    return res.status(400).json({ error: 'Destination and departure date are required.' });
  }

  try {
    let flights = [];

    if (MOCK_MODE) {
      flights = generateMockFlights(origin, destination, departDate, returnDate, stayDays, flexDays, passengers, cabin);
    } else {
      const flex = Math.min(parseInt(flexDays) || 0, 3);
      const baseDate = new Date(departDate + 'T00:00:00');
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

    // Apply stops filter
    if (maxStops !== 'any') {
      flights = flights.filter(f => f.stops <= parseInt(maxStops));
    }

    // Apply constraint filters and build warning messages
    const warnings = [];
    let filteredFlights = [...flights];

    // Stopover region/city constraint
    if (constraints.stopoverRegion) {
      const region = constraints.stopoverRegion.toLowerCase();
      const matching = flights.filter(f =>
        f.stops === 0 || (f.viaRegion && f.viaRegion.toLowerCase().includes(region)) ||
        (f.viaCity && f.viaCity.toLowerCase().includes(region))
      );
      if (matching.length === 0) {
        warnings.push(`No flights found with stopovers in ${constraints.stopoverRegion}. Showing all available options instead.`);
      } else {
        filteredFlights = matching;
        if (matching.length < flights.length) {
          warnings.push(`Showing only flights with stopovers in ${constraints.stopoverRegion} (${matching.length} of ${flights.length} options). Remove this filter to see more.`);
        }
      }
    }

    // Specific airline constraint
    if (constraints.airlines && constraints.airlines.length > 0) {
      const requestedAirlines = constraints.airlines.map(a => a.toLowerCase());
      const matching = filteredFlights.filter(f =>
        requestedAirlines.some(a => f.carrierName.toLowerCase().includes(a) || f.carrierCode.toLowerCase() === a)
      );
      if (matching.length === 0) {
        warnings.push(`No flights found for ${constraints.airlines.join(', ')}. Showing all available airlines instead.`);
      } else {
        filteredFlights = matching;
      }
    }

    // Max duration constraint
    if (constraints.maxDurationHours) {
      const maxMins = constraints.maxDurationHours * 60;
      const matching = filteredFlights.filter(f => f.durationMins <= maxMins);
      if (matching.length === 0) {
        warnings.push(`No flights found under ${constraints.maxDurationHours} hours. Showing shortest available options instead.`);
        filteredFlights = filteredFlights.sort((a, b) => a.durationMins - b.durationMins).slice(0, 8);
      } else {
        filteredFlights = matching;
      }
    }

    // Departure time constraint
    if (constraints.departureWindow) {
      const windows = {
        morning: { start: 6, end: 12 },
        afternoon: { start: 12, end: 18 },
        evening: { start: 18, end: 24 },
        night: { start: 0, end: 6 },
      };
      const window = windows[constraints.departureWindow.toLowerCase()];
      if (window) {
        const matching = filteredFlights.filter(f => {
          const hour = parseInt(f.departureTime.split(':')[0]);
          return hour >= window.start && hour < window.end;
        });
        if (matching.length === 0) {
          warnings.push(`No ${constraints.departureWindow} departures found. Showing all departure times instead.`);
        } else {
          filteredFlights = matching;
        }
      }
    }

    filteredFlights = filteredFlights
      .sort((a, b) => a.price - b.price)
      .slice(0, 15)
      .map((f, i) => ({ ...f, rank: i + 1 }));

    const recommendation = generateRecommendation(filteredFlights, MOCK_MODE);

    return res.status(200).json({
      flights: filteredFlights,
      recommendation,
      warnings,
      isMock: MOCK_MODE,
      totalFound: flights.length,
    });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
