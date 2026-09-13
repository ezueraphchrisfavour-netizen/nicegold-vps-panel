const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]");
}

/* =========================================================
   READ USERS
========================================================= */

function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    const users = JSON.parse(data);

    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

/* =========================================================
   SAVE USERS
========================================================= */

function saveUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2),
    "utf8"
  );
}

/* =========================================================
   REMOVE PASSWORD HASH FROM API RESPONSES
========================================================= */

function sanitize(user) {
  if (!user) return null;

  const { passwordHash, ...safeUser } = user;

  return safeUser;
}

/* =========================================================
   CREATE USER
========================================================= */

async function createUser({ name, username, password }) {
  const users = readUsers();

  name = String(name || "").trim();
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");

  if (!name || !username || !password) {
    throw new Error("All fields are required");
  }

  if (name.length < 2) {
    throw new Error("Name is too short");
  }

  if (username.length < 3) {
    throw new Error("Username is too short");
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error(
      "Username can only contain letters, numbers, dots, underscores and hyphens"
    );
  }

  if (password.length < 8) {
    throw new Error(
      "Password must contain at least 8 characters"
    );
  }

  const adminUsername = String(
    process.env.ADMIN_USERNAME || "nicegoldadmin"
  )
    .trim()
    .toLowerCase();

  if (username === adminUsername) {
    throw new Error(
      "That username is reserved for the administrator"
    );
  }

  if (
    users.some(
      user =>
        String(user.username || "").toLowerCase() === username
    )
  ) {
    throw new Error("Username already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = {
    id: crypto.randomUUID(),
    name,
    username,
    passwordHash,
    role: "user",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    approvedAt: null
  };

  users.push(user);
  saveUsers(users);

  return sanitize(user);
}

/* =========================================================
   VERIFY LOGIN
========================================================= */

async function verifyLogin(username, password) {
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");

  const users = readUsers();

  const user = users.find(
    item =>
      String(item.username || "").toLowerCase() === username
  );

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!valid) {
    return null;
  }

  return sanitize(user);
}

/* =========================================================
   GET ALL USERS
========================================================= */

function getUsers() {
  return readUsers().map(sanitize);
}

/* =========================================================
   GET ONE USER
========================================================= */

function getUser(id) {
  const user = readUsers().find(
    item => String(item.id) === String(id)
  );

  return sanitize(user);
}

/* =========================================================
   CHANGE USER STATUS
========================================================= */

function changeStatus(id, status) {
  const allowedStatuses = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "SUSPENDED"
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid account status");
  }

  const users = readUsers();

  const index = users.findIndex(
    item => String(item.id) === String(id)
  );

  if (index === -1) {
    return null;
  }

  users[index].status = status;

  if (status === "APPROVED") {
    users[index].approvedAt =
      users[index].approvedAt ||
      new Date().toISOString();
  } else {
    users[index].approvedAt = null;
  }

  saveUsers(users);

  return sanitize(users[index]);
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  createUser,
  verifyLogin,
  getUsers,
  getUser,
  changeStatus
};
