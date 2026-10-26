// Independent optional point layer; all ranking is prepared by the refresh worker.
const candidateState = { data: null, selected: null, request: 0, status: 'Loading prepared candidates…' };
const candidateLayer = markerLayer;
const candidateNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function candidateWarnings(candidate) {
  const labels = {
    geometryRepaired: 'Invalid source geometry was repaired.',
    missingGeometryPart: 'A source geometry part was missing or empty.',
    multipartGeometry: 'Disconnected areas: one point represents only one placement scenario.',
    multipleNames: 'The property has multiple source names.',
    conflictingBoroughs: 'Conflicting source borough labels need review.',
    multipleTypes: 'Conflicting property types need review.',
    missingAttributes: 'Some property attributes are missing.',
    questionableAcreage: 'Source acreage is missing or nonpositive.',
    inconsistentAreaAttributes: 'Source acreage/percentage attributes disagree across rows.',
    uncertainSpatialOverlap: 'An active run footprint intersects this property; hosting is unconfirmed.',
    sourceCoverageIncomplete: 'Nearby parcels have invalid units or an unallocatable ZIP.',
    includesUnassignedNtaDemand: 'Some incremental demand cannot be assigned to a unique NTA.'
  };
  return Object.entries(labels).filter(([flag]) => candidate.flags[flag]).map(([, label]) => label);
}
function filteredCandidates() {
  const candidates = candidateState.data?.candidates || [];
  return candidates.filter(c => state.borough === 'ALL' || c.borough === boroughNames[state.borough]);
}
function renderCandidates() {
  const enabled = document.querySelector('#candidate-toggle').checked;
  document.querySelector('#candidate-panel').hidden = !enabled;
  document.querySelector('#candidate-key').hidden = !enabled;
  document.querySelector('#candidate-status').textContent = candidateState.status;
  const candidates = filteredCandidates();
  document.querySelector('#candidate-list-title').textContent = state.borough === 'ALL' ? 'Top 10 candidate parks' : `Top 10 in ${boroughNames[state.borough]}`;
  const summary = candidateState.data?.candidateSummary;
  document.querySelector('#candidate-summary').textContent = summary ? `${summary.rankableProperties} hypothetical sites citywide; ${summary.excludedActiveProperties} properties excluded by active-run ID; ${summary.uncertainSpatialOverlapProperties} uncertain overlaps retained. Citywide ranks; borough filter applies. Dog-run search does not change rankings.` : 'Prepared candidate results are unavailable. Other map layers remain available.';
  const top = enabled ? candidates.slice(0, 10) : [];
  const items = d3.select('#candidate-list').selectAll('button.candidate-item').data(top, c => c.id).join('button')
    .attr('type', 'button').attr('class', 'run-item candidate-item')
    .classed('active', c => c.id === candidateState.selected)
    .on('click', (_event, c) => selectCandidate(c, true));
  items.selectAll('strong').data(c => [c]).join('strong').text(c => `#${c.rank} ${c.name}`);
  items.selectAll('small').data(c => [c]).join('small').text(c => `${candidateNumber.format(c.incrementalDemand)} newly covered · ${c.borough || 'Borough unknown'}`);
  d3.select('#candidate-list').selectAll('p.empty').data(enabled && candidateState.data && !top.length ? [null] : []).join('p').attr('class','empty').text('No candidates in this borough.');
  if (!projection) return;
  const points = candidateLayer.selectAll('g.candidate').data(enabled ? candidates : [], c => c.id).join(enter => {
    const group = enter.append('g').attr('class', 'candidate map-marker');
    group.append('circle').attr('class', 'marker-hit-target').attr('r', 9);
    group.append('circle').attr('class', 'candidate-selection-ring').attr('r', 11);
    group.append('path').attr('class', 'candidate-point');
    return group;
  })
    .attr('transform', c => markerTransform(c.longitude,c.latitude))
    .classed('selected', c => c.id === candidateState.selected)
    .attr('tabindex', 0).attr('role', 'button')
    .attr('aria-pressed', c => c.id === candidateState.selected)
    .attr('aria-label', c => `Hypothetical candidate ${c.name}, rank ${c.rank}`)
    .on('click', handleCandidateMarkerClick)
    .on('keydown', handleCandidateMarkerKeydown);
  points.select('.candidate-point').attr('d', d3.symbol().type(d3.symbolDiamond)
    .size(c => c.id === candidateState.selected ? 90 : 48));
  points.selectAll('title').data(c => [c]).join('title').text(c => `#${c.rank} ${c.name}: ${candidateNumber.format(c.incrementalDemand)} newly covered estimated licensed-dog demand`);
  raiseSelectedMarkers();
}
function updateCandidateMarkerPositions() {
  candidateLayer.selectAll('g.candidate').attr('transform', c => markerTransform(c.longitude,c.latitude));
}
function handleCandidateMarkerClick(event, candidate) {
  event.stopPropagation();
  selectCandidate(candidate, false);
}
function handleCandidateMarkerKeydown(event, candidate) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleCandidateMarkerClick(event, candidate);
  }
}
function selectCandidate(candidate, moveMap) {
  candidateState.selected = candidate.id;
  state.selected = null;
  detail.hidden = true;
  document.querySelector('#candidate-name').textContent = candidate.name;
  document.querySelector('#candidate-location').textContent = `${candidate.borough || 'Borough unknown'} · ${candidate.id}`;
  document.querySelector('#candidate-rank').textContent = `#${candidate.rank} citywide`;
  document.querySelector('#candidate-gain').textContent = candidateNumber.format(candidate.incrementalDemand);
  const warnings = candidateWarnings(candidate);
  const list = document.querySelector('#candidate-warnings');
  list.replaceChildren();
  for (const text of warnings.length ? warnings : ['No additional source flags; site suitability is still unverified.']) {
    const item = document.createElement('li'); item.textContent = text; list.append(item);
  }
  document.querySelector('#candidate-detail').hidden = false;
  render();
  if (moveMap) {
    const [x,y] = projection([candidate.longitude,candidate.latitude]);
    svg.transition().duration(650).call(zoom.transform, d3.zoomIdentity.translate(svg.node().clientWidth/2,svg.node().clientHeight/2).scale(5).translate(-x,-y));
  }
}
function clearCandidateSelection() {
  candidateState.selected = null;
  document.querySelector('#candidate-detail').hidden = true;
}
async function loadCandidates() {
  const request = ++candidateState.request;
  candidateState.status = 'Loading prepared candidates…';
  renderCandidates();
  try {
    const response = await fetch('/api/candidate-parks', { cache: 'no-store' });
    const data = await response.json();
    if (request !== candidateState.request) return;
    if (!response.ok) throw new Error(data.status === 'stale' ? 'Source data changed; candidate rankings need refreshing.' : data.status === 'not_ready' ? 'Candidate rankings have not been prepared yet.' : 'Candidate rankings are unavailable.');
    candidateState.data = data;
    candidateState.status = `Prepared ${new Date(data.metadata.computedAt).toLocaleString()}.`;
    // Refresh selection from the new generation, rather than retaining old scores.
    const selected = data.candidates.find(c => c.id === candidateState.selected);
    if (selected) selectCandidate(selected, false); else clearCandidateSelection();
  } catch (error) {
    if (request !== candidateState.request) return;
    candidateState.data = null; clearCandidateSelection();
    candidateState.status = `${error.message} Other map layers remain available.`;
  }
  renderCandidates();
}
document.querySelector('#candidate-toggle').addEventListener('change', () => {
  if (!document.querySelector('#candidate-toggle').checked) clearCandidateSelection();
  renderCandidates();
});
document.querySelector('#close-candidate').addEventListener('click', () => { clearCandidateSelection(); renderCandidates(); });
document.querySelector('#reload-layers').addEventListener('click', loadCandidates);
loadCandidates();
