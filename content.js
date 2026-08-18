const DEFAULT_RADIX_MODE = "random";

let currentRadixMode = DEFAULT_RADIX_MODE;
let originals = null; // Map<Text, string> | null（null = 未変換状態）
let observer = null;
let pendingQueue = [];
let processing = false;

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
  if (!originals || !isConvertibleTextNode(node)) return;
  originals.set(node, node.textContent);
  node.textContent = toRandomRadixString(node.textContent, currentRadixMode);
}

// キューに積まれたノードをアイドルタイム中に少しずつ変換する。
// サイト自体のスクロール・入力・アニメーションをブロックしないための処理。
function processQueue(deadline) {
  while (pendingQueue.length > 0 && (deadline.timeRemaining() > 0 || deadline.didTimeout)) {
    convertNode(pendingQueue.shift());
  }

  if (pendingQueue.length > 0) {
    requestIdleCallback(processQueue);
    return;
  }

  processing = false;
  if (originals) startObserving();
}

function enqueueNodes(nodes) {
  if (nodes.length === 0) return;
  pendingQueue.push(...nodes);
  if (processing) return;
  processing = true;
  stopObserving();
  requestIdleCallback(processQueue);
}

// ページ側で新規追加/変更されたノードをキューに積む。
// 自分自身の書き換えによるMutationは、処理中observerを止めることで無視する。
function enqueueSubtree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    enqueueNodes([root]);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  enqueueNodes(collectVisibleTextNodesUnder(root));
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      for (const added of mutation.addedNodes) {
        enqueueSubtree(added);
      }
    } else if (mutation.type === "characterData") {
      // ストリーミング表示等でテキストノードの内容が外部から書き換わったケース。
      // 書き換わった新しい内容を元テキストとして記録し直し、改めて変換する。
      enqueueNodes([mutation.target]);
    }
  }
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
  enqueueNodes(collectVisibleTextNodesUnder(document.body));
  if (!processing) startObserving();
}

function revertConversion() {
  if (!originals) return;
  stopObserving();
  pendingQueue = [];
  processing = false;
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
