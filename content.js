const DEFAULT_RADIX_MODE = "random";
const IDLE_CALLBACK_TIMEOUT_MS = 50; // 真にアイドルになるまで待たず、この時間内に強制実行する
const MAX_NODES_PER_FORCED_SLICE = 30; // タイムアウトによる強制実行時でもメインスレッドを長時間ブロックしないための上限

let currentRadixMode = DEFAULT_RADIX_MODE;
let originals = null; // Map<Text, string> | null（null = 未変換状態）
let observer = null;
let pendingQueue = [];
let processing = false;
let originalTitle = null;
let titleObserver = null;

// Material Icons等のアイコンフォントは、DOM上のテキスト（例: "home"）を
// フォントの合字でアイコン画像として表示している。変換すると合字が崩れ、
// メニューボタン等のアイコン表示が壊れてしまうため対象から除外する。
const ICON_FONT_NAME_PATTERN =
  /material (icons|symbols)|font awesome|glyphicons|ionicons|icomoon|academicons|typicons|foundation-icons|simple-line-icons/i;

function hasAriaHiddenAncestor(el) {
  let cur = el;
  while (cur) {
    if (cur.getAttribute && cur.getAttribute("aria-hidden") === "true") return true;
    cur = cur.parentElement;
  }
  return false;
}

function isConvertibleTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  const tag = parent.tagName;
  if (
    tag === "SCRIPT" ||
    tag === "STYLE" ||
    tag === "NOSCRIPT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "OPTION"
  ) {
    return false;
  }
  if (parent.isContentEditable) return false;
  if (!node.textContent || !node.textContent.trim()) return false;
  const style = window.getComputedStyle(parent);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (ICON_FONT_NAME_PATTERN.test(style.fontFamily || "")) return false;
  if (hasAriaHiddenAncestor(parent)) return false;
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

const MAX_LENGTH_MULTIPLIER = 2; // 元のテキスト長に対する変換後文字列の長さの上限倍率
const MIN_MAX_LENGTH = 8; // 短いテキストでも最低限これだけは表示する

// 変換後の文字列は1文字あたり数文字〜十数文字に膨張するため、そのまま
// 表示するとナビゲーションやボタンなど幅の決まったUI要素のレイアウトが
// 崩れてしまう。元のテキスト長に応じた上限で切り詰め、崩れを抑える。
function toRandomRadixString(text, radixMode) {
  const converted = Array.from(text)
    .map((ch) => {
      const codePoint = ch.codePointAt(0);
      const radix = radixMode === "random" ? Math.floor(Math.random() * 35) + 2 : parseInt(radixMode, 10);
      return `${codePoint.toString(radix)}(${radix})`;
    })
    .join(" ");

  const maxLength = Math.max(text.length * MAX_LENGTH_MULTIPLIER, MIN_MAX_LENGTH);
  if (converted.length <= maxLength) return converted;
  return `${converted.slice(0, maxLength - 1)}…`;
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

// <title>要素はdocument.body配下ではないため、専用のobserverで監視する。
// SPAが通知件数の表示などでタブタイトルを動的に書き換えるケースに追従するため。
function startObservingTitle() {
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  if (!titleObserver) titleObserver = new MutationObserver(handleTitleMutation);
  titleObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });
}

function stopObservingTitle() {
  if (titleObserver) titleObserver.disconnect();
}

function handleTitleMutation() {
  stopObservingTitle();
  originalTitle = document.title;
  document.title = toRandomRadixString(originalTitle, currentRadixMode);
  startObservingTitle();
}

function applyTitleConversion() {
  originalTitle = document.title;
  document.title = toRandomRadixString(originalTitle, currentRadixMode);
  startObservingTitle();
}

function revertTitleConversion() {
  stopObservingTitle();
  if (originalTitle !== null) {
    document.title = originalTitle;
  }
  originalTitle = null;
}

function applyConversion(radixMode) {
  if (originals) return;
  currentRadixMode = radixMode;
  originals = new Map();
  applyTitleConversion();
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
  revertTitleConversion();
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
