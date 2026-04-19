// CONFIG is loaded from config.js

// AWS Setup
AWS.config.region = CONFIG.REGION;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: CONFIG.IDENTITY_POOL_ID,
});
var s3 = new AWS.S3({ apiVersion: "2006-03-01" });

// State
var isAdmin = sessionStorage.getItem("photo_admin") === "true";
var currentIndex = -1;
var photoList = []; // unified list used for rendering

// DOM
var photoGrid = document.getElementById("photo-grid");
var emptyState = document.getElementById("empty-state");
var viewerTitle = document.getElementById("viewer-title");
var viewerCount = document.getElementById("viewer-count");
var viewerLoading = document.getElementById("viewer-loading");
var lightbox = document.getElementById("lightbox");
var lightboxImg = document.getElementById("lightbox-img");
var lightboxName = document.getElementById("lightbox-name");
var lightboxMeta = document.getElementById("lightbox-meta");
var lightboxClose = document.getElementById("lightbox-close");
var lightboxPrev = document.getElementById("lightbox-prev");
var lightboxNext = document.getElementById("lightbox-next");
var lightboxDelete = document.getElementById("lightbox-delete");

// History helpers
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("photo_uploads") || "[]");
  } catch (e) {
    return [];
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function getSignedUrl(key) {
  return s3.getSignedUrl("getObject", {
    Bucket: CONFIG.BUCKET,
    Key: key,
    Expires: 3600,
  });
}

// ===== Load photos =====
function loadPhotos(callback) {
  if (isAdmin) {
    // Admin: list all objects from S3
    viewerTitle.innerHTML = 'All Photos <span class="admin-badge">Admin</span>';
    viewerLoading.classList.remove("hidden");
    listAllObjects([], null, function(objects) {
      viewerLoading.classList.add("hidden");
      // Sort by key (which contains timestamp) descending
      objects.sort(function(a, b) { return b.Key.localeCompare(a.Key); });
      photoList = objects.map(function(obj) {
        // Extract original filename from key: uploads/TIMESTAMP-RANDOM-filename.jpg
        var parts = obj.Key.replace(CONFIG.PREFIX, "").split("-");
        var name = parts.length > 2 ? parts.slice(2).join("-") : obj.Key;
        return {
          key: obj.Key,
          name: name,
          size: obj.Size,
          lastModified: obj.LastModified,
        };
      });
      callback();
    });
  } else {
    // Normal user: use localStorage history
    viewerTitle.textContent = "Your Photos";
    photoList = getHistory();
    callback();
  }
}

function listAllObjects(accumulated, continuationToken, callback) {
  var params = {
    Bucket: CONFIG.BUCKET,
    Prefix: CONFIG.PREFIX,
    MaxKeys: 1000,
  };
  if (continuationToken) {
    params.ContinuationToken = continuationToken;
  }
  s3.listObjectsV2(params, function(err, data) {
    if (err) {
      console.error("Failed to list objects:", err);
      callback(accumulated);
      return;
    }
    var objects = accumulated.concat(data.Contents || []);
    if (data.IsTruncated) {
      listAllObjects(objects, data.NextContinuationToken, callback);
    } else {
      callback(objects);
    }
  });
}

// ===== Render grid =====
function renderGrid() {
  if (photoList.length === 0) {
    emptyState.classList.remove("hidden");
    photoGrid.innerHTML = "";
    viewerCount.textContent = "";
    return;
  }

  emptyState.classList.add("hidden");
  var label = isAdmin ? " total photos in cloud" : " photo" + (photoList.length !== 1 ? "s" : "") + " from this device";
  viewerCount.textContent = photoList.length + label;

  photoGrid.innerHTML = "";
  photoList.forEach(function(entry, i) {
    var tile = document.createElement("div");
    tile.className = "photo-tile";

    var fileName = entry.name || entry.key || "";
    var isVideo = fileName.toLowerCase().match(/\.(mp4|mov|webm|avi)$/);

    if (isVideo) {
      var placeholder = document.createElement("div");
      placeholder.className = "tile-loading";
      placeholder.textContent = "\uD83C\uDFAC";
      placeholder.style.fontSize = "1.5rem";
      tile.appendChild(placeholder);

      var badge = document.createElement("div");
      badge.className = "video-badge";
      badge.textContent = "VIDEO";
      tile.appendChild(badge);
    } else {
      var loading = document.createElement("div");
      loading.className = "tile-loading";
      loading.textContent = "Loading...";
      tile.appendChild(loading);

      var img = document.createElement("img");
      img.alt = fileName;
      img.loading = "lazy";
      img.style.opacity = "0";
      img.style.transition = "opacity 0.3s";
      tile.appendChild(img);

      (function(imgEl, loadingEl, key) {
        var url = getSignedUrl(key);
        imgEl.onload = function() {
          imgEl.style.opacity = "1";
          if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
        };
        imgEl.onerror = function() {
          loadingEl.textContent = "Failed";
          imgEl.style.display = "none";
        };
        imgEl.src = url;
      })(img, loading, entry.key);
    }

    tile.addEventListener("click", (function(idx) {
      return function() { openLightbox(idx); };
    })(i));

    photoGrid.appendChild(tile);
  });
}

// ===== Lightbox =====
function openLightbox(index) {
  if (index < 0 || index >= photoList.length) return;

  currentIndex = index;
  var entry = photoList[index];

  lightboxImg.src = getSignedUrl(entry.key);
  lightboxName.textContent = entry.name || entry.key;

  var metaParts = [];
  if (entry.size) metaParts.push(formatSize(entry.size));
  if (entry.uploadedAt) metaParts.push(formatDate(new Date(entry.uploadedAt)));
  else if (entry.lastModified) metaParts.push(formatDate(new Date(entry.lastModified)));
  lightboxMeta.textContent = metaParts.join(" \u00B7 ");

  lightboxPrev.style.display = index > 0 ? "" : "none";
  lightboxNext.style.display = index < photoList.length - 1 ? "" : "none";

  // Show delete button only for admin
  if (isAdmin) {
    lightboxDelete.classList.remove("hidden");
    lightboxDelete.disabled = false;
    lightboxDelete.textContent = "Delete Photo";
  } else {
    lightboxDelete.classList.add("hidden");
  }

  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  document.body.style.overflow = "";
  lightboxImg.src = "";
  currentIndex = -1;
}

lightboxClose.addEventListener("click", closeLightbox);

lightbox.addEventListener("click", function(e) {
  if (e.target === lightbox || e.target.id === "lightbox-content") {
    closeLightbox();
  }
});

lightboxPrev.addEventListener("click", function(e) {
  e.stopPropagation();
  if (currentIndex > 0) openLightbox(currentIndex - 1);
});

lightboxNext.addEventListener("click", function(e) {
  e.stopPropagation();
  if (currentIndex < photoList.length - 1) openLightbox(currentIndex + 1);
});

document.addEventListener("keydown", function(e) {
  if (lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") lightboxPrev.click();
  if (e.key === "ArrowRight") lightboxNext.click();
});

// Admin delete
lightboxDelete.addEventListener("click", function(e) {
  e.stopPropagation();
  if (!isAdmin || currentIndex < 0 || currentIndex >= photoList.length) return;

  var entry = photoList[currentIndex];
  lightboxDelete.textContent = "Deleting...";
  lightboxDelete.disabled = true;

  s3.deleteObject({ Bucket: CONFIG.BUCKET, Key: entry.key }, function(err) {
    if (err) {
      console.error("Delete failed:", err);
      lightboxDelete.textContent = "Failed - try again";
      lightboxDelete.disabled = false;
      return;
    }

    photoList.splice(currentIndex, 1);
    closeLightbox();
    renderGrid();
  });
});

// ===== Init =====
AWS.config.credentials.get(function(err) {
  if (err) {
    console.error("Failed to get credentials:", err);
    viewerCount.textContent = "Failed to load credentials. Please refresh.";
    return;
  }
  loadPhotos(renderGrid);
});
