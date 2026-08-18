const DEFAULT_RADIX_MODE = "random";

let currentRadixMode = DEFAULT_RADIX_MODE;
let originals = null; // Map<Text, string> | null（null = 未変換状態）
let observer = null;

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

function collectVisibleTextNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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

function convertNode(node) {
  if (!isConvertibleTextNode(node)) return;
  originals.set(node, node.textContent);
  node.textContent = toRandomRadixString(node.textContent, currentRadixMode);
}

// ページ側で新規追加/変更されたノードを変換する。
// 自分自身の書き換えによるMutationは、書き込み中にobserverを止めることで無視する。
function convertSubtree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    convertNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  for (const node of collectVisibleTextNodesUnder(root)) {
    convertNode(node);
  }
}

function handleMutations(mutations) {
  observer.disconnect();
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      for (const added of mutation.addedNodes) {
        convertSubtree(added);
      }
    } else if (mutation.type === "characterData") {
      // ストリーミング表示等でテキストノードの内容が外部から書き換わったケース。
      // 書き換わった新しい内容を元テキストとして記録し直し、改めて変換する。
      convertNode(mutation.target);
    }
  }
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function startObserving() {
  if (!observer) observer = new MutationObserver(handleMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopObserving() {
  if (observer) observer.disconnect();
}

function applyConversion(radixMode) {
  if (originals) return;
  currentRadixMode = radixMode;
  originals = new Map();
  convertSubtree(document.body);
  startObserving();
}

function revertConversion() {
  if (!originals) return;
  stopObserving();
  for (const [node, original] of originals) {
    node.textContent = original;
  }
  originals = null;
}

function toggleConversion(radixMode) {
  if (originals) {
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
    sendResponse({ converted: Boolean(originals) });
  }
});
