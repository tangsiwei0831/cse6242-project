const boroughNames = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
const state = {
  neighborhoods: null, density: null, complaints: null, opportunities: null,
  layers: { candidate: true, density: true, complaints: false },
  includeExisting: false,
  borough: 'ALL', query: '', selected: null, selectedType: null, searchArea: null
};

const svg = d3.select('#map');
const mapRoot = svg.append('g');
const neighborhoodLayer = mapRoot.append('g');
const candidateLayer = mapRoot.append('g');
const complaintLayer = mapRoot.append('g');
const loading = document.querySelector('#loading');
const list = document.querySelector('#candidate-list');
const existingList = document.querySelector('#existing-park-list');
const densityList = document.querySelector('#density-list');
const detail = document.querySelector('#detail-card');
const tooltip = document.querySelector('#map-tooltip');
let projection;
let path;
let opportunityRequestId = 0;

const zoom = d3.zoom().scaleExtent([1, 12]).on('zoom', (event) => mapRoot.attr('transform', event.transform));
svg.call(zoom);

function eligibleCandidates() {
  if (!state.opportunities) return [];
  return state.opportunities.features.filter((candidate) => candidate.properties.score !== null);
}

function filteredCandidates() {
  const term = state.query.trim().toLowerCase();
  return eligibleCandidates().filter((candidate) => {
    return matchesParkFilter(candidate, term);
  });
}

function filteredExistingParks() {
  const term = state.query.trim().toLowerCase();
  return (state.opportunities?.features || []).filter((candidate) =>
    candidate.properties.hasDogRun && matchesParkFilter(candidate, term));
}

function matchesParkFilter(candidate, term) {
  const p = candidate.properties;
  const boroughMatch = state.borough === 'ALL' || p.borough === state.borough;
  const textMatch = !term || p.name.toLowerCase().includes(term) || String(p.propertyId).toLowerCase().includes(term);
  return boroughMatch && textMatch;
}

function topCount() {
  const input = document.querySelector('#top-park-count');
  const count = Number(input.value);
  return Number.isInteger(count) && count >= 1 ? count : null;
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
  const candidates = eligibleCandidates();
  const counts = d3.rollup(candidates, (values) => values.length, (candidate) => candidate.properties.borough);
  const filters = [['ALL', 'All', candidates.length], ...boroughNames.map((name) => [name, name, counts.get(name) || 0])];
  d3.select('#borough-filters').selectAll('button').data(filters).join('button')
    .attr('type', 'button')
    .attr('class', ([code]) => `filter${state.borough === code ? ' active' : ''}`)
    .attr('aria-pressed', ([code]) => state.borough === code)
    .text(([, name, count]) => `${name} ${count}`)
    .on('click', (_event, [code]) => { state.borough = code; render(); });
}

function render() {
  renderNeighborhoods();
  renderCandidateParks();
  renderComplaints();
  renderSidebar();
  renderLegends();
}

function renderNeighborhoods() {
  const metrics = densityContext();
  const density = state.layers.density ? metrics : null;
  neighborhoodLayer.selectAll('path')
    .attr('class', (feature) => `neighborhood${metrics ? ' density-area' : ''}${state.selectedType === 'density' && feature.id === state.selected ? ' selected' : ''}${state.searchArea === feature.id ? ' search-match' : ''}`)
    .style('fill', (feature) => density ? density.color(density.byId.get(feature.id)?.density || 0) : null)
    .on('click', metrics ? (event, feature) => {
      event.stopPropagation();
      selectArea(metrics.byId.get(feature.id));
    } : null)
    .on('mousemove', metrics ? (event, feature) => {
      const area = metrics.byId.get(feature.id);
      if (!area) return;
      tooltip.hidden = false;
      tooltip.style.left = `${event.offsetX + 14}px`;
      tooltip.style.top = `${event.offsetY + 14}px`;
      tooltip.replaceChildren();
      const header = document.createElement('div');
      header.className = 'area-tooltip-header';
      const name = document.createElement('strong');
      name.textContent = area.name;
      const meta = document.createElement('small');
      meta.textContent = `${area.borough} · ${area.nta}`;
      header.append(name, meta);
      const grid = document.createElement('div');
      grid.className = 'area-metric-grid';
      [
        ['Est. licenses', d3.format(',')(area.licenses)],
        ['Licenses / km²', d3.format(',.0f')(area.density)],
        ['Active dog runs', d3.format(',')(area.dogRuns)],
        ['Parks without runs', d3.format(',')(area.parksWithoutRuns)],
        ['Dog-related complaints', d3.format(',')(area.complaints311)],
        ['Park acreage', d3.format(',.1f')(area.parkAcres)]
      ].forEach(([label, value]) => {
        const item = document.createElement('div');
        const labelNode = document.createElement('span');
        const valueNode = document.createElement('b');
        labelNode.textContent = label;
        valueNode.textContent = value;
        item.append(labelNode, valueNode);
        grid.append(item);
      });
      tooltip.append(header, grid);
    } : null)
    .on('mouseleave', () => { tooltip.hidden = true; });
}

function renderCandidateParks() {
  if (!state.opportunities || !projection) return;
  const features = state.layers.candidate ? state.opportunities.features : [];
  const markers = candidateLayer.selectAll('g.candidate-park').data(features, (feature) => feature.id).join(
    (enter) => {
      const marker = enter.append('g').attr('class', 'candidate-park');
      marker.append('rect').attr('class', 'candidate-park-point').attr('x', -4).attr('y', -4).attr('width', 8).attr('height', 8).attr('rx', 1);
      marker.append('text').attr('class', 'candidate-park-rank').attr('text-anchor', 'middle').attr('dy', '.35em');
      return marker;
    },
    (update) => update,
    (exit) => exit.remove()
  )
    .attr('transform', (feature) => `translate(${projection(feature.geometry.coordinates)})`)
    .classed('has-existing-run', (feature) => feature.properties.hasDogRun)
    .classed('selected', (feature) => state.selectedType === 'candidate' && feature.id === state.selected)
    .on('click', (event, feature) => {
      event.stopPropagation();
      selectCandidate(feature);
    })
    .on('mousemove', showCandidateTooltip)
    .on('mouseleave', () => { tooltip.hidden = true; });
  markers.select('.candidate-park-rank')
    .text((feature) => feature.properties.rank <= (topCount() || 0) ? feature.properties.rank : '');
}

function showCandidateTooltip(event, candidate) {
  const p = candidate.properties;
  tooltip.hidden = false;
  tooltip.style.left = `${event.offsetX + 14}px`;
  tooltip.style.top = `${event.offsetY + 14}px`;
  tooltip.replaceChildren();

  const header = document.createElement('div');
  header.className = 'area-tooltip-header';
  const name = document.createElement('strong');
  name.textContent = p.name;
  const meta = document.createElement('small');
  meta.textContent = `${p.borough || 'NYC'} · ${p.hasDogRun ? 'Existing dog run' : 'No mapped dog run'}`;
  header.append(name, meta);

  const grid = document.createElement('div');
  grid.className = 'area-metric-grid';
  [
    ['Rank', p.rank === null ? 'Not ranked' : `#${p.rank}`],
    ['Score', p.score === null ? 'Excluded' : `${p.score} / 100`],
    ['Park acreage', `${p.acres.toFixed(1)} acres`],
    ['Nearest run', `${p.nearestRunKm.toFixed(2)} km`],
    ['Est. licenses', d3.format(',')(p.licenseEstimate)],
    ['Dog-related complaints', d3.format(',')(p.complaintCount)]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    const labelNode = document.createElement('span');
    const valueNode = document.createElement('b');
    labelNode.textContent = label;
    valueNode.textContent = value;
    item.append(labelNode, valueNode);
    grid.append(item);
  });
  tooltip.append(header, grid);

  if (p.factors) {
    const strongest = Object.entries(p.factors).sort((a, b) => d3.descending(a[1], b[1]))[0];
    const insight = document.createElement('p');
    insight.className = 'park-tooltip-insight';
    insight.textContent = `Strongest scoring factor: ${{
      demand: 'dog-run demand',
      access: 'access gap',
      complaints: 'dog-related complaints',
      acreage: 'park acreage'
    }[strongest[0]]} (${strongest[1].toFixed(0)} / 100).`;
    tooltip.append(insight);
  }
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
    .text((cell) => `${cell.properties.complaintCount} dog-related complaint${cell.properties.complaintCount === 1 ? '' : 's'} · ${cell.properties.neighborhood || 'NYC'}`);
}

function renderSidebar() {
  document.querySelector('#candidate-controls').hidden = !state.layers.candidate;
  document.querySelector('#existing-park-options').hidden = !state.layers.candidate;
  document.querySelector('#existing-list-section').hidden = !state.layers.candidate;
  document.querySelector('#top-candidate-section').hidden = !state.layers.candidate;
  densityList.hidden = state.layers.candidate || !state.layers.density || !state.density;
  renderFilters();

  if (state.layers.candidate) return renderCandidateList();
  if (state.layers.density && state.density) return renderDensityList();

  document.querySelector('#visible-count').textContent = '0';
  document.querySelector('#visible-label').textContent = 'visible layers';
  document.querySelector('#borough-count').textContent = '—';
  document.querySelector('#borough-label').textContent = 'select a data layer';
  document.querySelector('.results-heading h2').textContent = 'No layers selected';
  d3.select(densityList).selectAll('*').remove();
}

function baseList(container, items, key, selectedType, onClick) {
  const rows = d3.select(container).selectAll('button.run-item').data(items, key).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'run-item').html('<span class="dot"></span><span><strong></strong><small></small></span>'),
    (update) => update,
    (exit) => exit.remove()
  );
  rows.classed('active', (item) => state.selectedType === selectedType && key(item) === state.selected).on('click', onClick);
  d3.select(container).selectAll('p.empty').remove();
  return rows;
}

function renderDensityList() {
  const context = densityContext();
  const areas = [...state.density.areas].sort((a, b) => d3.descending(a.density, b.density));
  document.querySelector('#visible-count').textContent = d3.format(',')(state.density.totalLicenses);
  document.querySelector('#visible-label').textContent = `estimated licenses (${state.density.year})`;
  document.querySelector('#borough-count').textContent = areas.filter((area) => area.licenses > 0).length;
  document.querySelector('#borough-label').textContent = 'NTAs with licenses';
  document.querySelector('.results-heading h2').textContent = 'Highest density areas';
  const rows = baseList(densityList, areas, (area) => area.nta, 'density', (_event, area) => selectArea(area));
  rows.select('.dot').style('background', (area) => context.color(area.density));
  rows.select('strong').text((area) => area.name);
  rows.select('small').text((area) => `${d3.format(',.0f')(area.density)} licenses / km² · ${d3.format(',')(area.licenses)}`);
}

function renderCandidateList() {
  if (!state.opportunities) return;
  const parks = filteredCandidates();
  const candidates = parks.slice(0, topCount() || 0);
  const existingParks = filteredExistingParks();
  d3.select(existingList).selectAll('button.candidate-item, p.empty').remove();
  document.querySelector('#visible-count').textContent = d3.format(',')(parks.length);
  document.querySelector('#visible-label').textContent = `ranked parks ${state.includeExisting ? '(including existing runs)' : '(excluding existing runs)'}`;
  document.querySelector('#borough-count').textContent = new Set(parks.map((candidate) => candidate.properties.borough)).size;
  document.querySelector('#borough-label').textContent = 'boroughs';
  const existingRows = d3.select(existingList).selectAll('button.candidate-item').data(existingParks, (candidate) => candidate.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'candidate-item existing-park-item').html('<span class="rank existing-rank">●</span><span><strong></strong><small></small></span><b>RUN</b>'),
    (update) => update,
    (exit) => exit.remove()
  ).classed('active', (candidate) => state.selectedType === 'candidate' && candidate.id === state.selected)
    .on('click', (_event, candidate) => selectCandidate(candidate));
  existingRows.select('strong').text((candidate) => candidate.properties.name);
  existingRows.select('small').text((candidate) => `${candidate.properties.borough || 'NYC'} · ${candidate.properties.acres.toFixed(1)} acres`);

  const rows = d3.select(list).selectAll('button.candidate-item').data(candidates, (candidate) => candidate.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'candidate-item').html('<span class="rank"></span><span><strong></strong><small></small></span><b></b>'),
    (update) => update, (exit) => exit.remove()
  ).classed('active', (candidate) => state.selectedType === 'candidate' && candidate.id === state.selected)
    .on('click', (_event, candidate) => selectCandidate(candidate));
  rows.select('.rank').text((candidate) => `#${candidate.properties.rank}`);
  rows.select('strong').text((candidate) => candidate.properties.name);
  rows.select('small').text((candidate) => `${candidate.properties.borough || 'NYC'} · ${candidate.properties.acres.toFixed(1)} acres${candidate.properties.hasDogRun ? ' · existing run' : ''}`);
  rows.select('b').text((candidate) => candidate.properties.score.toFixed(1));
  d3.select(existingList).selectAll('p.empty').data(existingParks.length ? [] : [null]).join('p').attr('class', 'empty')
    .text(state.query ? 'No existing dog-run parks match your search.' : 'No existing dog-run parks in this area.');
  d3.select(list).selectAll('p.empty').data(candidates.length ? [] : [null]).join('p').attr('class', 'empty')
    .text(topCount() === null ? 'Enter a whole number of 1 or more.' : state.query ? 'No ranked parks match your search.' : 'No ranked parks are available for this selection.');
}

function renderLegends() {
  document.querySelector('.legend-candidate').hidden = !state.layers.candidate;
  document.querySelector('.legend-existing').hidden = !state.layers.candidate;
  document.querySelector('.legend-complaints').hidden = !state.layers.complaints;
  document.querySelector('.legend-ranking').hidden = !state.layers.candidate;
  const mapKey = document.querySelector('.map-key');
  mapKey.hidden = !state.layers.candidate && !state.layers.complaints;
  document.querySelector('.legend-ranking').lastChild.textContent = ` Rank in top ${topCount() || 'N'} candidate parks`;
}

function setDetailLabels(kicker, one, two, three) {
  document.querySelector('#detail-kicker').textContent = kicker;
  document.querySelector('#detail-label-one').textContent = one;
  document.querySelector('#detail-label-two').textContent = two;
  document.querySelector('#detail-label-three').textContent = three;
}

function selectArea(area) {
  if (!area) return;
  state.selected = area.nta;
  state.selectedType = 'density';
  setDetailLabels('DOG-RUN DEMAND', 'Licenses', 'Density', 'NTA area');
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

function selectSearchedArea(feature, moveMap) {
  if (!feature) return;
  const wasSelected = state.searchArea === feature.id;
  state.searchArea = feature.id;
  state.selected = feature.id;
  state.selectedType = 'area-search';
  const densityArea = state.density?.areas.find((area) => area.nta === feature.id);
  setDetailLabels('NYC NEIGHBORHOOD', 'Borough', 'NTA code', 'Dog-run demand');
  document.querySelector('#detail-name').textContent = feature.properties.name;
  document.querySelector('#detail-location').textContent = 'Neighborhood Tabulation Area boundary';
  document.querySelector('#detail-surface').textContent = feature.properties.borough;
  document.querySelector('#detail-seating').textContent = feature.id;
  document.querySelector('#detail-area').textContent = densityArea ? `${d3.format(',.0f')(densityArea.density)} licenses / km²` : 'Loading…';
  document.querySelector('#candidate-factors').hidden = true;
  const directions = document.querySelector('#directions');
  directions.className = '';
  directions.removeAttribute('href');
  directions.textContent = 'Highlighted NTA boundary';
  detail.hidden = false;
  render();
  if (moveMap && !wasSelected) zoomToFeature(feature);
}

function zoomToFeature(feature) {
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  const scale = Math.min(2, 0.48 / Math.max((x1 - x0) / width, (y1 - y0) / height));
  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(650).call(zoom.transform, transform);
}

function neighborhoodSearchMatch(value) {
  const term = value.trim().toLowerCase();
  if (!term || !state.neighborhoods) return null;
  const features = state.neighborhoods.features;
  const exact = features.find((feature) => feature.properties.name.toLowerCase() === term || feature.id.toLowerCase() === term);
  if (exact) return exact;
  const starts = features.filter((feature) => feature.properties.name.toLowerCase().startsWith(term));
  if (starts.length === 1) return starts[0];
  const contains = features.filter((feature) => feature.properties.name.toLowerCase().includes(term));
  return contains.length === 1 ? contains[0] : null;
}

function selectCandidate(candidate) {
  const p = candidate.properties;
  state.selected = candidate.id;
  state.selectedType = 'candidate';
  setDetailLabels('CANDIDATE PARK', 'Score', 'Park acreage', 'Nearest run');
  document.querySelector('#detail-name').textContent = p.rank === null ? p.name : `#${p.rank} ${p.name}`;
  document.querySelector('#detail-location').textContent = `${p.borough || 'NYC'} · ${p.hasDogRun ? 'Existing dog run' : 'No mapped dog run'} · ${d3.format(',')(p.licenseEstimate)} estimated licenses · ${d3.format(',')(p.complaintCount)} complaints`;
  document.querySelector('#detail-surface').textContent = p.score === null ? 'Excluded from ranking' : `${p.score} / 100`;
  document.querySelector('#detail-seating').textContent = `${p.acres.toFixed(1)} acres`;
  document.querySelector('#detail-area').textContent = `${p.nearestRunKm.toFixed(2)} km`;
  const factors = document.querySelector('#candidate-factors');
  factors.hidden = !p.factors;
  factors.innerHTML = p.factors ? [
    ['Dog-run demand', p.factors.demand],
    ['Access gap', p.factors.access],
    ['Dog-related complaints', p.factors.complaints],
    ['Park acreage', p.factors.acreage]
  ].map(([label, value]) => `<div class="factor-chip"><span>${label}</span><strong>${value.toFixed(0)}</strong></div>`).join('') : '';
  const directions = document.querySelector('#directions');
  directions.className = 'candidate-note';
  directions.textContent = p.score === null
    ? 'This park is excluded from scoring under the current selection.'
    : 'Exploratory comparison only — not a construction recommendation or site approval.';
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

function currentWeights() {
  return Object.fromEntries([...document.querySelectorAll('[data-weight]')].map((input) => [input.dataset.weight, Number(input.value)]));
}

async function refreshOpportunities() {
  const requestId = ++opportunityRequestId;
  const status = document.querySelector('#ranking-status');
  const weights = currentWeights();
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total !== 100) {
    status.textContent = `Weights total ${total}%; they must total 100%.`;
    return;
  }
  status.textContent = 'Recalculating scores and rankings…';
  const params = new URLSearchParams({ ...weights, includeExisting: String(state.includeExisting) });
  try {
    const response = await fetch(`/api/opportunities?${params}`);
    if (!response.ok) throw new Error(`Ranking request returned ${response.status}`);
    const opportunities = await response.json();
    if (requestId !== opportunityRequestId) return;
    state.opportunities = opportunities;
    status.textContent = `${eligibleCandidates().length.toLocaleString()} parks scored and ranked.`;
    const selectedCandidate = state.selectedType === 'candidate'
      ? state.opportunities.features.find((candidate) => candidate.id === state.selected)
      : null;
    if (selectedCandidate) {
      selectCandidate(selectedCandidate);
      return;
    }
    render();
  } catch (error) {
    if (requestId === opportunityRequestId) status.textContent = 'Unable to calculate park scores.';
    console.error(error);
  }
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
    load('/api/license-density', (data) => {
      state.density = data;
      if (state.selectedType === 'area-search') {
        const feature = state.neighborhoods.features.find((area) => area.id === state.searchArea);
        if (feature) selectSearchedArea(feature, false);
      }
    }),
    load('/api/complaint-hotspots', (data) => { state.complaints = data; }),
    refreshOpportunities()
  ]);
}

async function init() {
  try {
    const neighborhoodsResponse = await fetch('/api/neighborhoods');
    if (!neighborhoodsResponse.ok) throw new Error('Neighborhood map data request failed');
    const neighborhoods = await neighborhoodsResponse.json();
    state.neighborhoods = neighborhoods;
    d3.select('#area-options').selectAll('option').data(neighborhoods.features).join('option')
      .attr('value', (feature) => feature.properties.name)
      .attr('label', (feature) => feature.properties.borough);
    drawMap();
    loading.hidden = true;
    loadOptionalLayers();
  } catch (error) {
    loading.textContent = 'We could not load the map. Please try again.';
    console.error(error);
  }
}

document.querySelector('#search').addEventListener('input', (event) => {
  state.query = event.target.value;
  const match = neighborhoodSearchMatch(state.query);
  if (match) selectSearchedArea(match, true);
  else {
    state.searchArea = null;
    if (state.selectedType === 'area-search') {
      state.selected = null;
      state.selectedType = null;
      detail.hidden = true;
    }
    render();
  }
});
document.querySelector('#close-detail').addEventListener('click', () => { state.selected = null; state.selectedType = null; detail.hidden = true; render(); });
document.querySelector('#reset-view').addEventListener('click', resetView);
document.querySelector('#zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.5));
document.querySelector('#zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.67));
document.querySelectorAll('.layer-option input').forEach((checkbox) => checkbox.addEventListener('change', () => {
  state.layers[checkbox.dataset.layer] = checkbox.checked;
  const selectionType = { candidate: 'candidate', density: 'density' }[checkbox.dataset.layer];
  if (!checkbox.checked && state.selectedType === selectionType) {
    state.selected = null;
    state.selectedType = null;
    detail.hidden = true;
  }
  render();
}));
document.querySelectorAll('input[name="existing-parks"]').forEach((radio) => radio.addEventListener('change', () => {
  state.includeExisting = radio.value === 'include';
  refreshOpportunities();
}));
document.querySelector('#apply-weights').addEventListener('click', async () => {
  refreshOpportunities();
});
document.querySelector('#reset-weights').addEventListener('click', () => {
  const defaults = { demand: 35, access: 25, complaints: 20, suitability: 20 };
  document.querySelectorAll('[data-weight]').forEach((input) => {
    input.value = defaults[input.dataset.weight];
  });
  refreshOpportunities();
});
document.querySelector('#top-park-count').addEventListener('input', () => render());
svg.on('click', () => { state.selected = null; state.selectedType = null; state.searchArea = null; detail.hidden = true; render(); });
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
