const search = document.querySelector('input[name="q"]');
if (search) {
  const filter = document.querySelector('select[name="type"]');
  const entries = [...document.querySelectorAll(".entry")];
  const count = document.querySelector("#result-count");
  const empty = document.querySelector(".empty");
  const normalize = value => value.toLowerCase().normalize("NFD")
    .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function readState() {
    const params = new URLSearchParams(location.search);
    search.value = params.get("q") ?? "";
    const kind = params.get("type") ?? "";
    filter.value = [...filter.options].some(option => option.value === kind) ? kind : "";
  }

  function showResults() {
    const words = normalize(search.value).split(" ").filter(Boolean);
    let visible = 0;
    for (const entry of entries) {
      const matches = (!filter.value || filter.value === entry.dataset.kind) &&
        words.every(word => entry.dataset.search.includes(word));
      entry.hidden = !matches;
      visible += Number(matches);
    }
    count.textContent = visible === 1 ? "1 post" : `${visible} posts`;
    empty.hidden = visible !== 0;
  }

  function updateState(commit) {
    const url = new URL(location.href);
    for (const [key, value] of [["q", search.value.trim()], ["type", filter.value]]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (location.protocol !== "file:" && url.href !== location.href) {
      if (commit) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    }
    showResults();
  }

  search.addEventListener("input", () => updateState(false));
  filter.addEventListener("change", () => updateState(true));
  addEventListener("popstate", () => {
    readState();
    showResults();
  });
  readState();
  showResults();
}

const copyStatus = document.querySelector("#copy-status");
for (const button of document.querySelectorAll("[data-copy]")) {
  let reset;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(JSON.parse(button.dataset.copy));
      button.textContent = "Copied";
      copyStatus.textContent = "Code copied to the clipboard.";
    } catch {
      button.textContent = "Select code";
      copyStatus.textContent = "Could not copy automatically. Select and copy the code manually.";
    }
    reset = setTimeout(() => {
      button.textContent = "Copy";
      copyStatus.textContent = "";
    }, 2200);
  });
}
