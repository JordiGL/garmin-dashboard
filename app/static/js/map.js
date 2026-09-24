// Almacén global de instancias de mapa
const mapInstances = {};

// Fuentes de mapas base disponibles
const BASE_TILE_SOURCES = {
  osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  topo: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
};

// Función auxiliar para calcular el rumbo/bearing más corto (evita giros bruscos de 360°)
function getShortestRotation(current, target) {
  let diff = (target - current) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return current + diff;
}

// Cálculo del rumbo en grados entre dos puntos
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Control de Play / Pausa
function togglePlaySimulation(actId) {
  const instance = mapInstances[actId];
  if (!instance) return;

  if (instance.isPlaying) {
    pauseSimulation(actId);
  } else {
    startSimulation(actId);
  }
}

function startSimulation(actId) {
  const instance = mapInstances[actId];
  const btn = document.getElementById(`btn-play-${actId}`);
  const speedSelect = document.getElementById(`sim-speed-${actId}`);
  const multiplier = parseFloat(speedSelect ? speedSelect.value : 2);

  if (!instance || !instance.points || instance.points.length < 2) return;

  instance.isPlaying = true;
  // Reiniciar el estado de interacción manual al dar a Play
  instance.userIsInteracting = false;

  if (btn) btn.innerHTML = "⏸ Pausa";

  if (instance.simIndex >= instance.points.length - 1) {
    instance.simIndex = 0;
    instance.animProgress = 0;
  }

  // Si es el inicio de la reproducción, orientamos la cámara a la posición 3D inicial
  const pStart1 = instance.points[instance.simIndex];
  const pStart2 = instance.points[instance.simIndex + 1] || pStart1;
  const initialBearing = calculateBearing(
    pStart1.lat,
    pStart1.lng,
    pStart2.lat,
    pStart2.lng
  );

  instance.map.easeTo({
    center: [pStart1.lng, pStart1.lat],
    zoom: 17.5,
    pitch: 70,
    bearing: initialBearing,
    duration: 500,
  });

  // Cancelar cualquier frame previo
  if (instance.animFrameId) cancelAnimationFrame(instance.animFrameId);

  let lastTimestamp = null;
  const basePointDurationMs = 300 / multiplier;

  if (typeof instance.animProgress === "undefined") {
    instance.animProgress = 0;
  }

  function animate(timestamp) {
    if (!instance.isPlaying) return;

    if (!lastTimestamp) lastTimestamp = timestamp;
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    instance.animProgress += deltaTime / basePointDurationMs;

    while (instance.animProgress >= 1) {
      instance.animProgress -= 1;
      instance.simIndex++;

      if (instance.simIndex >= instance.points.length - 1) {
        pauseSimulation(actId);
        instance.simIndex = 0;
        instance.animProgress = 0;
        return;
      }
    }

    const p1 = instance.points[instance.simIndex];
    const p2 = instance.points[instance.simIndex + 1] || p1;
    const t = instance.animProgress;

    // Interpolación lineal de posición (Lng / Lat)
    const currentLng = p1.lng + (p2.lng - p1.lng) * t;
    const currentLat = p1.lat + (p2.lat - p1.lat) * t;
    const currentCoords = [currentLng, currentLat];

    // Mover el marcador por la ruta SIEMPRE
    instance.hoverMarker.setLngLat(currentCoords);

    // SOLO mover/reorientar la cámara si el usuario NO ha interactuado manualmente con el mapa
    if (!instance.userIsInteracting) {
      const p3 = instance.points[instance.simIndex + 2] || p2;
      const b1 = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);
      const b2 = calculateBearing(p2.lat, p2.lng, p3.lat, p3.lng);
      const targetB = getShortestRotation(b1, b2);
      const currentBearing = b1 + (targetB - b1) * t;

      instance.map.jumpTo({
        center: currentCoords,
        bearing: currentBearing,
      });
    }

    // Sincronizar gráfica de elevación
    syncChartCursor(actId, instance.simIndex);

    instance.animFrameId = requestAnimationFrame(animate);
  }

  instance.animFrameId = requestAnimationFrame(animate);
}

function pauseSimulation(actId) {
  const instance = mapInstances[actId];
  const btn = document.getElementById(`btn-play-${actId}`);

  if (!instance) return;

  instance.isPlaying = false;
  if (btn) btn.innerHTML = "▶ Play";

  if (instance.animFrameId) {
    cancelAnimationFrame(instance.animFrameId);
    instance.animFrameId = null;
  }
}

function syncChartCursor(actId, pointIndex) {
  const chartInstance =
    typeof chartInstances !== "undefined" ? chartInstances[actId]?.chart : null;
  if (!chartInstance) return;

  const activeSegment = chartInstance.getDatasetMeta(0).data[pointIndex];
  if (activeSegment) {
    chartInstance.setActiveElements([{ datasetIndex: 0, index: pointIndex }]);
    chartInstance.tooltip.setActiveElements(
      [{ datasetIndex: 0, index: pointIndex }],
      { x: activeSegment.x, y: activeSegment.y }
    );
    chartInstance.update("none");
  }
}

function renderMapForActivity(actId, points) {
  const containerId = `map-${actId}`;
  if (!points || points.length === 0) return;

  const startLngLat = [points[0].lng, points[0].lat];

  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {
        "base-raster-source": {
          type: "raster",
          tiles: [BASE_TILE_SOURCES.satellite],
          tileSize: 256,
          attribution: "&copy; Esri",
        },
      },
      layers: [
        {
          id: "base-raster-layer",
          type: "raster",
          source: "base-raster-source",
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    },
    center: startLngLat,
    zoom: 14,
    pitch: 60,
    bearing: -20,
  });

  map.addControl(new maplibregl.NavigationControl());

  map.on("load", () => {
    const features = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      // Resolver la elevación tanto para p1 como para p2
      const ele1 =
        p1.elevation ?? p1.alt ?? p1.altitude ?? p1.enhanced_altitude;
      const ele2 =
        p2.elevation ?? p2.alt ?? p2.altitude ?? p2.enhanced_altitude; // <-- AÑADIR ESTA LÍNEA

      // Pasar ele2 a calculateGrade
      const grade = p1.grade ?? calculateGrade(p1, p2, ele1, ele2); // <-- CORREGIR AQUÍ
      const speedKmH = calculateSpeed(p1, p2);
      const watts = p1.watts ?? p1.power ?? null;

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [p1.lng, p1.lat],
            [p2.lng, p2.lat],
          ],
        },
        properties: {
          speed: speedKmH || 0,
          grade: grade || 0,
          watts: watts || 0,
          colorSpeed: getColorForSpeed(speedKmH),
          colorGrade: getColorForGrade(grade),
          colorWatts: getColorForWatts(watts),
        },
      });
    }

    map.addSource(`route-source-${actId}`, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: features,
      },
    });

    map.addLayer({
      id: `route-layer-${actId}`,
      type: "line",
      source: `route-source-${actId}`,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": ["get", "colorSpeed"],
        "line-width": 5,
      },
    });

    const markerEl = document.createElement("div");
    markerEl.style.width = "14px";
    markerEl.style.height = "14px";
    markerEl.style.backgroundColor = "#2563eb";
    markerEl.style.border = "2px solid white";
    markerEl.style.borderRadius = "50%";
    markerEl.style.boxShadow = "0 0 6px rgba(0,0,0,0.5)";

    const hoverMarker = new maplibregl.Marker({ element: markerEl })
      .setLngLat(startLngLat)
      .addTo(map);

    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 40, pitch: 60 });

    mapInstances[actId] = {
      map: map,
      points: points,
      hoverMarker: hoverMarker,
      simIndex: 0,
      animProgress: 0,
      animFrameId: null,
      isPlaying: false,
      userIsInteracting: false,
    };

    // Detectar cuando el usuario interactúa manualmente (arrastra, zoom con rueda o doble clic)
    const setInteracting = () => {
      if (mapInstances[actId]) {
        mapInstances[actId].userIsInteracting = true;
      }
    };

    map.on("dragstart", setInteracting);
    map.on("rotatestart", setInteracting);
    map.on("pitchstart", setInteracting);
    map.on("zoomstart", (e) => {
      // Solo consideramos interacción manual si el zoom proviene del usuario (no de animaciones)
      if (e.originalEvent) {
        setInteracting();
      }
    });

    if (typeof initConnectedChart === "function") {
      initConnectedChart(actId, points, map, hoverMarker);
    }
  });
}

function switchBaseMapStyle(actId, styleKey) {
  const instance = mapInstances[actId];
  if (!instance || !BASE_TILE_SOURCES[styleKey]) return;

  const tileUrl = BASE_TILE_SOURCES[styleKey];
  const map = instance.map;

  if (map.getSource("base-raster-source")) {
    map.removeLayer("base-raster-layer");
    map.removeSource("base-raster-source");

    map.addSource("base-raster-source", {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
    });

    map.addLayer(
      {
        id: "base-raster-layer",
        type: "raster",
        source: "base-raster-source",
        minzoom: 0,
        maxzoom: 19,
      },
      `route-layer-${actId}`
    );
  }
}

function switchMapColorMode(actId, mode) {
  const instance = mapInstances[actId];
  if (!instance) return;

  let propertyName = "colorSpeed";
  if (mode === "grade") propertyName = "colorGrade";
  if (mode === "watts") propertyName = "colorWatts";

  instance.map.setPaintProperty(`route-layer-${actId}`, "line-color", [
    "get",
    propertyName,
  ]);

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
  if (grade < -1) return "#38bdf8"; // Azul (Bajada)
  if (grade <= 2) return "#22c55e"; // Verde (Llano)
  if (grade <= 5) return "#eab308"; // Amarillo (Pendiente suave)
  if (grade <= 8) return "#f97316"; // Naranja (Pendiente media)
  if (grade <= 12) return "#ef4444"; // Rojo (Pendiente dura)
  return "#a855f7"; // Morado (Pared)
}

function getColorForSpeed(speed) {
  if (speed === null || speed === undefined) return "#94a3b8";
  if (speed < 15) return "#38bdf8"; // Azul (Menor velocidad)
  if (speed < 25) return "#22c55e"; // Verde
  if (speed < 35) return "#eab308"; // Amarillo
  if (speed < 45) return "#f97316"; // Naranja
  if (speed < 55) return "#ef4444"; // Rojo
  return "#a855f7"; // Morado (Mayor velocidad)
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

// Auxiliares de cálculo
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
