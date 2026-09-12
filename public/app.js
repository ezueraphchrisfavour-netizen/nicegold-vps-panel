"use strict";


/* =====================================================
   HELPERS
===================================================== */

const $ = (id) =>
  document.getElementById(id);

const $$ = (selector) =>
  document.querySelectorAll(selector);


function safeNumber(value) {
  return Number.isFinite(Number(value))
    ? Number(value)
    : 0;
}


function clamp(
  value,
  min = 0,
  max = 100
) {
  return Math.min(
    Math.max(
      safeNumber(value),
      min
    ),
    max
  );
}


function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


async function getJSON(
  url,
  options = {}
) {

  const response =
    await fetch(
      url,
      {
        cache: "no-store",
        ...options
      }
    );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`
    );
  }

  return response.json();
}


/* =====================================================
   PAGE NAVIGATION
===================================================== */

const pageNames = {

  dashboard: "Dashboard",
  servers: "Servers",
  monitoring: "Monitoring",
  network: "Network",
  services: "Services",
  console: "Console",
  logs: "Activity",
  security: "Security",
  backups: "Backups",
  settings: "Settings"

};


function openSection(section) {

  const target =
    $(section);

  if (!target) {
    return;
  }


  $$(".page-section")
    .forEach(page => {

      page.classList.remove(
        "active"
      );

    });


  target.classList.add(
    "active"
  );


  $$(".nav-item")
    .forEach(item => {

      item.classList.toggle(
        "active",
        item.dataset.section === section
      );

    });


  $$(".mobile-nav button")
    .forEach(item => {

      item.classList.toggle(
        "active",
        item.dataset.section === section
      );

    });


  $("pageTitle").textContent =
    pageNames[section] ||
    "Dashboard";


  closeMobileMenu();


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


$$("[data-section]")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const section =
          button.dataset.section;

        if (section) {
          openSection(section);
        }

      }
    );

  });


/* =====================================================
   MOBILE MENU
===================================================== */

function toggleMobileMenu() {

  $("sidebar")
    .classList.toggle("open");

  $("mobileOverlay")
    .classList.toggle("show");

}


function closeMobileMenu() {

  $("sidebar")
    .classList.remove("open");

  $("mobileOverlay")
    .classList.remove("show");

}


$("menuButton")
  ?.addEventListener(
    "click",
    toggleMobileMenu
  );


$("mobileOverlay")
  ?.addEventListener(
    "click",
    closeMobileMenu
  );


$("mobileMore")
  ?.addEventListener(
    "click",
    toggleMobileMenu
  );


/* =====================================================
   CLOCK
===================================================== */

function updateClock() {

  const now =
    new Date();

  if ($("topClock")) {

    $("topClock")
      .textContent =
      now.toLocaleTimeString();

  }

  if ($("topDate")) {

    $("topDate")
      .textContent =
      now.toLocaleDateString(
        undefined,
        {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }
      );

  }

}


updateClock();

setInterval(
  updateClock,
  1000
);


/* =====================================================
   CHART ENGINE
===================================================== */

const history = {

  cpu: [],
  ram: [],
  disk: []

};


const MAX_POINTS = 32;


function pushHistory(
  key,
  value
) {

  history[key].push(
    clamp(value)
  );

  if (
    history[key].length >
    MAX_POINTS
  ) {

    history[key].shift();

  }

}


function drawChart(
  canvas,
  values,
  options = {}
) {

  if (!canvas) {
    return;
  }


  const rect =
    canvas.getBoundingClientRect();

  const width =
    Math.max(
      rect.width,
      50
    );

  const height =
    Math.max(
      rect.height,
      30
    );


  const dpr =
    window.devicePixelRatio ||
    1;


  canvas.width =
    width * dpr;

  canvas.height =
    height * dpr;


  const ctx =
    canvas.getContext("2d");


  ctx.scale(
    dpr,
    dpr
  );


  ctx.clearRect(
    0,
    0,
    width,
    height
  );


  const points =
    values.length > 1
      ? values
      : [0, 0];


  /* Grid */

  ctx.strokeStyle =
    "rgba(255,255,255,.055)";

  ctx.lineWidth = 1;

  for (
    let i = 1;
    i < 4;
    i++
  ) {

    const y =
      (height / 4) * i;

    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      width,
      y
    );

    ctx.stroke();

  }


  /* Line */

  const color =
    options.color ||
    "#ddd";


  ctx.strokeStyle =
    color;

  ctx.lineWidth =
    options.lineWidth ||
    1.4;

  ctx.lineJoin =
    "round";

  ctx.lineCap =
    "round";


  ctx.beginPath();


  points.forEach(
    (value, index) => {

      const x =
        (index /
          (points.length - 1)) *
        width;

      const y =
        height -
        (clamp(value) / 100) *
        height;

      if (index === 0) {

        ctx.moveTo(
          x,
          y
        );

      } else {

        ctx.lineTo(
          x,
          y
        );

      }

    }
  );


  ctx.stroke();


  /* Fill */

  if (options.fill) {

    ctx.lineTo(
      width,
      height
    );

    ctx.lineTo(
      0,
      height
    );

    ctx.closePath();

    const gradient =
      ctx.createLinearGradient(
        0,
        0,
        0,
        height
      );

    gradient.addColorStop(
      0,
      "rgba(255,255,255,.10)"
    );

    gradient.addColorStop(
      1,
      "rgba(255,255,255,0)"
    );

    ctx.fillStyle =
      gradient;

    ctx.fill();

  }

}


function redrawCharts() {

  drawChart(
    $("cpuChart"),
    history.cpu,
    {
      color: "#ddd",
      fill: true
    }
  );


  drawChart(
    $("ramChart"),
    history.ram,
    {
      color: "#aaa",
      fill: true
    }
  );


  drawChart(
    $("diskChart"),
    history.disk,
    {
      color: "#777",
      fill: true
    }
  );


  drawChart(
    $("mainChart"),
    history.cpu,
    {
      color: "#ddd",
      fill: true
    }
  );


  drawChart(
    $("monitorChart"),
    history.cpu,
    {
      color: "#ddd",
      fill: true
    }
  );

}


window.addEventListener(
  "resize",
  redrawCharts
);


/* =====================================================
   DASHBOARD DATA
===================================================== */

async function loadDashboard() {

  try {

    const data =
      await getJSON(
        "/api/dashboard"
      );


    const cpu =
      data.cpu;

    const memory =
      data.memory;

    const disk =
      data.disk;


    /*
      Linux load average isn't CPU percentage.
      We estimate current utilization from
      1-minute load divided by core count.
    */

    const cpuPercent =
      clamp(
        (
          cpu.load[0] /
          Math.max(cpu.cores, 1)
        ) * 100
      );


    /* History */

    pushHistory(
      "cpu",
      cpuPercent
    );

    pushHistory(
      "ram",
      memory.percent
    );

    pushHistory(
      "disk",
      disk.percent
    );


    /* CPU */

    if ($("cpuValue")) {

      $("cpuValue")
        .textContent =
        Math.round(cpuPercent);

    }

    if ($("cpuCores")) {

      $("cpuCores")
        .textContent =
        `${cpu.cores} cores`;

    }

    if ($("cpuBar")) {

      $("cpuBar")
        .style.width =
        `${cpuPercent}%`;

    }


    /* RAM */

    if ($("ramValue")) {

      $("ramValue")
        .textContent =
        memory.percent;

    }

    if ($("ramUsed")) {

      $("ramUsed")
        .textContent =
        memory.usedFormatted;

    }

    if ($("ramTotal")) {

      $("ramTotal")
        .textContent =
        memory.totalFormatted;

    }

    if ($("ramBar")) {

      $("ramBar")
        .style.width =
        `${memory.percent}%`;

    }


    /* DISK */

    if ($("diskValue")) {

      $("diskValue")
        .textContent =
        disk.percent;

    }

    if ($("diskUsed")) {

      $("diskUsed")
        .textContent =
        disk.usedFormatted;

    }

    if ($("diskTotal")) {

      $("diskTotal")
        .textContent =
        disk.totalFormatted;

    }

    if ($("diskBar")) {

      $("diskBar")
        .style.width =
        `${disk.percent}%`;

    }


    /* Uptime */

    if ($("uptimeValue")) {

      $("uptimeValue")
        .textContent =
        data.uptime.formatted;

    }

    if ($("heroUptime")) {

      $("heroUptime")
        .textContent =
        data.uptime.formatted;

    }


    /* Server */

    if ($("heroHostname")) {

      $("heroHostname")
        .textContent =
        data.server.hostname;

    }

    if ($("heroNode")) {

      $("heroNode")
        .textContent =
        data.server.node;

    }

    if ($("heroArch")) {

      $("heroArch")
        .textContent =
        data.server.architecture;

    }


    /* Info */

    if ($("infoHostname")) {

      $("infoHostname")
        .textContent =
        data.server.hostname;

    }

    if ($("infoOS")) {

      $("infoOS")
        .textContent =
        `${data.server.platform} ${data.server.release}`;

    }

    if ($("infoArch")) {

      $("infoArch")
        .textContent =
        data.server.architecture;

    }

    if ($("infoNode")) {

      $("infoNode")
        .textContent =
        data.server.node;

    }

    if ($("infoPid")) {

      $("infoPid")
        .textContent =
        data.server.pid;

    }

    if ($("infoCpu")) {

      $("infoCpu")
        .textContent =
        cpu.cores;

    }


    /* Monitoring */

    if ($("monitorCPU")) {

      $("monitorCPU")
        .textContent =
        `${Math.round(cpuPercent)}%`;

    }

    if ($("monitorRAM")) {

      $("monitorRAM")
        .textContent =
        `${memory.percent}%`;

    }

    if ($("monitorDisk")) {

      $("monitorDisk")
        .textContent =
        `${disk.percent}%`;

    }


    if ($("monitorCPUBar")) {

      $("monitorCPUBar")
        .style.width =
        `${cpuPercent}%`;

    }

    if ($("monitorRAMBar")) {

      $("monitorRAMBar")
        .style.width =
        `${memory.percent}%`;

    }

    if ($("monitorDiskBar")) {

      $("monitorDiskBar")
        .style.width =
        `${disk.percent}%`;

    }


    redrawCharts();


  } catch (error) {

    console.error(
      "Dashboard error:",
      error
    );

  }

}


/* =====================================================
   NETWORK
===================================================== */

async function loadNetwork() {

  try {

    const data =
      await getJSON(
        "/api/network"
      );

    const interfaces =
      data.interfaces;


    if ($("networkCount")) {

      $("networkCount")
        .textContent =
        interfaces.length;

    }


    /* Dashboard table */

    if ($("dashboardNetwork")) {

      const visible =
        interfaces.slice(0, 5);

      $("dashboardNetwork")
        .innerHTML = `

          <div class="table-row header">
            <span>Interface</span>
            <span>Address</span>
            <span>Status</span>
          </div>

          ${
            visible.map(item => `
              <div class="table-row">
                <strong>
                  ${escapeHTML(item.interface)}
                </strong>

                <span>
                  ${escapeHTML(item.address)}
                </span>

                <strong class="online">
                  UP
                </strong>
              </div>
            `).join("")
          }

        `;

    }


    /* Full network page */

    if ($("networkPage")) {

      $("networkPage")
        .innerHTML =
        interfaces
          .map(item => `

            <article class="network-card panel">

              <div class="network-card-top">

                <h3>
                  ${escapeHTML(item.interface)}
                </h3>

                <span class="network-status">
                  ● UP
                </span>

              </div>

              <div class="network-address">
                ${escapeHTML(item.address)}
              </div>

              <div class="network-meta">

                <div>
                  <span>FAMILY</span>
                  <strong>
                    ${escapeHTML(item.family)}
                  </strong>
                </div>

                <div>
                  <span>NETMASK</span>
                  <strong>
                    ${escapeHTML(item.netmask || "N/A")}
                  </strong>
                </div>

                <div>
                  <span>MAC</span>
                  <strong>
                    ${escapeHTML(item.mac || "N/A")}
                  </strong>
                </div>

                <div>
                  <span>TYPE</span>
                  <strong>
                    ${item.internal ? "LOCAL" : "NETWORK"}
                  </strong>
                </div>

              </div>

            </article>

          `)
          .join("");

    }


  } catch (error) {

    console.error(
      "Network error:",
      error
    );

  }

}


/* =====================================================
   SERVICES
===================================================== */

async function loadServices() {

  try {

    const data =
      await getJSON(
        "/api/services"
      );


    if ($("dashboardServices")) {

      $("dashboardServices")
        .innerHTML =
        data.services
          .slice(0, 5)
          .map(service => `

            <div class="service-row">

              <div class="service-name">

                <i class="service-dot"></i>

                ${escapeHTML(
                  service.name
                )}

              </div>

              <span class="service-status">
                ${escapeHTML(
                  service.status
                )}
              </span>

            </div>

          `)
          .join("");

    }


    if ($("servicesPage")) {

      $("servicesPage")
        .innerHTML =
        data.services
          .map(service => `

            <article class="service-large panel">

              <div class="service-large-left">

                <div class="service-large-icon">
                  ⚙
                </div>

                <div>

                  <h3>
                    ${escapeHTML(
                      service.name
                    )}
                  </h3>

                  <p>
                    ${escapeHTML(
                      service.description
                    )}
                  </p>

                </div>

              </div>

              <div>

                <div class="service-large-status">
                  ● ${escapeHTML(
                    service.status
                  )}
                </div>

              </div>

            </article>

          `)
          .join("");

    }


  } catch (error) {

    console.error(
      "Services error:",
      error
    );

  }

}


/* =====================================================
   ACTIVITY
===================================================== */

async function loadActivity() {

  try {

    const data =
      await getJSON(
        "/api/activity"
      );


    if ($("activityFeed")) {

      $("activityFeed")
        .innerHTML =
        data.activity
          .map(item => `

            <div class="activity-item">

              <span class="activity-time">
                ${escapeHTML(item.time)}
              </span>

              <span class="activity-title">
                ${escapeHTML(item.title)}
              </span>

            </div>

          `)
          .join("");

    }


    if ($("logsPage")) {

      $("logsPage")
        .innerHTML =
        data.activity
          .map(item => `

            <div class="log-row">

              <span class="log-time">
                ${escapeHTML(item.time)}
              </span>

              <span class="log-type">
                ${escapeHTML(
                  item.type.toUpperCase()
                )}
              </span>

              <span class="log-message">
                ${escapeHTML(item.title)}
              </span>

            </div>

          `)
          .join("");

    }


  } catch (error) {

    console.error(
      "Activity error:",
      error
    );

  }

}


/* =====================================================
   SECURITY
===================================================== */

async function loadSecurity() {

  try {

    const data =
      await getJSON(
        "/api/security"
      );

    const security =
      data.security;


    if (!$("securityPage")) {
      return;
    }


    const items = [

      [
        "Panel",
        "Main control interface",
        security.panel
      ],

      [
        "Shell Access",
        "Unrestricted browser shell",
        security.arbitraryShell
          ? "ENABLED"
          : "DISABLED"
      ],

      [
        "API",
        "Monitoring API",
        security.api
      ],

      [
        "Static Files",
        "Frontend asset protection",
        security.staticFiles
      ],

      [
        "Process",
        "Server process isolation",
        security.process
      ],

      [
        "Overall",
        "Current security posture",
        security.status
      ]

    ];


    $("securityPage")
      .innerHTML =
      items
        .map(item => `

          <article class="security-card panel">

            <div class="security-icon">
              ◇
            </div>

            <h3>
              ${escapeHTML(item[0])}
            </h3>

            <p>
              ${escapeHTML(item[1])}
            </p>

            <strong>
              ${escapeHTML(item[2])}
            </strong>

          </article>

        `)
        .join("");


  } catch (error) {

    console.error(
      "Security error:",
      error
    );

  }

}


/* =====================================================
   BACKUPS
===================================================== */

async function loadBackups() {

  try {

    const data =
      await getJSON(
        "/api/backups"
      );

    const b =
      data.backup;


    if (!$("backupPage")) {
      return;
    }


    $("backupPage")
      .innerHTML = `

        <div class="backup-left">

          <div class="backup-icon">
            ◫
          </div>

          <div>

            <h2>
              Backup System
            </h2>

            <p>
              ${escapeHTML(
                b.message
              )}
            </p>

          </div>

        </div>

        <div>

          <div class="backup-status">
            STATUS:
            ${escapeHTML(b.status)}
          </div>

          <div class="backup-status">
            MODE:
            ${b.automatic
              ? "AUTOMATIC"
              : "MANUAL"}
          </div>

        </div>

      `;


  } catch (error) {

    console.error(
      "Backup error:",
      error
    );

  }

}


/* =====================================================
   SERVER PAGE
===================================================== */

async function loadServerPage() {

  try {

    const data =
      await getJSON(
        "/api/dashboard"
      );


    if ($("serverHostnamePage")) {

      $("serverHostnamePage")
        .textContent =
        data.server.hostname;

    }

    if ($("serverPlatformPage")) {

      $("serverPlatformPage")
        .textContent =
        `${data.server.platform} ${data.server.release}`;

    }

    if ($("serverArchPage")) {

      $("serverArchPage")
        .textContent =
        data.server.architecture;

    }

    if ($("serverNodePage")) {

      $("serverNodePage")
        .textContent =
        data.server.node;

    }

    if ($("serverPidPage")) {

      $("serverPidPage")
        .textContent =
        data.server.pid;

    }


  } catch (error) {

    console.error(
      "Server page error:",
      error
    );

  }

}


/* =====================================================
   CONSOLE
===================================================== */

function appendConsole(
  text,
  className = ""
) {

  const output =
    $("consoleOutput");


  if (!output) {
    return;
  }


  const line =
    document.createElement(
      "div"
    );

  line.className =
    className;

  line.textContent =
    text;

  output.appendChild(
    line
  );


  output.scrollTop =
    output.scrollHeight;

}


async function runConsoleCommand(
  command
) {

  const clean =
    String(command)
      .trim()
      .toLowerCase();


  if (!clean) {
    return;
  }


  appendConsole(
    `nicegold@vps:~$ ${clean}`,
    "console-line-command"
  );


  try {

    const data =
      await getJSON(
        "/api/console",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              command: clean
            })

        }
      );


    if (data.output) {

      data.output
        .split("\n")
        .forEach(line => {

          appendConsole(
            line
          );

        });

    }


  } catch (error) {

    appendConsole(
      "Command unavailable.",
      "console-line-error"
    );

  }

}


$("consoleForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      const input =
        $("consoleInput");

      const command =
        input.value.trim();

      if (!command) {
        return;
      }

      input.value = "";

      await runConsoleCommand(
        command
      );

      input.focus();

    }
  );


$$("[data-command]")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        const command =
          button.dataset.command;

        runConsoleCommand(
          command
        );

      }
    );

  });


/* =====================================================
   SEARCH
===================================================== */

const searchableSections = [
  "dashboard",
  "servers",
  "monitoring",
  "network",
  "services",
  "console",
  "logs",
  "security",
  "backups",
  "settings"
];


$("searchInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key !== "Enter"
      ) {
        return;
      }


      const query =
        event.target.value
          .trim()
          .toLowerCase();


      if (!query) {
        return;
      }


      const match =
        searchableSections.find(
          section =>
            section.includes(query)
        );


      if (match) {

        openSection(
          match
        );

      } else if (
        [
          "help",
          "status",
          "uptime",
          "memory",
          "disk",
          "network",
          "node",
          "hostname",
          "os",
          "cpu"
        ].includes(query)
      ) {

        openSection(
          "console"
        );

        runConsoleCommand(
          query
        );

      }

    }
  );


/* CTRL + K */

document.addEventListener(
  "keydown",
  event => {

    if (
      (event.ctrlKey ||
       event.metaKey) &&
      event.key.toLowerCase() === "k"
    ) {

      event.preventDefault();

      $("searchInput")
        ?.focus();

    }

  }
);


/* =====================================================
   NOTIFICATIONS
===================================================== */

$("notificationButton")
  ?.addEventListener(
    "click",
    () => {

      alert(
        "NICEGOLD\n\n" +
        "3 recent system events available."
      );

    }
  );


/* =====================================================
   INITIAL LOAD
===================================================== */

async function refreshAll() {

  await Promise.all([
    loadDashboard(),
    loadNetwork(),
    loadServices(),
    loadActivity(),
    loadSecurity(),
    loadBackups(),
    loadServerPage()
  ]);

}


refreshAll();


/*
  Refresh live information.
*/

setInterval(
  refreshAll,
  5000
);
