const boroughNames = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', R: 'Staten Island', X: 'Bronx' };
const defaultWeights = { demand: 35, access: 25, complaints: 20, suitability: 20 };
const state = {
  runs: [],
  parks: [],
  complaintHotspots: [],
  neighborhoods: null,
  demand: null,
  opportunities: [],
  borough: 'ALL',
  query: '',
  selected: null,
  scoreScope: 'without-runs',
  weights: { ...defaultWeights },
  weightDraft: { ...defaultWeights },
  layers: { places: true, demand: false, requests: false }
};

const svg = d3.select('#map');
const mapRoot = svg.append('g');
const neighborhoodLayer = mapRoot.append('g');
const demandLayer = mapRoot.append('g');
const parkLayer = mapRoot.append('g');
const complaintLayer = mapRoot.append('g');
const runLayer = mapRoot.append('g');
const loading = document.querySelector('#loading');
const list = document.querySelector('#run-list');
const detail = document.querySelector('#detail-card');
const mapTooltip = document.querySelector('#map-tooltip');
const TOP_CANDIDATE_COUNT = 8;
let scoreRequestId = 0;
let projection;
let path;

const zoom = d3.zoom().scaleExtent([1, 12]).on('zoom', (event) => {
  mapRoot.attr('transform', event.transform);
});
svg.call(zoom);

function boroughMatches(borough) {
  return state.borough === 'ALL' || borough === state.borough || borough === boroughNames[state.borough];
}

function filteredRuns() {
  const term = state.query.trim().toLowerCase();
  return state.runs.filter((run) => {
    const boroughMatch = boroughMatches(run.properties.borough);
    const textMatch = !term || run.properties.name.toLowerCase().includes(term) || (run.properties.zipcode || '').includes(term);
    return boroughMatch && textMatch;
  });
}

function renderFilters() {
  const counts = d3.rollup(state.runs, (values) => values.length, (run) => run.properties.borough);
  const filters = [['ALL', 'All', state.runs.length], ...Object.entries(boroughNames).map(([code, name]) => [code, name, counts.get(code) || 0])];
  d3.select('#borough-filters').selectAll('button').data(filters).join('button')
    .attr('type', 'button')
    .attr('class', ([code]) => `filter${state.borough === code ? ' active' : ''}`)
    .attr('aria-pressed', ([code]) => state.borough === code)
    .text(([, name, count]) => `${name} ${count}`)
    .on('click', (_event, [code]) => { state.borough = code; render(); });
}

function render() {
  const runs = filteredRuns();
  const visibleRuns = state.runs.filter((run) => boroughMatches(run.properties.borough));
  const visibleOpportunities = state.opportunities.filter((park) => boroughMatches(park.properties.borough));
  document.querySelector('#visible-count').textContent = visibleRuns.length;
  document.querySelector('#borough-count').textContent = new Set(visibleRuns.map((run) => run.properties.borough)).size;
  renderFilters();
  renderRunList(runs);
  renderOpportunityList(visibleOpportunities);
  renderLayers(visibleRuns, visibleOpportunities);
  renderLegend();
}

function renderRunList(runs) {
  const items = d3.select(list).selectAll('button.run-item').data(runs, (run) => run.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'run-item').html('<span class="dot"></span><span><strong></strong><small></small></span>'),
    (update) => update,
    (exit) => exit.remove()
  );
  items.classed('active', (run) => state.selected === `run:${run.id}`)
    .on('click', (_event, run) => selectRun(run, true));
  items.select('strong').text((run) => run.properties.name);
  items.select('small').text((run) => `${boroughNames[run.properties.borough]} · ${run.properties.zipcode || 'ZIP unavailable'}`);
  d3.select(list).selectAll('p.empty').data(runs.length ? [] : [null]).join('p').attr('class', 'empty').text('No dog runs match your search.');
}

function renderOpportunityList(opportunities) {
  const topParks = opportunities.slice(0, TOP_CANDIDATE_COUNT);
  document.querySelector('#opportunity-heading').textContent =
    state.scoreScope === 'all' ? 'Top ranked parks' : 'Top parks without a dog run';
  const items = d3.select('#opportunity-list').selectAll('button.opportunity-item').data(topParks, (park) => park.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'opportunity-item')
      .html('<span class="rank"></span><span><strong></strong><small></small></span><b class="score"></b>'),
    (update) => update,
    (exit) => exit.remove()
  );
  items.classed('active', (park) => state.selected === `opportunity:${park.id}`)
    .on('click', (_event, park) => selectOpportunity(park, true));
  items.select('.rank').text((park) => `#${park.properties.rank}`);
  items.select('strong').text((park) => park.properties.name);
  items.select('small').text((park) => `${park.properties.borough || 'NYC'} · ${park.properties.acres.toFixed(1)} acres`);
  items.select('.score').text((park) => Math.round(park.properties.score));
  d3.select('#opportunity-list').selectAll('p.empty').data(topParks.length ? [] : [null]).join('p')
    .attr('class', 'empty')
    .text(state.scoreScope === 'all' ? 'No parks to rank in this borough.' : 'No candidate parks in this borough.');
}

function renderWeights() {
  for (const [factor, weight] of Object.entries(state.weightDraft)) {
    document.querySelector(`#weight-${factor}`).value = weight;
    document.querySelector(`#weight-${factor}-value`).textContent = `${weight}%`;
  }
  const total = Object.values(state.weightDraft).reduce((sum, weight) => sum + weight, 0);
  const isValid = total === 100;
  document.querySelector('#weight-total').textContent = `${total}%`;
  document.querySelector('#apply-weights').disabled = !isValid;
  const validation = document.querySelector('#weight-validation');
  validation.classList.toggle('invalid', !isValid);
  validation.textContent = isValid
    ? 'Weights total 100%. Apply to update rankings.'
    : `Weights total ${total}%. Adjust the weights to total 100% before applying.`;
}

function updateWeight(changedFactor, requestedValue) {
  state.weightDraft[changedFactor] = Math.max(0, Math.min(100, Math.round(requestedValue)));
  renderWeights();
}

function applyWeights() {
  const total = Object.values(state.weightDraft).reduce((sum, weight) => sum + weight, 0);
  if (total !== 100) {
    renderWeights();
    return;
  }
  state.weights = { ...state.weightDraft };
  updateOpportunityScores();
}

function opportunityUrl() {
  const params = new URLSearchParams({ scope: state.scoreScope });
  Object.entries(state.weights).forEach(([factor, weight]) => params.set(factor, String(weight)));
  return `/api/opportunities?${params}`;
}

function renderLayers(visibleRuns, visibleOpportunities) {
  const boroughDemand = state.demand.features.filter((feature) => boroughMatches(feature.properties.borough));
  demandLayer.style('display', state.layers.demand ? null : 'none');
  complaintLayer.style('display', state.layers.requests ? null : 'none');
  runLayer.style('display', state.layers.places ? null : 'none');

  const licenseScale = d3.scaleSequentialSqrt()
    .domain([0, d3.max(boroughDemand, (feature) => feature.properties.licenseEstimate) || 1])
    .interpolator(d3.interpolatePurples);
  demandLayer.selectAll('path').data(boroughDemand, (feature) => feature.id).join('path')
    .attr('class', 'demand-neighborhood')
    .attr('d', path)
    .attr('fill', (feature) => feature.properties.licenseEstimate ? licenseScale(feature.properties.licenseEstimate) : '#f6f3f8')
    .on('mouseenter', showDemandTooltip)
    .on('mouseleave', hideTooltip);

  const visibleParks = state.parks.filter((park) => boroughMatches(park.properties.borough));
  const candidatesByProperty = new Map(state.opportunities.map((park) => [String(park.id), park]));
  const displayedParks = visibleParks
    .map((park) => ({
      ...park,
      candidate: candidatesByProperty.get(String(park.id))
    }))
    .filter(() => state.layers.places);
  parkLayer.style('display', displayedParks.length ? null : 'none');
  const parkMarkers = parkLayer.selectAll('g.park-marker').data(displayedParks, (park) => park.id).join(
    (enter) => {
      const marker = enter.append('g').attr('class', 'park-marker');
      marker.append('rect').attr('class', 'park-point').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 12).attr('rx', 2);
      marker.append('text').attr('class', 'park-rank').attr('text-anchor', 'middle').attr('dy', '0.35em');
      marker.append('title');
      return marker;
    },
    (update) => update,
    (exit) => exit.remove()
  );
  parkMarkers
    .attr('transform', (park) => `translate(${projection([park.properties.longitude, park.properties.latitude])})`)
    .classed('candidate', (park) => Boolean(park.candidate))
    .classed('has-run', (park) => park.properties.hasDogRun)
    .classed('top-candidate', (park) => park.candidate?.properties.rank <= TOP_CANDIDATE_COUNT)
    .classed('selected', (park) => state.selected === `opportunity:${park.id}`)
    .on('mouseenter', showParkTooltip)
    .on('mousemove', positionMapTooltip)
    .on('mouseleave', hideMapTooltip)
    .on('click', (event, park) => {
      if (!park.candidate) return;
      event.stopPropagation();
      selectOpportunity(park.candidate, false);
    });
  parkMarkers.select('.park-rank')
    .text((park) => park.candidate?.properties.rank <= TOP_CANDIDATE_COUNT ? park.candidate.properties.rank : '')
    .style('display', (park) => park.candidate?.properties.rank <= TOP_CANDIDATE_COUNT ? null : 'none');
  parkMarkers.select('title').text((park) => park.candidate
    ? `#${park.candidate.properties.rank} ${park.properties.name} · score ${park.candidate.properties.score}/100`
    : `${park.properties.name} · ${park.properties.acres.toFixed(1)} acres`);

  const representedRunIds = new Set(state.parks.flatMap((park) => park.properties.dogRunIds || []));
  const unassociatedRuns = visibleRuns.filter((run) => !representedRunIds.has(run.properties.objectId));
  const visibleComplaintHotspots = state.complaintHotspots.filter((feature) => boroughMatches(feature.properties.borough));
  const complaintRadius = d3.scaleSqrt()
    .domain([1, d3.max(visibleComplaintHotspots, (feature) => feature.properties.complaintCount) || 1])
    .range([1.8, 6]);
  const complaintPoints = complaintLayer.selectAll('circle.complaint-point')
    .data(visibleComplaintHotspots, (feature) => feature.id).join('circle')
    .attr('class', 'complaint-point')
    .attr('cx', (feature) => projection([feature.properties.longitude, feature.properties.latitude])[0])
    .attr('cy', (feature) => projection([feature.properties.longitude, feature.properties.latitude])[1])
    .attr('r', (feature) => complaintRadius(feature.properties.complaintCount))
    .on('mouseenter', showComplaintTooltip)
    .on('mouseleave', hideTooltip);
  complaintPoints.selectAll('title').data((feature) => [feature]).join('title')
    .text((feature) => `${d3.format(',')(feature.properties.complaintCount)} dog-related 311 requests · ${feature.properties.neighborhood || feature.properties.borough || 'NYC'}`);

  const runPoints = runLayer.selectAll('g.run').data(unassociatedRuns, (run) => run.id).join(
    (enter) => {
      const group = enter.append('g').attr('class', 'run');
      group.append('circle').attr('class', 'run-halo').attr('r', 9);
      group.append('circle').attr('class', 'run-point').attr('r', 4.5);
      group.append('title');
      return group;
    },
    (update) => update,
    (exit) => exit.remove()
  );
  runPoints.attr('transform', (run) => `translate(${projection([run.properties.longitude, run.properties.latitude])})`)
    .on('click', (event, run) => { event.stopPropagation(); selectRun(run, false); });
  runPoints.select('.run-point').classed('selected', (run) => state.selected === `run:${run.id}`);
  runPoints.select('title').text((run) => `${run.properties.name} · Active dog run (no park match)`);
}

function renderLegend() {
  const demandFeatures = state.demand.features.filter((feature) => boroughMatches(feature.properties.borough));
  const maxLicenses = d3.max(demandFeatures, (feature) => feature.properties.licenseEstimate) || 0;
  const entries = [
    ['places', 'Park without an active dog run', 'park-legend', ''],
    ['places', 'Park with active dog run', 'occupied-park-legend', ''],
    ['places', 'Active dog run (no park match)', 'run-legend', ''],
    ['places', 'Top 8 scored parks · rank in box', 'top-candidate-legend', ''],
    ['places', 'Other scored parks · hover for rank', 'other-candidate-legend', ''],
    ['demand', 'Estimated dog-license demand', 'license-legend', `0–${d3.format(',')(Math.round(maxLicenses))} records`],
    ['requests', 'Dog-related 311 requests', 'complaint-legend', 'dot size = count in approx. 100 m cell'],
  ].filter(([layer]) => state.layers[layer]);
  d3.select('#map-key').selectAll('div').data(entries).join('div')
    .attr('class', 'key-item')
    .html(([, label, icon, range]) => `<span class="legend-dot ${icon}"></span><span>${label}${range ? `<small>${range}</small>` : ''}</span>`);
}

function showParkTooltip(event, park) {
  const heading = mapTooltip.querySelector('strong');
  const details = mapTooltip.querySelector('small');
  heading.textContent = park.properties.name;
  if (park.candidate) {
    const runInfo = park.properties.hasDogRun
      ? ` · ${park.properties.dogRunCount} active dog run${park.properties.dogRunCount === 1 ? '' : 's'}`
      : '';
    details.textContent =
      `Rank #${park.candidate.properties.rank} · Score ${Math.round(park.candidate.properties.score)}/100${runInfo}`;
  } else if (park.properties.hasDogRun && state.scoreScope === 'without-runs') {
    details.textContent = `${park.properties.borough || 'NYC'} · Existing dog run · excluded from this ranking`;
  } else if (park.properties.acres <= 0) {
    details.textContent = `${park.properties.borough || 'NYC'} · Not ranked: no positive reported acreage`;
  } else {
    details.textContent = `${park.properties.borough || 'NYC'} · ${park.properties.acres.toFixed(1)} acres · not scored`;
  }
  mapTooltip.hidden = false;
  positionMapTooltip(event);
}

function positionMapTooltip(event) {
  const bounds = document.querySelector('.map-panel').getBoundingClientRect();
  mapTooltip.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - mapTooltip.offsetWidth - 12)}px`;
  mapTooltip.style.top = `${Math.max(8, event.clientY - bounds.top - mapTooltip.offsetHeight - 12)}px`;
}

function hideMapTooltip() {
  mapTooltip.hidden = true;
}

function showDemandTooltip(event, feature) {
  const name = feature.properties.name;
  const licenses = d3.format(',')(Math.round(feature.properties.licenseEstimate));
  const complaints = d3.format(',')(feature.properties.complaintCount);
  d3.select('#map-key').attr('data-detail', `${name}: ~${licenses} estimated license records · ${complaints} 311 requests`);
}

function hideTooltip() {
  d3.select('#map-key').attr('data-detail', null);
}

function showComplaintTooltip(_event, feature) {
  const location = feature.properties.neighborhood || feature.properties.borough || 'NYC';
  d3.select('#map-key').attr('data-detail',
    `${d3.format(',')(feature.properties.complaintCount)} dog-related 311 requests near ${location} (approx. 100 m cell)`);
}

function selectRun(run, moveMap) {
  state.selected = `run:${run.id}`;
  const p = run.properties;
  document.querySelector('#detail-kicker').textContent = 'ACTIVE DOG RUN';
  document.querySelector('#detail-name').textContent = p.name;
  document.querySelector('#detail-location').textContent = `${boroughNames[p.borough]} · ${p.zipcode || 'ZIP unavailable'}`;
  document.querySelector('#run-details').hidden = false;
  document.querySelector('#opportunity-details').hidden = true;
  document.querySelector('#detail-surface').textContent = p.surface || 'Not listed';
  document.querySelector('#detail-seating').textContent = p.seating || 'Not listed';
  document.querySelector('#detail-area').textContent = p.areaSqM < 1000 ? `${Math.round(p.areaSqM)} m²` : `${(p.areaSqM / 1000).toFixed(1)}k m²`;
  document.querySelector('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
  detail.hidden = false;
  render();
  if (moveMap) zoomTo(projection([p.longitude, p.latitude]));
}

function selectOpportunity(park, moveMap) {
  state.selected = `opportunity:${park.id}`;
  const p = park.properties;
  document.querySelector('#detail-kicker').textContent = `PARK SCORE · RANK #${p.rank}`;
  document.querySelector('#detail-name').textContent = p.name;
  document.querySelector('#detail-location').textContent =
    `${p.borough || 'NYC'} · ${p.acres.toFixed(1)} acres${p.hasDogRun ? ` · ${p.dogRunCount} active dog run${p.dogRunCount === 1 ? '' : 's'}` : ' · no matched active dog run'}`;
  document.querySelector('#run-details').hidden = true;
  document.querySelector('#opportunity-details').hidden = false;
  document.querySelector('#detail-score').textContent = Math.round(p.score);
  document.querySelector('#detail-factors').textContent =
    `Weights — demand ${state.weights.demand}% · access ${state.weights.access}% · 311 ${state.weights.complaints}% · acreage ${state.weights.suitability}%. Factor scores /100 — demand ${Math.round(p.factors.dogDemand)} · access ${Math.round(p.factors.access)} · 311 ${Math.round(p.factors.complaints)} · acreage ${Math.round(p.factors.suitability)}.`;
  document.querySelector('#detail-caveat').textContent =
    `~${d3.format(',')(Math.round(p.licenseEstimate))} estimated license records · ${d3.format(',')(p.complaintCount)} dog-related 311 requests · nearest ${p.hasDogRun && state.scoreScope === 'all' ? 'other ' : ''}active run ${(p.nearestRunMeters / 1000).toFixed(1)} km straight-line`;
  const [longitude, latitude] = [p.longitude, p.latitude];
  document.querySelector('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  detail.hidden = false;
  render();
  if (moveMap) zoomTo(path.centroid(park));
}

function zoomTo([x, y]) {
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(5).translate(-x, -y));
}

function resetView() {
  state.selected = null;
  detail.hidden = true;
  svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  render();
}

function drawMap() {
  const bounds = svg.node().getBoundingClientRect();
  projection = d3.geoMercator().fitExtent([[28, 28], [bounds.width - 28, bounds.height - 28]], state.neighborhoods);
  path = d3.geoPath(projection);
  neighborhoodLayer.selectAll('path').data(state.neighborhoods.features).join('path')
    .attr('class', 'neighborhood').attr('d', path).selectAll('title').data((feature) => [feature]).join('title')
    .text((feature) => feature.properties.name);
  render();
}

async function init() {
  try {
    const [runsResponse, neighborhoodsResponse, parksResponse, demandResponse, complaintResponse, opportunitiesResponse] = await Promise.all([
      fetch('/api/dog-runs'),
      fetch('/api/neighborhoods'),
      fetch('/api/parks'),
      fetch('/api/neighborhood-demand'),
      fetch('/api/complaint-hotspots'),
      fetch(opportunityUrl())
    ]);
    if ([runsResponse, neighborhoodsResponse, parksResponse, demandResponse, complaintResponse, opportunitiesResponse].some((response) => !response.ok)) {
      throw new Error('Map data request failed');
    }
    const [runs, neighborhoods, parks, demand, complaintHotspots, opportunities] = await Promise.all([
      runsResponse.json(),
      neighborhoodsResponse.json(),
      parksResponse.json(),
      demandResponse.json(),
      complaintResponse.json(),
      opportunitiesResponse.json()
    ]);
    state.runs = runs.features;
    state.neighborhoods = neighborhoods;
    state.parks = parks.features;
    state.demand = demand;
    state.complaintHotspots = complaintHotspots.features;
    state.opportunities = opportunities.features;
    document.querySelector('#score-status').textContent =
      `${state.opportunities.length.toLocaleString()} parks scored · ${state.scoreScope === 'all' ? 'all parks' : 'parks without a matched active dog run'}`;
    drawMap();
    loading.hidden = true;
  } catch (error) {
    loading.textContent = 'We could not load the map. Please try again.';
    console.error(error);
  }
}

async function updateScoreScope(scope) {
  state.scoreScope = scope;
  updateOpportunityScores();
}

async function updateOpportunityScores() {
  state.selected = null;
  detail.hidden = true;
  const requestId = ++scoreRequestId;
  const status = document.querySelector('#score-status');
  status.textContent = 'Updating park scores…';
  try {
    const response = await fetch(opportunityUrl());
    if (!response.ok) throw new Error(`Park score request failed with status ${response.status}`);
    const opportunities = await response.json();
    if (requestId !== scoreRequestId) return;
    state.opportunities = opportunities.features;
    status.textContent =
      `${state.opportunities.length.toLocaleString()} parks scored · ${state.scoreScope === 'all' ? 'all parks' : 'parks without a matched active dog run'}`;
    render();
  } catch (error) {
    if (requestId !== scoreRequestId) return;
    status.textContent = 'Unable to update park scores. Please try again.';
    console.error(error);
  }
}

document.querySelector('#search').addEventListener('input', (event) => { state.query = event.target.value; render(); });
document.querySelectorAll('[data-layer]').forEach((input) => {
  input.addEventListener('change', () => {
    state.layers[input.dataset.layer] = input.checked;
    render();
  });
});
document.querySelectorAll('input[name="score-scope"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked && input.value !== state.scoreScope) updateScoreScope(input.value);
  });
});
document.querySelectorAll('[data-weight]').forEach((input) => {
  input.addEventListener('input', () => updateWeight(input.dataset.weight, Number(input.value)));
});
document.querySelector('#apply-weights').addEventListener('click', applyWeights);
document.querySelector('#reset-weights').addEventListener('click', () => {
  state.weightDraft = { ...defaultWeights };
  renderWeights();
  applyWeights();
});
renderWeights();
document.querySelector('#close-detail').addEventListener('click', () => { state.selected = null; detail.hidden = true; render(); });
document.querySelector('#reset-view').addEventListener('click', resetView);
document.querySelector('#zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.5));
document.querySelector('#zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.67));
svg.on('click', () => { state.selected = null; detail.hidden = true; render(); });
window.addEventListener('resize', () => { if (state.neighborhoods) drawMap(); });

init();

(async function enableLiveReload() {
  try {
    const initial = await fetch('/api/dev-version', { cache: 'no-store' }).then((response) => response.json());
    if (!initial.enabled) return;
    let version = initial.version;
    window.setInterval(async () => {
      try {
        const current = await fetch('/api/dev-version', { cache: 'no-store' }).then((response) => response.json());
        if (current.version > version) window.location.reload();
        version = current.version;
      } catch (_error) {
        // The server may be briefly unavailable while Node restarts.
      }
    }, 800);
  } catch (_error) {
    // Live reload is optional and should never affect the map.
  }
}());
