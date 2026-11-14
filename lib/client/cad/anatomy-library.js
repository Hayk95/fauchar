/** Original parametric morphology, not manufacturer tooth models or trained AI. */
export const ANATOMY_STYLES = {
  balanced: { label: "Balanced", height: 1, spread: .25, groove: .12 },
  soft: { label: "Soft", height: .7, spread: .34, groove: .06 },
  pronounced: { label: "Pronounced", height: 1.25, spread: .19, groove: .18 },
  worn: { label: "Worn", height: .4, spread: .4, groove: .03 },
};
export function morphologyForTooth(fdi) {
  const n = Number(fdi) % 10, q = Math.floor(Number(fdi) / 10);
  if (![1, 2, 3, 4].includes(q) || n < 1 || n > 8) throw new Error("Choose a valid FDI tooth for anatomy.");
  return n <= 2 ? "incisor" : n === 3 ? "canine" : n <= 5 ? "premolar" : q <= 2 ? "upper-molar" : "lower-molar";
}
const CUSPS = {
  premolar: [[-.38, .05, 1], [.38, -.05, .85]],
  "upper-molar": [[-.38, -.36, .95], [.36, -.36, 1], [-.38, .36, .8], [.36, .36, .85]],
  "lower-molar": [[-.4, -.35, .9], [.32, -.35, 1], [-.45, .3, .85], [.12, .37, .8], [.55, .2, .6]],
};
/** Non-negative normalized relief. The separate crown builder preserves the intaglio. */
export function anatomyHeight(fdi, style, u, v) {
  const settings = ANATOMY_STYLES[style];
  if (!settings) throw new Error("Unknown anatomy style.");
  const type = morphologyForTooth(fdi);
  const mirror = [2, 3].includes(Math.floor(Number(fdi) / 10)) ? -1 : 1;
  u *= mirror;
  let h;
  if (type === "incisor") h = .65 * Math.exp(-v*v/.12) * (.8 + .2*Math.exp(-u*u/.5));
  else if (type === "canine") h = Math.exp(-(u*u+v*v)/settings.spread);
  else h = CUSPS[type].reduce((sum,[x,y,z]) => sum + z*Math.exp(-((u-x)**2+(v-y)**2)/settings.spread),0) - settings.groove*Math.exp(-v*v/.035);
  return Math.max(0, h) * settings.height;
}
/** Lightweight SVG preview sampled from the exact relief function used in construction. */
export function anatomyThumbnail(fdi, style) {
  let cells = "";
  for (let y=0;y<16;y++) for(let x=0;x<16;x++) {
    const u=(x-7.5)/8,v=(y-7.5)/8;
    if(u*u+v*v>.95)continue;
    const h=anatomyHeight(fdi,style,u,v), shade=Math.round(Math.min(96,65+h*22));
    cells+=`<rect x="${x*4+8}" y="${y*4+8}" width="4.2" height="4.2" fill="hsl(43 25% ${shade}%)"/>`;
  }
  return `<svg viewBox="0 0 80 80" aria-hidden="true"><ellipse cx="40" cy="42" rx="32" ry="33" fill="#c3b897"/>${cells}</svg>`;
}
