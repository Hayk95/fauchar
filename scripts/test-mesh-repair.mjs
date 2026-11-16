import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { parseHTML } from "linkedom";
import { findMeshBoundaries, fillMeshBoundary } from "../lib/client/cad/mesh-repair.js";
import { inspectMesh } from "../lib/client/cad/mesh-quality.js";
import { clipMeshByPlane } from "../lib/client/cad/mesh-cut.js";
import { CadEditor } from "../lib/client/cad/editor.js";
import { renderPanel } from "../lib/client/cad/panel.js";
import { parseBinarySTL } from "../lib/client/cad/mesh.js";

const tetra=()=>({positions:new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]),indices:new Uint32Array([0,2,1,0,1,3,1,2,3,2,0,3])});
const openTetra=()=>({...tetra(),indices:tetra().indices.slice(3)});
function prism(poly=[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],height=1){
  const n=poly.length, positions=Float64Array.from([0,height].flatMap(z=>poly.flatMap(([x,y])=>[x,y,z])));
  const indices=[0,2,1,0,3,2,0,5,3,3,5,4];
  for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,j,j+n,i,j+n,i+n);}
  return {positions,indices:Uint32Array.from(indices)};
}
const fillFirst=mesh=>fillMeshBoundary({...mesh,vertices:findMeshBoundaries(mesh).loops[0].vertices});

test("find and fill one hole with shared indices, original coordinates and opposite boundary winding",()=>{
  const mesh=openTetra(),before=structuredClone(mesh),found=findMeshBoundaries(mesh);
  assert.equal(found.boundaryEdges,3);assert.equal(found.loops.length,1);assert.equal(found.loops[0].fillable,true);
  assert.equal(found.segments.length,18);
  const result=fillFirst(mesh);
  assert.equal(result.addedFaces,1);assert.equal(result.report.closedOriented,true);
  assert.deepEqual(result.positions,mesh.positions);
  assert.deepEqual(result.indices.slice(0,mesh.indices.length),mesh.indices);
  assert.deepEqual(mesh,before);
  assert.equal(findMeshBoundaries(result).boundaryEdges,0);
});

test("concave planar holes triangulate without a center fan or moving the boundary",()=>{
  const mesh=prism(),found=findMeshBoundaries(mesh);
  assert.equal(found.loops.length,1);assert.equal(found.loops[0].vertexCount,6);
  const result=fillFirst(mesh);
  assert.equal(result.addedFaces,4);assert.equal(result.positions.length,mesh.positions.length);
  assert.equal(result.report.closedOriented,true);
  const area=indices=>{
    let sum=0;for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3).map(v=>v*3);sum+=((mesh.positions[b]-mesh.positions[a])*(mesh.positions[c+1]-mesh.positions[a+1])-(mesh.positions[b+1]-mesh.positions[a+1])*(mesh.positions[c]-mesh.positions[a]))/2;}return sum;
  };
  assert.equal(area(result.indices.slice(mesh.indices.length)),3);
});

test("only the selected loop is filled; a cut can be closed without a replacement shell",()=>{
  const a=openTetra(),b=openTetra();
  const mesh={positions:Float32Array.from([...a.positions,...b.positions.map((v,i)=>v+(i%3===0?3:0))]),indices:Uint32Array.from([...a.indices,...b.indices.map(v=>v+4)])};
  const found=findMeshBoundaries(mesh);assert.equal(found.loops.length,2);
  const filled=fillMeshBoundary({...mesh,vertices:found.loops[1].vertices});
  assert.equal(filled.report.boundaryEdges,3);
  const clipped=clipMeshByPlane({...tetra(),axis:0,offset:.25,side:1});
  const repaired=fillFirst(clipped);assert.equal(repaired.report.closedOriented,true);
});

test("non-planar, oversized, ambiguous, stale and self-crossing boundaries fail explicitly",()=>{
  const warped=prism();warped.positions[6*3+2]+=.1;
  assert.match(findMeshBoundaries(warped).loops[0].reason,/not planar/);
  assert.throws(()=>fillFirst(warped),/not planar/);
  const large=prism();large.positions=large.positions.map(v=>v*10);
  assert.match(findMeshBoundaries(large).loops[0].reason,/size limit/);
  assert.throws(()=>fillMeshBoundary({...openTetra(),vertices:[0,1,3]}),/changed/);
  const mesh=openTetra();
  assert.throws(()=>fillMeshBoundary({...mesh,vertices:[0,0,1]}),/simple boundary/);
  const a=openTetra(),b=openTetra();
  const ambiguous={positions:Float32Array.from([...a.positions,...b.positions.slice(3).map(v=>-v)]),indices:Uint32Array.from([...a.indices,...b.indices.map(v=>v===0?0:v+3)])};
  const boundaries=findMeshBoundaries(ambiguous);assert.equal(boundaries.loops.length,0);assert.ok(boundaries.ambiguousEdges>0);
  const bow=prism([[0,0],[2,2],[2,0],[0,2],[0,3],[-1,1]]);
  assert.equal(findMeshBoundaries(bow).loops[0].fillable,false);
});

test("caps reject existing geometry crossing or overlapping the selected hole",()=>{
  const base=openTetra();
  // Missing base is z=0; extra surface crosses its interior.
  const crossing={positions:Float32Array.from([...base.positions,.2,.2,-.2,.2,.2,.2,.4,.2,.2]),indices:Uint32Array.from([...base.indices,4,5,6])};
  const loop=findMeshBoundaries(crossing).loops.find(l=>l.vertices.includes(0));
  assert.throws(()=>fillMeshBoundary({...crossing,vertices:loop.vertices}),/intersect/);
  const overlapping={positions:Float32Array.from([...base.positions,.1,.1,0,.2,.1,0,.1,.2,0]),indices:Uint32Array.from([...base.indices,4,5,6])};
  const selected=findMeshBoundaries(overlapping).loops.find(l=>l.vertices.includes(0));
  assert.throws(()=>fillMeshBoundary({...overlapping,vertices:selected.vertices}),/overlap/);
  const sheet={positions:base.positions,indices:new Uint32Array([0,1,2])};
  assert.throws(()=>fillFirst(sheet),/overlap/);
});

class BrowserWorker {
  constructor(){this.worker=new Worker(new URL("./fixtures/kernel-thread.mjs",import.meta.url));this.worker.on("message",data=>this.onmessage?.({data}));this.worker.on("error",error=>this.onerror?.(error));}
  postMessage(message){this.worker.postMessage(message);} terminate(){void this.worker.terminate();}
}
globalThis.Worker=BrowserWorker;
function editor(io={}){
  const layers=new Map(),viewer={meshes:new Map(),canvas:{dataset:{}},toWorld:p=>[p[0],p[2],-p[1]],addMesh(id,g){this.meshes.set(id,g);},setVisible(){},removeMesh(id){this.meshes.delete(id);},render(){},setLineLayer(id,points){layers.set(id,points);}};
  const ed=new CadEditor({viewer,caseData:{id:"REPAIR",teeth:[22]},io:{toast(){},...io}});
  ed.scanObjects=[];ed.tool="mesh";ed.renderPanel=ed.renderRibbon=ed.refreshMap=ed.updateSection=()=>{};
  return {ed,layers};
}
const dispose=ed=>{clearTimeout(ed.saveTimer);ed.kernel.dispose();};

test("worker-backed repair, 3D loop highlight, undo/redo, export and persistence preserve original crown",async()=>{
  let saved;const {ed,layers}=editor({saveDesign:async value=>{saved=structuredClone(value);}});
  const crown={id:"cad:crown",kind:"crown",name:"Crown"};ed.addObject(crown,openTetra(),{});ed.selectedId=crown.id;
  const original=crown.mesh.idx.slice();
  try{
    assert.equal(await ed.runMeshRepair("fill"),null);
    const copy=ed.addMeshWorkingCopy(crown,openTetra(),{type:"component",componentId:0});
    assert.equal(ed.restorationUnits.length,1,"working copies must not add a bridge unit");
    const found=await ed.runMeshRepair("find");assert.equal(found.loops.length,1);
    ed.drawMeshBoundaries();assert.equal(layers.get("mesh-boundary-selected").length,18);
    const selected=found.loops[0].vertices;
    const expected=selected.flatMap((v,i)=>[v,selected[(i+1)%selected.length]].flatMap(id=>ed.viewer.toWorld([...copy.mesh.pos.slice(id*3,id*3+3)])));
    assert.deepEqual([...layers.get("mesh-boundary-selected")],expected);
    const result=await ed.runMeshRepair("fill");assert.equal(result.report.closedOriented,true);
    assert.equal(layers.get("mesh-boundary-selected"),null);assert.deepEqual(crown.mesh.idx,original);
    ed.undo();assert.equal(inspectMesh({positions:copy.mesh.pos,indices:copy.mesh.idx}).report.boundaryEdges,3);
    ed.redo();assert.equal(inspectMesh({positions:copy.mesh.pos,indices:copy.mesh.idx}).report.closedOriented,true);
    let exported;
    ed.download=buffer=>{exported=parseBinarySTL(buffer);};
    assert.equal(ed.exportUnit(copy).closed,true);
    assert.equal(inspectMesh(exported).report.closedOriented,true);
    assert.equal(exported.indices.length,copy.mesh.idx.length);
    await ed.saveDesign();const reopened=editor({loadDesign:async()=>saved}).ed;
    try{await reopened.restoreDesign();assert.deepEqual(reopened.objects.get(copy.id).mesh.idx,copy.mesh.idx);assert.deepEqual(reopened.crown.mesh.idx,original);}finally{dispose(reopened);}
  }finally{dispose(ed);}
});

test("panel disables filling a fitted crown and binds boundary selection on working meshes",async()=>{
  const {ed,layers}=editor(),{document,window}=parseHTML('<div id="panel"></div>');
  ed.panelEl=document.getElementById("panel");
  const obj={id:"scan",kind:"scan",name:"Jaw"};ed.addObject(obj,openTetra(),{});ed.selectedId=obj.id;
  try{
    await ed.runMeshRepair("find");renderPanel(ed);
    assert.ok(ed.panelEl.querySelector('[data-act="mesh-fill-boundary"]').hasAttribute("disabled"));
    obj.kind="mesh";renderPanel(ed);assert.equal(ed.panelEl.querySelector('[data-act="mesh-fill-boundary"]').hasAttribute("disabled"),false);
    const select=ed.panelEl.querySelector('[data-mesh-boundary]');select.dispatchEvent(new window.Event("change"));
    assert.equal(ed.meshBoundaryId,0);
    ed.tool="sculpt";ed.drawMeshBoundaries();assert.equal(layers.get("mesh-boundary-selected"),null);
  }finally{dispose(ed);}
});


test("a missing triangle on the sample crown repairs without resampling the tooth",()=>{
  const raw=readFileSync(new URL("../public/assets/sample/demo-crown-22.stl",import.meta.url));
  const mesh=parseBinarySTL(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  const damaged={positions:mesh.positions,indices:mesh.indices.slice(3)};
  const repaired=fillFirst(damaged);
  assert.equal(repaired.addedFaces,1);assert.equal(repaired.report.closedOriented,true);
  assert.deepEqual(repaired.positions,mesh.positions);
  assert.deepEqual([...repaired.indices.slice(-3)].sort((a,b)=>a-b),[...mesh.indices.slice(0,3)].sort((a,b)=>a-b));
});


test("stale boundary analyses and results never mutate a changed working mesh",async()=>{
  const messages=[],{ed,layers}=editor({toast:message=>messages.push(message)});
  const obj={id:"cad:mesh",kind:"mesh",name:"Working mesh"};ed.addObject(obj,openTetra(),{});ed.selectedId=obj.id;
  try{
    await ed.runMeshRepair("find");obj.meshRevision=1;ed.drawMeshBoundaries();
    assert.equal(layers.get("mesh-boundary-selected"),null);
    assert.equal(await ed.runMeshRepair("fill"),null);
    const run=ed.kernel.run.bind(ed.kernel);
    ed.kernel.run=async(...args)=>{const result=await run(...args);obj.meshRevision++;return result;};
    assert.equal(await ed.runMeshRepair("find"),null);
    assert.ok(messages.some(message=>message.includes("mesh changed")));
    assert.deepEqual(obj.mesh.idx,openTetra().indices);assert.equal(ed.stack.length,0);
  }finally{dispose(ed);}
});
