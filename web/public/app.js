const boroughNames = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', R: 'Staten Island', X: 'Bronx' };
const state = {
  runs: [], parks: null, neighborhoods: null, density: null, complaints: null, opportunities: null,
  layers: { runs: true, density: true, parks: true, complaints: false, ranking: true },
  borough: 'ALL', query: '', selected: null, selectedType: null
};

const svg = d3.select('#map');
const mapRoot = svg.append('g');
const neighborhoodLayer = mapRoot.append('g');
const parkLayer = mapRoot.append('g');
const complaintLayer = mapRoot.append('g');
const rankingLayer = mapRoot.append('g');
const runLayer = mapRoot.append('g');
const loading = document.querySelector('#loading');
const list = document.querySelector('#run-list');
const detail = document.querySelector('#detail-card');
const tooltip = document.querySelector('#map-tooltip');
let projection;
let path;

const zoom = d3.zoom().scaleExtent([1, 12]).on('zoom', (event) => mapRoot.attr('transform', event.transform));
svg.call(zoom);

function filteredRuns() {
  const term = state.query.trim().toLowerCase();
  return state.runs.filter((run) => {
    const boroughMatch = state.borough === 'ALL' || run.properties.borough === state.borough;
    const textMatch = !term || run.properties.name.toLowerCase().includes(term) || (run.properties.zipcode || '').includes(term);
    return boroughMatch && textMatch;
  });
}

function densityContext() {
  if (!state.density) return null;
  const positive = state.density.areas.map((area) => area.density).filter((value) => value > 0).sort(d3.ascending);
  const upper = d3.quantile(positive, 0.95) || 1;
  return {
    upper,
    byId: new Map(state.density.areas.map((area) => [area.nta, area])),
    color: d3.scaleSequentialSqrt(d3.interpolateYlGn).domain([0, upper]).clamp(true)
  };
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
  renderNeighborhoods();
  renderParks();
  renderComplaints();
  renderRankings();
  renderRuns();
  renderSidebar();
  renderCandidateList();
  renderLegends();
}

function renderNeighborhoods() {
  const density = state.layers.density ? densityContext() : null;
  neighborhoodLayer.selectAll('path')
    .attr('class', (feature) => `neighborhood${density ? ' density-area' : ''}${state.selectedType === 'density' && feature.id === state.selected ? ' selected' : ''}`)
    .style('fill', (feature) => density ? density.color(density.byId.get(feature.id)?.density || 0) : null)
    .on('click', density ? (event, feature) => {
      event.stopPropagation();
      selectArea(density.byId.get(feature.id));
    } : null)
    .on('mousemove', density ? (event, feature) => {
      const area = density.byId.get(feature.id);
      if (!area) return;
      tooltip.hidden = false;
      tooltip.style.left = `${event.offsetX + 14}px`;
      tooltip.style.top = `${event.offsetY + 14}px`;
      tooltip.replaceChildren();
      const name = document.createElement('strong');
      name.textContent = area.name;
      tooltip.append(name, document.createElement('br'), `${d3.format(',.0f')(area.density)} licenses / km²`);
    } : null)
    .on('mouseleave', () => { tooltip.hidden = true; });
}

function renderParks() {
  if (!state.parks || !projection) return;
  const visibleParks = state.layers.parks ? state.parks.features : [];
  const parks = parkLayer.selectAll('g.park-marker').data(visibleParks, (feature) => feature.id).join(
    (enter) => {
      const marker = enter.append('g').attr('class', 'park-marker');
      marker.append('rect').attr('class', 'park-point').attr('x', -3.5).attr('y', -3.5).attr('width', 7).attr('height', 7).attr('rx', 1.5);
      marker.append('title');
      return marker;
    },
    (update) => update,
    (exit) => exit.remove()
  )
    .attr('transform', (feature) => `translate(${projection(feature.geometry.coordinates)})`)
    .classed('selected', (feature) => state.selectedType === 'park' && feature.id === state.selected)
    .on('click', (event, feature) => {
      event.stopPropagation();
      selectPark(feature);
    });
  parks.select('title').text((feature) => `${feature.properties.name}${feature.properties.type ? ` · ${feature.properties.type}` : ''}`);
}

function renderComplaints() {
  if (!state.complaints || !projection) return;
  const cells = state.layers.complaints ? state.complaints.features : [];
  const radius = d3.scaleSqrt().domain([1, d3.max(cells, (cell) => cell.properties.complaintCount) || 1]).range([2, 14]);
  const points = complaintLayer.selectAll('circle').data(cells, (cell) => cell.id).join('circle')
    .attr('class', 'complaint-point')
    .attr('transform', (cell) => `translate(${projection(cell.geometry.coordinates)})`)
    .attr('r', (cell) => radius(cell.properties.complaintCount));
  points.selectAll('title').data((cell) => [cell]).join('title')
    .text((cell) => `${cell.properties.complaintCount} dog-related 311 request${cell.properties.complaintCount === 1 ? '' : 's'} · ${cell.properties.neighborhood || 'NYC'}`);
}

function renderRankings() {
  if (!state.opportunities || !projection) return;
  const candidates = state.layers.ranking ? state.opportunities.features.slice(0, 8) : [];
  const markers = rankingLayer.selectAll('g.rank-marker').data(candidates, (candidate) => candidate.id).join(
    (enter) => {
      const marker = enter.append('g').attr('class', 'rank-marker');
      marker.append('rect').attr('class', 'rank-point').attr('x', -7).attr('y', -7).attr('width', 14).attr('height', 14).attr('rx', 3);
      marker.append('text').attr('class', 'rank-label').attr('text-anchor', 'middle').attr('dy', '.35em');
      marker.append('title');
      return marker;
    }, (update) => update, (exit) => exit.remove()
  ).attr('transform', (candidate) => `translate(${projection(candidate.geometry.coordinates)})`)
    .on('click', (event, candidate) => { event.stopPropagation(); selectCandidate(candidate); });
  markers.select('.rank-label').text((candidate) => candidate.properties.rank);
  markers.select('title').text((candidate) => `#${candidate.properties.rank} ${candidate.properties.name} · score ${candidate.properties.score}`);
}

function renderRuns() {
  const runs = state.layers.runs ? filteredRuns() : [];
  const points = runLayer.selectAll('g.run').data(runs, (run) => run.id).join(
    (enter) => {
      const group = enter.append('g').attr('class', 'run');
      group.append('circle').attr('class', 'run-halo').attr('r', 9);
      group.append('circle').attr('class', 'run-point').attr('r', 4.5);
      return group;
    },
    (update) => update,
    (exit) => exit.remove()
  );
  points.attr('transform', (run) => `translate(${projection([run.properties.longitude, run.properties.latitude])})`)
    .on('click', (event, run) => { event.stopPropagation(); selectRun(run, false); });
  points.select('.run-point').classed('selected', (run) => state.selectedType === 'run' && run.id === state.selected);
}

function renderSidebar() {
  document.querySelector('#run-controls').hidden = !state.layers.runs;
  renderFilters();

  if (state.layers.runs) return renderRunList();
  if (state.layers.density && state.density) return renderDensityList();
  if (state.layers.parks && state.parks) return renderParkList();

  document.querySelector('#visible-count').textContent = '0';
  document.querySelector('#visible-label').textContent = 'visible layers';
  document.querySelector('#borough-count').textContent = '—';
  document.querySelector('#borough-label').textContent = 'select a layer';
  document.querySelector('.results-heading h2').textContent = 'No layers selected';
  d3.select(list).selectAll('*').remove();
}

function baseList(items, key, selectedType, onClick) {
  const rows = d3.select(list).selectAll('button.run-item').data(items, key).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'run-item').html('<span class="dot"></span><span><strong></strong><small></small></span>'),
    (update) => update,
    (exit) => exit.remove()
  );
  rows.classed('active', (item) => state.selectedType === selectedType && key(item) === state.selected).on('click', onClick);
  d3.select(list).selectAll('p.empty').remove();
  return rows;
}

function renderRunList() {
  const runs = filteredRuns();
  document.querySelector('#visible-count').textContent = runs.length;
  document.querySelector('#visible-label').textContent = 'dog runs shown';
  document.querySelector('#borough-count').textContent = new Set(runs.map((run) => run.properties.borough)).size;
  document.querySelector('#borough-label').textContent = 'boroughs';
  document.querySelector('.results-heading h2').textContent = 'Dog runs';
  const rows = baseList(runs, (run) => run.id, 'run', (_event, run) => selectRun(run, true));
  rows.select('.dot').style('background', null);
  rows.select('strong').text((run) => run.properties.name);
  rows.select('small').text((run) => `${boroughNames[run.properties.borough]} · ${run.properties.zipcode || 'ZIP unavailable'}`);
  d3.select(list).selectAll('p.empty').data(runs.length ? [] : [null]).join('p').attr('class', 'empty').text('No dog runs match your search.');
}

function renderDensityList() {
  const context = densityContext();
  const areas = [...state.density.areas].sort((a, b) => d3.descending(a.density, b.density));
  document.querySelector('#visible-count').textContent = d3.format(',')(state.density.totalLicenses);
  document.querySelector('#visible-label').textContent = `estimated licenses (${state.density.year})`;
  document.querySelector('#borough-count').textContent = areas.filter((area) => area.licenses > 0).length;
  document.querySelector('#borough-label').textContent = 'NTAs with licenses';
  document.querySelector('.results-heading h2').textContent = 'Highest density areas';
  const rows = baseList(areas, (area) => area.nta, 'density', (_event, area) => selectArea(area));
  rows.select('.dot').style('background', (area) => context.color(area.density));
  rows.select('strong').text((area) => area.name);
  rows.select('small').text((area) => `${d3.format(',.0f')(area.density)} licenses / km² · ${d3.format(',')(area.licenses)}`);
}

function renderParkList() {
  const parks = [...state.parks.features].sort((a, b) => d3.ascending(a.properties.name, b.properties.name));
  document.querySelector('#visible-count').textContent = d3.format(',')(parks.length);
  document.querySelector('#visible-label').textContent = 'parks without dog runs';
  document.querySelector('#borough-count').textContent = new Set(parks.map((park) => park.properties.borough)).size;
  document.querySelector('#borough-label').textContent = 'boroughs';
  document.querySelector('.results-heading h2').textContent = 'Candidate parks';
  const rows = baseList(parks, (park) => park.id, 'park', (_event, park) => selectPark(park));
  rows.select('.dot').style('background', '#e45f4f');
  rows.select('strong').text((park) => park.properties.name);
  rows.select('small').text((park) => `${park.properties.borough || 'NYC'} · ${park.properties.type || 'Park property'}`);
}

function renderCandidateList() {
  const section = document.querySelector('.candidate-list-section');
  section.hidden = !state.layers.ranking;
  if (!state.layers.ranking || !state.opportunities) return;
  const candidates = state.opportunities.features.slice(0, 8);
  const rows = d3.select('#candidate-list').selectAll('button.candidate-item').data(candidates, (candidate) => candidate.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'candidate-item').html('<span class="rank"></span><span><strong></strong><small></small></span><b></b>'),
    (update) => update, (exit) => exit.remove()
  ).classed('active', (candidate) => state.selectedType === 'ranking' && candidate.id === state.selected)
    .on('click', (_event, candidate) => selectCandidate(candidate));
  rows.select('.rank').text((candidate) => `#${candidate.properties.rank}`);
  rows.select('strong').text((candidate) => candidate.properties.name);
  rows.select('small').text((candidate) => `${candidate.properties.borough} · ${candidate.properties.acres.toFixed(1)} acres`);
  rows.select('b').text((candidate) => candidate.properties.score);
}

function renderLegends() {
  document.querySelector('.legend-runs').hidden = !state.layers.runs;
  document.querySelector('.legend-parks').hidden = !state.layers.parks;
  document.querySelector('.legend-complaints').hidden = !state.layers.complaints;
  document.querySelector('.legend-ranking').hidden = !state.layers.ranking;
  const mapKey = document.querySelector('.map-key');
  mapKey.hidden = !state.layers.runs && !state.layers.parks && !state.layers.complaints && !state.layers.ranking;
  const densityLegend = document.querySelector('#density-legend');
  const context = state.layers.density ? densityContext() : null;
  mapKey.classList.toggle('density-visible', Boolean(context));
  densityLegend.hidden = !context;
  if (context) {
    densityLegend.innerHTML = `<div class="legend-title">Estimated licenses per km²</div><div class="legend-gradient"></div><div class="legend-values"><span>0</span><span>${d3.format(',.0f')(context.upper)}+</span></div>`;
  }
}

function setDetailLabels(kicker, one, two, three) {
  document.querySelector('#detail-kicker').textContent = kicker;
  document.querySelector('#detail-label-one').textContent = one;
  document.querySelector('#detail-label-two').textContent = two;
  document.querySelector('#detail-label-three').textContent = three;
}

function selectRun(run, moveMap) {
  state.selected = run.id;
  state.selectedType = 'run';
  const p = run.properties;
  setDetailLabels('ACTIVE DOG RUN', 'Surface', 'Seating', 'Area');
  document.querySelector('#detail-name').textContent = p.name;
  document.querySelector('#detail-location').textContent = `${boroughNames[p.borough]} · ${p.zipcode || 'ZIP unavailable'}`;
  document.querySelector('#detail-surface').textContent = p.surface || 'Not listed';
  document.querySelector('#detail-seating').textContent = p.seating || 'Not listed';
  document.querySelector('#detail-area').textContent = p.areaSqM < 1000 ? `${Math.round(p.areaSqM)} m²` : `${(p.areaSqM / 1000).toFixed(1)}k m²`;
  const directions = document.querySelector('#directions');
  document.querySelector('#candidate-factors').hidden = true;
  directions.className = '';
  directions.textContent = 'Get directions ↗';
  directions.href = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
  detail.hidden = false;
  render();
  if (moveMap) centerPoint([p.longitude, p.latitude]);
}

function selectArea(area) {
  if (!area) return;
  state.selected = area.nta;
  state.selectedType = 'density';
  setDetailLabels('LICENSE DENSITY', 'Licenses', 'Density', 'NTA area');
  document.querySelector('#detail-name').textContent = area.name;
  document.querySelector('#detail-location').textContent = `${area.borough} · NTA ${area.nta} · ${state.density.year}`;
  document.querySelector('#detail-surface').textContent = d3.format(',')(area.licenses);
  document.querySelector('#detail-seating').textContent = `${d3.format(',.0f')(area.density)} / km²`;
  document.querySelector('#detail-area').textContent = `${area.areaSqKm.toFixed(1)} km²`;
  const directions = document.querySelector('#directions');
  document.querySelector('#candidate-factors').hidden = true;
  directions.className = '';
  directions.removeAttribute('href');
  directions.textContent = 'Estimated from license ZIP codes';
  detail.hidden = false;
  render();
}

function selectPark(park) {
  const p = park.properties;
  state.selected = park.id;
  state.selectedType = 'park';
  setDetailLabels('PARK WITHOUT A DOG RUN', 'Property ID', 'Recreation', 'Type');
  document.querySelector('#detail-name').textContent = p.name;
  document.querySelector('#detail-location').textContent = p.borough || 'New York City';
  document.querySelector('#detail-surface').textContent = p.propertyId;
  document.querySelector('#detail-seating').textContent = p.recreationCategory || 'Not classified';
  document.querySelector('#detail-area').textContent = p.type || 'Park property';
  const directions = document.querySelector('#directions');
  document.querySelector('#candidate-factors').hidden = true;
  directions.className = '';
  directions.removeAttribute('href');
  directions.textContent = 'No mapped dog run intersects this property';
  detail.hidden = false;
  render();
}

function selectCandidate(candidate) {
  const p = candidate.properties;
  state.selected = candidate.id;
  state.selectedType = 'ranking';
  setDetailLabels('DOG-RUN OPPORTUNITY', 'Score', 'Park acreage', 'Nearest run');
  document.querySelector('#detail-name').textContent = `#${p.rank} ${p.name}`;
  document.querySelector('#detail-location').textContent = `${p.borough} · ${d3.format(',')(p.licenseEstimate)} estimated licenses · ${d3.format(',')(p.complaintCount)} requests`;
  document.querySelector('#detail-surface').textContent = `${p.score} / 100`;
  document.querySelector('#detail-seating').textContent = `${p.acres.toFixed(1)} acres`;
  document.querySelector('#detail-area').textContent = `${p.nearestRunKm.toFixed(2)} km`;
  const factors = document.querySelector('#candidate-factors');
  factors.hidden = false;
  factors.innerHTML = [
    ['License demand', p.factors.demand],
    ['Access gap', p.factors.access],
    ['311 requests', p.factors.complaints],
    ['Park acreage', p.factors.acreage]
  ].map(([label, value]) => `<div class="factor-chip"><span>${label}</span><strong>${value.toFixed(0)}</strong></div>`).join('');
  const directions = document.querySelector('#directions');
  directions.className = 'candidate-note';
  directions.textContent = 'Exploratory comparison only — not a construction recommendation or site approval.';
  directions.removeAttribute('href');
  detail.hidden = false;
  render();
}

function centerPoint(coordinates) {
  const [x, y] = projection(coordinates);
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(5).translate(-x, -y));
}

function resetView() {
  state.selected = null;
  state.selectedType = null;
  detail.hidden = true;
  svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  render();
}

function drawMap() {
  const bounds = svg.node().getBoundingClientRect();
  projection = d3.geoMercator().fitExtent([[28, 28], [bounds.width - 28, bounds.height - 28]], state.neighborhoods);
  path = d3.geoPath(projection);
  const areas = neighborhoodLayer.selectAll('path').data(state.neighborhoods.features, (feature) => feature.id).join('path').attr('d', path);
  areas.selectAll('title').data((feature) => [feature]).join('title').text((feature) => feature.properties.name);
  render();
}

async function loadOptionalLayers() {
  const load = async (url, assign) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      assign(await response.json());
      render();
    } catch (error) { console.error(error); }
  };
  document.querySelector('#ranking-status').textContent = 'Calculating candidate scores…';
  await Promise.allSettled([
    load('/api/parks', (data) => { state.parks = data; }),
    load('/api/license-density', (data) => { state.density = data; }),
    load('/api/complaint-hotspots', (data) => { state.complaints = data; }),
    load('/api/opportunities', (data) => {
      state.opportunities = data;
      document.querySelector('#ranking-status').textContent = `${data.features.length.toLocaleString()} candidate parks scored.`;
    })
  ]);
}

async function init() {
  try {
    const [runsResponse, neighborhoodsResponse] = await Promise.all([fetch('/api/dog-runs'), fetch('/api/neighborhoods')]);
    if (!runsResponse.ok || !neighborhoodsResponse.ok) throw new Error('Map data request failed');
    const [runs, neighborhoods] = await Promise.all([runsResponse.json(), neighborhoodsResponse.json()]);
    state.runs = runs.features;
    state.neighborhoods = neighborhoods;
    drawMap();
    loading.hidden = true;
    loadOptionalLayers();
  } catch (error) {
    loading.textContent = 'We could not load the map. Please try again.';
    console.error(error);
  }
}

document.querySelector('#search').addEventListener('input', (event) => { state.query = event.target.value; render(); });
document.querySelector('#close-detail').addEventListener('click', () => { state.selected = null; state.selectedType = null; detail.hidden = true; render(); });
document.querySelector('#reset-view').addEventListener('click', resetView);
document.querySelector('#zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.5));
document.querySelector('#zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.67));
document.querySelectorAll('.layer-option input').forEach((checkbox) => checkbox.addEventListener('change', () => {
  state.layers[checkbox.dataset.layer] = checkbox.checked;
  const selectionType = { runs: 'run', density: 'density', parks: 'park' }[checkbox.dataset.layer];
  if (!checkbox.checked && state.selectedType === selectionType) {
    state.selected = null;
    state.selectedType = null;
    detail.hidden = true;
  }
  render();
}));
document.querySelector('#apply-weights').addEventListener('click', async () => {
  const values = Object.fromEntries([...document.querySelectorAll('[data-weight]')].map((input) => [input.dataset.weight, Number(input.value)]));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const status = document.querySelector('#ranking-status');
  if (total !== 100) { status.textContent = `Weights total ${total}%; they must total 100%.`; return; }
  status.textContent = 'Recalculating rankings…';
  const params = new URLSearchParams(values);
  try {
    const response = await fetch(`/api/opportunities?${params}`);
    if (!response.ok) throw new Error('Ranking request failed');
    state.opportunities = await response.json();
    status.textContent = `${state.opportunities.features.length.toLocaleString()} candidate parks scored.`;
    render();
  } catch (error) { status.textContent = 'Unable to calculate rankings.'; console.error(error); }
});
svg.on('click', () => { state.selected = null; state.selectedType = null; detail.hidden = true; render(); });
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
