// api/search.js — Vercel Serverless Function
// Handles flight search using Duffel API

const AIRLINE_TIERS = {
  'QR': 'A', 'EK': 'A', 'SQ': 'A', 'QF': 'A', 'CX': 'A',
  'TG': 'A', 'LH': 'A', 'BA': 'A', 'AF': 'A', 'NH': 'A', 'JL': 'A',
  'MH': 'B', 'TK': 'B', 'AI': 'B', 'ET': 'B', 'KL': 'B', 'UL': 'B',
  'D7': 'C', 'AK': 'C', 'FD': 'C',
};

function getAirlineTier(code) {
  return AIRLINE_TIERS[code] || 'B';
}

function parseDuration(iso) {
  // Parse ISO 8601 duration like PT23H35M
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
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function getStopVia(slices) {
  // Get first stopover airport
  if (!slices || slices.length === 0) return null;
  const slice = slices[0];
  if (!slice.segments || slice.segments.length <= 1) return null;
  return slice.segments[0].destination.iata_code;
}

async function searchDuffel(origin, destination, departDate, returnDate, passengers, cabin) {
  const slices = [{ origin, destination, departure_date: departDate }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });

  const cabinMap = {
    'economy': 'economy',
    'premium_economy': 'premium_economy',
    'business': 'business',
    'first': 'first'
  };

  const body = {
    data: {
      slices,
      passengers: Array(passengers).fill({ type: 'adult' }),
      cabin_class: cabinMap[cabin] || 'economy',
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

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Duffel API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.data?.offers || [];
}

function processOffers(offers, maxStops) {
  return offers
    .filter(offer => {
      if (maxStops === 'any') return true;
      const stops = offer.slices[0]?.segments?.length - 1 || 0;
      return stops <= parseInt(maxStops);
    })
    .map(offer => {
      const slice = offer.slices[0];
      const segments = slice?.segments || [];
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      const carrierCode = firstSeg?.marketing_carrier?.iata_code || '??';
      const carrierName = firstSeg?.marketing_carrier?.name || carrierCode;
      const stops = segments.length - 1;
      const duration = parseDuration(slice?.duration || 'PT0H');
      const via = getStopVia(offer.slices);
      const price = parseFloat(offer.total_amount);

      return {
        id: offer.id,
        carrierCode,
        carrierName,
        tier: getAirlineTier(carrierCode),
        stops,
        via,
        departureTime: formatTime(firstSeg?.departing_at),
        arrivalTime: formatTime(lastSeg?.arriving_at),
        departureDate: formatDate(firstSeg?.departing_at),
        duration: duration.text,
        durationMins: duration.mins,
        price,
        currency: offer.total_currency,
        deepLink: offer.payment_requirements?.requires_instant_payment ? null : null,
        trend: price < 1200 ? 'down' : price > 1600 ? 'up' : 'flat',
      };
    })
    .sort((a, b) => a.price - b.price)
    .slice(0, 8)
    .map((f, i) => ({ ...f, rank: i + 1 }));
}

function generateRecommendation(flights) {
  if (!flights.length) return 'No flights found for these criteria.';
  const best = flights[0];
  const tierAFlights = flights.filter(f => f.tier === 'A');
  const cheapest = flights[0];
  const mostExpensive = flights[flights.length - 1];
  const spread = mostExpensive.price - cheapest.price;

  let rec = `<strong>Top pick:</strong> ${best.carrierName} at A$${Math.round(best.price).toLocaleString()}`;
  if (best.stops === 0) rec += ' — direct flight, best value overall.';
  else rec += ` via ${best.via || 'connection'}.`;

  if (spread > 300) {
    rec += ` There's a A$${Math.round(spread).toLocaleString()} spread across options — worth comparing carefully.`;
  }

  if (tierAFlights.length > 0 && tierAFlights[0].id !== best.id) {
    rec += ` Best premium option: ${tierAFlights[0].carrierName} at A$${Math.round(tierAFlights[0].price).toLocaleString()}.`;
  }

  return rec;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    origin = 'SYD',
    destination,
    departDate,
    returnDate,
    flexDays = 0,
    passengers = 1,
    cabin = 'economy',
    maxStops = 'any'
  } = req.body;

  if (!destination || !departDate) {
    return res.status(400).json({ error: 'Destination and departure date are required.' });
  }

  try {
    // Search across flexible dates if requested
    const datesToSearch = [];
    const baseDate = new Date(departDate);
    const flex = Math.min(parseInt(flexDays) || 0, 3); // cap at 3 to manage API usage

    for (let d = -flex; d <= flex; d++) {
      const searchDate = new Date(baseDate);
      searchDate.setDate(baseDate.getDate() + d);
      datesToSearch.push(searchDate.toISOString().split('T')[0]);
    }

    // Search all dates in parallel (capped to manage API quota)
    const searchPromises = datesToSearch.map(date =>
      searchDuffel(origin, destination, date, returnDate, parseInt(passengers), cabin)
        .catch(err => { console.error(`Search failed for ${date}:`, err); return []; })
    );

    const allResults = await Promise.all(searchPromises);
    const allOffers = allResults.flat();

    if (allOffers.length === 0) {
      return res.status(200).json({
        flights: [],
        recommendation: 'No flights found. Try adjusting your dates, destination, or filters.'
      });
    }

    const flights = processOffers(allOffers, maxStops);
    const recommendation = generateRecommendation(flights);

    return res.status(200).json({ flights, recommendation });

  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
