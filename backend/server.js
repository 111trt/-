const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const defaultConfig = {
  transport: {
    road: { speedKmH: 60, costPerKm: 2, co2PerKm: 0.05 },
    rail: { speedKmH: 80, costPerKm: 1, co2PerKm: 0.02 },
    sea: { speedKmH: 35, costPerKm: 0.5, co2PerKm: 0.08 },
    air: { speedKmH: 800, costPerKm: 8, co2PerKm: 0.5 }
  },
  tariff: {
    crossBorderCost: 500,
    crossBorderDelayHours: 12
  }
};

let currentConfig = cloneConfig(defaultConfig);

function cloneConfig(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeConfig(target, patch) {
  Object.keys(patch || {}).forEach((key) => {
    const value = patch[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key]) target[key] = {};
      mergeConfig(target[key], value);
    } else {
      target[key] = value;
    }
  });
}

function toRad(v) {
  return (v * Math.PI) / 180;
}

function distanceKm(a, b) {
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.asin(Math.sqrt(x));
  return r * c;
}

function normalizeMode(mode) {
  if (!mode) return "road";
  if (mode === "1" || mode === "road") return "road";
  if (mode === "2" || mode === "sea") return "sea";
  if (mode === "3" || mode === "air") return "air";
  if (mode === "4" || mode === "rail") return "rail";
  return "road";
}

function computeLegStats(edge, fromNode, toNode, cfg) {
  const mode = normalizeMode(edge.mode);
  const distance =
    typeof edge.distanceKm === "number"
      ? edge.distanceKm
      : distanceKm(
          { lng: fromNode.lng, lat: fromNode.lat },
          { lng: toNode.lng, lat: toNode.lat }
        );

  const tCfg = cfg.transport[mode];
  const speed = Math.max(tCfg.speedKmH, 1);
  let timeHours = distance / speed;
  let cost = distance * tCfg.costPerKm;
  let co2 = distance * tCfg.co2PerKm;

  if (fromNode.region && toNode.region && fromNode.region !== toNode.region) {
    cost += cfg.tariff.crossBorderCost;
    timeHours += cfg.tariff.crossBorderDelayHours;
  }

  return { mode, distanceKm: distance, timeHours, cost, co2 };
}

function computeWeight(stats, objective) {
  const obj = objective || "fast";
  if (obj === "cheap") return stats.cost;
  if (obj === "green") return stats.co2;
  if (obj === "fast") return stats.timeHours;
  if (obj === "balanced") {
    const a = 0.5;
    const b = 0.3;
    const c = 0.2;
    return stats.cost * a + stats.timeHours * b + stats.co2 * c;
  }
  return stats.timeHours;
}

function buildGraph(nodes, edges, cfg, objective) {
  const nodeMap = {};
  nodes.forEach((n) => {
    nodeMap[n.id] = n;
  });
  const adj = {};
  edges.forEach((e) => {
    if (!nodeMap[e.from] || !nodeMap[e.to]) return;
    const fromNode = nodeMap[e.from];
    const toNode = nodeMap[e.to];
    const stats = computeLegStats(e, fromNode, toNode, cfg);
    const weight = computeWeight(stats, objective);
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push({
      to: e.to,
      mode: stats.mode,
      distanceKm: stats.distanceKm,
      timeHours: stats.timeHours,
      cost: stats.cost,
      co2: stats.co2,
      weight
    });
  });
  return { nodeMap, adj };
}

function dijkstra(graph, originId, destinationId) {
  const dist = {};
  const prev = {};
  const visited = {};
  Object.keys(graph.nodeMap).forEach((id) => {
    dist[id] = Infinity;
    prev[id] = null;
  });
  dist[originId] = 0;

  while (true) {
    let u = null;
    let best = Infinity;
    Object.keys(dist).forEach((id) => {
      if (!visited[id] && dist[id] < best) {
        best = dist[id];
        u = id;
      }
    });
    if (u === null) break;
    if (u === destinationId) break;
    visited[u] = true;
    const neighbors = graph.adj[u] || [];
    neighbors.forEach((edge) => {
      const v = edge.to;
      const alt = dist[u] + edge.weight;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = { from: u, edge };
      }
    });
  }

  if (!prev[destinationId]) {
    return null;
  }

  const path = [];
  let cur = destinationId;
  while (prev[cur]) {
    path.unshift(prev[cur]);
    cur = prev[cur].from;
  }
  return path;
}

function buildDefaultNetwork() {
  const nodes = [
    { id: "CN_SHANGHAI", name: "上海", lng: 121.5, lat: 31.2, region: "CN" },
    { id: "CN_CHONGQING", name: "重庆", lng: 106.5, lat: 29.5, region: "CN" },
    { id: "CN_XIAN", name: "西安", lng: 108.95, lat: 34.27, region: "CN" },
    { id: "CN_ZHENGZHOU", name: "郑州", lng: 113.65, lat: 34.76, region: "CN" },
    { id: "EU_DUISBURG", name: "杜伊斯堡", lng: 6.76, lat: 51.43, region: "EU" },
    { id: "EU_HAMBURG", name: "汉堡", lng: 9.99, lat: 53.55, region: "EU" },
    { id: "EU_ROTTERDAM", name: "鹿特丹", lng: 4.48, lat: 51.92, region: "EU" }
  ];

  const edges = [
    { from: "CN_CHONGQING", to: "CN_XIAN", mode: "rail" },
    { from: "CN_XIAN", to: "CN_ZHENGZHOU", mode: "rail" },
    { from: "CN_ZHENGZHOU", to: "EU_DUISBURG", mode: "rail" },
    { from: "CN_SHANGHAI", to: "EU_HAMBURG", mode: "sea" },
    { from: "CN_SHANGHAI", to: "EU_ROTTERDAM", mode: "sea" },
    { from: "EU_HAMBURG", to: "EU_DUISBURG", mode: "road" },
    { from: "EU_ROTTERDAM", to: "EU_DUISBURG", mode: "road" },
    { from: "CN_SHANGHAI", to: "CN_CHONGQING", mode: "road" }
  ];

  return { nodes, edges };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/config/get", (req, res) => {
  res.json({
    defaultConfig,
    currentConfig
  });
});

app.post("/api/config/update", (req, res) => {
  const patch = req.body || {};
  mergeConfig(currentConfig, patch);
  res.json({
    success: true,
    currentConfig
  });
});

app.post("/api/config/reset", (req, res) => {
  currentConfig = cloneConfig(defaultConfig);
  res.json({
    success: true,
    currentConfig
  });
});

app.post("/api/plan/route", (req, res) => {
  const body = req.body || {};
  const objective = body.objective || "fast";
  let nodes = body.nodes;
  let edges = body.edges;
  let originId = body.originId;
  let destinationId = body.destinationId;

  if (!nodes || !edges || !originId || !destinationId) {
    const def = buildDefaultNetwork();
    nodes = def.nodes;
    edges = def.edges;
    originId = "CN_SHANGHAI";
    destinationId = "EU_DUISBURG";
  }

  const graph = buildGraph(nodes, edges, currentConfig, objective);

  if (!graph.nodeMap[originId] || !graph.nodeMap[destinationId]) {
    res.status(400).json({
      error: "originId or destinationId not found in nodes"
    });
    return;
  }

  const path = dijkstra(graph, originId, destinationId);
  if (!path) {
    res.status(404).json({
      error: "no path found between origin and destination"
    });
    return;
  }

  let totalTime = 0;
  let totalCost = 0;
  let totalCo2 = 0;
  let totalDistance = 0;
  const legs = path.map((step) => {
    totalTime += step.edge.timeHours;
    totalCost += step.edge.cost;
    totalCo2 += step.edge.co2;
    totalDistance += step.edge.distanceKm;
    return {
      fromId: step.from,
      toId: step.edge.to,
      mode: step.edge.mode,
      distanceKm: step.edge.distanceKm,
      timeHours: step.edge.timeHours,
      cost: step.edge.cost,
      co2: step.edge.co2
    };
  });

  res.json({
    objective,
    originId,
    destinationId,
    summary: {
      totalTimeHours: totalTime,
      totalCost,
      totalCo2,
      totalDistanceKm: totalDistance
    },
    legs
  });
});

app.listen(port, () => {
  console.log(`LogiGlobe backend listening on port ${port}`);
});

