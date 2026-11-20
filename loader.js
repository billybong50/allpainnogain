(function () {
  "use strict";

  const BASE = "./";
  const TOTAL_BYTES = 160.54 * 1048576;

  const originalFetch = window.fetch.bind(window);
  const mergedData = {};
  const pendingRequests = {};
  let bytesLoadedSoFar = 0;

  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const loaderFill = document.getElementById("loaderFill");
  const loaderPercent = document.getElementById("loaderPercent");

  function formatMB(bytes) {
    return (bytes / 1048576).toFixed(2);
  }

  function setStatus(percent, message) {
    const safePercent = Math.max(8, Math.min(100, Math.round(percent)));
    loaderFill.style.width = safePercent + "%";
    loaderPercent.textContent = safePercent + "%";
    statusText.textContent = message;
  }

  function updateDownloadStatus() {
    const percent = Math.round((bytesLoadedSoFar / TOTAL_BYTES) * 85);
    setStatus(
      Math.max(8, Math.min(85, percent)),
      "Downloading files " + formatMB(bytesLoadedSoFar) + " / 160.54 MB"
    );
  }

  function hideStatus() {
    setStatus(100, "Game ready.");
    setTimeout(function () {
      statusEl.classList.add("hidden");
    }, 600);
  }

  window.fetch = function (url, ...args) {
    const u = String(url);

    // The bundled game data calls out to the publisher's own CMS on startup
    // to fetch in-game announcements/news. It always fails here (the
    // sandboxed page has a null origin, which the remote CORS policy
    // rejects) and just spams the console. Short-circuit it locally instead
    // of letting it hit the network.
    if (u.includes("blobfishgames.com")) {
      return Promise.reject(new Error("Announcements disabled."));
    }

    if (u.includes("Brotato.pck") || u.includes("Brotato.wasm")) {
      const fileName = u.includes(".pck") ? "Brotato.pck" : "Brotato.wasm";

      if (mergedData[fileName]) {
        return Promise.resolve(new Response(mergedData[fileName], {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        }));
      }

      return new Promise(function (resolve) {
        if (!pendingRequests[fileName]) pendingRequests[fileName] = [];
        pendingRequests[fileName].push(resolve);
      });
    }

    return originalFetch(url, ...args);
  };

  async function merge(name, start, end) {
    const buffers = [];

    for (let i = start; i <= end; i++) {
      const url = BASE + encodeURIComponent(name + ".part" + i);
      const response = await originalFetch(url);

      if (!response.ok) {
        throw new Error("Failed loading " + url);
      }

      const data = await response.arrayBuffer();
      buffers.push(data);
      bytesLoadedSoFar += data.byteLength;
      updateDownloadStatus();
    }

    const blob = new Blob(buffers, { type: "application/octet-stream" });
    mergedData[name] = blob;

    if (pendingRequests[name]) {
      pendingRequests[name].forEach(function (resolve) {
        resolve(new Response(blob, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        }));
      });

      delete pendingRequests[name];
    }
  }

  async function fetchSingle(name) {
    const url = BASE + encodeURIComponent(name);
    const response = await originalFetch(url);

    if (!response.ok) {
      throw new Error("Failed loading " + url);
    }

    const data = await response.arrayBuffer();
    bytesLoadedSoFar += data.byteLength;
    updateDownloadStatus();

    const blob = new Blob([data], { type: "application/octet-stream" });
    mergedData[name] = blob;

    if (pendingRequests[name]) {
      pendingRequests[name].forEach(function (resolve) {
        resolve(new Response(blob, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        }));
      });

      delete pendingRequests[name];
    }
  }

  function forceCanvasFit() {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;

    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.maxWidth = "100vw";
    canvas.style.maxHeight = "100vh";
    canvas.style.display = "block";
    canvas.style.background = "#000";
  }

  // Brotato's saved settings default to fullscreen, so the Godot engine calls
  // canvas.requestFullscreen() on its own (fires on the first click inside
  // the iframe). When framed, fullscreen should only come from the host
  // page's fullscreen button, so neuter the engine's request on the canvas.
  function blockEngineFullscreen() {
    if (window.self === window.top) return;
    const canvas = document.getElementById("canvas");
    if (!canvas) return;

    const noop = function () { return Promise.resolve(); };
    ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen",
     "mozRequestFullScreen", "mozRequestFullscreen", "msRequestFullscreen"
    ].forEach(function (name) {
      try {
        Object.defineProperty(canvas, name, { configurable: true, writable: true, value: noop });
      } catch (e) {}
    });
  }

  blockEngineFullscreen();

  window.addEventListener("resize", forceCanvasFit);
  window.addEventListener("orientationchange", forceCanvasFit);
  setInterval(forceCanvasFit, 1000);

  async function init() {
    try {
      setStatus(8, "Preparing All Pain No Gain files...");

      await merge("Brotato.pck", 0, 8);
      await fetchSingle("Brotato.wasm");

      setStatus(88, "Starting Brotato engine...");

      const script = document.createElement("script");
      script.src = BASE + "Brotato.js";

      script.onload = function () {
        try {
          const engine = new Engine({
            args: [],
            canvasResizePolicy: 2,
            executable: "Brotato",
            experimentalVK: false,
            fileSizes: {
              "Brotato.pck": 147972096,
              "Brotato.wasm": 19796835
            },
            focusCanvas: true,
            gdnativeLibs: []
          });

          engine.startGame({
            onProgress: function (current, total) {
              if (total > 0) {
                const enginePercent = Math.round((current / total) * 10);
                setStatus(88 + enginePercent, "Starting game engine...");
              }
            }
          }).then(function () {
            hideStatus();
            forceCanvasFit();
            window.dispatchEvent(new Event("resize"));
          }).catch(function (err) {
            console.error("Brotato engine failed.", err);
            setStatus(100, "Load error. Refresh and try again.");
          });
        } catch (err) {
          console.error("Brotato startup failed.", err);
          setStatus(100, "Load error. Refresh and try again.");
        }
      };

      script.onerror = function () {
        setStatus(100, "Load error. Game script failed.");
      };

      document.body.appendChild(script);
    } catch (err) {
      console.error("Brotato load failed.", err);
      setStatus(100, "Load error. Refresh and try again.");
    }
  }

  init();
})();
