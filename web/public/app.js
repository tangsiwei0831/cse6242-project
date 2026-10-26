const boroughNames = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', R: 'Staten Island', X: 'Bronx' };
const state = { runs: [], neighborhoods: null, borough: 'ALL', query: '', selected: null };

const svg = d3.select('#map');
const mapRoot = svg.append('g');
const neighborhoodLayer = mapRoot.append('g');
// Both marker types share a parent so the selected marker can sit above either.
const markerLayer = mapRoot.append('g').attr('class', 'marker-layer');
const loading = document.querySelector('#loading');
const list = document.querySelector('#run-list');
const detail = document.querySelector('#detail-card');
let demandData = null;
let demandByNta = new Map();
let accessibilityData = null;
let accessibilityByNta = new Map();
const layerStatus = { demand: 'Loading prepared demand estimates…', accessibility: 'Loading prepared accessibility estimates…' };
const layerRequests = { demand: 0, accessibility: 0 };
let projection;
let path;
let mapTransform = d3.zoomIdentity;

const zoom = d3.zoom().scaleExtent([1, 12]).on('zoom', handleMapZoom);
svg.call(zoom);

// Keep each marker anchored in map coordinates, but cancel its inherited zoom
// scale. A glyph/hit target thus keeps the same size in SVG screen pixels.
function markerTransform(longitude, latitude) {
  const [x, y] = projection([longitude, latitude]);
  return `translate(${x},${y}) scale(${1 / mapTransform.k})`;
}
function handleMapZoom(event) {
  mapTransform = event.transform;
  mapRoot.attr('transform', mapTransform);
  markerLayer.selectAll('g.run').attr('transform', run => markerTransform(run.properties.longitude, run.properties.latitude));
  if (typeof updateCandidateMarkerPositions === 'function') updateCandidateMarkerPositions();
}
function raiseSelectedMarkers() {
  const selected = markerLayer.selectAll('g.map-marker.selected');
  markerLayer.classed('has-selection', !selected.empty());
  selected.raise();
}
function handleRunMarkerClick(event, run) {
  event.stopPropagation();
  selectRun(run, false);
}

function filteredRuns() {
  const term = state.query.trim().toLowerCase();
  return state.runs.filter((run) => {
    const boroughMatch = state.borough === 'ALL' || run.properties.borough === state.borough;
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
  document.querySelector('#visible-count').textContent = runs.length;
  document.querySelector('#borough-count').textContent = new Set(runs.map((run) => run.properties.borough)).size;
  renderFilters();

  const items = d3.select(list).selectAll('button.run-item').data(runs, (run) => run.id).join(
    (enter) => enter.append('button').attr('type', 'button').attr('class', 'run-item').html('<span class="dot"></span><span><strong></strong><small></small></span>'),
    (update) => update,
    (exit) => exit.remove()
  );
  items.classed('active', (run) => run.id === state.selected)
    .on('click', (_event, run) => selectRun(run, true));
  items.select('strong').text((run) => run.properties.name);
  items.select('small').text((run) => `${boroughNames[run.properties.borough]} · ${run.properties.zipcode || 'ZIP unavailable'}`);
  d3.select(list).selectAll('p.empty').data(runs.length ? [] : [null]).join('p').attr('class', 'empty').text('No dog runs match your search.');

  const points = markerLayer.selectAll('g.run').data(runs, (run) => run.id).join(
    (enter) => {
      const group = enter.append('g').attr('class', 'run map-marker');
      group.append('circle').attr('class', 'marker-hit-target').attr('r', 9);
      group.append('circle').attr('class', 'run-halo').attr('r', 7.5);
      group.append('circle').attr('class', 'run-point').attr('r', 4.5);
      return group;
    },
    (update) => update,
    (exit) => exit.remove()
  );
  points.attr('transform', run => markerTransform(run.properties.longitude, run.properties.latitude))
    .classed('selected', run => run.id === state.selected)
    .on('click', handleRunMarkerClick);
  points.select('.run-point').classed('selected', (run) => run.id === state.selected);
  if (typeof renderCandidates === 'function') renderCandidates();
  raiseSelectedMarkers();
}

function selectRun(run, moveMap) {
  if (typeof clearCandidateSelection === 'function') clearCandidateSelection();
  state.selected = run.id;
  const p = run.properties;
  document.querySelector('#detail-name').textContent = p.name;
  document.querySelector('#detail-location').textContent = `${boroughNames[p.borough]} · ${p.zipcode || 'ZIP unavailable'}`;
  document.querySelector('#detail-surface').textContent = p.surface || 'Not listed';
  document.querySelector('#detail-seating').textContent = p.seating || 'Not listed';
  document.querySelector('#detail-area').textContent = p.areaSqM < 1000 ? `${Math.round(p.areaSqM)} m²` : `${(p.areaSqM / 1000).toFixed(1)}k m²`;
  document.querySelector('#directions').href = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
  detail.hidden = false;
  render();
  if (moveMap) {
    const [x, y] = projection([p.longitude, p.latitude]);
    const width = svg.node().clientWidth;
    const height = svg.node().clientHeight;
    svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(5).translate(-x, -y));
  }
}

function resetView() {
  if (typeof clearCandidateSelection === 'function') clearCandidateSelection();
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
    .attr('class', 'neighborhood').attr('d', path)
    .on('pointermove', showDemandTooltip)
    .on('pointerleave', () => { document.querySelector('#demand-tooltip').hidden = true; });
  renderDemand();
  render();
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
  } catch (error) {
    loading.textContent = 'We could not load the map. Please try again.';
    console.error(error);
  }
}

document.querySelector('#search').addEventListener('input', (event) => { state.query = event.target.value; render(); });
document.querySelector('#close-detail').addEventListener('click', () => { state.selected = null; detail.hidden = true; render(); });
document.querySelector('#reset-view').addEventListener('click', resetView);
document.querySelector('#zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.5));
document.querySelector('#zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.67));
svg.on('click', () => { if (typeof clearCandidateSelection === 'function') clearCandidateSelection(); state.selected = null; detail.hidden = true; render(); });
window.addEventListener('resize', () => { if (state.neighborhoods) drawMap(); });

init();
loadDemand();
loadAccessibility();

// In the local Docker development setup, refresh the page after frontend edits.
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

const demandFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
function renderDemand() {
  document.querySelector('#demand-tooltip').hidden = true;
  const enabled = document.querySelector('#demand-toggle').checked;
  const accessibility = document.querySelector('#map-layer').value === 'accessibility';
  document.querySelector('#demand-metric-control').hidden = accessibility;
  document.querySelector('#accessibility-note').hidden = !accessibility;
  const metric = accessibility ? 'uncoveredDemand' : document.querySelector('#demand-metric').value;
  const data = accessibility ? accessibilityData : demandData;
  const byNta = accessibility ? accessibilityByNta : demandByNta;
  renderLayerStatus(accessibility ? 'accessibility' : 'demand', data);
  const maximum = d3.max(data?.ntas || [], (n) => n[metric]) || 0;
  const color = d3.scaleSequentialSqrt(d3.interpolateYlOrRd).domain([0, maximum || 1]);
  neighborhoodLayer.selectAll('path').style('fill', (f) => {
    if (!enabled || !data) return null;
    const value = byNta.get(f.id)?.[metric];
    return value == null ? '#c4c8cc' : value === 0 ? '#fffdf8' : color(value);
  });
  const legend = document.querySelector('#demand-legend');
  legend.hidden = !enabled || !data;
  legend.replaceChildren();
  if (legend.hidden) return;
  const title = document.createElement('strong');
  title.textContent = accessibility ? 'Underserved estimated licensed-dog demand' : metric === 'estimatedDemand' ? 'Estimated licensed-dog total' : 'Estimated licenses / 1,000 units';
  legend.append(title);
  if (accessibility) {
    const note = document.createElement('div');
    note.textContent = 'Beyond 800m straight-line radius · not walking distance';
    legend.append(note);
  }
  const ramp = document.createElement('div');
  ramp.className = 'demand-ramp';
  ramp.style.background = `linear-gradient(to right, ${d3.range(11).map((i) => color(maximum * i / 10)).join(',')})`;
  legend.append(ramp);
  const labels = document.createElement('div');
  labels.textContent = `Low → ${demandFormat.format(maximum)} · square-root scale`;
  legend.append(labels);
  const key = document.createElement('div');
  key.textContent = accessibility ? 'White: zero uncovered demand · Gray: missing data' : '□ White: zero demand · ■ Gray: missing data';
  legend.append(key);
  document.querySelector('#demand-tooltip').hidden = true;
}
function showDemandTooltip(event, feature) {
  const accessibility = document.querySelector('#map-layer').value === 'accessibility';
  const data = accessibility ? accessibilityData : demandData;
  if (!data || !document.querySelector('#demand-toggle').checked) return;
  const n = (accessibility ? accessibilityByNta : demandByNta).get(feature.id);
  const tooltip = document.querySelector('#demand-tooltip');
  const fmt = (v) => v == null ? 'Missing data' : demandFormat.format(v);
  tooltip.textContent = `${feature.properties.name}\nEstimated Licensed-Dog Demand: ${fmt(n?.estimatedDemand)}\nResidential units: ${fmt(n?.residentialUnits)}\nUnits with allocatable ZIP: ${fmt(n?.coveredResidentialUnits)}\nPer 1,000 allocatable units: ${fmt(n?.demandPer1000Units)}${n?.flags.partialCoverage ? '\nPartial coverage: invalid units or unknown ZIP.' : ''}\nModeled estimate; not observed dog locations.`;
  if (document.querySelector('#map-layer').value === 'accessibility') {
    tooltip.textContent = `${feature.properties.name}\nEstimated Licensed-Dog Demand\nTotal eligible demand: ${fmt(n?.accessibilityTotalDemand)}\nCovered (≤800m): ${fmt(n?.coveredDemand)}\nUncovered (>800m): ${fmt(n?.uncoveredDemand)}\nDemand-weighted coverage: ${n?.coveragePercentage == null ? 'N/A (zero or missing demand)' : fmt(n.coveragePercentage) + '%'}\n800m straight-line service radius, not walking distance.${n?.flags.partialCoverage ? '\nPartial source coverage: invalid units or unknown ZIP.' : ''}${n?.flags.noActiveDogRuns ? '\nNo active dog runs in the database.' : ''}\nModeled estimate; not observed dog locations.`;
  }
  tooltip.hidden = false;
  const box = document.querySelector('.map-panel').getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX - box.left + 14, box.width - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY - box.top + 14, box.height - tooltip.offsetHeight - 8))}px`;
}
function renderLayerStatus(kind, data) {
  document.querySelector('#demand-status').textContent = layerStatus[kind];
  const quality = document.querySelector('#demand-quality');
  if (!data) { quality.textContent = 'No prepared metrics to display for this layer. Other map features remain available.'; return; }
  const s = data.summary;
  quality.textContent = `${demandFormat.format(s.nta_demand)} of ${demandFormat.format(s.active_license_records)} active license records mapped. Excluded: ${demandFormat.format(s.excluded_demand)} (${demandFormat.format(s.unallocatable_demand)} unallocatable by ZIP/units; ${demandFormat.format(s.missing_coordinate_demand)} missing coordinates; ${demandFormat.format(s.outside_nta_demand)} outside NTAs; ${demandFormat.format(s.ambiguous_nta_demand)} ambiguous). Residential parcels assigned: ${s.assigned_residential_parcels}/${s.residential_parcels}.`;
  if (kind === 'accessibility') {
    const a = data.accessibilitySummary;
    quality.textContent += ` Accessibility: ${demandFormat.format(a.nta_covered_demand)} covered and ${demandFormat.format(a.nta_uncovered_demand)} uncovered. Unassigned NTA demand: ${demandFormat.format(a.unassigned_nta_demand)}; invalid-location demand: ${demandFormat.format(a.invalid_location_demand)}. Conservation error: ${demandFormat.format(a.conservation_error)}.`;
  }
}
async function loadLayer(kind, url) {
  const requestId = ++layerRequests[kind];
  layerStatus[kind] = `Loading prepared ${kind} estimates…`;
  renderDemand();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (requestId !== layerRequests[kind]) return;
    if (!response.ok) {
      const message = payload.status === 'stale' ? 'Source data changed. Estimates need to be refreshed.' : payload.status === 'not_ready' ? 'Estimates have not been prepared yet.' : 'Estimates are temporarily unavailable.';
      throw new Error(message);
    }
    if (kind === 'demand') { demandData = payload; demandByNta = new Map(payload.ntas.map(n => [n.id, n])); }
    else { accessibilityData = payload; accessibilityByNta = new Map(payload.ntas.map(n => [n.id, n])); }
    layerStatus[kind] = `Prepared ${new Date(payload.metadata.computedAt).toLocaleString()}.`;
  } catch (error) {
    if (requestId !== layerRequests[kind]) return;
    if (kind === 'demand') { demandData = null; demandByNta = new Map(); }
    else { accessibilityData = null; accessibilityByNta = new Map(); }
    layerStatus[kind] = `${error.message} Other map features remain available.`;
  }
  renderDemand();
}
async function loadDemand() { return loadLayer('demand', '/api/dog-demand'); }
async function loadAccessibility() { return loadLayer('accessibility', '/api/dog-accessibility'); }
document.querySelector('#demand-toggle').addEventListener('change', renderDemand);
document.querySelector('#demand-metric').addEventListener('change', renderDemand);

document.querySelector('#map-layer').addEventListener('change', renderDemand);

document.querySelector('#reload-layers').addEventListener('click', () => { loadDemand(); loadAccessibility(); });
