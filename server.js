require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const UPTIMEROBOT_API_KEY = process.env.UPTIMEROBOT_API_KEY;
const DASHBOARD_KEY = process.env.X_ORBIT_DASHBOARD_KEY;
const UPTIMEROBOT_API = "https://api.uptimerobot.com/v3";

if (!UPTIMEROBOT_API_KEY || UPTIMEROBOT_API_KEY.includes("PUT_YOUR")) {
  console.error("ERROR: Add a valid UPTIMEROBOT_API_KEY to your .env file.");
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireApiKey(req, res, next) {
  if (!DASHBOARD_KEY || DASHBOARD_KEY === "change-this-dashboard-key") {
    return res.status(500).json({
      success: false,
      error: "Configure X_ORBIT_DASHBOARD_KEY in .env before using the API."
    });
  }

  const provided = req.headers["x-api-key"];
  if (!provided || provided !== DASHBOARD_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  next();
}

async function uptimeRobotRequest(endpoint, options = {}) {
  const response = await fetch(`${UPTIMEROBOT_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${UPTIMEROBOT_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || `UptimeRobot returned HTTP ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.monitors)) return data.monitors;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.monitors)) return data.data.monitors;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function normalizeStatus(monitor) {
  const status = monitor.status ?? monitor.statusCode ?? monitor.state ?? monitor.monitorStatus;

  if ([2, "2", "up", "UP", "online", "ONLINE"].includes(status)) return "up";
  if ([8, "8", "down", "DOWN", "offline", "OFFLINE"].includes(status)) return "down";
  if ([9, "9", "paused", "PAUSED"].includes(status)) return "paused";
  return "unknown";
}

function normalizeMonitor(monitor) {
  return {
    id: monitor.id ?? monitor.monitorId,
    name: monitor.friendlyName ?? monitor.name ?? "Unnamed Monitor",
    url: monitor.url ?? monitor.target ?? "",
    type: monitor.type ?? "HTTP",
    status: normalizeStatus(monitor),
    statusRaw: monitor.status ?? monitor.statusCode ?? monitor.state ?? null,
    uptime: monitor.uptime ?? monitor.uptimeRatio ?? monitor.uptimePercentage ?? null,
    responseTime:
      monitor.averageResponseTime ??
      monitor.average_response_time ??
      monitor.responseTime ??
      monitor.avgResponseTime ??
      null,
    interval: monitor.interval ?? monitor.intervalSeconds ?? null,
    createdAt: monitor.createdAt ?? monitor.createDate ?? null
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "X-ORBIT CORP Uptime Monitor",
    uptimeRobot: "configured",
    time: new Date().toISOString()
  });
});

app.get("/api/monitors", requireApiKey, async (req, res) => {
  try {
    const data = await uptimeRobotRequest("/monitors");
    const monitors = extractArray(data).map(normalizeMonitor);
    res.json({ success: true, count: monitors.length, monitors });
  } catch (error) {
    console.error("GET MONITORS ERROR:", error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Unable to retrieve monitors"
    });
  }
});

app.post("/api/monitors", requireApiKey, async (req, res) => {
  try {
    const { name, url, interval = 300 } = req.body;

    if (!name || !url) {
      return res.status(400).json({
        success: false,
        error: "Name and URL are required."
      });
    }

    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        error: "Only HTTP and HTTPS URLs are supported."
      });
    }

    const body = {
      friendlyName: String(name).trim(),
      url: parsedUrl.toString(),
      type: 1,
      interval: Math.max(60, Number(interval) || 300)
    };

    const data = await uptimeRobotRequest("/monitors", {
      method: "POST",
      body: JSON.stringify(body)
    });

    res.status(201).json({ success: true, monitor: data });
  } catch (error) {
    console.error("CREATE MONITOR ERROR:", error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Unable to create monitor"
    });
  }
});

app.patch("/api/monitors/:id", requireApiKey, async (req, res) => {
  try {
    const allowed = ["friendlyName", "url", "interval"];
    const body = {};

    for (const field of allowed) {
      if (req.body[field] !== undefined) body[field] = req.body[field];
    }

    const data = await uptimeRobotRequest(
      `/monitors/${encodeURIComponent(req.params.id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    );

    res.json({ success: true, monitor: data });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Unable to update monitor"
    });
  }
});

app.delete("/api/monitors/:id", requireApiKey, async (req, res) => {
  try {
    const data = await uptimeRobotRequest(
      `/monitors/${encodeURIComponent(req.params.id)}`,
      { method: "DELETE" }
    );

    res.json({
      success: true,
      message: "Monitor deleted successfully.",
      result: data
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Unable to delete monitor"
    });
  }
});

app.get("/api/monitors/:id", requireApiKey, async (req, res) => {
  try {
    const data = await uptimeRobotRequest(
      `/monitors/${encodeURIComponent(req.params.id)}`
    );

    res.json({
      success: true,
      monitor: normalizeMonitor(data?.monitor || data?.data || data)
    });
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Unable to retrieve monitor"
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found" });
});

app.listen(PORT, () => {
  console.log(`X-ORBIT CORP Uptime Monitor running on port ${PORT}`);
});