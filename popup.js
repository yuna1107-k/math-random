const toggleBtn = document.getElementById("toggle-btn");
const radixSelect = document.getElementById("radix-mode");

const DEFAULT_RADIX_MODE = "random";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

chrome.storage.sync.get({ radixMode: DEFAULT_RADIX_MODE }, ({ radixMode }) => {
  radixSelect.value = radixMode;
});

radixSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ radixMode: radixSelect.value });
});

(async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "getState" }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    toggleBtn.textContent = response.converted ? "元に戻す" : "変換する";
  });
})();

toggleBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "toggle", radixMode: radixSelect.value },
    (response) => {
      if (chrome.runtime.lastError || !response) return;
      toggleBtn.textContent = response.converted ? "元に戻す" : "変換する";
    }
  );
});
