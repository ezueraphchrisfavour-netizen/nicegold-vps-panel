const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]");
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2)
  );
}

function createUser({ name, username, password }) {
  const users = readUsers();

  if (users.some(u => u.username === username)) {
    throw new Error("Username already exists");
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    username,
    password,
    role: "user",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    approvedAt: null
  };

  users.push(user);
  saveUsers(users);

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
}

function getUsers() {
  return readUsers().map(({ password, ...user }) => user);
}

function updateUserStatus(id, status) {
  const users = readUsers();
  const user = users.find(u => u.id === id);

  if (!user) {
    throw new Error("User not found");
  }

  const allowed = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];

  if (!allowed.includes(status)) {
    throw new Error("Invalid status");
  }

  user.status = status;

  if (status === "APPROVED") {
    user.approvedAt = new Date().toISOString();
  }

  saveUsers(users);

  const { password, ...safeUser } = user;
  return safeUser;
}

module.exports = {
  createUser,
  getUsers,
  updateUserStatus
};
