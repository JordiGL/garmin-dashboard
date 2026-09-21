// Almacén global de mapas
const mapInstances = {};

function renderMapForActivity(actId, points) {
  const containerId = `map-${actId}`;

  // 1. Definir los diferentes proveedores de mapas
  const openStreetMap = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }
  );

  const esriSatellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxZoom: 19,
    }
  );

  const openTopoMap = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 17,
    }
  );

  // 2. Inicializar el mapa con la capa por defecto
  const map = L.map(containerId, {
    layers: [openStreetMap],
  });

  // 3. Crear el objeto de capas base
  const baseMaps = {
    Mapa: openStreetMap,
    Satélite: esriSatellite,
    Relieve: openTopoMap,
  };

  // 4. Mover el selector a 'topleft' o 'bottomleft' para no chocar con los botones del header
  L.control.layers(baseMaps, null, { position: "topleft" }).addTo(map);

  const latlngs = points.map((p) => [p.lat, p.lng]);

  const hoverMarker = L.circleMarker([points[0].lat, points[0].lng], {
    color: "#2563eb",
    fillColor: "#3b82f6",
    fillOpacity: 1,
    radius: 7,
    weight: 2,
  });

  const processedSegments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const ele1 = p1.elevation ?? p1.alt ?? p1.altitude ?? p1.enhanced_altitude;
    let grade = p1.grade ?? calculateGrade(p1, p2, ele1, p2.elevation);
    const speedKmH = calculateSpeed(p1, p2);
    const watts = p1.watts ?? p1.power ?? null;

    processedSegments.push({ p1, p2, ele1, grade, speedKmH, watts });
  }

  mapInstances[actId] = {
    map: map,
    segments: processedSegments,
    layers: [],
    hoverMarker: hoverMarker,
    currentMode: "speed",
  };

  drawRouteSegments(actId, "speed");

  if (latlngs.length > 0) {
    map.fitBounds(latlngs, { padding: [25, 25] });
  }

  // 5. Forzar el recalculo del tamaño del mapa para evitar la pantalla gris
  setTimeout(() => {
    map.invalidateSize();
    if (latlngs.length > 0) {
      map.fitBounds(latlngs, { padding: [25, 25] });
    }
  }, 200);

  initConnectedChart(actId, points, map, hoverMarker);
}

function drawRouteSegments(actId, mode) {
  const instance = mapInstances[actId];
  if (!instance) return;

  instance.layers.forEach((layer) => instance.map.removeLayer(layer));
  instance.layers = [];
  instance.currentMode = mode;

  instance.segments.forEach((seg) => {
    let color = "#38bdf8";

    if (mode === "grade") {
      color = getColorForGrade(seg.grade);
    } else if (mode === "speed") {
      color = getColorForSpeed(seg.speedKmH);
    } else if (mode === "watts") {
      color = getColorForWatts(seg.watts);
    }

    const polyline = L.polyline(
      [
        [seg.p1.lat, seg.p1.lng],
        [seg.p2.lat, seg.p2.lng],
      ],
      {
        color: color,
        weight: 4,
        opacity: 0.95,
      }
    ).addTo(instance.map);

    polyline.bindTooltip(
      `
      <div style="font-size: 12px; line-height: 1.4;">
        <b>Potencia:</b> ${
          seg.watts !== null ? Math.round(seg.watts) + " W" : "N/D"
        }<br/>
        <b>Pendiente:</b> ${
          seg.grade !== null ? seg.grade.toFixed(1) + "%" : "N/D"
        }<br/>
        <b>Altitud:</b> ${
          seg.ele1 !== undefined && seg.ele1 !== null
            ? Math.round(seg.ele1) + "m"
            : "N/D"
        }<br/>
        <b>Velocidad:</b> ${
          seg.speedKmH !== null ? seg.speedKmH.toFixed(1) + " km/h" : "N/D"
        }
      </div>
    `,
      { sticky: true }
    );

    instance.layers.push(polyline);
  });
}

function switchMapColorMode(actId, mode) {
  drawRouteSegments(actId, mode);

  const minEl = document.getElementById(`legend-min-${actId}`);
  const maxEl = document.getElementById(`legend-max-${actId}`);

  if (minEl && maxEl) {
    if (mode === "watts") {
      minEl.innerText = "Menos potencia";
      maxEl.innerText = "Más potencia";
    } else if (mode === "grade") {
      minEl.innerText = "Bajada";
      maxEl.innerText = "Más pendiente";
    } else {
      minEl.innerText = "Menor velocidad";
      maxEl.innerText = "Mayor velocidad";
    }
  }
}

// Escalas de colores
function getColorForGrade(grade) {
  if (grade === null || grade === undefined) return "#94a3b8";
  if (grade < -1) return "#38bdf8";
  if (grade <= 3) return "#22c55e";
  if (grade <= 7) return "#eab308";
  if (grade <= 10) return "#f97316";
  return "#ef4444";
}

function getColorForSpeed(speed) {
  if (speed === null || speed === undefined) return "#94a3b8";
  if (speed < 15) return "#ef4444";
  if (speed < 25) return "#f97316";
  if (speed < 35) return "#eab308";
  if (speed < 45) return "#22c55e";
  return "#38bdf8";
}

function getColorForWatts(watts) {
  if (watts === null || watts === undefined) return "#94a3b8";
  if (watts < 100) return "#38bdf8";
  if (watts < 180) return "#22c55e";
  if (watts < 250) return "#eab308";
  if (watts < 320) return "#f97316";
  if (watts < 400) return "#ef4444";
  return "#a855f7";
}

// Funciones auxiliares de cálculo
function calculateGrade(p1, p2, ele1, ele2) {
  if (
    ele1 === undefined ||
    ele2 === undefined ||
    ele1 === null ||
    ele2 === null
  )
    return null;
  const distanceMeters = getHaversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  if (distanceMeters < 3) return 0;
  const elevationChange = ele2 - ele1;
  const grade = (elevationChange / distanceMeters) * 100;
  return Math.max(-30, Math.min(30, grade));
}

function calculateSpeed(p1, p2) {
  const rawSpeed = p1.speed ?? p1.enhanced_speed ?? p1.velocity;
  if (rawSpeed !== undefined && rawSpeed !== null) {
    return rawSpeed > 100 ? rawSpeed : rawSpeed * 3.6;
  }
  const t1 = p1.timestamp ?? p1.time;
  const t2 = p2.timestamp ?? p2.time;
  if (!t1 || !t2) return null;

  const time1 = typeof t1 === "string" ? new Date(t1).getTime() / 1000 : t1;
  const time2 = typeof t2 === "string" ? new Date(t2).getTime() / 1000 : t2;
  const timeDiffSeconds = time2 - time1;

  if (timeDiffSeconds <= 0 || timeDiffSeconds > 120) return 0;
  const distanceMeters = getHaversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
  const speedKmH = (distanceMeters / timeDiffSeconds) * 3.6;
  return speedKmH > 120 ? 0 : speedKmH;
}

function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
