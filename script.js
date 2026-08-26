/* ============================================================
   Watch Party - script.js
   MKV support: browser-native playback is attempted first.
   If the browser cannot play MKV, ffmpeg.wasm converts the remote
   MKV to a browser-friendly MP4 locally in the browser.
   ============================================================ */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDLXAuoEF7oJki62MVAWmi6kqEl8yCQ_EE",
  authDomain: "asal-d127b.firebaseapp.com",
  databaseURL: "https://asal-d127b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "asal-d127b",
  storageBucket: "asal-d127b.firebasestorage.app",
  messagingSenderId: "683243354000",
  appId: "1:683243354000:web:367e637ff1e3da70862515",
  measurementId: "G-2E70TE70BB"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const screens = {
  landing: document.getElementById("landing"),
  setup: document.getElementById("setup"),
  inviteBox: document.getElementById("inviteBox"),
  player: document.getElementById("player"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

function getRoomIdFromUrl() {
  return new URLSearchParams(window.location.search).get("room");
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

const startBtn = document.getElementById("startBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const videoUrlInput = document.getElementById("videoUrlInput");
const subtitleUrlInput = document.getElementById("subtitleUrlInput");
const inviteLinkInput = document.getElementById("inviteLinkInput");
const copyBtn = document.getElementById("copyBtn");
const goToPlayerBtn = document.getElementById("goToPlayerBtn");
const videoPlayer = document.getElementById("videoPlayer");
const statusText = document.getElementById("statusText");
const unlockBtn = document.getElementById("unlockBtn");
const subtitleFileInput = document.getElementById("subtitleFileInput");
const convertMkvBtn = document.getElementById("convertMkvBtn");
const conversionProgress = document.getElementById("conversionProgress");

let currentRoomId = null;
let roomRef = null;
let roomValueHandler = null;
let isRemoteChange = false;
let hasLoadedVideoSrc = false;
let lastSentTime = 0;
let currentSourceUrl = null;
let currentObjectUrl = null;
let ffmpeg = null;
let ffmpegLoaded = false;
let conversionPromise = null;
let roomData = null;

function isMkvUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".mkv");
  } catch {
    return /\.mkv(?:$|[?#])/i.test(url);
  }
}

function nativeVideoCanPlay(url) {
  if (!isMkvUrl(url)) return true;
  const probe = document.createElement("video");
  // Most browsers report an empty string for MKV because it is not a
  // reliably supported HTML5 container. Do not trust this as a guarantee.
  return !!probe.canPlayType('video/x-matroska; codecs="avc1"');
}

function setStatus(text, type = "normal") {
  statusText.textContent = text;
  statusText.classList.remove("error", "success", "working");
  if (type !== "normal") statusText.classList.add(type);
}

function setConversionUI(visible, disabled = false) {
  if (!convertMkvBtn) return;
  convertMkvBtn.style.display = visible ? "block" : "none";
  convertMkvBtn.disabled = disabled;
  if (conversionProgress) {
    conversionProgress.style.display = visible ? "block" : "none";
  }
}

/* ---------- Start ---------- */
startBtn.addEventListener("click", () => {
  const roomIdInUrl = getRoomIdFromUrl();
  if (roomIdInUrl) {
    currentRoomId = roomIdInUrl;
    showScreen("player");
    joinRoom(currentRoomId);
  } else {
    showScreen("setup");
  }
});

/* ---------- Create room ---------- */
createRoomBtn.addEventListener("click", async () => {
  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    alert("لطفاً لینک فیلم رو وارد کن 🎬");
    return;
  }

  currentRoomId = generateRoomId();
  const subtitleUrl = subtitleUrlInput.value.trim();

  await db.ref("rooms/" + currentRoomId).set({
    videoUrl,
    subtitleUrl: subtitleUrl || null,
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
  });

  const inviteLink =
    window.location.origin +
    window.location.pathname +
    "?room=" +
    currentRoomId;

  inviteLinkInput.value = inviteLink;
  showScreen("inviteBox");
});

/* ---------- Copy invite ---------- */
copyBtn.addEventListener("click", () => {
  inviteLinkInput.select();
  inviteLinkInput.setSelectionRange(0, 99999);
  navigator.clipboard
    .writeText(inviteLinkInput.value)
    .then(() => {
      copyBtn.textContent = "کپی شد ✅";
      setTimeout(() => (copyBtn.textContent = "کپی 📋"), 2000);
    })
    .catch(() => document.execCommand("copy"));
});

goToPlayerBtn.addEventListener("click", () => {
  showScreen("player");
  joinRoom(currentRoomId);
});

/* ---------- Subtitles ---------- */
function srtToVtt(srtText) {
  const cleaned = srtText.replace(/\r+/g, "");
  const body = cleaned
    .replace(/^\d+\s*\n(?=\d{2}:\d{2}:\d{2})/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + body;
}

function setSubtitleTrack(url) {
  const oldTrack = videoPlayer.querySelector("track");
  if (oldTrack) oldTrack.remove();

  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "زیرنویس";
  track.srclang = "fa";
  track.src = url;
  track.default = true;
  videoPlayer.appendChild(track);

  setTimeout(() => {
    if (videoPlayer.textTracks[0]) videoPlayer.textTracks[0].mode = "showing";
  }, 200);
}

subtitleFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let text = reader.result;
    if (file.name.toLowerCase().endsWith(".srt")) {
      text = srtToVtt(text);
    } else if (!text.trim().startsWith("WEBVTT")) {
      text = "WEBVTT\n\n" + text;
    }
    const blob = new Blob([text], { type: "text/vtt" });
    setSubtitleTrack(URL.createObjectURL(blob));
  };
  reader.readAsText(file);
});

/* ---------- Autoplay unlock ---------- */
unlockBtn.addEventListener("click", async () => {
  videoPlayer.style.display = "block";
  unlockBtn.style.display = "none";

  try {
    await videoPlayer.play();
    videoPlayer.pause();
    if (roomData && roomData.isPlaying) {
      await videoPlayer.play();
    }
  } catch {
    // A real user gesture was still received; future remote play can retry.
  }
});

/* ---------- MKV / ffmpeg.wasm ---------- */
async function loadFfmpeg() {
  if (ffmpegLoaded) return ffmpeg;
  if (typeof FFmpegClass === "undefined" || typeof FFmpegUtil === "undefined") {
    throw new Error("کتابخانه MKV/FFmpeg بارگذاری نشد. اینترنت یا CDN را بررسی کن.");
  }

  setStatus("در حال آماده‌سازی پشتیبانی MKV… حدود ۳۱ مگابایت دانلود می‌شود", "working");

  ffmpeg = new FFmpegClass();
  ffmpeg.on("log", ({ message }) => {
    if (/error|invalid|failed/i.test(message)) console.warn("ffmpeg:", message);
  });
  ffmpeg.on("progress", ({ progress }) => {
    if (conversionProgress) {
      conversionProgress.value = Math.max(0, Math.min(1, progress || 0));
    }
    if (progress > 0) {
      setStatus(`در حال تبدیل MKV به MP4… ${Math.round(progress * 100)}٪`, "working");
    }
  });

  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await FFmpegUtil.toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await FFmpegUtil.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegLoaded = true;
  return ffmpeg;
}

async function convertMkvToMp4(url) {
  if (conversionPromise) return conversionPromise;

  conversionPromise = (async () => {
    try {
      setConversionUI(true, true);
      if (conversionProgress) conversionProgress.value = 0;

      const engine = await loadFfmpeg();

      setStatus("در حال دانلود فیلم برای تبدیل… این مرحله ممکن است طول بکشد", "working");
      let inputData;
      try {
        inputData = await FFmpegUtil.fetchFile(url);
      } catch (err) {
        throw new Error(
          "مرورگر اجازه دانلود فایل MKV از این سرور را نداد. سرور فیلم باید CORS را برای سایت شما فعال کند."
        );
      }

      // Use H.264/AAC because this combination is broadly supported by
      // Android Chrome and iPhone Safari. Faststart lets playback begin sooner.
      await engine.writeFile("input.mkv", inputData);
      await engine.exec([
        "-i", "input.mkv",
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "output.mp4"
      ]);

      const output = await engine.readFile("output.mp4");
      const blob = new Blob([output.buffer], { type: "video/mp4" });
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(blob);

      setConversionUI(false);
      setStatus("MKV آماده شد؛ حالا فیلم را پخش کن ❤️", "success");
      return currentObjectUrl;
    } catch (err) {
      console.error(err);
      setConversionUI(true, false);
      setStatus(
        err?.message || "تبدیل MKV انجام نشد. لطفاً لینک مستقیم فایل و CORS را بررسی کن.",
        "error"
      );
      throw err;
    } finally {
      conversionPromise = null;
    }
  })();

  return conversionPromise;
}

convertMkvBtn?.addEventListener("click", async () => {
  if (!currentSourceUrl) return;
  try {
    const convertedUrl = await convertMkvToMp4(currentSourceUrl);
    videoPlayer.src = convertedUrl;
    videoPlayer.load();
    videoPlayer.style.display = "block";
    unlockBtn.style.display = "block";
  } catch {
    // Error already shown to user.
  }
});

async function prepareVideo(url) {
  currentSourceUrl = url;

  // For normal web formats, use the original URL directly.
  if (!isMkvUrl(url)) {
    videoPlayer.src = url;
    videoPlayer.load();
    videoPlayer.style.display = "block";
    unlockBtn.style.display = "block";
    setConversionUI(false);
    return;
  }

  // Some browsers may support MKV natively. Try it first.
  if (nativeVideoCanPlay(url)) {
    videoPlayer.src = url;
    videoPlayer.load();
    videoPlayer.style.display = "block";
    unlockBtn.style.display = "block";
    setConversionUI(false);
    setStatus("MKV به‌صورت مستقیم در مرورگر در حال بارگذاری است…", "working");
    return;
  }

  // Chrome Android normally lands here.
  videoPlayer.removeAttribute("src");
  videoPlayer.load();
  videoPlayer.style.display = "none";
  unlockBtn.style.display = "none";
  setConversionUI(true, false);
  setStatus("این مرورگر MKV را مستقیم پخش نمی‌کند. روی «تبدیل MKV به MP4» بزن.", "working");
}

/* ---------- Join room & synchronization ---------- */
function joinRoom(roomId) {
  // Prevent duplicate listeners if the user returns to the player.
  if (roomRef && roomValueHandler) roomRef.off("value", roomValueHandler);

  currentRoomId = roomId;
  roomRef = db.ref("rooms/" + roomId);
  hasLoadedVideoSrc = false;

  roomValueHandler = async (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      setStatus("این Room پیدا نشد 😢", "error");
      return;
    }

    roomData = data;

    if (!hasLoadedVideoSrc) {
      hasLoadedVideoSrc = true;
      await prepareVideo(data.videoUrl);
      if (data.subtitleUrl) setSubtitleTrack(data.subtitleUrl);
    }

    isRemoteChange = true;

    if (videoPlayer.readyState >= 1 && Math.abs(videoPlayer.currentTime - data.currentTime) > 1.5) {
      try { videoPlayer.currentTime = data.currentTime || 0; } catch {}
    }

    if (data.isPlaying && videoPlayer.paused) {
      videoPlayer.play()
        .then(() => setStatus("در حال پخش با هم ❤️", "success"))
        .catch(() => setStatus("برای شروع پخش، یک‌بار روی دکمه ▶️ بزن", "working"));
    } else if (!data.isPlaying && !videoPlayer.paused) {
      videoPlayer.pause();
      setStatus("فیلم متوقف شده ⏸️");
    } else if (!data.isPlaying) {
      setStatus("متصل شد؛ منتظر پارتنرت... 💌");
    }

    setTimeout(() => { isRemoteChange = false; }, 350);
  };

  roomRef.on("value", roomValueHandler);

  // Attach local listeners only once.
  if (!videoPlayer.dataset.syncListenersAttached) {
    videoPlayer.dataset.syncListenersAttached = "true";

    videoPlayer.addEventListener("play", () => {
      if (isRemoteChange || !roomRef) return;
      roomRef.update({
        isPlaying: true,
        currentTime: videoPlayer.currentTime,
        updatedAt: Date.now(),
      });
    });

    videoPlayer.addEventListener("pause", () => {
      if (isRemoteChange || !roomRef) return;
      roomRef.update({
        isPlaying: false,
        currentTime: videoPlayer.currentTime,
        updatedAt: Date.now(),
      });
    });

    videoPlayer.addEventListener("seeked", () => {
      if (isRemoteChange || !roomRef) return;
      roomRef.update({
        currentTime: videoPlayer.currentTime,
        updatedAt: Date.now(),
      });
    });

    videoPlayer.addEventListener("loadedmetadata", () => {
      if (roomData && Math.abs(videoPlayer.currentTime - (roomData.currentTime || 0)) > 1.5) {
        try { videoPlayer.currentTime = roomData.currentTime || 0; } catch {}
      }
    });

    videoPlayer.addEventListener("error", () => {
      const mediaError = videoPlayer.error;
      console.error("Video error:", mediaError);
      if (isMkvUrl(currentSourceUrl) && !currentObjectUrl) {
        setConversionUI(true, false);
        setStatus("پخش MKV ناموفق بود؛ برای تبدیل به MP4 دکمه را بزن.", "error");
      } else {
        setStatus("ویدیو قابل پخش نیست؛ فرمت یا لینک فایل را بررسی کن.", "error");
      }
    });
  }

  setStatus("متصل شد؛ در حال آماده‌سازی فیلم... 💌");
}

/* ---------- Periodic sync ---------- */
setInterval(() => {
  if (isRemoteChange || !roomRef || videoPlayer.paused) return;
  if (Math.abs(videoPlayer.currentTime - lastSentTime) < 2) return;
  lastSentTime = videoPlayer.currentTime;
  roomRef.update({
    currentTime: videoPlayer.currentTime,
    updatedAt: Date.now(),
  });
}, 3000);
