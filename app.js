// Chatflight — Frontend App Logic

const AIRLINE_TIERS = {
  'QR': { name: 'Qatar Airways', tier: 'A' },
  'EK': { name: 'Emirates', tier: 'A' },
  'SQ': { name: 'Singapore Airlines', tier: 'A' },
  'QF': { name: 'Qantas', tier: 'A' },
  'CX': { name: 'Cathay Pacific', tier: 'A' },
  'TG': { name: 'Thai Airways', tier: 'A' },
  'LH': { name: 'Lufthansa', tier: 'A' },
  'BA': { name: 'British Airways', tier: 'A' },
  'AF': { name: 'Air France', tier: 'A' },
  'NH': { name: 'ANA', tier: 'A' },
  'JL': { name: 'Japan Airlines', tier: 'A' },
  'MH': { name: 'Malaysia Airlines', tier: 'B' },
  'TK': { name: 'Turkish Airlines', tier: 'B' },
  'AI': { name: 'Air India', tier: 'B' },
  'ET': { name: 'Ethiopian Airlines', tier: 'B' },
  'KL': { name: 'KLM', tier: 'B' },
  'UL': { name: 'SriLankan Airlines', tier: 'B' },
  'D7': { name: 'AirAsia X', tier: 'C' },
  'SL': { name: 'Thai Lion Air', tier: 'C' },
  'XY': { name: 'Flynas', tier: 'C' },
};

let chatHistory = [];
let currentResults = [];
let activeTiers = new Set(['A', 'B']);

// Set default dates
const today = new Date();
const depart = new Date(today); depart.setDate(today.getDate() + 30);
const ret = new Date(today); ret.setDate(today.getDate() + 44);
document.getElementById('departDate').value = depart.toISOString().split('T')[0];
document.getElementById('returnDate').value = ret.toISOString().split('T')[0];

// Tier toggle
function toggleTier(btn) {
  const tier = btn.dataset.tier;
  if (activeTiers.has(tier)) {
    if (activeTiers.size > 1) {
      activeTiers.delete(tier);
      btn.classList.remove('active');
    }
  } else {
    activeTiers.add(tier);
    btn.classList.add('active');
  }
}

// Suggestion chips
function sendSuggestion(btn) {
  document.getElementById('chatInput').value = btn.textContent;
  sendChat();
}

// Chat input enter key
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});

// Add message to chat UI
function addMessage(role, text, isTyping = false) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : ''}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? 'You' : 'AI'}</div>
    <div class="msg-bubble ${isTyping ? 'typing' : ''}">${text}</div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// Send chat message
async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  // Hide suggestions after first message
  document.getElementById('suggestions').style.display = 'none';

  input.value = '';
  addMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const typingDiv = addMessage('assistant', 'Thinking...', true);
  document.getElementById('chatSendBtn').disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory })
    });

    const data = await response.json();

    if (data.error) throw new Error(data.error);

    typingDiv.remove();

    const reply = data.reply;
    chatHistory.push({ role: 'assistant', content: reply });

    // Check if AI extracted search params
    if (data.searchParams) {
      addMessage('assistant', reply);
      // Pre-fill form with extracted params
      if (data.searchParams.origin) document.getElementById('origin').value = data.searchParams.origin;
      if (data.searchParams.destination) document.getElementById('destination').value = data.searchParams.destination;
      if (data.searchParams.departDate) document.getElementById('departDate').value = data.searchParams.departDate;
      if (data.searchParams.returnDate) document.getElementById('returnDate').value = data.searchParams.returnDate;
      // Trigger search
      await doSearch(data.searchParams);
    } else {
      addMessage('assistant', reply);
    }
  } catch (err) {
    typingDiv.remove();
    addMessage('assistant', "Sorry, I couldn't process that. Please try again or use the search form below.");
    console.error(err);
  }

  document.getElementById('chatSendBtn').disabled = false;
  document.getElementById('chatInput').focus();
}

// Form search
async function doFormSearch() {
  const origin = document.getElementById('origin').value.trim().toUpperCase();
  const destination = document.getElementById('destination').value.trim().toUpperCase();
  const departDate = document.getElementById('departDate').value;
  const returnDate = document.getElementById('returnDate').value;
  const flexDays = parseInt(document.getElementById('flexDays').value);
  const passengers = parseInt(document.getElementById('passengers').value);
  const cabin = document.getElementById('cabin').value;
  const maxStops = document.getElementById('maxStops').value;

  if (!origin || !destination) {
    alert('Please enter both origin and destination airports.');
    return;
  }
  if (!departDate) {
    alert('Please select a departure date.');
    return;
  }

  await doSearch({ origin, destination, departDate, returnDate, flexDays, passengers, cabin, maxStops });
}

// Core search function
async function doSearch(params) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.style.display = 'block';
  resultsDiv.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      Searching flights across ${params.flexDays > 0 ? `±${params.flexDays} days` : 'your dates'}...
    </div>
  `;
  resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('searchBtn').disabled = true;

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    const data = await response.json();

    if (data.error) throw new Error(data.error);

    currentResults = data.flights || [];
    renderResults(data, params);

  } catch (err) {
    resultsDiv.innerHTML = `
      <div class="no-results">
        <p>Couldn't fetch flights right now.</p>
        <p style="font-size:12px;margin-top:6px;color:var(--text-3)">${err.message}</p>
      </div>
    `;
    console.error(err);
  }

  document.getElementById('searchBtn').disabled = false;
}

// Render results
function renderResults(data, params) {
  const resultsDiv = document.getElementById('results');
  const flights = data.flights || [];

  if (flights.length === 0) {
    resultsDiv.innerHTML = `<div class="no-results">No flights found for these criteria. Try adjusting your dates or filters.</div>`;
    return;
  }

  const routeLabel = `${params.origin} → ${params.destination}`;
  const html = `
    <div class="ai-banner">${data.recommendation || 'Here are the best options found.'}</div>
    <div class="results-header">
      <div class="results-title">${flights.length} flights · ${routeLabel}</div>
      <select class="sort-select" onchange="sortResults(this.value)">
        <option value="rank">Recommended</option>
        <option value="price">Cheapest first</option>
        <option value="stops">Fewest stops</option>
        <option value="duration">Shortest flight</option>
      </select>
    </div>
    <div id="flightCards">
      ${flights.map((f, i) => renderCard(f, i)).join('')}
    </div>
  `;
  resultsDiv.innerHTML = html;
}

function renderCard(f, i) {
  const tierInfo = AIRLINE_TIERS[f.carrierCode] || { name: f.carrierName || f.carrierCode, tier: 'B' };
  const tierBadgeClass = { A: 'badge-a', B: 'badge-b', C: 'badge-c' }[tierInfo.tier] || 'badge-c';
  const stopLabel = f.stops === 0 ? 'Direct' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`;
  const stopBadgeClass = f.stops === 0 ? 'badge-direct' : 'badge-stop';
  const isTop = i === 0;
  const rankClass = i === 0 ? 'gold' : '';
  const trendHtml = f.trend === 'down'
    ? `<div class="fc-trend-down">↓ falling</div>`
    : f.trend === 'up'
    ? `<div class="fc-trend-up">↑ rising</div>`
    : `<div class="fc-trend-flat">— stable</div>`;

  return `
    <div class="flight-card ${isTop ? 'top' : ''}">
      <div class="fc-rank ${rankClass}">#${i + 1}</div>
      <div>
        <div class="fc-top-row">
          ${isTop ? '<span class="badge badge-best">Top pick</span>' : ''}
          <span class="fc-airline">${tierInfo.name}</span>
          <span class="badge ${tierBadgeClass}">Tier ${tierInfo.tier}</span>
          <span class="badge ${stopBadgeClass}">${stopLabel}</span>
        </div>
        <div class="fc-route">
          <span class="fc-time">${f.departureTime}</span>
          <span class="fc-arrow">→</span>
          <span class="fc-time">${f.arrivalTime}</span>
          <span class="fc-duration">${f.duration}</span>
        </div>
        <div class="fc-date">${f.departureDate}${f.stops > 0 ? ` · via ${f.via || '?'}` : ''}</div>
      </div>
      <div class="fc-price-col">
        <div class="fc-price">A$${Math.round(f.price).toLocaleString()}</div>
        <div class="fc-price-sub">per person</div>
        ${trendHtml}
        <button class="fc-book-btn" onclick="bookFlight('${f.deepLink || '#'}')">Book →</button>
      </div>
    </div>
  `;
}

function sortResults(val) {
  let sorted = [...currentResults];
  if (val === 'price') sorted.sort((a, b) => a.price - b.price);
  else if (val === 'stops') sorted.sort((a, b) => a.stops - b.stops);
  else if (val === 'duration') sorted.sort((a, b) => (a.durationMins || 0) - (b.durationMins || 0));
  else sorted.sort((a, b) => a.rank - b.rank);
  document.getElementById('flightCards').innerHTML = sorted.map((f, i) => renderCard(f, i)).join('');
}

function bookFlight(url) {
  if (url && url !== '#') window.open(url, '_blank');
  else alert('Booking link not available in test mode. Connect live Duffel API for real links.');
}
