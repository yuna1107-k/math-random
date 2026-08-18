chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: toggleConversion,
  });
});

// chrome.scripting.executeScript でページ側に注入して実行する関数。
// 外側のクロージャは参照できないため、必要な処理は全てこの関数内に閉じる。
function toggleConversion() {
  const STATE_KEY = "__mathRandomOriginals";

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

  function toRandomRadixString(text) {
    return Array.from(text)
      .map((ch) => {
        const codePoint = ch.codePointAt(0);
        const radix = Math.floor(Math.random() * 35) + 2; // 2〜36
        return codePoint.toString(radix);
      })
      .join(" ");
  }

  if (window[STATE_KEY]) {
    for (const [node, original] of window[STATE_KEY]) {
      node.textContent = original;
    }
    delete window[STATE_KEY];
    return;
  }

  const originals = new Map();
  for (const node of collectVisibleTextNodes()) {
    originals.set(node, node.textContent);
    node.textContent = toRandomRadixString(node.textContent);
  }
  window[STATE_KEY] = originals;
}
