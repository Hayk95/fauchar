/** Explicit planar hole caps for working meshes; no vertex welding or surface inference. */
import { validateIndexedMesh, inspectMesh } from "./mesh-quality.js";

const MAX_LOOP = 128, MAX_DIAMETER = 10, PLANAR_TOLERANCE = 1e-5;
const point = (p, v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
const sub = (a, b) => a.map((x, k) => x - b[k]);
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const orient = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const signedArea = poly => poly.reduce((s, a, i) => { const b = poly[(i+1)%poly.length]; return s+a[0]*b[1]-a[1]*b[0]; }, 0)/2;

function onSegment(a, b, p, eps) {
  return Math.abs(orient(a,b,p)) <= eps && p[0]>=Math.min(a[0],b[0])-eps && p[0]<=Math.max(a[0],b[0])+eps && p[1]>=Math.min(a[1],b[1])-eps && p[1]<=Math.max(a[1],b[1])+eps;
}
function properCross(a,b,c,d,eps) {
  return orient(a,b,c)*orient(a,b,d)<-eps*eps && orient(c,d,a)*orient(c,d,b)<-eps*eps;
}
function insideTriangle(p,a,b,c,sign,eps) {
  return sign*orient(a,b,p)>=-eps && sign*orient(b,c,p)>=-eps && sign*orient(c,a,p)>=-eps;
}
function inPolygon(p, poly, eps) {
  let inside = false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[j],b=poly[i];
    if(onSegment(a,b,p,eps)) return false; // only strict interior is an obstruction
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}

function triangulate(positions, vertices) {
  if(vertices.length<3 || vertices.length>MAX_LOOP) throw Error(`Choose a simple boundary with 3–${MAX_LOOP} vertices.`);
  const pts=vertices.map(v=>point(positions,v)), center=pts[0];
  const local=pts.map(p=>sub(p,center));
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const p of pts) for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],p[k]); hi[k]=Math.max(hi[k],p[k]); }
  const diameter=Math.hypot(...sub(hi,lo));
  if(diameter>MAX_DIAMETER) throw Error(`Boundary exceeds the ${MAX_DIAMETER} mm size limit.`);
  const normal=local.reduce((n,p,i)=>{ const q=cross(p,local[(i+1)%local.length]); return n.map((x,k)=>x+q[k]); },[0,0,0]);
  const length=Math.hypot(...normal);
  if(length<1e-10) throw Error("Boundary has no stable planar area.");
  const n=normal.map(x=>x/length);
  if(local.some(p=>Math.abs(dot(p,n))>PLANAR_TOLERANCE)) throw Error("Boundary is not planar within 0.00001 mm. Curved surface repair is not supported.");
  const drop=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))), axes=[0,1,2].filter(k=>k!==drop);
  const project=p=>{const q=sub(p,center);return axes.map(k=>q[k]);};
  const poly=pts.map(project), eps=Math.max(1e-12,diameter*diameter*1e-10);
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length];
    if(Math.hypot(...sub(a,b))<1e-8) throw Error("Boundary has coincident vertices; repair it manually.");
    for(let j=i+1;j<poly.length;j++) {
      if(j===i+1 || (i===0 && j===poly.length-1)) continue;
      const c=poly[j],d=poly[(j+1)%poly.length];
      if(properCross(a,b,c,d,eps) || onSegment(a,b,c,eps) || onSegment(a,b,d,eps) || onSegment(c,d,a,eps) || onSegment(c,d,b,eps)) throw Error("Boundary overlaps or intersects itself.");
    }
  }
  const sign=Math.sign(signedArea(poly));
  const remaining=vertices.map((_,i)=>i), triangles=[];
  while(remaining.length>3) {
    let clipped=false;
    for(let i=0;i<remaining.length;i++) {
      const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];
      if(sign*orient(poly[a],poly[b],poly[c])<=eps) continue;
      if(remaining.some(v=>v!==a&&v!==b&&v!==c&&insideTriangle(poly[v],poly[a],poly[b],poly[c],sign,eps))) continue;
      triangles.push([a,b,c]); remaining.splice(i,1); clipped=true; break;
    }
    if(!clipped) throw Error("Boundary cannot be triangulated without degenerate faces.");
  }
  if(sign*orient(...remaining.map(i=>poly[i]))<=eps) throw Error("Boundary would create a zero-area cap.");
  triangles.push(remaining);
  return { triangles: triangles.map(t=>t.map(i=>vertices[i])), projected:triangles.map(t=>t.map(i=>poly[i])), poly, project, normal:n, center, diameter, eps, lo, hi };
}

export function findMeshBoundaries({ positions, indices }, progress=()=>{}) {
  validateIndexedMesh(positions,indices);
  const edges=new Map(), vertexCount=positions.length/3;
  for(let i=0;i<indices.length;i+=3) {
    const face=[indices[i],indices[i+1],indices[i+2]];
    for(let k=0;k<3;k++) {
      const a=face[k],b=face[(k+1)%3],key=Math.min(a,b)*vertexCount+Math.max(a,b);
      const edge=edges.get(key);
      if(edge){edge.count++;edge.direction+=a<b?1:-1;}else edges.set(key,{a,b,count:1,direction:a<b?1:-1});
    }
    if(i%49152===0) progress(i/indices.length*.6);
  }
  const boundary=[...edges.values()].filter(e=>e.count===1), outgoing=new Map(),incoming=new Map();
  const badTopology=[...edges.values()].some(e=>e.count>2 || (e.count===2 && e.direction!==0));
  for(const e of boundary){ const out=outgoing.get(e.a)||[];out.push(e);outgoing.set(e.a,out);incoming.set(e.b,(incoming.get(e.b)||0)+1); }
  const visited=new Set(),loops=[];let ambiguousEdges=0,omittedLoops=0;
  for(const start of boundary) {
    if(visited.has(start)) continue;
    const vertices=[]; let edge=start,closed=false;
    while(edge&&!visited.has(edge)) {
      visited.add(edge);vertices.push(edge.a);
      if(outgoing.get(edge.a)?.length!==1 || incoming.get(edge.a)!==1){edge=null;break;}
      edge=outgoing.get(edge.b)?.[0]; if(edge===start){closed=true;break;}
    }
    if(!closed){ambiguousEdges+=vertices.length;continue;}
    if(loops.length>=1000){omittedLoops++;continue;}
    let perimeter=0;for(let i=0;i<vertices.length;i++)perimeter+=Math.hypot(...sub(point(positions,vertices[i]),point(positions,vertices[(i+1)%vertices.length])));
    let reason=null,diameter=null;
    try { diameter=triangulate(positions,[...vertices].reverse()).diameter; } catch(error) { reason=error.message; }
    if(badTopology) reason="Fix non-manifold edges or winding conflicts before filling holes.";
    loops.push({id:loops.length,vertices:vertices.length<=4096?vertices:[],vertexCount:vertices.length,perimeter,diameter,fillable:!reason,reason});

  }
  progress(1);
  const segments=Float32Array.from(boundary.slice(0,100000).flatMap(edge=>[...point(positions,edge.a),...point(positions,edge.b)]));
  return { loops,boundaryEdges:boundary.length,ambiguousEdges,omittedLoops,badTopology,segments,previewTruncated:boundary.length>100000 };
}

// Intersection area of two projected triangles. Contacts along an edge have zero area.
function overlapArea(subject, clip) {
  let output=subject,sign=Math.sign(signedArea(clip));
  for(let i=0;i<3&&output.length;i++) {
    const a=clip[i],b=clip[(i+1)%3],input=output;output=[];
    for(let j=0;j<input.length;j++) {
      const p=input[j],q=input[(j+1)%input.length],dp=sign*orient(a,b,p),dq=sign*orient(a,b,q);
      if(dp>=0)output.push(p);
      if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);output.push(p.map((x,k)=>x+t*(q[k]-x)));}
    }
  }
  return Math.abs(signedArea(output));
}
function checkObstructions(positions,indices,cap) {
  let comparisons=0;
  for(let i=0;i<indices.length;i+=3) {
    const pts=[0,1,2].map(k=>point(positions,indices[i+k]));
    if([0,1,2].some(k=>Math.min(...pts.map(p=>p[k]))>cap.hi[k]+PLANAR_TOLERANCE || Math.max(...pts.map(p=>p[k]))<cap.lo[k]-PLANAR_TOLERANCE)) continue;
    const d=pts.map(p=>dot(sub(p,cap.center),cap.normal));
    if(d.every(x=>x>PLANAR_TOLERANCE)||d.every(x=>x<-PLANAR_TOLERANCE))continue;
    if(d.every(x=>Math.abs(x)<=PLANAR_TOLERANCE)) {
      const tri=pts.map(cap.project);
      for(const patch of cap.projected){if(++comparisons>200000)throw Error("Local intersection-check budget exceeded; use a smaller repair.");if(overlapArea(tri,patch)>cap.eps)throw Error("Cap would overlap existing mesh geometry.");}
    } else {
      const intersections=[];
      for(let k=0;k<3;k++) {
        const j=(k+1)%3;
        if(Math.abs(d[k])<=PLANAR_TOLERANCE)intersections.push(cap.project(pts[k]));
        if(d[k]*d[j]<0){const t=d[k]/(d[k]-d[j]);intersections.push(cap.project(pts[k].map((x,a)=>x+t*(pts[j][a]-x))));}
      }
      if(intersections.some(p=>inPolygon(p,cap.poly,cap.eps)))throw Error("Cap would intersect existing mesh geometry.");
      for(let a=0;a<intersections.length;a++)for(let b=a+1;b<intersections.length;b++) {
        const p=intersections[a],q=intersections[b],mid=p.map((x,k)=>(x+q[k])/2);
        if(inPolygon(mid,cap.poly,cap.eps)||cap.poly.some((v,k)=>properCross(p,q,v,cap.poly[(k+1)%cap.poly.length],cap.eps)))throw Error("Cap would intersect existing mesh geometry.");
      }
    }
  }
}

export function fillMeshBoundary({ positions,indices,vertices },progress=()=>{}) {
  validateIndexedMesh(positions,indices);
  if(!Array.isArray(vertices)||vertices.length<3||vertices.length>MAX_LOOP||new Set(vertices).size!==vertices.length)throw Error("Choose one current simple boundary to fill.");
  const boundaries=findMeshBoundaries({positions,indices});
  const sameLoop=loop=>loop.vertices.length===vertices.length && loop.vertices.every((v,i)=>v===vertices[(i+vertices.indexOf(loop.vertices[0]))%vertices.length]);
  const loop=boundaries.loops.find(sameLoop);
  if(!loop)throw Error("The selected boundary changed. Find boundaries again.");
  if(!loop.fillable)throw Error(loop.reason);
  const before=inspectMesh({positions,indices}).report;
  if(before.duplicateFaces||before.degenerateFaces)throw Error("Clean duplicate or zero-area faces before filling holes.");
  const cap=triangulate(positions,[...vertices].reverse());
  checkObstructions(positions,indices,cap);progress(.7);
  if(indices.length/3+cap.triangles.length>750000)throw Error("Repair exceeds the 750,000 triangle output budget.");
  const output=new Uint32Array(indices.length+cap.triangles.length*3);output.set(indices);output.set(cap.triangles.flat(),indices.length);
  const report=inspectMesh({positions,indices:output}).report;
  if(report.boundaryEdges!==before.boundaryEdges-vertices.length||report.nonManifoldEdges||report.inconsistentEdges||report.duplicateFaces||report.degenerateFaces)throw Error("Repair failed topology validation; no geometry was changed.");
  progress(1);
  return { positions:positions.slice(),indices:output,addedFaces:cap.triangles.length,report };
}
