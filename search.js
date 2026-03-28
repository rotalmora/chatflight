// search.js — returns raw flight data only, no filtering
// All analysis, filtering and ranking is done by Claude in chat.js

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
  'TK': 1189, 'AI': 989,  'KL': 1229, 'LH': 1379, 'D7': 849
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
  const cabinMult = { economy: 1, premium_economy: 1.8, business: 3.5, first: 5.5 }[cabin] || 1;
  const pax = parseInt(passengers) || 1;
  const flex = parseInt(flexDays) || 0;

  // Calculate exact stay duration
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
      // Only offset departure if user asked for flexibility
      const depOffset = flex > 0 ? Math.floor(rand() * (flex * 2 + 1)) - flex : 0;
      const actualDepart = depOffset !== 0 ? addDays(departDate, depOffset) : departDate;

      // Return date always = depart + exact stay duration
      const actualReturn = addDays(actualDepart, exactStayDays);

      const base = BASE_PRICES[code] || 1200;
      const variance = Math.round((rand() - 0.5) * 250);
      const price = Math.round((base + variance) * cabinMult * pax);

      // US/Canada routes always have 1 stop
      const forceStop = ['AA', 'UA', 'AC', 'D7'].includes(code);
      const stops = forceStop ? 1 : (rand() > 0.7 ? 0 : 1);

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
        id: `mock_${code}_${v}_${actualDepart}`,
        carrierCode: code,
        carrierName: airline.name,
        tier: airline.tier,
        stops,
        stopoverCity: stops > 0 ? airline.hubCity : null,
        stopoverRegion: stops > 0 ? airline.hubRegion : null,
        stopoverCode: stops > 0 ? airline.hub : null,
        departureDate: formatDisplayDate(actualDepart),
        returnDate: formatDisplayDate(actualReturn),
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
      });
    }
  });

  return flights.sort((a, b) => a.price - b.price);
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
  } = req.body;

  if (!destination || !departDate) {
    return res.status(400).json({ error: 'Destination and departure date are required.' });
  }

  try {
    // TODO: Replace generateMockFlights with searchDuffel() when ready for live data
    const flights = generateMockFlights(
      origin, destination, departDate, returnDate,
      stayDays, flexDays, passengers, cabin
    );

    // Return ALL raw flights — Claude in chat.js decides what to show
    return res.status(200).json({ flights, isMock: true });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
