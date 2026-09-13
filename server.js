require("dotenv").config();

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
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
const HOST = "0.0.0.0";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "nicegoldadmin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "NiceGoldAdmin2026!";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(48).toString("hex");

const ADMIN_TOKEN_SECRET =
  process.env.ADMIN_TOKEN_SECRET ||
  crypto.createHash("sha256").update(SESSION_SECRET).digest("hex");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function signAdminToken(username) {
  const payload = {
    username,
    role: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(encoded)
    .digest("base64url");

  return `${encoded}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    if (!token || !token.includes(".")) return null;

    const [encoded, signature] = token.split(".");

    const expected = crypto
      .createHmac("sha256", ADMIN_TOKEN_SECRET)
      .update(encoded)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    );

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    if (
      payload.role !== "admin" ||
      payload.username !== ADMIN_USERNAME
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach(part => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function isAdmin(req) {
  const cookies = getCookies(req);
  return !!verifyAdminToken(cookies.nicegold_admin);
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    authenticated: false,
    message: "Administrator authentication required"
  });
}

function isApprovedUser(req) {
  if (isAdmin(req)) return true;

  if (!req.session || !req.session.userId) {
    return false;
  }

  const user = getUser(req.session.userId);

  return !!(
    user &&
    user.status === "APPROVED"
  );
}

function requireApproved(req, res, next) {
  if (isApprovedUser(req)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    authenticated: false,
    message: "Approved access required"
  });
}

function systemStats() {
  const cpus = os.cpus();

  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach(cpu => {
    const times = cpu.times;

    totalIdle += times.idle;
    totalTick +=
      times.user +
      times.nice +
      times.sys +
      times.irq +
      times.idle;
  });

  const cpuPercent =
    totalTick > 0
      ? Math.round((1 - totalIdle / totalTick) * 100)
      : 0;

  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const memoryUsed = memoryTotal - memoryFree;

  return {
    cpu: Math.max(0, Math.min(100, cpuPercent)),
    memory: {
      used: memoryUsed,
      total: memoryTotal,
      percent: Math.round(
        (memoryUsed / memoryTotal) * 100
      )
    },
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    node: process.version,
    load: os.loadavg()
  };
}

/* =========================
   AUTH
========================= */

app.post("/api/auth/register", (req, res) => {
  try {
    const { name, username, password } = req.body;

    const user = createUser({
      name,
      username,
      password
    });

    res.status(201).json({
      ok: true,
      message: "Access request submitted",
      user
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message
    });
  }
});

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

    if (user.status !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        status: user.status,
        message:
          user.status === "PENDING"
            ? "Your access request is still pending"
            : "Your account does not currently have access"
      });
    }

    req.session.userId = user.id;

    res.json({
      ok: true,
      message: "Login successful",
      user
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message
    });
  }
});

/*
  ADMIN LOGIN

  This no longer depends on the temporary
  Express session. A signed 7-day cookie is used.
*/

app.post("/api/auth/admin-login", (req, res) => {
  try {
    const { username, password } = req.body;

    if (
      username !== ADMIN_USERNAME ||
      password !== ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        ok: false,
        message: "Invalid administrator credentials"
      });
    }

    const token = signAdminToken(username);

    res.setHeader(
      "Set-Cookie",
      [
        `nicegold_admin=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=604800"
      ].join("; ")
    );

    return res.json({
      ok: true,
      message: "Administrator login successful",
      user: {
        id: "admin",
        name: "NICEGOLD Administrator",
        username: ADMIN_USERNAME,
        role: "admin",
        status: "APPROVED"
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Administrator login failed"
    });
  }
});

app.get("/api/auth/me", (req, res) => {
  if (isAdmin(req)) {
    return res.json({
      ok: true,
      authenticated: true,
      user: {
        id: "admin",
        name: "NICEGOLD Administrator",
        username: ADMIN_USERNAME,
        role: "admin",
        status: "APPROVED"
      }
    });
  }

  if (req.session && req.session.userId) {
    const user = getUser(req.session.userId);

    if (user) {
      return res.json({
        ok: true,
        authenticated: true,
        user
      });
    }
  }

  return res.json({
    ok: true,
    authenticated: false,
    user: null
  });
});

app.post("/api/auth/logout", (req, res) => {
  const cookies = getCookies(req);

  const headers = [
    "nicegold_admin=;",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  res.setHeader("Set-Cookie", headers.join("; "));

  if (req.session) {
    req.session.destroy(() => {
      res.json({
        ok: true,
        message: "Logged out successfully"
      });
    });
  } else {
    res.json({
      ok: true,
      message: "Logged out successfully"
    });
  }
});

/* =========================
   ADMIN
========================= */

app.get(
  "/api/admin/users",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      users: getUsers()
    });
  }
);

app.post(
  "/api/admin/users/:id/status",
  requireAdmin,
  (req, res) => {
    try {
      const { status } = req.body;

      const allowed = [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "SUSPENDED"
      ];

      if (!allowed.includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid status"
        });
      }

      const user = changeStatus(
        req.params.id,
        status
      );

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "User not found"
        });
      }

      res.json({
        ok: true,
        message: `User status changed to ${status}`,
        user
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        message: error.message
      });
    }
  }
);

/* =========================
   VPS / DASHBOARD
========================= */

app.get(
  "/api/vps",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      access: true,
      message: "VPS access granted"
    });
  }
);

app.get(
  "/api/vps/access",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      access: true,
      user: isAdmin(req)
        ? {
            username: ADMIN_USERNAME,
            role: "admin"
          }
        : getUser(req.session.userId)
    });
  }
);

app.get(
  "/api/dashboard",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      stats: systemStats(),
      timestamp: new Date().toISOString()
    });
  }
);

app.get(
  "/api/system",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      ...systemStats()
    });
  }
);

app.get(
  "/api/network",
  requireApproved,
  (req, res) => {
    const interfaces = os.networkInterfaces();
    const result = [];

    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(item => {
        result.push({
          interface: name,
          address: item.address,
          family: item.family,
          internal: item.internal
        });
      });
    });

    res.json({
      ok: true,
      interfaces: result
    });
  }
);

app.get(
  "/api/services",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      services: [
        {
          name: "NICEGOLD Core",
          status: "RUNNING"
        },
        {
          name: "Node.js",
          status: "RUNNING"
        },
        {
          name: "Express API",
          status: "RUNNING"
        },
        {
          name: "Authentication",
          status: "RUNNING"
        }
      ]
    });
  }
);

app.get(
  "/api/activity",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      activity: [
        {
          type: "system",
          message: "NICEGOLD engine online",
          time: new Date().toISOString()
        }
      ]
    });
  }
);

app.get(
  "/api/security",
  requireApproved,
  (req, res) => {
    res.json({
      ok: true,
      security: {
        authentication: "ACTIVE",
        adminProtection: "ACTIVE",
        sessionProtection: "ACTIVE",
        apiProtection: "ACTIVE"
      }
    });
  }
);

app.get(
  "/api/backups",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,
      backups: []
    });
  }
);

app.post(
  "/api/console",
  requireAdmin,
  (req, res) => {
    const command = String(
      req.body.command || ""
    )
      .trim()
      .toLowerCase();

    const allowed = {
      help:
        "Available commands: help, status, uptime, hostname",
      status:
        "NICEGOLD Operations Engine: ONLINE",
      uptime:
        `${Math.floor(os.uptime())} seconds`,
      hostname:
        os.hostname()
    };

    if (!allowed[command]) {
      return res.status(400).json({
        ok: false,
        message: "Command not allowed"
      });
    }

    res.json({
      ok: true,
      output: allowed[command]
    });
  }
);

/* =========================
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "ONLINE",
    service: "NICEGOLD VPS PANEL",
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    name: "NICEGOLD VPS PANEL",
    status: "ONLINE"
  });
});

/* =========================
   PAGES
========================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

app.get("/access", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "access.html")
  );
});

app.get("/vps", (req, res) => {
  if (!isApprovedUser(req)) {
    return res.redirect("/access");
  }

  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.get("/", (req, res) => {
  if (isApprovedUser(req)) {
    return res.sendFile(
      path.join(__dirname, "public", "index.html")
    );
  }

  res.redirect("/access");
});

/* =========================
   404
========================= */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      ok: false,
      message: "API endpoint not found"
    });
  }

  res.status(404).send("NICEGOLD page not found");
});

app.listen(PORT, HOST, () => {
  console.log("");
  console.log("======================================");
  console.log("      NICEGOLD VPS PANEL");
  console.log("======================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`http://127.0.0.1:${PORT}`);
  console.log("Admin authentication: PERSISTENT");
  console.log("======================================");
  console.log("");
});
