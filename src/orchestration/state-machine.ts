import type { FlowNode, FlowSpec } from '../types.js';
import { interpolate } from './interpolate.js';
import { schemasForTools, toDeepgramFunctions } from './tools.js';

/**
 * ORCH_MODE=state (Mode 2): walk the flow node-by-node. At each node the driver
 * gets the node instruction (with global prompt prepended, so persona + emergency
 * override always apply) and ONLY that node's tools. `answer_qa` is entered from
 * any speaking node and returns via the `__resume__` sentinel.
 */

export type NodeView = {
  nodeId: string;
  nodeType: FlowNode['type'];
  /** full system prompt for this node (global + step) */
  instruction: string;
  /** Deepgram function defs gated to this node's allowed tools */
  functions: unknown[];
  isEnd: boolean;
};

export class FlowStateMachine {
  private readonly byId: Map<string, FlowNode>;
  private currentId: string;
  private readonly resumeStack: string[] = [];

  constructor(
    private readonly flow: FlowSpec,
    private readonly vars: Record<string, string>,
  ) {
    this.byId = new Map(flow.nodes.map((n) => [n.id, n]));
    this.currentId = flow.startNode;
  }

  get currentNodeId(): string {
    return this.currentId;
  }

  view(): NodeView {
    const node = this.byId.get(this.currentId)!;
    return {
      nodeId: node.id,
      nodeType: node.type,
      instruction: interpolate(`${this.flow.globalPrompt}\n\nCURRENT STEP [${node.id}]:\n${node.instruction}`, this.vars),
      functions: toDeepgramFunctions(schemasForTools(node.allowedTools)),
      isEnd: node.type === 'end',
    };
  }

  isEnd(): boolean {
    return this.byId.get(this.currentId)?.type === 'end';
  }

  /** Enter the Q&A side-branch, remembering where to return. */
  enterQA(): NodeView {
    if (this.currentId !== 'answer_qa') {
      this.resumeStack.push(this.currentId);
      this.goTo('answer_qa');
    }
    return this.view();
  }

  /** Follow the node's forward edge (ignoring the answer_qa branch). */
  advance(): NodeView {
    const node = this.byId.get(this.currentId)!;
    const fwd = [...node.edges].reverse().find((e) => e.to !== 'answer_qa');
    let target = fwd?.to;
    if (target === '__resume__') target = this.resumeStack.pop() ?? 'close';
    if (target) this.goTo(target);
    return this.view();
  }

  goTo(id: string): void {
    if (this.byId.has(id)) this.currentId = id;
  }

  /** Convenience: is the current node one that carries tools (subagent)? */
  currentAllowsTools(): boolean {
    return (this.byId.get(this.currentId)?.allowedTools.length ?? 0) > 0;
  }
}
