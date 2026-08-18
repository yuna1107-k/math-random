const STATE_KEY = "__mathRandomOriginals";
const DEFAULT_RADIX_MODE = "random";

function isConvertibleTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") {
    return false;
  }
  if (parent.isContentEditable) return false;
  if (!node.textContent || !node.textContent.trim()) return false;
  const style = window.getComputedStyle(parent);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function collectVisibleTextNodes() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isConvertibleTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) {
    nodes.push(current);
  }
  return nodes;
}

function toRandomRadixString(text, radixMode) {
  return Array.from(text)
    .map((ch) => {
      const codePoint = ch.codePointAt(0);
      const radix = radixMode === "random" ? Math.floor(Math.random() * 35) + 2 : parseInt(radixMode, 10);
      return codePoint.toString(radix);
    })
    .join(" ");
}

function applyConversion(radixMode) {
  if (window[STATE_KEY]) return;
  const originals = new Map();
  for (const node of collectVisibleTextNodes()) {
    originals.set(node, node.textContent);
    node.textContent = toRandomRadixString(node.textContent, radixMode);
  }
  window[STATE_KEY] = originals;
}

function revertConversion() {
  if (!window[STATE_KEY]) return;
  for (const [node, original] of window[STATE_KEY]) {
    node.textContent = original;
  }
  delete window[STATE_KEY];
}

function toggleConversion(radixMode) {
  if (window[STATE_KEY]) {
    revertConversion();
    return false;
  }
  applyConversion(radixMode);
  return true;
}

chrome.storage.sync.get({ radixMode: DEFAULT_RADIX_MODE }, ({ radixMode }) => {
  applyConversion(radixMode);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "toggle") {
    sendResponse({ converted: toggleConversion(message.radixMode ?? DEFAULT_RADIX_MODE) });
  } else if (message?.type === "getState") {
    sendResponse({ converted: Boolean(window[STATE_KEY]) });
  }
});
