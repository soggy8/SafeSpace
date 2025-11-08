(() => {
  const params = new URLSearchParams(window.location.search);
  const site = params.get("site") || "This site";

  const siteLabel = document.getElementById("blockedSite");
  if (siteLabel) {
    siteLabel.textContent = site;
  }

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      history.back();
    });
  }
})();

