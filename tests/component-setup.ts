// jsdom has no layout engine. ProseMirror (TipTx's view layer) asks text
// nodes and ranges for rectangles while scrolling a selection into view; real
// browsers answer these, jsdom does not. The empty answers below are the
// standard compatibility shims for contenteditable editors in tests - they
// only affect test geometry and never production code.
const zeroRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
} as DOMRect;

const nodePrototype = Node.prototype as Node & {
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
};
nodePrototype.getClientRects ??= () => [] as unknown as DOMRectList;
nodePrototype.getBoundingClientRect ??= () => zeroRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => zeroRect;
