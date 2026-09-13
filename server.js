const express = require("express");
const session = require("express-session");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const auth = require("./auth");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

function now() {
  return new Date().toISOString();
}

function getFreshSessionUser(req) {
  if (!req.session.user) return null;

  if (req.session.user.id === "admin") {
    return req.session.user;
  }

  const freshUser = auth.getUser(req.session.user.id);

  if (!freshUser) {
    req.session.user = null;
    return null;
  }

  req.session.user = freshUser;
  return freshUser;
}

function requireLogin(req, res, next) {
  const user = getFreshSessionUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required"
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  const user = getFreshSessionUser(req);

  if (!user || user.role !== "admin") {
    return res.status(403).json({
      ok: false,
      error: "Administrator permission required"
    });
  }

  next();
}

function requireApproved(req, res, next) {
  const user = getFreshSessionUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required"
    });
  }

  if (user.role === "admin") {
    return next();
  }

  if (user.status !== "APPROVED") {
    return res.status(403).json({
      ok: false,
      error: "VPS access is not approved",
      status: user.status
    });
  }

  next();
}

/* =========================================================
   AUTHENTICATION
========================================================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    const user = await auth.createUser(
      String(name || ""),
      String(username || ""),
      String(password || "")
    );

    res.status(201).json({
      ok: true,
      message: "Access request submitted successfully",
      user
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});


/* NORMAL USER LOGIN */
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");

    const user = await auth.verifyLogin(username, password);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid username or password"
      });
    }

    req.session.user = user;

    res.json({
      ok: true,
      message: "Login successful",
      user
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Login failed"
    });
  }
});


/* ADMIN LOGIN */
app.post("/api/auth/admin-login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const configuredUsername = String(
      process.env.ADMIN_USERNAME || "nicegoldadmin"
    )
      .trim()
      .toLowerCase();

    const configuredPassword = String(
      process.env.ADMIN_PASSWORD || ""
    );

    if (
      username.toLowerCase() !== configuredUsername ||
      password !== configuredPassword
    ) {
      return res.status(401).json({
        ok: false,
        error: "Invalid administrator credentials"
      });
    }

    const adminUser = {
      id: "admin",
      name: "NICEGOLD Administrator",
      username: configuredUsername,
      role: "admin",
      status: "APPROVED"
    };

    req.session.user = adminUser;

    res.json({
      ok: true,
      message: "Administrator login successful",
      user: adminUser
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Administrator login failed"
    });
  }
});


app.get("/api/auth/me", (req, res) => {
  const user = getFreshSessionUser(req);

  if (!user) {
    return res.json({
      ok: true,
      authenticated: false,
      user: null
    });
  }

  res.json({
    ok: true,
    authenticated: true,
    user
  });
});


app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");

    res.json({
      ok: true,
      message: "Logged out successfully"
    });
  });
});


/* =========================================================
   ADMIN USER MANAGEMENT
========================================================= */

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = auth.getUsers();

  const counts = {
    total: users.length,
    pending: users.filter(u => u.status === "PENDING").length,
    approved: users.filter(u => u.status === "APPROVED").length,
    rejected: users.filter(u => u.status === "REJECTED").length,
    suspended: users.filter(u => u.status === "SUSPENDED").length
  };

  res.json({
    ok: true,
    users,
    counts
  });
});


app.post("/api/admin/users/:id/status", requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const status = String(req.body.status || "").toUpperCase();

    const user = auth.changeStatus(id, status);

    res.json({
      ok: true,
      message: `User status changed to ${status}`,
      user
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});


/* =========================================================
   VPS ACCESS
========================================================= */

app.get("/api/vps", requireApproved, (req, res) => {
  const user = getFreshSessionUser(req);

  res.json({
    ok: true,
    vps: {
      name: "NICEGOLD VPS",
      status: "ONLINE",
      engine: "NICEGOLD Operations Engine",
      accessLevel: user.role === "admin" ? "ADMINISTRATOR" : "APPROVED USER",
      host: os.hostname(),
      platform: process.platform,
      node: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      serverTime: now()
    }
  });
});


app.get("/api/vps/access", requireApproved, (req, res) => {
  const user = getFreshSessionUser(req);

  res.json({
    ok: true,
    access: true,
    user,
    message: "VPS access granted"
  });
});


/* =========================================================
   SYSTEM TELEMETRY
========================================================= */

function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    total,
    free,
    used,
    usedPercent: Number(((used / total) * 100).toFixed(1))
  };
}


function getCpuLoad() {
  const cpus = os.cpus();

  if (!cpus.length) {
    return {
      cores: 0,
      load1m: 0,
      usagePercent: 0
    };
  }

  const load = os.loadavg()[0] || 0;
  const usage = Math.min(
    100,
    Math.max(0, (load / cpus.length) * 100)
  );

  return {
    cores: cpus.length,
    load1m: Number(load.toFixed(2)),
    usagePercent: Number(usage.toFixed(1))
  };
}


function getSystemUptime() {
  return Math.floor(os.uptime());
}


app.get("/api/dashboard", requireApproved, (req, res) => {
  const memory = getMemoryInfo();
  const cpu = getCpuLoad();

  res.json({
    ok: true,
    timestamp: now(),
    system: {
      hostname: os.hostname(),
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      node: process.version
    },
    cpu,
    memory,
    uptime: getSystemUptime()
  });
});


app.get("/api/system", requireApproved, (req, res) => {
  const memory = getMemoryInfo();
  const cpu = getCpuLoad();

  res.json({
    ok: true,
    hostname: os.hostname(),
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    node: process.version,
    cpu,
    memory,
    uptime: getSystemUptime(),
    loadAverage: os.loadavg(),
    timestamp: now()
  });
});


/* =========================================================
   NETWORK
========================================================= */

app.get("/api/network", requireApproved, (req, res) => {
  const interfaces = os.networkInterfaces();
  const result = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      result.push({
        interface: name,
        address: address.address,
        family: address.family,
        internal: address.internal,
        netmask: address.netmask,
        mac: address.mac
      });
    }
  }

  res.json({
    ok: true,
    interfaces: result,
    hostname: os.hostname(),
    timestamp: now()
  });
});


/* =========================================================
   SERVICES
========================================================= */

app.get("/api/services", requireApproved, (req, res) => {
  res.json({
    ok: true,
    services: [
      {
        name: "NICEGOLD Engine",
        status: "ONLINE",
        description: "Core VPS control engine"
      },
      {
        name: "Node.js",
        status: "ONLINE",
        description: process.version
      },
      {
        name: "Express API",
        status: "ONLINE",
        description: "Panel API service"
      },
      {
        name: "Authentication",
        status: "ONLINE",
        description: "Session authentication service"
      },
      {
        name: "User Database",
        status: "ONLINE",
        description: "Local JSON access database"
      }
    ],
    timestamp: now()
  });
});


/* =========================================================
   ACTIVITY
========================================================= */

app.get("/api/activity", requireApproved, (req, res) => {
  const user = getFreshSessionUser(req);

  res.json({
    ok: true,
    activities: [
      {
        event: "Panel connection",
        status: "SUCCESS",
        actor: user.username,
        time: now()
      },
      {
        event: "Authentication service",
        status: "ONLINE",
        actor: "NICEGOLD Engine",
        time: now()
      },
      {
        event: "VPS telemetry",
        status: "ACTIVE",
        actor: "System Monitor",
        time: now()
      }
    ]
  });
});


/* =========================================================
   SECURITY
========================================================= */

app.get("/api/security", requireApproved, (req, res) => {
  const user = getFreshSessionUser(req);

  res.json({
    ok: true,
    security: {
      authentication: "ACTIVE",
      session: "ACTIVE",
      accessControl: "ENFORCED",
      userStatus: user.status,
      role: user.role,
      serverBinding: "0.0.0.0",
      restrictedConsole: true
    },
    timestamp: now()
  });
});


/* =========================================================
   BACKUPS
========================================================= */

app.get("/api/backups", requireAdmin, (req, res) => {
  const dataDir = path.join(__dirname, "data");

  let usersFileSize = 0;

  try {
    usersFileSize = fs.statSync(
      path.join(dataDir, "users.json")
    ).size;
  } catch {}

  res.json({
    ok: true,
    backups: [
      {
        name: "User Database",
        file: "data/users.json",
        status: "AVAILABLE",
        sizeBytes: usersFileSize
      }
    ],
    timestamp: now()
  });
});


/* =========================================================
   CONTROLLED CONSOLE
   Only predefined commands are allowed.
========================================================= */

const SAFE_COMMANDS = {
  help: {
    file: "echo",
    args: [
      "NICEGOLD VPS Console\nAvailable commands: help, status, uptime, hostname"
    ]
  },

  status: {
    file: "echo",
    args: ["NICEGOLD ENGINE: ONLINE"]
  },

  uptime: {
    file: "uptime",
    args: []
  },

  hostname: {
    file: "hostname",
    args: []
  }
};


app.get("/api/console", requireApproved, (req, res) => {
  res.json({
    ok: true,
    message: "NICEGOLD controlled console ready",
    commands: Object.keys(SAFE_COMMANDS)
  });
});


app.post("/api/console", requireApproved, (req, res) => {
  const command = String(req.body.command || "")
    .trim()
    .toLowerCase();

  const selected = SAFE_COMMANDS[command];

  if (!selected) {
    return res.status(400).json({
      ok: false,
      error: "Command not allowed"
    });
  }

  execFile(
    selected.file,
    selected.args,
    {
      timeout: 5000
    },
    (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({
          ok: false,
          error: "Command execution failed",
          output: stderr || error.message
        });
      }

      res.json({
        ok: true,
        command,
        output: stdout.trim()
      });
    }
  );
});


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "ONLINE",
    service: "NICEGOLD VPS PANEL",
    engine: "NICEGOLD Operations Engine",
    uptime: process.uptime(),
    timestamp: now()
  });
});


app.get("/api", (req, res) => {
  res.json({
    ok: true,
    name: "NICEGOLD VPS PANEL",
    version: "3.0",
    status: "ONLINE",
    engine: "NICEGOLD Operations Engine",
    timestamp: now()
  });
});


/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(PUBLIC_DIR));


/* Dedicated admin page */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});


/* Dedicated access page */
app.get("/access", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "access.html"));
});


/* VPS dashboard route */
app.get("/vps", (req, res) => {
  const user = getFreshSessionUser(req);

  if (!user) {
    return res.redirect("/access");
  }

  if (user.role !== "admin" && user.status !== "APPROVED") {
    return res.redirect("/access");
  }

  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});


/* =========================================================
   API 404
========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "API endpoint not found"
  });
});


/* =========================================================
   SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==============================================");
  console.log("        NICEGOLD VPS PANEL V3");
  console.log("        NICEGOLD Operations Engine");
  console.log("==============================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Local:   http://127.0.0.1:${PORT}`);
  console.log(`Admin:   http://127.0.0.1:${PORT}/admin`);
  console.log(`Access:  http://127.0.0.1:${PORT}/access`);
  console.log(`VPS:     http://127.0.0.1:${PORT}/vps`);
  console.log("==============================================");
  console.log("");
});
