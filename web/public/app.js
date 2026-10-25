const boroughNames = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', R: 'Staten Island', X: 'Bronx' };
const state = { runs: [], neighborhoods: null, borough: 'ALL', query: '', selected: null };

const svg = d3.select('#map');
const mapRoot = svg.append('g');
const neighborhoodLayer = mapRoot.append('g');
const runLayer = mapRoot.append('g');
const loading = document.querySelector('#loading');
const list = document.querySelector('#run-list');
const detail = document.querySelector('#detail-card');
let demandData = null;
let demandByNta = new Map();
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
  points.select('.run-point').classed('selected', (run) => run.id === state.selected);
}

function selectRun(run, moveMap) {
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
svg.on('click', () => { state.selected = null; detail.hidden = true; render(); });
window.addEventListener('resize', () => { if (state.neighborhoods) drawMap(); });

init();
loadDemand();

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
  const metric = document.querySelector('#demand-metric').value;
  const maximum = d3.max(demandData?.ntas || [], (n) => n[metric]) || 0;
  const color = d3.scaleSequentialSqrt(d3.interpolateYlOrRd).domain([0, maximum || 1]);
  neighborhoodLayer.selectAll('path').style('fill', (f) => {
    if (!enabled || !demandData) return null;
    const value = demandByNta.get(f.id)?.[metric];
    return value == null ? '#c4c8cc' : value === 0 ? '#fffdf8' : color(value);
  });
  const legend = document.querySelector('#demand-legend');
  legend.hidden = !enabled || !demandData;
  legend.replaceChildren();
  if (legend.hidden) return;
  const title = document.createElement('strong');
  title.textContent = metric === 'estimatedDemand' ? 'Estimated licensed-dog total' : 'Estimated licenses / 1,000 units';
  legend.append(title);
  const ramp = document.createElement('div');
  ramp.className = 'demand-ramp';
  ramp.style.background = `linear-gradient(to right, ${d3.range(11).map((i) => color(maximum * i / 10)).join(',')})`;
  legend.append(ramp);
  const labels = document.createElement('div');
  labels.textContent = `Low → ${demandFormat.format(maximum)} · square-root scale`;
  legend.append(labels);
  const key = document.createElement('div');
  key.textContent = '□ White: zero demand · ■ Gray: missing data';
  legend.append(key);
  document.querySelector('#demand-tooltip').hidden = true;
}
function showDemandTooltip(event, feature) {
  if (!demandData || !document.querySelector('#demand-toggle').checked) return;
  const n = demandByNta.get(feature.id);
  const tooltip = document.querySelector('#demand-tooltip');
  const fmt = (v) => v == null ? 'Missing data' : demandFormat.format(v);
  tooltip.textContent = `${feature.properties.name}\nEstimated Licensed-Dog Demand: ${fmt(n?.estimatedDemand)}\nResidential units: ${fmt(n?.residentialUnits)}\nCovered units: ${fmt(n?.coveredResidentialUnits)}\nPer 1,000 covered units: ${fmt(n?.demandPer1000Units)}${n?.flags.partialCoverage ? '\nPartial coverage: invalid units or unknown ZIP.' : ''}\nModeled estimate; not observed dog locations.`;
  tooltip.hidden = false;
  const box = document.querySelector('.map-panel').getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX - box.left + 14, box.width - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY - box.top + 14, box.height - tooltip.offsetHeight - 8))}px`;
}
async function loadDemand() {
  const quality = document.querySelector('#demand-quality');
  try {
    const response = await fetch('/api/dog-demand');
    if (!response.ok) throw new Error('Demand request failed');
    demandData = await response.json();
    demandByNta = new Map(demandData.ntas.map((n) => [n.id, n]));
    const s = demandData.summary;
    quality.textContent = `${demandFormat.format(s.nta_demand)} of ${demandFormat.format(s.active_license_records)} deduplicated active license records mapped. Excluded: ${demandFormat.format(s.excluded_demand)} (${demandFormat.format(s.unallocatable_demand)} unallocatable by ZIP/units; ${demandFormat.format(s.missing_coordinate_demand)} missing coordinates; ${demandFormat.format(s.outside_nta_demand)} outside NTAs; ${demandFormat.format(s.ambiguous_nta_demand)} ambiguous). Residential parcels assigned: ${s.assigned_residential_parcels}/${s.residential_parcels}.`;
    if (!Object.values(demandData.metadata.availability).every(Boolean)) quality.textContent += ' Required source data is missing.';
    renderDemand();
  } catch (error) {
    quality.textContent = 'Demand unavailable. Dog-run exploration remains available.';
    console.error(error);
  }
}
document.querySelector('#demand-toggle').addEventListener('change', renderDemand);
document.querySelector('#demand-metric').addEventListener('change', renderDemand);
