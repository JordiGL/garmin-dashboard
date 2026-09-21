document.addEventListener("DOMContentLoaded", () => {
  initMaps();
});

async function syncData() {
  const statusDiv = document.getElementById("status");
  if (statusDiv) {
    statusDiv.innerText = "Sincronizando con Garmin Connect...";
  }

  try {
    const res = await fetch("/sync", { method: "POST" });
    const data = await res.json();

    if (statusDiv) {
      statusDiv.innerText = data.message || data.detail || "Respuesta recibida";
    }

    if (res.ok) {
      setTimeout(() => location.reload(), 1500);
    }
  } catch (error) {
    if (statusDiv) {
      statusDiv.innerText = "Error de conexión al sincronizar.";
    }
  }
}

function initMaps() {
  const mapElements = document.querySelectorAll(".map");

  mapElements.forEach((container) => {
    const actId = container.id.replace("map-", "");
    const scriptEl = document.getElementById(`telemetry-data-${actId}`);

    if (!scriptEl) return;

    try {
      const points = JSON.parse(scriptEl.textContent);
      if (points && points.length > 0) {
        renderMapForActivity(actId, points);
      }
    } catch (e) {
      console.error("Error al renderizar el mapa:", e);
    }
  });
}
