// Almacén global de gráficas
const chartInstances = {};

// Plugin personalizado para la línea vertical (Crosshair)
const garminCrosshairPlugin = {
  id: "garminCrosshair",
  afterDraw: (chart) => {
    if (chart.tooltip?._active?.length) {
      const activePoint = chart.tooltip._active[0];
      const { ctx } = chart;
      const { x } = activePoint.element;
      const topY = chart.scales.y.top;
      const bottomY = chart.scales.y.bottom;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.restore();
    }
  },
};

if (typeof Chart !== "undefined") {
  Chart.register(garminCrosshairPlugin);
}

function initConnectedChart(actId, points, map, hoverMarker) {
  const canvas = document.getElementById(`chart-${actId}`);
  if (!canvas) return;

  let cumulativeDistanceMeters = 0;
  const distLabels = [];
  const timeLabels = [];
  const elevations = [];

  const initialTime = points[0]?.timestamp ?? points[0]?.time;
  const startTimeMs = initialTime ? new Date(initialTime).getTime() : 0;

  points.forEach((p, i) => {
    const ele =
      p.elevation ?? p.alt ?? p.altitude ?? p.enhanced_altitude ?? p.ele ?? 0;
    elevations.push(ele);

    if (i > 0) {
      const prev = points[i - 1];
      cumulativeDistanceMeters += getHaversineDistance(
        prev.lat,
        prev.lng,
        p.lat,
        p.lng
      );
    }
    const km = (cumulativeDistanceMeters / 1000).toFixed(2);
    distLabels.push(`${km} km`);

    const currentTime = p.timestamp ?? p.time;
    if (currentTime && startTimeMs) {
      const elapsedSec = Math.floor(
        (new Date(currentTime).getTime() - startTimeMs) / 1000
      );
      const hours = Math.floor(elapsedSec / 3600);
      const minutes = Math.floor((elapsedSec % 3600) / 60);
      const seconds = elapsedSec % 60;

      const formattedTime =
        hours > 0
          ? `${hours}:${String(minutes).padStart(2, "0")}:${String(
              seconds
            ).padStart(2, "0")}`
          : `${minutes}:${String(seconds).padStart(2, "0")}`;
      timeLabels.push(formattedTime);
    } else {
      timeLabels.push(`pt ${i}`);
    }
  });

  const ctx = canvas.getContext("2d");

  if (chartInstances[actId]?.chart) {
    chartInstances[actId].chart.destroy();
  }

  const maxEle = Math.max(...elevations, 10);

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: distLabels,
      datasets: [
        {
          label: "Altitud (m)",
          data: elevations,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.25)",
          borderWidth: 1.5,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#22c55e",
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          titleColor: "#334155",
          bodyColor: "#0f172a",
          borderColor: "#cbd5e1",
          borderWidth: 1,
          padding: 8,
          displayColors: false,
          callbacks: {
            title: (tooltipItems) => {
              const idx = tooltipItems[0].dataIndex;
              return `Distancia: ${distLabels[idx]}  |  Tiempo: ${timeLabels[idx]}`;
            },
            label: (context) => `Altitud: ${Math.round(context.raw)} m`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 8,
            color: "#64748b",
          },
        },
        y: {
          grid: { color: "#f1f5f9" },
          ticks: {
            font: { size: 9 },
            color: "#64748b",
            maxTicksLimit: 3,
          },
          suggestedMax: Math.ceil(maxEle + 10),
        },
      },
      onHover: (event, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          const pointIndex = activeElements[0].index;
          const targetPoint = points[pointIndex];

          if (targetPoint) {
            hoverMarker.setLatLng([targetPoint.lat, targetPoint.lng]);
            if (!map.hasLayer(hoverMarker)) {
              hoverMarker.addTo(map);
            }
          }
        }
      },
    },
  });

  chartInstances[actId] = {
    chart: chart,
    distLabels: distLabels,
    timeLabels: timeLabels,
    currentMode: "dist",
  };

  canvas.addEventListener("mouseleave", () => {
    if (map.hasLayer(hoverMarker)) {
      map.removeLayer(hoverMarker);
    }
  });
}

function switchChartXAxis(actId, mode) {
  const instance = chartInstances[actId];
  if (!instance) return;

  const btnTime = document.getElementById(`btn-time-${actId}`);
  const btnDist = document.getElementById(`btn-dist-${actId}`);

  if (mode === "time") {
    instance.chart.data.labels = instance.timeLabels;
    instance.currentMode = "time";

    if (btnTime && btnDist) {
      btnTime.style.background = "#475569";
      btnTime.style.color = "#fff";
      btnDist.style.background = "#f8fafc";
      btnDist.style.color = "#475569";
    }
  } else {
    instance.chart.data.labels = instance.distLabels;
    instance.currentMode = "dist";

    if (btnTime && btnDist) {
      btnDist.style.background = "#475569";
      btnDist.style.color = "#fff";
      btnTime.style.background = "#f8fafc";
      btnTime.style.color = "#475569";
    }
  }

  instance.chart.update("none");
}
