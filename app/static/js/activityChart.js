// Almacén global de gráficas
const chartInstances = {};

// Función auxiliar para aplicar media móvil (suavizado)
function smoothArray(data, windowSize = 5) {
  if (!data || data.length === 0) return [];
  const smoothed = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < data.length; i++) {
    let start = Math.max(0, i - halfWindow);
    let end = Math.min(data.length, i + halfWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += data[j];
    }
    smoothed.push(Math.round(sum / (end - start)));
  }
  return smoothed;
}

// Plugin personalizado para la línea vertical (Crosshair)
const garminCrosshairPlugin = {
  id: "garminCrosshair",
  afterDraw: (chart) => {
    if (chart.tooltip?._active?.length) {
      const activePoint = chart.tooltip._active[0];
      const { ctx } = chart;
      const { x } = activePoint.element;
      const topY = chart.scales.yElevation.top;
      const bottomY = chart.scales.yElevation.bottom;

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
  const powers = [];
  const speeds = [];

  const initialTime = points[0]?.timestamp ?? points[0]?.time;
  const startTimeMs = initialTime ? new Date(initialTime).getTime() : 0;

  points.forEach((p, i) => {
    // 1. Altitud
    const ele =
      p.elevation ?? p.alt ?? p.altitude ?? p.enhanced_altitude ?? p.ele ?? 0;
    elevations.push(Math.round(ele));

    // 2. Potencia
    const watts = p.watts ?? p.power ?? p.avg_watts ?? p.instant_watts ?? 0;
    powers.push(Math.round(watts));

    // 3. Velocidad
    let speedKmH = 0;
    const rawSpeed = p.speed ?? p.enhanced_speed ?? p.velocity ?? p.speed_ms;

    if (rawSpeed !== undefined && rawSpeed !== null && rawSpeed > 0) {
      speedKmH = rawSpeed > 100 ? rawSpeed : rawSpeed * 3.6;
    } else if (i > 0 && typeof calculateSpeed === "function") {
      const prev = points[i - 1];
      speedKmH = calculateSpeed(prev, p);
    }
    speeds.push(parseFloat(speedKmH.toFixed(1)));

    // 4. Acumular distancia
    if (i > 0 && typeof getHaversineDistance === "function") {
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

    // 5. Formatear Tiempo
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

  // Aplicamos un suavizado con ventana de 7 puntos para mitigar el ruido
  const smoothedPowers = smoothArray(powers, 7);
  const smoothedSpeeds = smoothArray(speeds, 5);

  const ctx = canvas.getContext("2d");

  if (chartInstances[actId]?.chart) {
    chartInstances[actId].chart.destroy();
  }

  // Calculamos límites dinámicos
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations, 10);
  const minPow = Math.min(...smoothedPowers);
  const maxPow = Math.max(...smoothedPowers, 50);
  const minSpeed = Math.min(...smoothedSpeeds);
  const maxSpeed = Math.max(...smoothedSpeeds, 10);

  const chart = new Chart(ctx, {
    data: {
      labels: distLabels,
      datasets: [
        {
          type: "line",
          label: "Altitud (m)",
          data: elevations,
          borderColor: "#16a34a",
          backgroundColor: "transparent",
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          tension: 0.2,
          yAxisID: "yElevation",
        },
        {
          type: "line",
          label: "Velocidad (km/h)",
          data: smoothedSpeeds,
          borderColor: "#2563eb",
          backgroundColor: "transparent",
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          tension: 0.3,
          yAxisID: "ySpeed",
        },
        {
          type: "bar", // Potencia como barras
          label: "Potencia (W)",
          data: smoothedPowers,
          backgroundColor: "rgba(249, 116, 22, 0.07)", // Mucho más transparente
          borderColor: "rgba(249, 115, 22, 0.3)",
          borderWidth: 1,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
          yAxisID: "yPower",
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
        legend: {
          display: true,
          position: "top",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            font: { size: 11, weight: "500" },
          },
        },
        tooltip: {
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          titleColor: "#334155",
          bodyColor: "#0f172a",
          borderColor: "#cbd5e1",
          borderWidth: 1,
          padding: 8,
          callbacks: {
            title: (tooltipItems) => {
              const idx = tooltipItems[0].dataIndex;
              return `Distancia: ${distLabels[idx]} | Tiempo: ${timeLabels[idx]}`;
            },
            label: (context) => {
              return ` ${context.dataset.label}: ${context.raw}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: "#64748b", maxTicksLimit: 8 },
        },
        // Escala Y de Altitud
        yElevation: {
          type: "linear",
          display: true,
          position: "left",
          min: Math.max(0, Math.floor(minEle * 0.9)),
          max: Math.ceil(maxEle * 1.05),
          title: {
            display: true,
            text: "Altitud (m)",
            color: "#16a34a",
            font: { size: 10, weight: "bold" },
          },
          grid: { color: "#f1f5f9" },
          ticks: { font: { size: 9 }, color: "#64748b", count: 6 },
        },
        // Escala Y de Potencia (debe ser tipo "linear")
        yPower: {
          type: "linear",
          display: true,
          position: "right",
          min: 0,
          max: Math.ceil(maxPow * 1.05),
          title: {
            display: true,
            text: "Potencia (W)",
            color: "#f97316",
            font: { size: 10, weight: "bold" },
          },
          grid: { display: false },
          ticks: { font: { size: 9 }, color: "#64748b", count: 6 },
        },
        // Escala Y de Velocidad
        ySpeed: {
          type: "linear",
          display: true,
          position: "right",
          min: Math.max(0, Math.floor(minSpeed * 0.9)),
          max: Math.ceil(maxSpeed * 1.05),
          title: {
            display: true,
            text: "Velocidad (km/h)",
            color: "#2563eb",
            font: { size: 10, weight: "bold" },
          },
          grid: { display: false },
          ticks: { font: { size: 9 }, color: "#64748b", count: 6 },
        },
      },
      onHover: (event, activeElements) => {
        if (activeElements && activeElements.length > 0) {
          const pointIndex = activeElements[0].index;
          const targetPoint = points[pointIndex];

          if (targetPoint && hoverMarker) {
            hoverMarker.setLngLat([targetPoint.lng, targetPoint.lat]);
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
