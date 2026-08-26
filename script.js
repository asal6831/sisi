/* ============================================================
   Watch Party - script.js
   قبل از استفاده، مقدار firebaseConfig پایین رو با اطلاعات
   پروژه‌ی Firebase خودت جایگزین کن (توضیحات کامل در README.md)
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

/* ---------- ابزارهای عمومی ---------- */

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
  const params = new URLSearchParams(window.location.search);
  return params.get("room");
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

/* ---------- عناصر ---------- */

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

let currentRoomId = null;
let isRemoteChange = false;
let hasLoadedVideoSrc = false;
let lastSentTime = 0;

/* ---------- شروع: دکمه‌ی "بریم فیلم ببینیم" ---------- */

startBtn.addEventListener("click", () => {
  const roomIdInUrl = getRoomIdFromUrl();
  if (roomIdInUrl) {
    // پارتنر لینک دعوت رو باز کرده -> مستقیم وارد پخش فیلم بشه
    currentRoomId = roomIdInUrl;
    showScreen("player");
    joinRoom(currentRoomId);
  } else {
    // اولین نفر -> باید لینک فیلم رو وارد کنه
    showScreen("setup");
  }
});

/* ---------- ساخت Room ---------- */

createRoomBtn.addEventListener("click", () => {
  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    alert("لطفاً لینک فیلم رو وارد کن 🎬");
    return;
  }

  currentRoomId = generateRoomId();
  const subtitleUrl = subtitleUrlInput.value.trim();

  db.ref("rooms/" + currentRoomId).set({
    videoUrl: videoUrl,
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

/* ---------- کپی لینک دعوت ---------- */

copyBtn.addEventListener("click", () => {
  inviteLinkInput.select();
  inviteLinkInput.setSelectionRange(0, 99999);
  navigator.clipboard
    .writeText(inviteLinkInput.value)
    .then(() => {
      copyBtn.textContent = "کپی شد ✅";
      setTimeout(() => (copyBtn.textContent = "کپی 📋"), 2000);
    })
    .catch(() => {
      // fallback برای مرورگرهای قدیمی
      document.execCommand("copy");
    });
});

/* ---------- ورود سازنده‌ی روم به صفحه‌ی پخش ---------- */

goToPlayerBtn.addEventListener("click", () => {
  showScreen("player");
  joinRoom(currentRoomId);
});

/* ---------- زیرنویس ---------- */

function srtToVtt(srtText) {
  const cleaned = srtText.replace(/\r+/g, "");
  const body = cleaned
    .replace(/^\d+\s*\n(?=\d{2}:\d{2}:\d{2})/gm, "") // حذف شماره‌ی ترتیب خط‌ها
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"); // تبدیل کاما به نقطه در زمان
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
    if (videoPlayer.textTracks[0]) {
      videoPlayer.textTracks[0].mode = "showing";
    }
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
    const url = URL.createObjectURL(blob);
    setSubtitleTrack(url);
  };
  reader.readAsText(file);
});

/* ---------- باز کردن قفل Autoplay با یک کلیک واقعی کاربر ---------- */

unlockBtn.addEventListener("click", () => {
  videoPlayer.style.display = "block";
  unlockBtn.style.display = "none";

  videoPlayer
    .play()
    .then(() => {
      // اگر هنوز طبق وضعیت فعلی روم قرار نیست پخش بشه، متوقفش کن
      videoPlayer.pause();
    })
    .catch(() => {
      // مهم نیست؛ همین کلیک برای باز شدن قفل مرورگر کافیه
    });
});

/* ---------- پیوستن به یک Room و همگام‌سازی ---------- */

function joinRoom(roomId) {
  const roomRef = db.ref("rooms/" + roomId);

  roomRef.on("value", (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      statusText.textContent = "این Room پیدا نشد 😢";
      return;
    }

    // بار اول: لینک ویدیو رو ست کن
    if (!hasLoadedVideoSrc) {
      videoPlayer.src = data.videoUrl;
      hasLoadedVideoSrc = true;
      if (data.subtitleUrl) {
        setSubtitleTrack(data.subtitleUrl);
      }
    }

    isRemoteChange = true;

    // همگام‌سازی زمان (اگر اختلاف بیشتر از ۱.۵ ثانیه بود)
    if (Math.abs(videoPlayer.currentTime - data.currentTime) > 1.5) {
      videoPlayer.currentTime = data.currentTime;
    }

    // همگام‌سازی play / pause
    if (data.isPlaying && videoPlayer.paused) {
      videoPlayer
        .play()
        .then(() => {
          statusText.textContent = "در حال پخش با هم ❤️";
        })
        .catch(() => {
          statusText.textContent = "برای پخش، یک‌بار روی ویدیو بزن ▶️";
        });
    } else if (!data.isPlaying && !videoPlayer.paused) {
      videoPlayer.pause();
      statusText.textContent = "فیلم متوقف شده ⏸️";
    }

    setTimeout(() => {
      isRemoteChange = false;
    }, 300);
  });

  /* رویدادهای محلی -> ارسال به Firebase */

  videoPlayer.addEventListener("play", () => {
    if (isRemoteChange) return;
    roomRef.update({
      isPlaying: true,
      currentTime: videoPlayer.currentTime,
      updatedAt: Date.now(),
    });
  });

  videoPlayer.addEventListener("pause", () => {
    if (isRemoteChange) return;
    roomRef.update({
      isPlaying: false,
      currentTime: videoPlayer.currentTime,
      updatedAt: Date.now(),
    });
  });

  videoPlayer.addEventListener("seeked", () => {
    if (isRemoteChange) return;
    roomRef.update({
      currentTime: videoPlayer.currentTime,
      updatedAt: Date.now(),
    });
  });

  // هر ۳ ثانیه، اگر در حال پخشه، زمان رو برای هماهنگی بیشتر آپدیت کن
  setInterval(() => {
    if (isRemoteChange || videoPlayer.paused) return;
    if (Math.abs(videoPlayer.currentTime - lastSentTime) < 2) return;
    lastSentTime = videoPlayer.currentTime;
    roomRef.update({
      currentTime: videoPlayer.currentTime,
      updatedAt: Date.now(),
    });
  }, 3000);

  statusText.textContent = "متصل شد، منتظر پارتنرت... 💌";
}
