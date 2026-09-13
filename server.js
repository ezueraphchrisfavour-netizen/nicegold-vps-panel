require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const {
  createUser,
  verifyLogin,
  getUsers,
  getUser,
  changeStatus
} = require("./auth");

const app = express();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const ACTIVITY_FILE = path.join(DATA_DIR, "activity.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ACTIVITY_FILE)) {
  fs.writeFileSync(ACTIVITY_FILE, "[]");
}

/* ============================================================
   EXPRESS CONFIG
============================================================ */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use(express.static(PUBLIC_DIR));

/* ============================================================
   ACTIVITY
============================================================ */

function readActivity() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVITY_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeActivity(items) {
  fs.writeFileSync(
    ACTIVITY_FILE,
    JSON.stringify(items.slice(-200), null, 2)
  );
}

function logActivity(type, message, user = null) {
  const activities = readActivity();

  activities.push({
    id: crypto.randomUUID(),
    type,
    message,
    user: user
      ? {
          id: user.id,
          name: user.name,
          username: user.username
        }
      : null,
    createdAt: new Date().toISOString()
  });

  writeActivity(activities);
}

/* ============================================================
   FIXED PERSONAL ADMIN QUESTION
============================================================ */

/*
   CHANGE THESE TWO VALUES.

   Keep your real answer private.
*/

const ADMIN_PERSONAL_QUESTION =
  "What is the name of my first website project?";

const ADMIN_PERSONAL_ANSWER =
  "NICE";


function normalizeAdminAnswer(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function createAdminChallenge(req) {
  req.session.adminChallenge = {
    question: ADMIN_PERSONAL_QUESTION
  };
}


/* ============================================================
   ADMIN AUTH MIDDLEWARE
============================================================ */

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminVerified === true) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    message: "Admin verification required."
  });
}


function requireUserOrAdmin(req, res, next) {
  if (req.session && req.session.adminVerified === true) {
    return next();
  }

  if (req.session && req.session.userId) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    message: "Authentication required."
  });
}


/* ============================================================
   BASIC API
============================================================ */

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    name: "BlueTigerGOLD VPS PANEL",
    status: "ONLINE",
    version: "V3",
    time: new Date().toISOString()
  });
});


app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});


/* ============================================================
   USER REGISTRATION
============================================================ */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    const user = await createUser({
      name,
      username,
      password
    });

    logActivity(
      "registration",
      `New access request from ${user.username}`,
      user
    );

    return res.status(201).json({
      ok: true,
      message:
        "Registration successful. Your account is pending admin approval.",
      user
    });

  } catch (error) {
    console.error("Registration error:", error);

    if (
      error.message &&
      error.message.toLowerCase().includes("username already exists")
    ) {
      return res.status(409).json({
        ok: false,
        message: "Username already exists."
      });
    }

    return res.status(400).json({
      ok: false,
      message: error.message || "Registration failed."
    });
  }
});


/* ============================================================
   USER LOGIN
============================================================ */

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Username and password are required."
      });
    }

    const user = await verifyLogin(username, password);

    if (!user) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password."
      });
    }

    if (user.status === "PENDING") {
      return res.status(403).json({
        ok: false,
        pending: true,
        message: "Your account is waiting for admin approval."
      });
    }

    if (
      user.status === "REJECTED" ||
      user.status === "SUSPENDED" ||
      user.status === "BLOCKED"
    ) {
      return res.status(403).json({
        ok: false,
        message:
          `Your account is ${user.status.toLowerCase()}.`
      });
    }

    if (user.status !== "APPROVED") {
      return res.status(403).json({
        ok: false,
        message: "Your account is not approved."
      });
    }

    req.session.userId = user.id;

    logActivity(
      "login",
      `User ${user.username} signed in`,
      user
    );

    return res.json({
      ok: true,
      message: "Login successful.",
      user
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      ok: false,
      message: "Login failed."
    });
  }
});


/* ============================================================
   CURRENT USER
============================================================ */

app.get("/api/auth/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({
      ok: true,
      authenticated: false
    });
  }

  const user = getUser(req.session.userId);

  if (!user) {
    req.session.userId = null;

    return res.json({
      ok: true,
      authenticated: false
    });
  }

  return res.json({
    ok: true,
    authenticated: true,
    user
  });
});


/* ============================================================
   USER LOGOUT
============================================================ */

app.post("/api/auth/logout", (req, res) => {
  const userId = req.session?.userId;

  if (userId) {
    const user = getUser(userId);

    if (user) {
      logActivity(
        "logout",
        `User ${user.username} signed out`,
        user
      );
    }
  }

  req.session.userId = null;

  res.json({
    ok: true,
    message: "Logged out."
  });
});


/* ============================================================
   FIXED ADMIN QUESTION
============================================================ */

app.get("/api/admin/challenge", (req, res) => {
  if (!req.session.adminChallenge) {
    createAdminChallenge(req);
  }

  res.json({
    ok: true,
    question: req.session.adminChallenge.question
  });
});


/* ============================================================
   ADMIN LOGIN
============================================================ */

app.post("/api/auth/admin-login", (req, res) => {
  try {
    const answer = normalizeAdminAnswer(req.body.answer);

    if (!answer) {
      return res.status(400).json({
        ok: false,
        message: "Please enter your answer."
      });
    }

    const correctAnswer =
      normalizeAdminAnswer(ADMIN_PERSONAL_ANSWER);

    if (answer !== correctAnswer) {
      createAdminChallenge(req);

      return res.status(401).json({
        ok: false,
        message: "Incorrect answer.",
        question:
          req.session.adminChallenge.question
      });
    }

    req.session.adminVerified = true;
    delete req.session.adminChallenge;

    logActivity(
      "admin-login",
      "BlueTigerGOLD administrator accessed the command center."
    );

    return res.json({
      ok: true,
      message: "Admin access granted.",
      admin: {
        username: "BlueTigerGOLD ADMIN",
        role: "admin"
      }
    });

  } catch (error) {
    console.error("Admin login error:", error);

    return res.status(500).json({
      ok: false,
      message: "Admin verification failed."
    });
  }
});


/* ============================================================
   ADMIN SESSION
============================================================ */

app.get("/api/admin/me", (req, res) => {
  if (
    !req.session ||
    req.session.adminVerified !== true
  ) {
    return res.json({
      ok: true,
      authenticated: false
    });
  }

  return res.json({
    ok: true,
    authenticated: true,
    admin: {
      username: "BlueTigerGOLD ADMIN",
      role: "admin"
    }
  });
});


/* ============================================================
   ADMIN LOGOUT
============================================================ */

app.post("/api/admin/logout", (req, res) => {
  req.session.adminVerified = false;
  delete req.session.adminChallenge;

  logActivity(
    "admin-logout",
    "BlueTigerGOLD administrator signed out."
  );

  res.json({
    ok: true,
    message: "Admin logged out."
  });
});


/* ============================================================
   ADMIN USER LIST
============================================================ */

app.get(
  "/api/admin/users",
  requireAdmin,
  (req, res) => {
    try {
      const users = getUsers();

      return res.json({
        ok: true,
        users
      });

    } catch (error) {
      console.error("Admin users error:", error);

      return res.status(500).json({
        ok: false,
        message: "Unable to load users."
      });
    }
  }
);


/* ============================================================
   ADMIN CHANGE USER STATUS
============================================================ */

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
        "SUSPENDED",
        "BLOCKED"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid account status."
        });
      }

      const user = getUser(req.params.id);

      if (!user) {
        return res.status(404).json({
          ok: false,
          message: "User not found."
        });
      }

      const updated = changeStatus(
        req.params.id,
        status
      );

      logActivity(
        "admin-action",
        `Admin changed ${user.username} status to ${status}.`,
        user
      );

      return res.json({
        ok: true,
        message:
          `User status changed to ${status}.`,
        user: updated
      });

    } catch (error) {
      console.error(
        "Status update error:",
        error
      );

      return res.status(500).json({
        ok: false,
        message: "Unable to update user status."
      });
    }
  }
);


/* ============================================================
   VPS ACCESS
============================================================ */

app.get(
  "/api/vps/access",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,
      access: true,
      panel: "BlueTigerGOLD VPS PANEL",
      status: "ONLINE"
    });
  }
);


app.get(
  "/api/vps",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,
      name: "BlueTigerGOLD VPS",
      status: "ONLINE",
      uptime: process.uptime(),
      platform: process.platform,
      architecture: process.arch,
      node: process.version
    });
  }
);


/* ============================================================
   DASHBOARD
============================================================ */

app.get(
  "/api/dashboard",
  requireUserOrAdmin,
  (req, res) => {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory =
      totalMemory - freeMemory;

    const load = os.loadavg();

    res.json({
      ok: true,

      cpu: {
        load1: load[0],
        load5: load[1],
        load15: load[2],
        estimatedPercent: Math.min(
          100,
          Math.round(
            (load[0] /
              Math.max(os.cpus().length, 1)) *
              100
          )
        )
      },

      memory: {
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        percent: Math.round(
          (usedMemory / totalMemory) * 100
        )
      },

      uptime: process.uptime(),

      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpus: os.cpus().length
      },

      timestamp:
        new Date().toISOString()
    });
  }
);


/* ============================================================
   SYSTEM INFORMATION
============================================================ */

app.get(
  "/api/system",
  requireUserOrAdmin,
  (req, res) => {
    const total = os.totalmem();
    const free = os.freemem();

    res.json({
      ok: true,

      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      architecture: os.arch(),
      nodeVersion: process.version,

      cpuCount: os.cpus().length,

      cpuModel:
        os.cpus()[0]?.model ||
        "Unknown",

      memory: {
        total,
        free,
        used: total - free
      },

      uptime:
        os.uptime(),

      processUptime:
        process.uptime()
    });
  }
);


/* ============================================================
   NETWORK
============================================================ */

app.get(
  "/api/network",
  requireUserOrAdmin,
  (req, res) => {
    const interfaces =
      os.networkInterfaces();

    const result = [];

    for (const [name, addresses] of Object.entries(
      interfaces
    )) {
      for (const address of addresses || []) {
        result.push({
          interface: name,
          address: address.address,
          family: address.family,
          internal: address.internal,
          mac: address.mac
        });
      }
    }

    res.json({
      ok: true,
      interfaces: result
    });
  }
);


/* ============================================================
   SERVICES
============================================================ */

app.get(
  "/api/services",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,

      services: [
        {
          name: "BlueTigerGOLD PANEL",
          status: "ONLINE",
          uptime: process.uptime()
        },
        {
          name: "Node.js",
          status: "ONLINE",
          version: process.version
        },
        {
          name: "Express",
          status: "ONLINE"
        },
        {
          name: "Authentication",
          status: "ONLINE"
        },
        {
          name: "Session Engine",
          status: "ONLINE"
        }
      ]
    });
  }
);


/* ============================================================
   ACTIVITY API
============================================================ */

app.get(
  "/api/activity",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,
      activity:
        readActivity()
          .slice()
          .reverse()
          .slice(0, 100)
    });
  }
);


/* ============================================================
   SECURITY
============================================================ */

app.get(
  "/api/security",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,

      security: {
        authentication: "ACTIVE",
        sessionProtection: "ACTIVE",
        adminGate: "ACTIVE",
        passwordHashing: "BCRYPT",
        httpOnlyCookies: true,
        sameSiteCookies: true
      }
    });
  }
);


/* ============================================================
   BACKUPS
============================================================ */

app.get(
  "/api/backups",
  requireUserOrAdmin,
  (req, res) => {
    res.json({
      ok: true,

      backups: [
        {
          name: "Application Data",
          status: "READY",
          location: "data/"
        },
        {
          name: "Activity Logs",
          status: "READY",
          location: "data/activity.json"
        }
      ]
    });
  }
);


/* ============================================================
   CONTROLLED CONSOLE
============================================================ */

app.post(
  "/api/console",
  requireUserOrAdmin,
  (req, res) => {
    const command = String(
      req.body.command || ""
    )
      .trim()
      .toLowerCase();

    const commands = {

      help: `
BlueTigerGOLD VPS CONSOLE

Available commands:

help
status
users
uptime
memory
system
      `.trim(),

      status: `
BlueTigerGOLD VPS STATUS

Panel: ONLINE
Authentication: ACTIVE
Admin Gate: ACTIVE
Node: ${process.version}
Platform: ${process.platform}
Architecture: ${process.arch}
      `.trim(),

      users: (() => {
        const users = getUsers();

        return `
TOTAL USERS: ${users.length}

${users
  .map(
    user =>
      `${user.username} | ${user.status}`
  )
  .join("\n")}
        `.trim();
      })(),

      uptime:
        `Process uptime: ${Math.round(
          process.uptime()
        )} seconds`,

      memory: (() => {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;

        return `
Memory Total: ${Math.round(
  total / 1024 / 1024
)} MB

Memory Used: ${Math.round(
  used / 1024 / 1024
)} MB

Memory Free: ${Math.round(
  free / 1024 / 1024
)} MB
        `.trim();
      })(),

      system: `
Hostname: ${os.hostname()}
Platform: ${os.platform()}
Release: ${os.release()}
Architecture: ${os.arch()}
Node: ${process.version}
CPU Cores: ${os.cpus().length}
      `.trim()
    };

    if (!commands[command]) {
      return res.json({
        ok: false,
        output:
          `Unknown command: ${command}\n\nType "help" for available commands.`
      });
    }

    logActivity(
      "console",
      `Console command executed: ${command}`
    );

    res.json({
      ok: true,
      output: commands[command]
    });
  }
);


/* ============================================================
   PAGE ROUTES
============================================================ */

app.get("/", (req, res) => {
  res.redirect("/access");
});


app.get("/access", (req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      "access.html"
    )
  );
});


app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      "admin.html"
    )
  );
});


app.get("/vps", (req, res) => {
  if (
    req.session?.adminVerified === true ||
    req.session?.userId
  ) {
    return res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }

  return res.redirect("/access");
});


/* ============================================================
   404 API HANDLER
============================================================ */

app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: "API endpoint not found."
  });
});


/* ============================================================
   ERROR HANDLER
============================================================ */

app.use((error, req, res, next) => {
  console.error(
    "SERVER ERROR:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    ok: false,
    message: "Internal server error."
  });
});


/* ============================================================
   START SERVER
============================================================ */

app.listen(PORT, () => {
  console.log(`
==========================================
        BlueTigerGOLD VPS PANEL
==========================================

Server running on port ${PORT}

Local:
http://127.0.0.1:${PORT}

Access Center:
/access

Admin Center:
/admin

VPS Dashboard:
/vps

==========================================
        SYSTEM ONLINE
==========================================
`);
});
