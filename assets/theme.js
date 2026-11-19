(() => {
  const device = matchMedia("(prefers-color-scheme: dark)");
  const storageKey = "fieldnotes-theme";
  let preference = "dark";

  try {
    const saved = localStorage.getItem(storageKey);
    if (["light", "dark", "system"].includes(saved)) preference = saved;
  } catch {
    // Storage is optional in private previews.
  }

  function apply() {
    const theme = preference === "system" ? (device.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#101714" : "#f5f7ef";
  }

  apply();
  device.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector('select[name="theme"]');
    select.value = preference;
    select.addEventListener("change", () => {
      preference = select.value;
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // A choice still applies for the current page.
      }
      apply();
    });
  });
})();
