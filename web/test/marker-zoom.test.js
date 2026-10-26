const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const appSource = readFileSync(join(__dirname,'../public/app.js'),'utf8');
const candidateSource = readFileSync(join(__dirname,'../public/candidates.js'),'utf8');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);

async function fixture() {
  const d3 = await import('d3');
  const runs = [{properties:{longitude:-73.95,latitude:40.77}}, {properties:{longitude:-74,latitude:40.7}}];
  const candidates = [{id:'M294',longitude:-73.95,latitude:40.78}];
  const positions = new Map();
  const layer = {
    selectAll(selector) {
      const data = selector === 'g.run' ? runs : candidates;
      return { attr(name, fn) {
        assert.equal(name,'transform');
        positions.set(selector,data.map(d=>fn(d)));
        return this;
      } };
    }
  };
  const calls = [];
  const context = vm.createContext({
    projection:d3.geoMercator().scale(50000).translate([100,200]),
    mapTransform:d3.zoomIdentity, markerLayer:layer,candidateLayer:layer,
    mapRoot:{attr(name,value){ assert.equal(name,'transform'); this.transform=value; }},
    selectRun:(d,move)=>calls.push({type:'run',datum:d,move}),
    selectCandidate:(d,move)=>calls.push({type:'candidate',datum:d,move})
  });
  vm.runInContext(appSource.slice(appSource.indexOf('function markerTransform'),appSource.indexOf('function filteredRuns')),context);
  vm.runInContext(candidateSource.slice(candidateSource.indexOf('function updateCandidateMarkerPositions'),candidateSource.indexOf('function selectCandidate')),context);
  return {d3,context,runs,candidates,positions,calls};
}
function decode(transform) {
  const m = /^translate\(([^,]+),([^\)]+)\) scale\(([^\)]+)\)$/.exec(transform);
  assert.ok(m,transform);
  return {x:Number(m[1]),y:Number(m[2]),scale:Number(m[3])};
}

test('markers stay geographically anchored with fixed pixel glyphs/hit areas throughout zoom and pan', async () => {
  const f = await fixture();
  for (const k of [1,1.25,2,5,8,12,1]) {
    f.context.event = {transform:f.d3.zoomIdentity.translate(180-k*20,-80+k*10).scale(k)};
    vm.runInContext('handleMapZoom(event)',f.context);
    for (const [selector,rows] of [['g.run',f.runs],['g.candidate',f.candidates]]) {
      assert.equal(f.positions.get(selector).length,rows.length); // No data rebind/removal on zoom.
      rows.forEach((row,i)=>{
        const p = row.properties || row;
        const local = decode(f.positions.get(selector)[i]);
        const projected = f.context.projection([p.longitude,p.latitude]);
        near(local.x,projected[0]); near(local.y,projected[1]);
        near(local.scale*k,1);
        const center = f.context.event.transform.apply(projected);
        // Circle radius, transparent hit target, diamond vertex, and selection
        // ring offsets all remain screen pixels after the nested SVG transforms.
        for (const offset of [[4.5,0],[9,0],[0,6.5],[11,0]]) {
          const actual = f.context.event.transform.apply([local.x+offset[0]*local.scale,local.y+offset[1]*local.scale]);
          near(actual[0],center[0]+offset[0]); near(actual[1],center[1]+offset[1]);
        }
      });
    }
  }
});

test('rerenders and resized projections retain counter-scale while already zoomed', async () => {
  const f = await fixture();
  f.context.event = {transform:f.d3.zoomIdentity.translate(-500,-200).scale(5)};
  vm.runInContext('handleMapZoom(event)',f.context);
  f.context.projection = f.d3.geoMercator().scale(70000).translate([500,400]);
  f.context.c = f.candidates[0];
  const next = decode(vm.runInContext('markerTransform(c.longitude,c.latitude)',f.context));
  const projected = f.context.projection([f.context.c.longitude,f.context.c.latitude]);
  near(next.x,projected[0]); near(next.y,projected[1]); near(next.scale,.2);
});

test('marker clicks and keyboard activation select the original datum without bubbling or recentering', async () => {
  const f = await fixture();
  for (const k of [1,5,12]) {
    f.context.event = {transform:f.d3.zoomIdentity.scale(k)};
    vm.runInContext('handleMapZoom(event)',f.context);
    let stopped = 0, prevented = 0;
    f.context.click = {stopPropagation(){stopped++;}};
    f.context.run = f.runs[0]; f.context.candidate = f.candidates[0];
    vm.runInContext('handleRunMarkerClick(click,run); handleCandidateMarkerClick(click,candidate)',f.context);
    f.context.key = {key:'Enter',stopPropagation(){stopped++;},preventDefault(){prevented++;}};
    vm.runInContext('handleCandidateMarkerKeydown(key,candidate)',f.context);
    f.context.key.key = ' ';
    vm.runInContext('handleCandidateMarkerKeydown(key,candidate)',f.context);
    assert.equal(stopped,4); assert.equal(prevented,2);
    const recent = f.calls.slice(-4);
    assert.equal(recent[0].datum,f.runs[0]);
    assert.ok(recent.slice(1).every(call=>call.datum===f.candidates[0]));
    assert.ok(recent.every(call=>call.move===false));
  }
});

test('selection emphasis moves selected marker above both types and resets cleanly', async () => {
  const f = await fixture();
  let selected = true, raised = 0, emphasis;
  f.context.markerLayer = {
    selectAll(selector){assert.equal(selector,'g.map-marker.selected');return {empty:()=>!selected,raise:()=>{raised++;}};},
    classed(name,value){assert.equal(name,'has-selection');emphasis=value;}
  };
  vm.runInContext('raiseSelectedMarkers()',f.context);
  assert.equal(emphasis,true); assert.equal(raised,1);
  selected=false;
  vm.runInContext('raiseSelectedMarkers()',f.context);
  assert.equal(emphasis,false);
});
