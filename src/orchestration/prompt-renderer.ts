import type { FlowSpec } from '../types.js';
import { interpolate } from './interpolate.js';
import { toDeepgramFunctions, TOOL_SCHEMAS } from './tools.js';

/**
 * ORCH_MODE=prompt (Mode 1): flatten the whole flow into ONE system prompt and
 * expose ALL tools for the entire call. The model self-navigates the sequence.
 * Simple; risk is skipped/misordered steps — which the A/B harness measures
 * against the state machine.
 */
export function renderSystemPrompt(flow: FlowSpec, vars: Record<string, string>): string {
  const global = interpolate(flow.globalPrompt, vars);

  // Order nodes starting from startNode by following primary edges, so the
  // written script reads in conversational order.
  const ordered = orderNodes(flow);
  const steps = ordered
    .filter((n) => n.type !== 'end')
    .map((n, i) => `${i + 1}. [${n.id}] ${interpolate(n.instruction, vars)}`)
    .join('\n\n');

  const end = flow.nodes.find((n) => n.type === 'end');

  return `${global}

You are conducting a structured pre-visit check-in. Follow these steps IN ORDER, one at a time. Do not skip steps. Ask a single question, wait for the answer, then continue. Use the provided tools exactly as each step instructs.

STEPS:
${steps}

${end ? `TO CLOSE: ${interpolate(end.instruction, vars)}` : ''}

If at any point the patient asks a question, briefly answer it (use getCareContext for anything clinical) and then RESUME the step you were on.`;
}

export function renderFunctions(): unknown[] {
  return toDeepgramFunctions(TOOL_SCHEMAS);
}

function orderNodes(flow: FlowSpec) {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: typeof flow.nodes = [];
  let cur = flow.startNode;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    const node = byId.get(cur)!;
    seen.add(cur);
    out.push(node);
    // primary (forward) edge = last non-resume edge
    const fwd = [...node.edges].reverse().find((e) => e.to !== '__resume__' && e.to !== 'answer_qa');
    cur = fwd?.to ?? '';
  }
  // append any nodes not on the main line (e.g. answer_qa) for completeness
  for (const n of flow.nodes) if (!seen.has(n.id)) out.push(n);
  return out;
}
