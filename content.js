const DEFAULT_RADIX_MODE = "random";
const IDLE_CALLBACK_TIMEOUT_MS = 50; // 真にアイドルになるまで待たず、この時間内に強制実行する
const MAX_NODES_PER_FORCED_SLICE = 30; // タイムアウトによる強制実行時でもメインスレッドを長時間ブロックしないための上限

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
// 自分自身の書き込みによるMutationを無視するため、実際に書き込む瞬間だけ
// observerを止める（スライスの前後は監視を維持し、SPAの再描画による変更を
// 取りこぼさないようにする）。
function processQueue(deadline) {
  stopObserving();
  let forcedCount = 0;
  while (
    pendingQueue.length > 0 &&
    (deadline.timeRemaining() > 0 || (deadline.didTimeout && forcedCount < MAX_NODES_PER_FORCED_SLICE))
  ) {
    convertNode(pendingQueue.shift());
    forcedCount++;
  }
  if (originals) startObserving();

  if (pendingQueue.length > 0) {
    requestIdleCallback(processQueue, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
  } else {
    processing = false;
  }
}

function enqueueNodes(nodes) {
  if (nodes.length === 0) return;
  pendingQueue.push(...nodes);
  if (processing) return;
  processing = true;
  requestIdleCallback(processQueue, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
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
  // 初回の変換キューを処理し終える前に監視を開始しておくことで、
  // SPAの初期描画直後に起きる再描画・DOM差し替えを取りこぼさないようにする。
  startObserving();
  enqueueNodes(collectVisibleTextNodesUnder(document.body));
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
