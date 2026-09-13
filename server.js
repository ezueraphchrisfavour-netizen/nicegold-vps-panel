require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");

const {
  createUser,
  verifyLogin,
  getUsers,
  getUser,
  changeStatus
} = require("./auth");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "NICEGOLD_CHANGE_THIS_SESSION_SECRET",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   AUTH HELPERS
========================================================= */

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(401).json({
      ok: false,
      message: "Administrator authentication required"
    });
  }

  next();
}

function requireApproved(req, res, next) {
  if (!req.session.user) {
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
    message: "Your account has not been approved yet",
    status: user.status
  });
}

/* =========================================================
   NORMAL USER REGISTRATION
========================================================= */

app.post("/api/auth/register", (req, res) => {
  try {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Name, username and password are required"
      });
    }

    const user = createUser({
      name,
      username,
      password
    });

    return res.status(201).json({
      ok: true,
      message: "Access request submitted",
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || "Unable to create account"
    });
  }
});

/* =========================================================
   NORMAL USER LOGIN
========================================================= */

app.post("/api/auth/login", (req, res) => {
  try {
    const { username, password } = req.body;

    const user = verifyLogin(username, password);

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password"
      });
    }

    req.session.user = user;

    return res.json({
      ok: true,
      message: "Login successful",
      user
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Login failed"
    });
  }
});

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/auth/admin-login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const adminUsername = process.env.ADMIN_USERNAME || "nicegoldadmin";
  const adminPassword =
    process.env.ADMIN_PASSWORD || "NiceGoldAdmin2026!";

  if (
    username !== adminUsername ||
    password !== adminPassword
  ) {
    return res.status(401).json({
      ok: false,
      message: "Invalid administrator credentials"
    });
  }

  req.session.user = {
    id: "admin",
    name: "NICEGOLD Administrator",
    username: adminUsername,
    role: "admin",
    status: "APPROVED"
  };

  return res.json({
    ok: true,
    message: "Administrator login successful",
    user: req.session.user
  });
});

/* =========================================================
   CURRENT SESSION
========================================================= */

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) {
    return res.json({
      ok: false,
      authenticated: false,
      message: "Not authenticated"
    });
  }

  return res.json({
    ok: true,
    authenticated: true,
    user: req.session.user
  });
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
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
      users
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Unable to load users"
    });
  }
});

app.post(
  "/api/admin/users/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const { status } = req.body;

      const allowedStatuses = [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "SUSPENDED"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid account status"
        });
      }

      const user = changeStatus(req.params.id, status);

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "User not found"
        });
      }

      return res.json({
        ok: true,
        message: `User status changed to ${status}`,
        user
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: "Unable to update user"
      });
    }
  }
);

/* =========================================================
   VPS ACCESS
========================================================= */

app.get("/api/vps", requireApproved, (req, res) => {
  res.json({
    ok: true,
    message: "VPS access granted",
    user: req.session.user
  });
});

app.get("/api/vps/access", requireApproved, (req, res) => {
  res.json({
    ok: true,
    access: true,
    user: req.session.user
  });
});

/* =========================================================
   DASHBOARD API
========================================================= */

app.get("/api/dashboard", requireApproved, (req, res) => {
  res.json({
    ok: true,
    server: "NICEGOLD VPS",
    status: "ONLINE",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/system", requireApproved, (req, res) => {
  const memory = process.memoryUsage();

  res.json({
    ok: true,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    pid: process.pid,
    uptime: process.uptime(),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/network", requireApproved, (req, res) => {
  res.json({
    ok: true,
    status: "ONLINE",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/services", requireApproved, (req, res) => {
  res.json({
    ok: true,
    services: [
      {
        name: "NICEGOLD VPS ENGINE",
        status: "RUNNING"
      },
      {
        name: "NODE.JS",
        status: "RUNNING"
      },
      {
        name: "WEB SERVER",
        status: "RUNNING"
      },
      {
        name: "AUTHENTICATION",
        status: "RUNNING"
      }
    ]
  });
});

app.get("/api/activity", requireApproved, (req, res) => {
  res.json({
    ok: true,
    activity: [
      {
        event: "VPS engine online",
        time: new Date().toISOString()
      },
      {
        event: "Authentication service active",
        time: new Date().toISOString()
      }
    ]
  });
});

app.get("/api/security", requireApproved, (req, res) => {
  res.json({
    ok: true,
    security: {
      authentication: "ACTIVE",
      sessionProtection: "ACTIVE",
      adminProtection: "ACTIVE"
    }
  });
});

app.get("/api/backups", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    backups: []
  });
});

/* =========================================================
   CONTROLLED CONSOLE
========================================================= */

app.post("/api/console", requireApproved, (req, res) => {
  const command = String(req.body.command || "")
    .trim()
    .toLowerCase();

  const allowedCommands = {
    help: "Available commands: help, status, uptime, hostname",
    status: "NICEGOLD VPS ENGINE: ONLINE",
    uptime: `${Math.floor(process.uptime())} seconds`,
    hostname: require("os").hostname()
  };

  if (!allowedCommands[command]) {
    return res.status(400).json({
      ok: false,
      message: "Command not allowed"
    });
  }

  res.json({
    ok: true,
    command,
    output: allowedCommands[command]
  });
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "NICEGOLD VPS PANEL",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    message: "NICEGOLD VPS API is running"
  });
});

/* =========================================================
   PAGE ROUTING
   IMPORTANT:
   /access = Access Center
   /admin  = Admin Center
   /vps    = Main VPS Panel
========================================================= */

app.get("/access", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "access.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

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

/* =========================================================
   UNKNOWN API ROUTES
========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: "API endpoint not found"
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
