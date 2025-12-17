const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
const port = process.env.PORT || 3001;
const CONFIG_FILE = path.join(__dirname, "config.json");
const SCHEMES_FILE = path.join(__dirname, "schemes.json");
// Default key provided by user, can be overridden by env var
const AMAP_WEB_KEY = process.env.AMAP_WEB_KEY || "450af30412a9e5534649bbd6e1d56061";
const CONFIG_HISTORY_FILE = path.join(__dirname, "config_history.json");

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
  },
  weights: {
    balancedCostWeight: 0.5,
    balancedTimeWeight: 0.3,
    balancedCo2Weight: 0.2
  }
};

let currentConfig = loadConfigFromFile() || cloneConfig(defaultConfig);

function cloneConfig(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadConfigFromFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error("Failed to load config from file:", e.message);
    return null;
  }
}

function saveConfigToFile(cfg) {
  try {
    const data = JSON.stringify(cfg, null, 2);
    fs.writeFileSync(CONFIG_FILE, data, "utf8");
  } catch (e) {
    console.error("Failed to save config to file:", e.message);
  }
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

function loadConfigHistory() {
  try {
    if (!fs.existsSync(CONFIG_HISTORY_FILE)) return [];
    const raw = fs.readFileSync(CONFIG_HISTORY_FILE, "utf8");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (e) {
    console.error("Failed to load config history:", e.message);
    return [];
  }
}

function saveConfigHistory(history) {
  try {
    const data = JSON.stringify(history, null, 2);
    fs.writeFileSync(CONFIG_HISTORY_FILE, data, "utf8");
  } catch (e) {
    console.error("Failed to save config history:", e.message);
  }
}

function pushConfigHistory(cfg) {
  const history = loadConfigHistory();
  const entry = {
    timestamp: new Date().toISOString(),
    config: cloneConfig(cfg)
  };
  history.push(entry);
  while (history.length > 20) {
    history.shift();
  }
  saveConfigHistory(history);
}

function loadSchemesFromFile() {
  try {
    if (!fs.existsSync(SCHEMES_FILE)) return {};
    const raw = fs.readFileSync(SCHEMES_FILE, "utf8");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch (e) {
    console.error("Failed to load schemes from file:", e.message);
    return {};
  }
}

function saveSchemesToFile(schemes) {
  try {
    const data = JSON.stringify(schemes, null, 2);
    fs.writeFileSync(SCHEMES_FILE, data, "utf8");
  } catch (e) {
    console.error("Failed to save schemes to file:", e.message);
  }
}

function callAmapDriving(origin, destination) {
  return new Promise((resolve, reject) => {
    if (!AMAP_WEB_KEY) {
      reject(new Error("AMAP_WEB_KEY not set"));
      return;
    }
    const query = new URLSearchParams({
      key: AMAP_WEB_KEY,
      origin,
      destination,
      extensions: "base",
      strategy: "0"
    }).toString();
    const url = "https://restapi.amap.com/v3/direction/driving?" + query;
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => {
          data += chunk;
        });
        resp.on("end", () => {
          try {
            const json = JSON.parse(data || "{}");
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
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

function callAmapPlaceAround(location, keywords, types, radiusMeters) {
  return new Promise((resolve, reject) => {
    if (!AMAP_WEB_KEY) {
      resolve({ status: "0", info: "AMAP_WEB_KEY not set" });
      return;
    }
    const params = new URLSearchParams({
      key: AMAP_WEB_KEY,
      location,
      keywords,
      radius: String(radiusMeters || 50000),
      offset: "5",
      page: "1",
      output: "json"
    });
    if (types) {
      params.append("types", types);
    }
    const url = "https://restapi.amap.com/v3/place/around?" + params.toString();
    https
      .get(url, (resp) => {
        let data = "";
        resp.on("data", (chunk) => {
          data += chunk;
        });
        resp.on("end", () => {
          try {
            const json = JSON.parse(data || "{}");
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

function normalizeMode(mode) {
  if (!mode) return "road";
  if (mode === "1" || mode === "road") return "road";
  if (mode === "2" || mode === "sea") return "sea";
  if (mode === "3" || mode === "air") return "air";
  if (mode === "4" || mode === "rail") return "rail";
  return "road";
}

function normalizeNodeType(t) {
  if (!t) return "";
  const v = String(t).toLowerCase();
  if (v === "port") return "port";
  if (v === "airport" || v === "air") return "airport";
  if (v === "rail" || v === "rail_hub") return "rail";
  if (v === "warehouse") return "warehouse";
  return v;
}

function computeLegStats(edge, fromNode, toNode, cfg, events) {
  const mode = normalizeMode(edge.mode);
  const fromType = normalizeNodeType(fromNode.type);
  const toType = normalizeNodeType(toNode.type);
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
  const affectedEvents = [];
  let blocked = false;

  if (typeof edge.timeHours === "number" && edge.timeHours > 0) {
    timeHours = edge.timeHours;
  }
  if (typeof edge.cost === "number" && edge.cost > 0) {
    cost = edge.cost;
  }

  if (fromNode.region && toNode.region && fromNode.region !== toNode.region) {
    cost += cfg.tariff.crossBorderCost;
    timeHours += cfg.tariff.crossBorderDelayHours;
  }

  if (Array.isArray(events) && events.length > 0) {
    const midLng = (fromNode.lng + toNode.lng) / 2;
    const midLat = (fromNode.lat + toNode.lat) / 2;
    const midPoint = { lng: midLng, lat: midLat };
    events.forEach((ev) => {
      if (!ev || typeof ev !== "object") return;
      const centerArr = Array.isArray(ev.center) ? ev.center : null;
      const centerObj = ev.center && !Array.isArray(ev.center) ? ev.center : null;
      if (!centerArr && !centerObj) return;
      const center = centerArr
        ? { lng: centerArr[0], lat: centerArr[1] }
        : { lng: centerObj.lng, lat: centerObj.lat };
      const radiusKm = typeof ev.radiusKm === "number" ? ev.radiusKm : 0;
      if (radiusKm <= 0) return;
      const allowedModes = Array.isArray(ev.affectedModes)
        ? ev.affectedModes
        : null;
      if (allowedModes && !allowedModes.includes(mode)) return;
      const d = distanceKm(
        { lng: center.lng, lat: center.lat },
        { lng: midPoint.lng, lat: midPoint.lat }
      );
      if (d <= radiusKm) {
        if (ev.type === "block") {
          blocked = true;
        }
        const delayHours =
          typeof ev.delayHours === "number" ? ev.delayHours : 0;
        const costFactor =
          typeof ev.costFactor === "number" && ev.costFactor > 0
            ? ev.costFactor
            : 1;
        if (delayHours > 0) {
          timeHours += delayHours;
        }
        cost *= costFactor;
        const id = ev.id || ev.type || "event";
        if (!affectedEvents.includes(id)) {
          affectedEvents.push(id);
        }
      }
    });
  }

  return {
    mode,
    distanceKm: distance,
    timeHours,
    cost,
    co2,
    affectedEvents,
    blocked
  };
}

function computeWeight(stats, objective) {
  const obj = objective || "fast";
  if (obj === "cheap") return stats.cost;
  if (obj === "green") return stats.co2;
  if (obj === "fast") return stats.timeHours;
  if (obj === "balanced") {
    const cfgWeights = currentConfig.weights || defaultConfig.weights || {};
    const a =
      typeof cfgWeights.balancedCostWeight === "number"
        ? cfgWeights.balancedCostWeight
        : 0.5;
    const b =
      typeof cfgWeights.balancedTimeWeight === "number"
        ? cfgWeights.balancedTimeWeight
        : 0.3;
    const c =
      typeof cfgWeights.balancedCo2Weight === "number"
        ? cfgWeights.balancedCo2Weight
        : 0.2;
    return stats.cost * a + stats.timeHours * b + stats.co2 * c;
  }
  return stats.timeHours;
}

function buildGraph(nodes, edges, cfg, objective, events) {
  const nodeMap = {};
  nodes.forEach((n) => {
    nodeMap[n.id] = n;
  });
  const adj = {};
  edges.forEach((e) => {
    if (!nodeMap[e.from] || !nodeMap[e.to]) return;
    const fromNode = nodeMap[e.from];
    const toNode = nodeMap[e.to];
    const stats = computeLegStats(e, fromNode, toNode, cfg, events);
    if (stats.blocked) return;
    const weight = computeWeight(stats, objective);
    if (!adj[e.from]) adj[e.from] = [];
    adj[e.from].push({
      to: e.to,
      mode: stats.mode,
      distanceKm: stats.distanceKm,
      timeHours: stats.timeHours,
      cost: stats.cost,
      co2: stats.co2,
      affectedEvents: stats.affectedEvents,
      weight
    });
  });
  return { nodeMap, adj };
}

async function buildVirtualNodesForPath(nodeMap, legs) {
  if (!AMAP_WEB_KEY) return [];
  if (!legs || !Array.isArray(legs) || legs.length === 0) return [];
  const result = [];
  const seen = new Set();
  const addPoi = (poi, type) => {
    if (!poi || !poi.location) return;
    const locParts = String(poi.location).split(",");
    if (locParts.length !== 2) return;
    const lng = parseFloat(locParts[0]);
    const lat = parseFloat(locParts[1]);
    if (!isFinite(lng) || !isFinite(lat)) return;
    const key = type + "|" + lng.toFixed(6) + "|" + lat.toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      id: poi.id || key,
      name: poi.name || "",
      lng,
      lat,
      type,
      level: 2,
      region: "CN",
      source: "amap"
    });
  };
  for (const leg of legs) {
    if (!leg || !leg.fromId || !leg.toId) continue;
    const fromNode = nodeMap[leg.fromId];
    const toNode = nodeMap[leg.toId];
    if (!fromNode || !toNode) continue;
    const mode = normalizeMode(leg.mode);
    let keywords = null;
    let types = null;
    let nodeType = null;
    if (mode === "sea") {
      keywords = "港口";
      nodeType = "port";
    } else if (mode === "air") {
      keywords = "机场";
      types = "150100";
      nodeType = "airport";
    } else if (mode === "rail") {
      keywords = "火车站";
      types = "150200";
      nodeType = "rail";
    }
    if (!keywords || !nodeType) continue;
    const midLng = (fromNode.lng + toNode.lng) / 2;
    const midLat = (fromNode.lat + toNode.lat) / 2;
    const loc = midLng + "," + midLat;
    try {
      const resp = await callAmapPlaceAround(loc, keywords, types, 80000);
      if (
        resp &&
        resp.status === "1" &&
        Array.isArray(resp.pois) &&
        resp.pois.length > 0
      ) {
        const poi = resp.pois[0];
        addPoi(poi, nodeType);
      }
    } catch (e) {
      continue;
    }
  }
  return result;
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
    {
      id: "CN_SHANGHAI",
      name: "上海",
      lng: 121.5,
      lat: 31.2,
      region: "CN",
      type: "port"
    },
    {
      id: "CN_CHONGQING",
      name: "重庆",
      lng: 106.5,
      lat: 29.5,
      region: "CN",
      type: "rail"
    },
    {
      id: "CN_XIAN",
      name: "西安",
      lng: 108.95,
      lat: 34.27,
      region: "CN",
      type: "rail"
    },
    {
      id: "CN_ZHENGZHOU",
      name: "郑州",
      lng: 113.65,
      lat: 34.76,
      region: "CN",
      type: "rail"
    },
    {
      id: "EU_DUISBURG",
      name: "杜伊斯堡",
      lng: 6.76,
      lat: 51.43,
      region: "EU",
      type: "rail"
    },
    {
      id: "EU_HAMBURG",
      name: "汉堡",
      lng: 9.99,
      lat: 53.55,
      region: "EU",
      type: "port"
    },
    {
      id: "EU_ROTTERDAM",
      name: "鹿特丹",
      lng: 4.48,
      lat: 51.92,
      region: "EU",
      type: "port"
    }
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

async function enrichEdgesWithAmap(nodes, edges) {
  if (!AMAP_WEB_KEY) return edges;
  const nodeMap = {};
  nodes.forEach((n) => {
    nodeMap[n.id] = n;
  });
  const tasks = edges.map(async (e) => {
    const mode = normalizeMode(e.mode);
    if (mode !== "road") return e;
    if (
      typeof e.distanceKm === "number" &&
      typeof e.timeHours === "number" &&
      e.distanceKm > 0 &&
      e.timeHours > 0
    ) {
      return e;
    }
    const fromNode = nodeMap[e.from];
    const toNode = nodeMap[e.to];
    if (!fromNode || !toNode) return e;
    const origin = `${fromNode.lng},${fromNode.lat}`;
    const destination = `${toNode.lng},${toNode.lat}`;
    try {
      const result = await callAmapDriving(origin, destination);
      if (
        result &&
        result.status === "1" &&
        result.route &&
        Array.isArray(result.route.paths) &&
        result.route.paths.length > 0
      ) {
        const path = result.route.paths[0];
        const d =
          path.distance && !isNaN(Number(path.distance))
            ? Number(path.distance) / 1000
            : null;
        const t =
          path.duration && !isNaN(Number(path.duration))
            ? Number(path.duration) / 3600
            : null;
        if (d && d > 0) {
          e.distanceKm = d;
        }
        if (t && t > 0) {
          e.timeHours = t;
        }
      }
    } catch (err) {
      console.error(
        "Failed to fetch AMap driving data for edge",
        e.from,
        e.to,
        err.message
      );
    }
    return e;
  });
  return Promise.all(tasks);
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

app.get("/api/amap/driving", (req, res) => {
  const origin = req.query.origin;
  const destination = req.query.destination;
  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination are required" });
    return;
  }
  callAmapDriving(origin, destination)
    .then((result) => {
      res.json(result);
    })
    .catch((err) => {
      console.error("AMap driving error:", err.message);
      res.status(500).json({ error: "amap driving request failed" });
    });
});

app.post("/api/config/update", (req, res) => {
  const patch = req.body || {};
  pushConfigHistory(currentConfig);
  mergeConfig(currentConfig, patch);
  saveConfigToFile(currentConfig);
  res.json({
    success: true,
    currentConfig
  });
});

app.post("/api/config/reset", (req, res) => {
  pushConfigHistory(currentConfig);
  currentConfig = cloneConfig(defaultConfig);
  saveConfigToFile(currentConfig);
  res.json({
    success: true,
    currentConfig
  });
});

app.get("/api/config/history", (req, res) => {
  const history = loadConfigHistory();
  res.json({ history });
});

app.post("/api/config/rollback", (req, res) => {
  const body = req.body || {};
  const history = loadConfigHistory();
  if (!Array.isArray(history) || history.length === 0) {
    res.status(400).json({ error: "no history available" });
    return;
  }
  let target = null;
  if (body.timestamp) {
    target = history.find((h) => h.timestamp === body.timestamp);
  }
  if (!target) {
    target = history[history.length - 1];
  }
  if (!target || !target.config) {
    res.status(400).json({ error: "invalid history entry" });
    return;
  }
  currentConfig = cloneConfig(target.config);
  saveConfigToFile(currentConfig);
  res.json({
    success: true,
    currentConfig
  });
});

app.post("/api/plan/route", async (req, res) => {
  const body = req.body || {};
  const objective = body.objective || "fast";
  let nodes = body.nodes;
  let edges = body.edges;
  let originId = body.originId;
  let destinationId = body.destinationId;
  const events = Array.isArray(body.events) ? body.events : [];

  if (!nodes || !edges || !originId || !destinationId) {
    const def = buildDefaultNetwork();
    nodes = def.nodes;
    edges = def.edges;
    originId = "CN_SHANGHAI";
    destinationId = "EU_DUISBURG";
  }

  try {
    edges = await enrichEdgesWithAmap(nodes, edges);
  } catch (e) {
    console.error("enrichEdgesWithAmap error:", e.message);
  }

  const graph = buildGraph(nodes, edges, currentConfig, objective, events);

  if (!graph.nodeMap[originId] || !graph.nodeMap[destinationId]) {
    res.status(400).json({
      error: "originId or destinationId not found in nodes"
    });
    return;
  }

  let path = dijkstra(graph, originId, destinationId);
  if (!path) {
    const originNode = graph.nodeMap[originId];
    const destNode = graph.nodeMap[destinationId];
    if (originNode && destNode) {
      const modeCounter = {};
      edges.forEach((e) => {
        if (
          e &&
          (e.from === originId ||
            e.to === originId ||
            e.from === destinationId ||
            e.to === destinationId)
        ) {
          const m = normalizeMode(e.mode);
          modeCounter[m] = (modeCounter[m] || 0) + 1;
        }
      });
      const modePriority = ["road", "rail", "sea", "air"];
      let fallbackMode = "road";
      let bestCount = -1;
      modePriority.forEach((m) => {
        const c = modeCounter[m] || 0;
        if (c > bestCount) {
          bestCount = c;
          fallbackMode = m;
        }
      });
      const edge = { from: originId, to: destinationId, mode: fallbackMode };
      const stats = computeLegStats(
        edge,
        originNode,
        destNode,
        currentConfig,
        events
      );
      if (!stats.blocked) {
        const leg = {
          fromId: originId,
          toId: destinationId,
          mode: stats.mode,
          distanceKm: stats.distanceKm,
          timeHours: stats.timeHours,
          cost: stats.cost,
          co2: stats.co2,
          affectedEvents: stats.affectedEvents || []
        };
        let virtualNodes = [];
        try {
          virtualNodes = await buildVirtualNodesForPath(graph.nodeMap, [leg]);
        } catch (e) {
          virtualNodes = [];
        }
        res.json({
          objective,
          originId,
          destinationId,
          summary: {
            totalTimeHours: stats.timeHours,
            totalCost: stats.cost,
            totalCo2: stats.co2,
            totalDistanceKm: stats.distanceKm
          },
          legs: [leg],
          nodes: virtualNodes
        });
        return;
      }
    }
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
      co2: step.edge.co2,
      affectedEvents: step.edge.affectedEvents || []
    };
  });

  let virtualNodes = [];
  try {
    virtualNodes = await buildVirtualNodesForPath(graph.nodeMap, legs);
  } catch (e) {
    virtualNodes = [];
  }

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
    legs,
    nodes: virtualNodes
  });
});

app.get("/api/network/schemes", (req, res) => {
  const schemes = loadSchemesFromFile();
  const list = Object.keys(schemes).map((name) => {
    const s = schemes[name];
    return {
      name,
      savedAt: s.savedAt || null,
      nodesCount: Array.isArray(s.nodes) ? s.nodes.length : 0,
      connectionsCount: Array.isArray(s.connections)
        ? s.connections.length
        : 0,
      stats: s.stats || null
    };
  });
  res.json({ schemes: list });
});

app.get("/api/network/schemes/:name", (req, res) => {
  const name = req.params.name;
  const schemes = loadSchemesFromFile();
  const scheme = schemes[name];
  if (!scheme) {
    res.status(404).json({ error: "scheme not found" });
    return;
  }
  res.json(scheme);
});

app.post("/api/network/schemes", (req, res) => {
  const body = req.body || {};
  const name = body.name;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "scheme name is required" });
    return;
  }
  const schemes = loadSchemesFromFile();
  const now = new Date().toISOString();
  const scheme = {
    name,
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    connections: Array.isArray(body.connections) ? body.connections : [],
    params: body.params || null,
    planStartName: body.planStartName || null,
    planEndName: body.planEndName || null,
    savedAt: now,
    stats: body.stats || null
  };
  schemes[name] = scheme;
  saveSchemesToFile(schemes);
  res.json({ success: true, scheme });
});

app.delete("/api/network/schemes/:name", (req, res) => {
  const name = req.params.name;
  const schemes = loadSchemesFromFile();
  if (!schemes[name]) {
    res.status(404).json({ error: "scheme not found" });
    return;
  }
  delete schemes[name];
  saveSchemesToFile(schemes);
  res.json({ success: true });
});

app.post("/api/network/apply-scheme", (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim()
    : "default";
  const schemes = loadSchemesFromFile();
  const now = new Date().toISOString();
  const scheme = {
    name,
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    connections: Array.isArray(body.connections) ? body.connections : [],
    params: body.params || null,
    planStartName: body.planStartName || null,
    planEndName: body.planEndName || null,
    savedAt: now,
    stats: body.stats || null
  };
  schemes[name] = scheme;
  saveSchemesToFile(schemes);
  res.json({ success: true, scheme });
});

app.listen(port, () => {
  console.log(`LogiGlobe backend listening on port ${port}`);
});
