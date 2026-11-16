import { V, parseBinarySTL, writeBinarySTL } from "./mesh.js";

export function scanContext(mesh, margin, axis) {
  if (!margin?.length || !axis || V.len(axis) < .9) throw new Error("Complete the margin and insertion direction first.");
  const center = V.mul(margin.reduce((sum,p) => V.add(sum,p), [0,0,0]), 1/margin.length);
  const radius = Math.max(...margin.map(p => V.dist(p, center))) * 2.4;
  if (!Number.isFinite(radius) || radius < 1 || radius > 30) throw new Error("Check the preparation dimensions.");
  const z = V.norm(axis), y = V.norm(V.cross(z, Math.abs(z[0]) < .9 ? [1,0,0] : [0,1,0])), x = V.cross(y,z);
  const basis = [x,y,z], positions = [], indices = [], remap = new Map();
  const {positions: raw, indices: faces} = mesh;
  const local = new Float32Array(raw.length);
  const inside = new Uint8Array(raw.length / 3);
  for (let i=0; i<inside.length; i++) {
    const d = V.sub(raw.subarray(i*3,i*3+3),center);
    inside[i] = V.len(d) <= radius;
    basis.forEach((v,k) => { local[i*3+k] = V.dot(d,v) * .95/radius; });
  }
  for(let i=0;i<faces.length;i+=3) {
    const tri=faces.subarray(i,i+3);
    if (!tri.every(v=>inside[v])) continue;
    if (indices.length >= 3*300000) throw new Error("Scan context exceeds the evaluation mesh budget.");
    for(const v of tri) {
      if(!remap.has(v)) { remap.set(v,positions.length/3); positions.push(...local.subarray(v*3,v*3+3)); }
      indices.push(remap.get(v));
    }
  }
  if(!indices.length) throw new Error("No preparation triangles inside the selected margin region.");
  return {buffer:writeBinarySTL([{positions,indices}]), toScan(p) {
    return basis.reduce((point,v,k)=>V.add(point,V.mul(v,p[k]*radius/.95)),center);
  }};
}

export async function requestToothCraft(context, signal) {
  const response = await fetch("http://127.0.0.1:7861/complete", {method:"POST", signal,
    headers:{"Content-Type":"model/stl","X-Fauchar-Evaluation":"1"}, body:context.buffer});
  if (!response.ok) throw new Error((await response.json().catch(()=>({}))).detail || `ToothCraft returned ${response.status}`);
  const geometry=parseBinarySTL(await response.arrayBuffer());
  for(let i=0;i<geometry.positions.length;i+=3) {
    const p=geometry.positions.subarray(i,i+3);
    if(!p.every(Number.isFinite)) throw new Error("ToothCraft returned invalid geometry.");
    p.set(context.toScan(p));
  }
  return geometry;
}
