/** Standard single-crown / bridge order, with explicit geometry prerequisites. */
export const WORKFLOW = [
  { id: "scan", label: "Scan review", tool: "view", hint: "Check units, scan orientation and jaw alignment." },
  { id: "margin", label: "Margin", tool: "margin", hint: "Draw or detect the finish line, then inspect it from every side." },
  { id: "axis", label: "Insertion", tool: "axis", hint: "Set the insertion direction from the current view and inspect undercuts." },
  { id: "bottom", label: "Crown bottom", tool: "construction", hint: "Pick a library tooth, set the cement gap, then build. Sculpt it in Freeforming." },
  { id: "placement", label: "Placement", tool: "transform", hint: "Position, rotate and scale the restoration." },
  { id: "freeform", label: "Freeforming", tool: "sculpt", hint: "Finish the anatomy with real sculpting and anatomic deformation." },
  { id: "contacts", label: "Contacts", tool: "occlusion", hint: "Review occlusion and proximal contacts against the actual scans." },
  { id: "bridge", label: "Connectors", tool: "bridge", hint: "For a bridge, add pontics and connect the units. Skip for a single crown." },
  { id: "review", label: "Review", tool: "measure", hint: "Inspect wall thickness, sections, contacts and the margin fit." },
  { id: "export", label: "Merge / save", tool: "export", hint: "Export edited STL geometry and save the design in this browser." },
];

export function workflowForCase(caseData, multipleUnits = false) {
  return caseData.restoration === "bridge" || multipleUnits ? WORKFLOW : WORKFLOW.filter(step => step.id !== "bridge");
}

export function workflowProblem(editor, target) {
  const index = WORKFLOW.findIndex(s => s.id === target);
  if (index < 0) return "Unknown workflow step.";
  if (index >= 2 && editor.marginDraft?.length) return "Finish or cancel the margin you are drawing first.";
  if (!editor.scanObjects?.length && !editor.crown) return "Load a scan or restoration first.";
  if (index >= 2 && !editor.margin?.length) return "Define and review the preparation margin first.";
  if (index >= 3 && (!editor.insertionAxis || editor.insertionAxis.some(v => !Number.isFinite(v)))) return "Set the insertion direction first.";
  if (index >= 5 && editor.toothSetup) return "Press OK in Placement to fit the tooth to the margin first.";
  if (index >= 4 && !editor.crown && !(index === 4 && editor.toothSetup)) return "Place a library tooth in Crown bottom (or import a restoration STL) to create the crown first.";
  return null;
}

export function initialStep(editor) {
  const saved = editor.workflow?.step;
  if (saved && !workflowProblem(editor, saved)) return saved;
  return editor.crown ? "freeform" : editor.scanObjects?.length ? "margin" : "scan";
}
