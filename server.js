require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  createUser,
  verifyLogin,
  getUsers,
  getUser,
  changeStatus
} = require("./auth");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET =
  process.env.SESSION_SECRET || "NICEGOLD_CHANGE_THIS_SESSION_SECRET";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   HELPERS
========================================================= */

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null
  };
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      message: "Authentication required"
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      message: "Administrator authentication required"
    });
  }

  if (req.session.user.role !== "admin") {
    return res.status(403).json({
      ok: false,
      message: "Administrator access required"
    });
  }

  next();
}

function requireApproved(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      ok: false,
      message: "Authentication required"
    });
  }

  const user = req.session.user;

  if (user.role === "admin" || user.status === "APPROVED") {
    return next();
  }

  return res.status(403).json({
    ok: false,
    message: "Your account is waiting for administrator approval",
    status: user.status
  });
}

/* =========================================================
   AUTHENTICATION
========================================================= */

/*
   REQUEST ACCESS
*/
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const username = String(req.body?.username || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!name || !username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Name, username and password are required"
      });
    }

    const user = await createUser({
      name,
      username,
      password
    });

    return res.status(201).json({
      ok: true,
      message: "Access request submitted",
      user: publicUser(user)
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    /*
      IMPORTANT:
      A duplicate username is a normal validation error.
      It must NEVER crash the Node server.
    */
    if (
      error.message &&
      error.message.toLowerCase().includes("username already exists")
    ) {
      return res.status(409).json({
        ok: false,
        message: "Username already exists. Please choose another username."
      });
    }

    if (
      error.message &&
      error.message.toLowerCase().includes("password")
    ) {
      return res.status(400).json({
        ok: false,
        message: error.message
      });
    }

    return res.status(400).json({
      ok: false,
      message: error.message || "Unable to submit access request"
    });
  }
});

/*
   USER SIGN IN
*/
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Username and password are required"
      });
    }

    const user = await verifyLogin(username, password);

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password"
      });
    }

    if (user.status === "PENDING") {
      return res.status(403).json({
        ok: false,
        message: "Your access request is still pending approval",
        status: "PENDING",
        user: publicUser(user)
      });
    }

    if (user.status === "REJECTED" || user.status === "BLOCKED") {
      return res.status(403).json({
        ok: false,
        message: "Your account does not currently have access",
        status: user.status,
        user: publicUser(user)
      });
    }

    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        ok: false,
        message: "Your account is currently suspended",
        status: "SUSPENDED",
        user: publicUser(user)
      });
    }

    req.session.user = publicUser(user);

    return res.json({
      ok: true,
      message: "Login successful",
      user: publicUser(user)
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to process login"
    });
  }
});

/*
   ADMIN SIGN IN
*/
app.post("/api/auth/admin-login", async (req, res) => {
  try {
    const username = String(req.body?.username || "")
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || "");

    const adminUsername = String(
      process.env.ADMIN_USERNAME || "nicegoldadmin"
    )
      .trim()
      .toLowerCase();

    const adminPassword = String(
      process.env.ADMIN_PASSWORD || ""
    );

    if (!adminPassword) {
      return res.status(500).json({
        ok: false,
        message: "Administrator password is not configured"
      });
    }

    if (
      username !== adminUsername ||
      password !== adminPassword
    ) {
      return res.status(401).json({
        ok: false,
        message: "Invalid administrator credentials"
      });
    }

    const adminUser = {
      id: "admin",
      name: "NICEGOLD Administrator",
      username: adminUsername,
      role: "admin",
      status: "APPROVED"
    };

    req.session.user = adminUser;

    return res.json({
      ok: true,
      message: "Administrator login successful",
      user: adminUser
    });
  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      ok: false,
      message: "Administrator login failed"
    });
  }
});

/*
   CURRENT SESSION
*/
app.get("/api/auth/me", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json({
      ok: true,
      authenticated: false,
      user: null
    });
  }

  /*
    Refresh normal users from the users database so that
    approval/rejection changes are reflected immediately.
  */
  if (req.session.user.role !== "admin") {
    const latest = getUser(req.session.user.id);

    if (latest) {
      req.session.user = publicUser(latest);
    }
  }

  return res.json({
    ok: true,
    authenticated: true,
    user: req.session.user
  });
});

/*
   LOGOUT
*/
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        ok: false,
        message: "Unable to logout"
      });
    }

    res.clearCookie("connect.sid");

    return res.json({
      ok: true,
      message: "Logged out successfully"
    });
  });
});

/* =========================================================
   ADMIN USER MANAGEMENT
========================================================= */

app.get("/api/admin/users", requireAdmin, (req, res) => {
  try {
    const users = getUsers();

    return res.json({
      ok: true,
      users: users.map(publicUser)
    });
  } catch (error) {
    console.error("Get users error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load users"
    });
  }
});

/*
   APPROVE / REJECT / SUSPEND / RESTORE
*/
app.post("/api/admin/users/:id/status", requireAdmin, (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const status = String(req.body?.status || "")
      .trim()
      .toUpperCase();

    const allowedStatuses = [
      "APPROVED",
      "REJECTED",
      "SUSPENDED",
      "BLOCKED",
      "PENDING"
    ];

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "User ID is required"
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid account status"
      });
    }

    const existing = getUser(id);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "User not found"
      });
    }

    /*
      Approved users can still be changed by the administrator
      when necessary. The Access page will immediately reflect
      the new status.
    */
    const updated = changeStatus(id, status);

    if (!updated) {
      return res.status(500).json({
        ok: false,
        message: "Unable to update user status"
      });
    }

    return res.json({
      ok: true,
      message: `User status changed to ${status}`,
      user: publicUser(updated)
    });
  } catch (error) {
    console.error("Status update error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to update user status"
    });
  }
});

/* =========================================================
   VPS ACCESS
========================================================= */

app.get("/api/vps", requireApproved, (req, res) => {
  return res.json({
    ok: true,
    message: "VPS access granted",
    user: req.session.user,
    panel: "NICEGOLD VPS PANEL"
  });
});

app.get("/api/vps/access", requireApproved, (req, res) => {
  return res.json({
    ok: true,
    access: true,
    user: req.session.user
  });
});

/* =========================================================
   DASHBOARD TELEMETRY
========================================================= */

app.get("/api/dashboard", requireApproved, (req, res) => {
  try {
    const cpus = os.cpus() || [];
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    const load = os.loadavg
      ? os.loadavg()[0]
      : 0;

    const cpuUsage =
      cpus.length > 0
        ? Math.min(
            100,
            Math.max(
              0,
              Number(((load / cpus.length) * 100).toFixed(1))
            )
          )
        : 0;

    return res.json({
      ok: true,
      hostname: os.hostname(),
      platform: os.platform(),
      architecture: os.arch(),
      uptime: os.uptime(),
      cpu: {
        cores: cpus.length,
        usage: cpuUsage
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        percentage: Number(
          ((usedMemory / totalMemory) * 100).toFixed(1)
        )
      },
      load: os.loadavg ? os.loadavg() : [],
      node: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Dashboard telemetry error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to read dashboard telemetry"
    });
  }
});

/* =========================================================
   SYSTEM INFORMATION
========================================================= */

app.get("/api/system", requireApproved, (req, res) => {
  try {
    const total = os.totalmem();
    const free = os.freemem();

    return res.json({
      ok: true,
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        architecture: os.arch(),
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || "Unknown",
        totalMemory: total,
        freeMemory: free,
        usedMemory: total - free,
        uptime: os.uptime(),
        nodeVersion: process.version,
        pid: process.pid
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("System information error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load system information"
    });
  }
});

/* =========================================================
   NETWORK
========================================================= */

app.get("/api/network", requireApproved, (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const network = [];

    for (const [name, addresses] of Object.entries(interfaces)) {
      for (const address of addresses || []) {
        network.push({
          interface: name,
          address: address.address,
          family: address.family,
          internal: address.internal,
          mac: address.mac,
          netmask: address.netmask
        });
      }
    }

    return res.json({
      ok: true,
      interfaces: network,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Network error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load network information"
    });
  }
});

/* =========================================================
   SERVICES
========================================================= */

app.get("/api/services", requireApproved, (req, res) => {
  return res.json({
    ok: true,
    services: [
      {
        name: "NICEGOLD Panel",
        status: "ONLINE",
        type: "CORE"
      },
      {
        name: "Node.js",
        status: "ONLINE",
        type: "RUNTIME"
      },
      {
        name: "Express",
        status: "ONLINE",
        type: "WEB"
      },
      {
        name: "Authentication",
        status: "ONLINE",
        type: "SECURITY"
      },
      {
        name: "Session Service",
        status: "ONLINE",
        type: "SECURITY"
      }
    ],
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   ACTIVITY
========================================================= */

app.get("/api/activity", requireApproved, (req, res) => {
  const users = getUsers();

  const activity = users
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0) -
        new Date(a.createdAt || 0)
    )
    .slice(0, 20)
    .map((user) => ({
      type: "ACCESS",
      message: `${user.username} account is ${user.status}`,
      user: user.username,
      status: user.status,
      timestamp: user.createdAt
    }));

  return res.json({
    ok: true,
    activity,
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   SECURITY
========================================================= */

app.get("/api/security", requireApproved, (req, res) => {
  return res.json({
    ok: true,
    security: {
      authentication: "ACTIVE",
      sessionProtection: "ACTIVE",
      passwordHashing: "BCRYPT",
      adminProtection: "ACTIVE",
      accessApproval: "ACTIVE"
    },
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   CONTROLLED CONSOLE
========================================================= */

app.post("/api/console", requireAdmin, (req, res) => {
  const command = String(req.body?.command || "").trim();

  if (!command) {
    return res.status(400).json({
      ok: false,
      message: "Console command is required"
    });
  }

  /*
    This intentionally does NOT execute arbitrary shell commands.
    It provides safe panel diagnostics instead.
  */

  const safeCommands = {
    help: [
      "status",
      "users",
      "uptime",
      "memory",
      "system"
    ],
    status: "NICEGOLD VPS PANEL ONLINE",
    uptime: `${Math.floor(os.uptime())} seconds`,
    memory: `${Math.round(
      ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
    )}% memory used`,
    system: `${os.platform()} ${os.arch()} | Node ${process.version}`,
    users: `${getUsers().length} registered user(s)`
  };

  const key = command.toLowerCase();

  if (!(key in safeCommands)) {
    return res.status(400).json({
      ok: false,
      message: "Command not available",
      available: Object.keys(safeCommands)
    });
  }

  return res.json({
    ok: true,
    command,
    output: safeCommands[key]
  });
});

/* =========================================================
   BACKUPS
========================================================= */

app.get("/api/backups", requireAdmin, (req, res) => {
  let usersBackup = false;

  try {
    usersBackup = fs.existsSync(
      path.join(__dirname, "data", "users.json")
    );
  } catch (_) {}

  return res.json({
    ok: true,
    backups: [
      {
        name: "User Database",
        status: usersBackup ? "AVAILABLE" : "MISSING",
        file: "data/users.json"
      },
      {
        name: "Panel Configuration",
        status: "AVAILABLE",
        file: ".env"
      }
    ],
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    status: "ONLINE",
    service: "NICEGOLD VPS PANEL",
    uptime: process.uptime(),
    node: process.version,
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (req, res) => {
  return res.json({
    ok: true,
    message: "NICEGOLD VPS PANEL API ONLINE",
    version: "V3",
    endpoints: {
      access: "/access",
      admin: "/admin",
      vps: "/vps",
      health: "/api/health"
    }
  });
});

/* =========================================================
   PAGE ROUTES
========================================================= */

/*
   ACCESS CENTER
*/
app.get("/access", (req, res) => {
  return res.sendFile(
    path.join(__dirname, "public", "access.html")
  );
});

/*
   ADMIN CENTER
*/
app.get("/admin", (req, res) => {
  return res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

/*
   VPS PANEL
*/
app.get("/vps", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/access");
  }

  const user = req.session.user;

  if (
    user.role !== "admin" &&
    user.status !== "APPROVED"
  ) {
    return res.redirect("/access");
  }

  return res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/*
   Send visitors from the root to the Access Center.
*/
app.get("/", (req, res) => {
  return res.redirect("/access");
});

/* =========================================================
   API 404
========================================================= */

app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    message: "API endpoint not found"
  });
});

/* =========================================================
   GENERAL ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    ok: false,
    message: "Internal server error"
  });
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("==========================================");
  console.log("        NICEGOLD VPS PANEL");
  console.log("==========================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://127.0.0.1:${PORT}`);
  console.log("Access Center: /access");
  console.log("Admin Center:  /admin");
  console.log("VPS Panel:     /vps");
  console.log("==========================================");
  console.log("");
});
