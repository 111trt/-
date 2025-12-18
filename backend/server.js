const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
const port = 3001;
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

async function planScenario(request = {}) {
  const baseEvents = Array.isArray(request.events) ? request.events : [];
  const baseNodesInput = Array.isArray(request.nodes) ? request.nodes : null;
  const baseEdgesInput = Array.isArray(request.edges) ? request.edges : null;

  const tasks = normalizeBatchRequest(request);
  if (tasks.length === 0) return [];

  const planned = await Promise.all(
    tasks.map((t) => planOneTask(t, baseNodesInput, baseEdgesInput, baseEvents))
  );
  return planned;

  function normalizeBatchRequest(req) {
    const list = Array.isArray(req.tasks) ? req.tasks.filter(Boolean) : null;
    if (list && list.length > 0) {
      return list.map((t, idx) => ({
        taskId:
          typeof t.taskId === "string" && t.taskId
            ? t.taskId
            : `task-${idx + 1}`,
        originId: t.originId,
        destinationId: t.destinationId,
        objectiveRaw: t.objective
      }));
    }
    return [
      {
        taskId:
          typeof req.taskId === "string" && req.taskId ? req.taskId : "task-1",
        originId: req.originId,
        destinationId: req.destinationId,
        objectiveRaw: req.objective
      }
    ];
  }

  function normalizeObjectiveToGraph(obj) {
    if (!obj) return "fast";
    const v = String(obj).toLowerCase();
    if (v === "min_time") return "fast";
    if (v === "min_cost") return "cheap";
    if (v === "min_co2") return "green";
    if (v === "fast" || v === "cheap" || v === "green" || v === "balanced")
      return v;
    return "fast";
  }

  function normalizeObjectiveToOutput(obj) {
    if (!obj) return "min_time";
    const v = String(obj).toLowerCase();
    if (v === "min_time" || v === "min_cost" || v === "min_co2") return v;
    if (v === "fast") return "min_time";
    if (v === "cheap") return "min_cost";
    if (v === "green") return "min_co2";
    return "min_time";
  }

  function decideModeAttempts(objectiveOut) {
    if (objectiveOut === "min_time") {
      return [["road", "air"]];
    }
    if (objectiveOut === "min_cost") {
      return [
        ["road", "sea"],
        ["road", "sea", "rail"],
        ["road", "sea", "rail", "air"]
      ];
    }
    if (objectiveOut === "min_co2") {
      return [["road", "rail", "sea"]];
    }
    return [["road", "rail", "sea", "air"]];
  }

  async function planOneTask(task, baseNodes, baseEdges, events) {
    const objectiveOut = normalizeObjectiveToOutput(task.objectiveRaw);
    const objectiveGraph = normalizeObjectiveToGraph(task.objectiveRaw);

    const originId = task.originId;
    const destinationId = task.destinationId;
    if (!originId || !destinationId) {
      return { taskId: task.taskId, objective: objectiveOut, solution: null };
    }

    const modeAttempts = decideModeAttempts(objectiveOut);
    for (const allowedModes of modeAttempts) {
      const base = !baseNodes || !baseEdges ? buildDefaultNetwork() : null;
      const initialNodes = cloneArray(baseNodes || base.nodes);
      const initialEdges = cloneArray(baseEdges || base.edges);

      const normalized = normalizeNetwork(initialNodes, initialEdges);
      const nodes = normalized.nodes;
      const edges = normalized.edges;

      const nodeMap = buildNodeMap(nodes);
      const originNode = nodeMap[originId];
      const destinationNode = nodeMap[destinationId];
      if (!originNode || !destinationNode) {
        return { taskId: task.taskId, objective: objectiveOut, solution: null };
      }

      const ensured = ensureFacilitiesForModes(
        task.taskId,
        nodes,
        edges,
        originNode,
        destinationNode,
        allowedModes
      );

      const constrainedEdges = filterEdgesByConstraintsAndModes(
        ensured.nodes,
        ensured.edges,
        allowedModes
      );

      const graph = buildGraph(
        ensured.nodes,
        constrainedEdges,
        currentConfig,
        objectiveGraph,
        events
      );

      const path = dijkstra(graph, originId, destinationId);
      if (!path || !Array.isArray(path) || path.length === 0) continue;

      const legs = path.map((step) => ({
        fromId: step.from,
        toId: step.edge.to,
        mode: step.edge.mode,
        distanceKm: step.edge.distanceKm,
        timeHours: step.edge.timeHours,
        cost: step.edge.cost,
        co2: step.edge.co2,
        affectedEvents: step.edge.affectedEvents || []
      }));

      const usedIds = new Set();
      legs.forEach((l) => {
        usedIds.add(l.fromId);
        usedIds.add(l.toId);
      });
      const ephemeralNodes = (ensured.ephemeralNodes || []).filter(
        (n) => n && n.id && usedIds.has(n.id)
      );

      const renderHints = buildRenderHints(legs, graph.nodeMap);
      return {
        taskId: task.taskId,
        objective: objectiveOut,
        solution: {
          legs,
          ephemeralNodes,
          renderHints
        }
      };
    }

    return { taskId: task.taskId, objective: objectiveOut, solution: null };
  }

  function cloneArray(arr) {
    if (!Array.isArray(arr)) return [];
    return JSON.parse(JSON.stringify(arr));
  }

  function normalizeNetwork(nodes, edges) {
    const normalizedNodes = [];
    const seenNodeIds = new Set();
    (nodes || []).forEach((n) => {
      if (!n || typeof n !== "object") return;
      if (typeof n.id !== "string" || !n.id) return;
      if (seenNodeIds.has(n.id)) return;
      if (!isFiniteNumber(n.lng) || !isFiniteNumber(n.lat)) return;
      seenNodeIds.add(n.id);
      normalizedNodes.push({
        ...n,
        lng: Number(n.lng),
        lat: Number(n.lat),
        type: normalizeNodeType(n.type)
      });
    });

    const nodeMap = buildNodeMap(normalizedNodes);
    const normalizedEdges = [];
    const seenEdgeKeys = new Set();
    (edges || []).forEach((e) => {
      if (!e || typeof e !== "object") return;
      if (typeof e.from !== "string" || typeof e.to !== "string") return;
      if (!nodeMap[e.from] || !nodeMap[e.to]) return;
      const mode = normalizeMode(e.mode);
      const key = `${e.from}|${e.to}|${mode}`;
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      normalizedEdges.push({
        ...e,
        from: e.from,
        to: e.to,
        mode
      });
    });

    return { nodes: normalizedNodes, edges: normalizedEdges };
  }

  function isFiniteNumber(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && !v.trim()) return false;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n);
  }

  function buildNodeMap(nodes) {
    const nodeMap = {};
    (nodes || []).forEach((n) => {
      if (n && typeof n.id === "string") nodeMap[n.id] = n;
    });
    return nodeMap;
  }

  function ensureFacilitiesForModes(
    taskId,
    nodes,
    edges,
    originNode,
    destinationNode,
    allowedModes
  ) {
    const nodeMap = buildNodeMap(nodes);
    const ephemeralNodes = [];

    const requiredFacilityTypes = [];
    (allowedModes || []).forEach((m) => {
      const mode = normalizeMode(m);
      if (mode === "air") requiredFacilityTypes.push("airport");
      if (mode === "sea") requiredFacilityTypes.push("port");
      if (mode === "rail") requiredFacilityTypes.push("rail");
    });

    const uniqueFacilityTypes = Array.from(new Set(requiredFacilityTypes));
    const facilityIndex = buildFacilityIndex(nodes);

    const ensureAccessForFacilityType = (facilityType) => {
      const originFacilityId = selectFacilityId(
        taskId,
        nodeMap,
        facilityIndex,
        originNode,
        facilityType,
        "origin"
      );
      const destFacilityId = selectFacilityId(
        taskId,
        nodeMap,
        facilityIndex,
        destinationNode,
        facilityType,
        "destination"
      );

      if (originFacilityId && originFacilityId !== originNode.id) {
        upsertEdge(edges, originNode.id, originFacilityId, "road");
        upsertEdge(edges, originFacilityId, originNode.id, "road");
      }
      if (destFacilityId && destFacilityId !== destinationNode.id) {
        upsertEdge(edges, destinationNode.id, destFacilityId, "road");
        upsertEdge(edges, destFacilityId, destinationNode.id, "road");
      }
    };

    uniqueFacilityTypes.forEach((facilityType) => {
      const before = nodes.length;
      ensureAccessForFacilityType(facilityType);
      for (let i = before; i < nodes.length; i++) {
        const n = nodes[i];
        if (n && n.ephemeral) ephemeralNodes.push(n);
      }
    });

    return { nodes, edges, ephemeralNodes };

    function selectFacilityId(
      taskIdInner,
      nodeMapInner,
      index,
      endpointNode,
      facilityType,
      role
    ) {
      const endpointType = normalizeNodeType(endpointNode.type);
      if (endpointType === facilityType) return endpointNode.id;

      const candidates = index[facilityType] || [];
      if (candidates.length > 0) {
        return findNearestNodeId(endpointNode, candidates);
      }

      const eid = makeEphemeralFacilityId(taskIdInner, endpointNode.id, facilityType, role);
      if (nodeMapInner[eid]) return eid;

      const created = {
        id: eid,
        name: endpointNode.name || "",
        lng: endpointNode.lng,
        lat: endpointNode.lat,
        region: endpointNode.region,
        type: facilityType,
        ephemeral: true
      };
      nodes.push(created);
      nodeMapInner[eid] = created;
      return eid;
    }
  }

  function buildFacilityIndex(nodes) {
    const index = { airport: [], port: [], rail: [] };
    (nodes || []).forEach((n) => {
      if (!n) return;
      const t = normalizeNodeType(n.type);
      if (t === "airport") index.airport.push(n);
      if (t === "port") index.port.push(n);
      if (t === "rail") index.rail.push(n);
    });
    return index;
  }

  function findNearestNodeId(fromNode, candidates) {
    let bestId = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (!c || !isFiniteNumber(c.lng) || !isFiniteNumber(c.lat)) continue;
      const d = distanceKm(
        { lng: fromNode.lng, lat: fromNode.lat },
        { lng: c.lng, lat: c.lat }
      );
      if (d < bestDist) {
        bestDist = d;
        bestId = c.id;
      }
    }
    return bestId;
  }

  function makeEphemeralFacilityId(taskId, endpointId, facilityType, role) {
    const safeTask = String(taskId || "task").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeEndpoint = String(endpointId || "node").replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );
    const safeRole = String(role || "endpoint").replace(/[^a-zA-Z0-9_-]/g, "_");
    return `EPH_${safeTask}_${safeEndpoint}_${facilityType}_${safeRole}`;
  }

  function upsertEdge(edges, from, to, mode) {
    const m = normalizeMode(mode);
    for (const e of edges) {
      if (!e) continue;
      if (e.from === from && e.to === to && normalizeMode(e.mode) === m) return;
    }
    edges.push({ from, to, mode: m });
  }

  function filterEdgesByConstraintsAndModes(nodes, edges, allowedModes) {
    const nodeMap = buildNodeMap(nodes);
    const allowed = new Set((allowedModes || []).map((m) => normalizeMode(m)));
    return (edges || []).filter((e) => {
      if (!e || typeof e.from !== "string" || typeof e.to !== "string") return false;
      if (!nodeMap[e.from] || !nodeMap[e.to]) return false;
      const mode = normalizeMode(e.mode);
      if (!allowed.has(mode)) return false;
      if (mode === "road") return true;
      const fromType = normalizeNodeType(nodeMap[e.from].type);
      const toType = normalizeNodeType(nodeMap[e.to].type);
      if (mode === "air") return fromType === "airport" && toType === "airport";
      if (mode === "sea") return fromType === "port" && toType === "port";
      if (mode === "rail") return fromType === "rail" && toType === "rail";
      return false;
    });
  }

  function buildRenderHints(legs, nodeMap) {
    const hints = [];
    legs.forEach((leg, idx) => {
      const fromNode = nodeMap[leg.fromId];
      const toNode = nodeMap[leg.toId];
      if (!fromNode || !toNode) return;
      const mode = normalizeMode(leg.mode);
      const fromLngLat = [fromNode.lng, fromNode.lat];
      const toLngLat = [toNode.lng, toNode.lat];

      if (mode === "road") {
        hints.push({
          legIndex: idx,
          mode: "road",
          type: "navigation",
          provider: "amap",
          level: "intercity",
          fromLngLat,
          toLngLat
        });
        return;
      }

      hints.push({
        legIndex: idx,
        mode,
        type: "arc",
        fromLngLat,
        toLngLat,
        curvature: 0.35
      });
    });
    return hints;
  }
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
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "invalid request body" });
    return;
  }

  let results = [];
  try {
    results = await planScenario(req.body);
  } catch (e) {
    res.status(500).json({ error: "planScenario failed" });
    return;
  }

  if (!Array.isArray(results)) {
    res.status(500).json({ error: "planScenario returned invalid result" });
    return;
  }

  res.json(results);
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
