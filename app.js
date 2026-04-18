// ===== CONFIGURATION — edit these values =====
const CONFIG = {
  REGION: "us-east-1",
  IDENTITY_POOL_ID: "us-east-1:e9dce307-e5bc-4924-acf4-2f875452dbfc",
  BUCKET: "ankita-photos-upload",
  PREFIX: "uploads/",
  PASSWORD: "photos2026",
  MAX_FILE_SIZE_MB: 50,
};

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
const historyList = $("history-list");
const clearHistoryBtn = $("clear-history-btn");

// ===== Toast Notifications =====
function showToast(message, type, duration) {
  type = type || "success";
  duration = duration || 4000;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = type;
  toastTimer = setTimeout(function() { toast.className = "hidden"; }, duration);
}

// ===== Password Gate =====
function checkSession() {
  if (sessionStorage.getItem("photo_auth") === "true") {
    showUploadSection();
  }
}

passwordForm.addEventListener("submit", function(e) {
  e.preventDefault();
  if (passwordInput.value === CONFIG.PASSWORD) {
    sessionStorage.setItem("photo_auth", "true");
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

    var key = CONFIG.PREFIX + Date.now() + "-" + Math.random().toString(36).substr(2, 6) + "-" + sanitizeFilename(file.name);

    var params = {
      Bucket: CONFIG.BUCKET,
      Key: key,
      Body: file,
      ContentType: file.type,
    };

    var progressBar = card.querySelector(".progress-bar");

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
          saveToHistory({ name: file.name, size: file.size, key: key, uploadedAt: new Date().toISOString() });
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
  historyCount.textContent = history.length;

  historyList.innerHTML = "";
  history.forEach(function(entry, i) {
    var row = document.createElement("div");
    row.className = "history-row";

    var info = document.createElement("div");
    info.className = "history-info";
    var date = new Date(entry.uploadedAt);
    info.innerHTML = '<span class="history-name">' + escapeHtml(entry.name) + '</span><span class="history-meta">' + formatSize(entry.size) + " \u00B7 " + formatDate(date) + "</span>";

    var deleteBtn = document.createElement("button");
    deleteBtn.className = "history-delete";
    deleteBtn.textContent = "Remove";
    deleteBtn.addEventListener("click", (function(idx, key) {
      return function() { deleteUpload(idx, key); };
    })(i, entry.key));

    row.append(info, deleteBtn);
    historyList.appendChild(row);
  });

  clearHistoryBtn.classList.toggle("hidden", history.length < 2);
}

function deleteUpload(index, key) {
  var row = historyList.children[index];
  var btn = row.querySelector(".history-delete");
  btn.textContent = "Removing...";
  btn.disabled = true;

  s3.deleteObject({ Bucket: CONFIG.BUCKET, Key: key }, function(err) {
    if (err) console.warn("S3 delete failed (file may already be gone):", err);

    var history = getHistory();
    history.splice(index, 1);
    localStorage.setItem("photo_uploads", JSON.stringify(history));
    renderHistory();
    showToast("File removed", "success", 3000);
  });
}

clearHistoryBtn.addEventListener("click", function() {
  localStorage.removeItem("photo_uploads");
  renderHistory();
});

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
