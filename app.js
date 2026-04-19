// CONFIG is loaded from config.js

// ===== AWS Setup =====
AWS.config.region = CONFIG.REGION;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: CONFIG.IDENTITY_POOL_ID,
});

const s3 = new AWS.S3({ apiVersion: "2006-03-01" });

// ===== State =====
let selectedFiles = [];
let toastTimer = null;

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const passwordSection = $("password-section");
const passwordForm = $("password-form");
const passwordInput = $("password-input");
const passwordError = $("password-error");
const uploadSection = $("upload-section");
const dropZone = $("drop-zone");
const fileInput = $("file-input");
const cameraInput = $("camera-input");
const chooseBtn = $("choose-btn");
const cameraBtn = $("camera-btn");
const uploadQueue = $("upload-queue");
const uploadBtn = $("upload-btn");
const toast = $("toast");
const historySection = $("history-section");
const historyCount = $("history-count");
const historyLatest = $("history-latest");

// ===== Toast Notifications =====
function showToast(message, type, duration) {
  type = type || "success";
  duration = duration || 4000;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = type;
  toastTimer = setTimeout(function() { toast.className = "hidden"; }, duration);
}

// ===== Landing Page =====
var landingSection = $("landing-section");
var landingContinue = $("landing-continue");

landingContinue.addEventListener("click", function() {
  landingSection.classList.add("hidden");
  passwordSection.classList.remove("hidden");
  passwordInput.focus();
});

// ===== Password Gate =====
function checkSession() {
  if (sessionStorage.getItem("photo_auth") === "true") {
    landingSection.classList.add("hidden");
    showUploadSection();
  }
}

passwordForm.addEventListener("submit", function(e) {
  e.preventDefault();
  var val = passwordInput.value;
  if (val === CONFIG.PASSWORD || val === CONFIG.PASSWORD_ADMIN) {
    sessionStorage.setItem("photo_auth", "true");
    if (val === CONFIG.PASSWORD_ADMIN) {
      sessionStorage.setItem("photo_admin", "true");
    }
    showUploadSection();
  } else {
    passwordError.classList.remove("hidden");
    passwordForm.classList.add("shake");
    setTimeout(function() { passwordForm.classList.remove("shake"); }, 400);
    passwordInput.value = "";
    passwordInput.focus();
  }
});

function showUploadSection() {
  passwordSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
}

// ===== File Selection =====
dropZone.addEventListener("click", function() { fileInput.click(); });
chooseBtn.addEventListener("click", function() { fileInput.click(); });
cameraBtn.addEventListener("click", function() { cameraInput.click(); });

fileInput.addEventListener("change", function() {
  addFiles(fileInput.files);
  fileInput.value = "";
});

cameraInput.addEventListener("change", function() {
  addFiles(cameraInput.files);
  cameraInput.value = "";
});

// Drag and drop
dropZone.addEventListener("dragenter", function(e) { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragover", function(e) { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", function() { dropZone.classList.remove("dragover"); });
dropZone.addEventListener("drop", function(e) {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
});

function addFiles(fileList) {
  var skipped = 0;
  for (var i = 0; i < fileList.length; i++) {
    var file = fileList[i];
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      skipped++;
      continue;
    }
    if (file.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) {
      showToast('"' + file.name + '" exceeds ' + CONFIG.MAX_FILE_SIZE_MB + " MB limit", "warn", 5000);
      continue;
    }
    var isDuplicate = selectedFiles.some(function(f) { return f.name === file.name && f.size === file.size; });
    if (isDuplicate) continue;
    selectedFiles.push(file);
  }
  if (skipped > 0) {
    showToast(skipped + " file" + (skipped > 1 ? "s" : "") + " skipped (unsupported format)", "warn");
  }
  renderQueue();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderQueue();
}

function renderQueue() {
  uploadQueue.innerHTML = "";
  selectedFiles.forEach(function(file, i) {
    var card = document.createElement("div");
    card.className = "file-card";
    card.dataset.index = i;

    var thumb;
    if (file.type.startsWith("image/")) {
      thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.src = URL.createObjectURL(file);
      thumb.alt = file.name;
    } else {
      thumb = document.createElement("div");
      thumb.className = "thumb";
      thumb.textContent = "\uD83C\uDFAC";
      thumb.style.display = "flex";
      thumb.style.alignItems = "center";
      thumb.style.justifyContent = "center";
      thumb.style.fontSize = "1.5rem";
    }

    var info = document.createElement("div");
    info.className = "info";
    info.innerHTML = '<div class="name">' + escapeHtml(file.name) + '</div><div class="size">' + formatSize(file.size) + "</div>";

    var removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "\u00D7";
    removeBtn.addEventListener("click", (function(idx) {
      return function(e) { e.stopPropagation(); removeFile(idx); };
    })(i));

    var progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.style.width = "0%";

    card.append(thumb, info, removeBtn, progressBar);
    uploadQueue.appendChild(card);
  });

  if (selectedFiles.length > 0) {
    uploadBtn.textContent = "Upload " + selectedFiles.length + " file" + (selectedFiles.length > 1 ? "s" : "");
    uploadBtn.classList.remove("hidden");
  } else {
    uploadBtn.classList.add("hidden");
  }
}

// ===== Upload =====
uploadBtn.addEventListener("click", function() { uploadAll(); });

function uploadAll() {
  var files = selectedFiles.slice();
  if (files.length === 0) return;

  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";

  // Hide remove buttons during upload
  document.querySelectorAll(".file-card .remove").forEach(function(b) { b.style.display = "none"; });

  var completed = 0;
  var successCount = 0;
  var errorCount = 0;

  files.forEach(function(file, index) {
    var card = uploadQueue.children[index];
    card.classList.add("uploading");

    extractExifDate(file).then(function(exifDate) {
      var timestamp;
      if (exifDate && !isNaN(exifDate.getTime())) {
        timestamp = dateToSortableString(exifDate);
      } else {
        timestamp = dateToSortableString(new Date());
      }
      var key = CONFIG.PREFIX + timestamp + "-" + Math.random().toString(36).substr(2, 6) + "-" + sanitizeFilename(file.name);

      var params = {
        Bucket: CONFIG.BUCKET,
        Key: key,
        Body: file,
        ContentType: file.type,
      };

      var progressBar = card.querySelector(".progress-bar");
      var photoDate = exifDate || new Date();

      s3.upload(params)
        .on("httpUploadProgress", function(evt) {
          if (evt.total) {
            var pct = Math.round((evt.loaded / evt.total) * 100);
            progressBar.style.width = pct + "%";
          }
        })
        .send(function(err) {
          card.classList.remove("uploading");
          var icon = document.createElement("span");
          icon.className = "status-icon";

          if (err) {
            card.classList.add("error");
            icon.textContent = "\u2717";
            icon.style.color = "var(--error)";
            console.error("Upload failed for " + file.name + ":", err);
            errorCount++;
          } else {
            card.classList.add("done");
            icon.textContent = "\u2713";
            icon.style.color = "var(--success)";
            saveToHistory({
              name: file.name,
              size: file.size,
              key: key,
              uploadedAt: new Date().toISOString(),
              takenAt: photoDate.toISOString(),
            });
            successCount++;
          }

          var removeEl = card.querySelector(".remove");
          if (removeEl) removeEl.replaceWith(icon);

          completed++;
          if (completed === files.length) {
            onAllDone(successCount, errorCount);
          }
        });
    });
  });
}

function onAllDone(successCount, errorCount) {
  if (errorCount === 0) {
    showToast(successCount + " file" + (successCount > 1 ? "s" : "") + " uploaded successfully!", "success", 5000);
    selectedFiles = [];
    setTimeout(function() {
      uploadQueue.innerHTML = "";
      uploadBtn.classList.add("hidden");
      uploadBtn.disabled = false;
    }, 2000);
  } else {
    showToast(successCount + " uploaded, " + errorCount + " failed. Please try again.", "fail", 8000);
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Retry failed";
  }
}

// ===== Upload History (localStorage) =====
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("photo_uploads") || "[]");
  } catch (e) {
    return [];
  }
}

function saveToHistory(entry) {
  var history = getHistory();
  history.unshift(entry);
  localStorage.setItem("photo_uploads", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  var history = getHistory();
  if (history.length === 0) {
    historySection.classList.add("hidden");
    return;
  }

  historySection.classList.remove("hidden");
  historyCount.textContent = history.length + " photo" + (history.length !== 1 ? "s" : "") + " uploaded";

  var latest = new Date(history[0].uploadedAt);
  historyLatest.textContent = "Last upload: " + formatDate(latest);
}

// ===== EXIF Date Extraction =====
function extractExifDate(file) {
  return new Promise(function(resolve) {
    if (!file.type || !file.type.match(/image\/jpe?g/i)) {
      resolve(null);
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var view = new DataView(e.target.result);
        // Check JPEG SOI marker
        if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }
        var offset = 2;
        while (offset < view.byteLength - 2) {
          var marker = view.getUint16(offset);
          if (marker === 0xFFE1) { // APP1 (EXIF)
            var exifDate = parseExifSegment(view, offset + 4);
            resolve(exifDate);
            return;
          }
          // Skip to next marker
          var segLen = view.getUint16(offset + 2);
          offset += 2 + segLen;
        }
        resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
    reader.onerror = function() { resolve(null); };
    // Only read first 128KB for EXIF (it's always near the start)
    reader.readAsArrayBuffer(file.slice(0, 131072));
  });
}

function parseExifSegment(view, tiffOffset) {
  // Check "Exif\0\0"
  var exifHeader = String.fromCharCode(
    view.getUint8(tiffOffset), view.getUint8(tiffOffset+1),
    view.getUint8(tiffOffset+2), view.getUint8(tiffOffset+3)
  );
  if (exifHeader !== "Exif") return null;

  var tiffStart = tiffOffset + 6;
  var byteOrder = view.getUint16(tiffStart);
  var littleEndian = (byteOrder === 0x4949); // "II"

  var ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  return findDateInIFD(view, tiffStart, tiffStart + ifdOffset, littleEndian);
}

function findDateInIFD(view, tiffStart, ifdStart, le) {
  var entries = view.getUint16(ifdStart, le);
  for (var i = 0; i < entries; i++) {
    var entryOffset = ifdStart + 2 + (i * 12);
    var tag = view.getUint16(entryOffset, le);
    // 0x9003 = DateTimeOriginal, 0x9004 = DateTimeDigitized, 0x0132 = DateTime
    if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
      var valueOffset = view.getUint32(entryOffset + 8, le);
      var dateStr = "";
      for (var j = 0; j < 19; j++) {
        dateStr += String.fromCharCode(view.getUint8(tiffStart + valueOffset + j));
      }
      // Format: "2024:06:15 14:30:22" -> Date object
      var parts = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (parts) {
        return new Date(parts[1], parts[2]-1, parts[3], parts[4], parts[5], parts[6]);
      }
    }
    // Check for EXIF sub-IFD pointer (tag 0x8769)
    if (tag === 0x8769) {
      var subIfdOffset = view.getUint32(entryOffset + 8, le);
      var result = findDateInIFD(view, tiffStart, tiffStart + subIfdOffset, le);
      if (result) return result;
    }
  }
  return null;
}

function dateToSortableString(date) {
  return date.getFullYear()
    + pad(date.getMonth() + 1) + pad(date.getDate())
    + "-" + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// ===== Helpers =====
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(date) {
  var now = new Date();
  var diffMs = now - date;
  var diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return diffMins + "m ago";
  var diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return diffHours + "h ago";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== Init =====
checkSession();
renderHistory();
