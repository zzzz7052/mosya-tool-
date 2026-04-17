/**
 * 模写スタジオ - メインアプリケーションロジック
 *
 * 機能:
 * - 画像のアップロード・表示
 * - Screen Wake Lock APIによるスリープ防止
 * - ズーム（ホイール対応）・パン（ドラッグ移動）
 * - 左右反転・上下反転・回転
 * - グレースケール・色反転フィルター
 * - 明るさ・コントラスト調整
 * - グリッドオーバーレイ
 * - 模写タイマー
 */

(function () {
  'use strict';

  // ============================
  // DOM要素の取得
  // ============================
  const $ = (sel) => document.querySelector(sel);
  const viewerScreen = $('#viewer-screen');
  const fileInput = $('#file-input');
  const refImage = $('#reference-image');
  const imageContainer = $('#image-container');
  const canvasArea = $('#canvas-area');
  const dropMessage = $('#drop-message');
  const gridOverlay = $('#grid-overlay');
  const thumbnailSidebar = $('#thumbnail-sidebar');
  const thumbnailList = $('#thumbnail-list');
  const toast = $('#toast');
  const toastMessage = $('#toast-message');

  // ツールバー
  const imageName = $('#image-name');
  const wakeLockToggle = $('#wake-lock-toggle');
  const wakeLockLabel = $('#wake-lock-label');
  const btnFullscreen = $('#btn-fullscreen');

  // コントロール
  const btnZoomOut = $('#btn-zoom-out');
  const btnZoomIn = $('#btn-zoom-in');
  const btnZoomFit = $('#btn-zoom-fit');
  const zoomValue = $('#zoom-value');
  const btnFlipH = $('#btn-flip-h');
  const btnFlipV = $('#btn-flip-v');
  const btnRotate = $('#btn-rotate');
  const btnGrayscale = $('#btn-grayscale');
  const btnInvert = $('#btn-invert');
  const btnGrid = $('#btn-grid');
  const gridSizeSelect = $('#grid-size');
  const btnCenterLine = $('#btn-center-line');
  const imageTimerDisplay = $('#image-timer-display');
  const btnReset = $('#btn-reset');
  const btnToggleThumbnails = $('#btn-toggle-thumbnails');

  // ============================
  // 状態管理
  // ============================
  const state = {
    // 画像管理
    imagesList: [],
    currentImageIndex: -1,

    // 画像変換
    zoom: 1,
    panX: 0,
    panY: 0,
    flipH: false,
    flipV: false,
    rotation: 0,

    // フィルター
    grayscale: false,
    invertColors: false,
    brightness: 100,
    contrast: 100,

    // グリッド
    gridVisible: false,
    gridSize: 3,
    centerLineVisible: false,


    // 画像ごとの表示タイマー（オート）
    imageTimerSeconds: 0,
    imageTimerInterval: null,

    // インタラクション
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0,

    // Wake Lock
    wakeLock: null,
    wakeLockActive: true,

    // UIの表示状態
    uiVisible: true,
    uiHideTimeout: null,
  };

  // ============================
  // IndexedDB 管理
  // ============================
  const DB_NAME = 'MosyaStudioDB';
  const STORE_NAME = 'images';
  const DB_VERSION = 1;
  let dbPromise = null;

  function initDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
        };
      });
    }
    return dbPromise;
  }

  async function saveImageToDB(file) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const data = {
        name: file.name,
        file: file,
        timestamp: Date.now()
      };
      const request = store.add(data);
      request.onsuccess = (e) => {
        data.id = e.target.result;
        resolve(data);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteImageFromDB(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function loadAllImagesFromDB() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ============================
  // Wake Lock（スリープ防止）
  // ============================
  async function requestWakeLock(silent = false) {
    try {
      if ('wakeLock' in navigator) {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLockActive = true;
        wakeLockToggle.classList.add('active');
        wakeLockLabel.textContent = 'スリープ防止: ON';
        if (!silent) showToast('🔒 スリープ防止が有効になりました');

        // ページの可視性が変わった際に再取得
        state.wakeLock.addEventListener('release', () => {
          state.wakeLockActive = false;
          wakeLockToggle.classList.remove('active');
          wakeLockLabel.textContent = 'スリープ防止: OFF';
        });
      } else {
        // Wake Lock API非対応ブラウザのフォールバック
        startFallbackWakeLock();
        if (!silent) showToast('🔒 スリープ防止（互換モード）が有効になりました');
      }
    } catch (err) {
      console.warn('Wake Lock取得失敗:', err);
      startFallbackWakeLock();
      if (!silent) showToast('🔒 スリープ防止（互換モード）が有効になりました');
    }
  }

  async function releaseWakeLock() {
    try {
      if (state.wakeLock) {
        await state.wakeLock.release();
        state.wakeLock = null;
      }
      stopFallbackWakeLock();
      state.wakeLockActive = false;
      wakeLockToggle.classList.remove('active');
      wakeLockLabel.textContent = 'スリープ防止: OFF';
      showToast('🔓 スリープ防止が無効になりました');
    } catch (err) {
      console.warn('Wake Lock解放失敗:', err);
    }
  }

  wakeLockToggle.addEventListener('click', () => {
    if (state.wakeLockActive) {
      releaseWakeLock();
    } else {
      requestWakeLock();
    }
  });

  // フォールバック: 非表示のvideoを再生してスリープ防止
  let fallbackVideo = null;
  function startFallbackWakeLock() {
    if (fallbackVideo) return;
    fallbackVideo = document.createElement('video');
    fallbackVideo.setAttribute('playsinline', '');
    fallbackVideo.setAttribute('muted', '');
    fallbackVideo.muted = true;
    fallbackVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';

    // 小さなダミー動画をインラインで生成（Base64の最小mp4）
    // 1x1px, 1フレーム, 無音のmp4
    const base64Mp4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0AAAA1m1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAPoAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAACYdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAIAAAACAAAAAAkaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAAAAAAG6bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAenN0YmwAAABec3RzZAAAAAAAAAABAAAATmF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAIAAgASAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAABRzdHRzAAAAAAAAAAAAAAAPc3RzYwAAAAAAAAAAAAAACHN0c3oAAAAAAAAAAAAAAAAAD3N0Y28AAAAAAAAAAAAAAAA=';
    fallbackVideo.src = 'data:video/mp4;base64,' + base64Mp4;
    fallbackVideo.loop = true;
    document.body.appendChild(fallbackVideo);
    fallbackVideo.play().catch(() => {});

    state.wakeLockActive = true;
    wakeLockToggle.classList.add('active');
    wakeLockLabel.textContent = 'スリープ防止: ON';
  }

  function stopFallbackWakeLock() {
    if (fallbackVideo) {
      fallbackVideo.pause();
      fallbackVideo.remove();
      fallbackVideo = null;
    }
  }

  // ページ再表示時にWake Lockを再取得
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.wakeLockActive && !state.wakeLock) {
      try {
        if ('wakeLock' in navigator) {
          state.wakeLock = await navigator.wakeLock.request('screen');
          state.wakeLock.addEventListener('release', () => {
            if (state.wakeLockActive) {
              state.wakeLock = null;
            }
          });
        }
      } catch (err) {
        console.warn('Wake Lock再取得失敗:', err);
      }
    }
  });

  // ============================
  // ファイルアップロード
  // ============================
  dropMessage.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadImages(e.target.files);
    }
    // 同じファイルも連続で再選択できるようにリセット
    fileInput.value = '';
  });

  // ドラッグ＆ドロップを画面全体で受け付ける
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropMessage.classList.add('drag-over');
  });

  document.body.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null || e.target === document.body) {
      dropMessage.classList.remove('drag-over');
    }
  });

  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    dropMessage.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      loadImages(e.dataTransfer.files);
    }
  });

  async function loadImages(files) {
    let newImagesAdded = false;
    
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      
      try {
        const savedData = await saveImageToDB(file);
        const objectUrl = URL.createObjectURL(file);
        state.imagesList.push({
          id: savedData.id,
          name: file.name,
          src: objectUrl,
          file: file
        });
        newImagesAdded = true;
      } catch (e) {
        console.warn('画像の保存に失敗:', e);
      }
    }

    if (newImagesAdded) {
      updateThumbnails();
      showToast('🖼️ 画像を追加しました');
      
      // 追加した直後に一番最後の（最新の）画像を表示する
      selectImage(state.imagesList.length - 1);
    } else {
      showToast('⚠️ 画像ファイルを選択してください');
    }
  }

  function selectImage(index) {
    if (index < 0 || index >= state.imagesList.length) return;
    state.currentImageIndex = index;
    const imgData = state.imagesList[index];

    refImage.onload = () => {
      imageName.textContent = imgData.name;
      dropMessage.classList.add('hidden');
      imageContainer.classList.remove('hidden');
      resetAllState();
      fitImageToView();
      highlightActiveThumbnail();

      // 画像切り替え時にタイマーをリセットして開始
      stopImageTimer();
      state.imageTimerSeconds = 0;
      updateImageTimerDisplay();
      startImageTimer();
    };
    refImage.src = imgData.src;
  }

  function updateThumbnails() {
    thumbnailList.innerHTML = '';
    
    if (state.imagesList.length > 0) {
      thumbnailSidebar.classList.remove('hidden');
    } else {
      thumbnailSidebar.classList.add('hidden');
    }

    state.imagesList.forEach((imgData, index) => {
      const item = document.createElement('div');
      item.className = 'thumbnail-item';
      if (index === state.currentImageIndex) item.classList.add('active');
      
      const img = document.createElement('img');
      img.src = imgData.src;
      img.alt = imgData.name;

      const delBtn = document.createElement('button');
      delBtn.className = 'thumbnail-del-btn';
      delBtn.innerHTML = '×';
      delBtn.title = '削除';
      
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteImage(imgData.id, index);
      });
      
      item.appendChild(img);
      item.appendChild(delBtn);
      
      item.addEventListener('click', () => {
        if (state.currentImageIndex !== index || dropMessage.classList.contains('hidden') === false) {
          selectImage(index);
        }
      });
      
      thumbnailList.appendChild(item);
    });

    // 新規画像追加ボタン
    const addBtn = document.createElement('div');
    addBtn.className = 'thumbnail-add-btn';
    if (state.currentImageIndex === -1) {
      addBtn.classList.add('active');
    }
    
    // アイコンとテキスト
    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span>追加</span>
    `;
    
    addBtn.addEventListener('click', () => {
      if (state.currentImageIndex !== -1) {
        showDropScreen();
      }
    });
    
    thumbnailList.appendChild(addBtn);
  }

  function showDropScreen() {
    state.currentImageIndex = -1;
    imageContainer.classList.add('hidden');
    dropMessage.classList.remove('hidden');
    imageName.textContent = '画像をドラッグ＆ドロップしてください';
    updateThumbnails();
  }

  async function deleteImage(id, index) {
    try {
      if (id !== undefined) {
        await deleteImageFromDB(id);
      }
    } catch (e) {
      console.warn('DBから画像削除失敗:', e);
    }

    const imgData = state.imagesList[index];
    URL.revokeObjectURL(imgData.src);
    state.imagesList.splice(index, 1);

    if (state.imagesList.length === 0) {
      state.currentImageIndex = -1;
      imageContainer.classList.add('hidden');
      dropMessage.classList.remove('hidden');
      imageName.textContent = '画像をドラッグ＆ドロップしてください';
      stopTimerIfRunning();
    } else {
      if (state.currentImageIndex === index) {
        state.currentImageIndex = Math.min(index, state.imagesList.length - 1);
        selectImage(state.currentImageIndex);
      } else if (state.currentImageIndex > index) {
        state.currentImageIndex--;
      }
    }
    updateThumbnails();
  }

  function stopTimerIfRunning() {
    stopImageTimer();
  }

  function highlightActiveThumbnail() {
    const items = thumbnailList.querySelectorAll('.thumbnail-item');
    items.forEach((item, index) => {
      item.classList.toggle('active', index === state.currentImageIndex);
      if (index === state.currentImageIndex) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // 追加ボタンのハイライト処理
    const addBtn = thumbnailList.querySelector('.thumbnail-add-btn');
    if (addBtn) {
      addBtn.classList.toggle('active', state.currentImageIndex === -1);
      if (state.currentImageIndex === -1) {
        addBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  // ============================
  // ズーム制御
  // ============================
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 10;
  const ZOOM_STEP = 0.1;

  function setZoom(newZoom, centerX, centerY) {
    const oldZoom = state.zoom;
    state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));

    // ズーム中心を基準にパンを調整
    if (centerX !== undefined && centerY !== undefined) {
      const zoomRatio = state.zoom / oldZoom;
      state.panX = centerX - (centerX - state.panX) * zoomRatio;
      state.panY = centerY - (centerY - state.panY) * zoomRatio;
    }

    updateTransform();
    zoomValue.textContent = Math.round(state.zoom * 100) + '%';
  }

  function fitImageToView() {
    const areaRect = canvasArea.getBoundingClientRect();
    const imgW = refImage.naturalWidth;
    const imgH = refImage.naturalHeight;

    if (!imgW || !imgH) return;

    const padding = 40;
    const availW = areaRect.width - padding * 2;
    const availH = areaRect.height - padding * 2;

    const scale = Math.min(availW / imgW, availH / imgH, 1);
    state.zoom = scale;
    state.panX = 0;
    state.panY = 0;

    updateTransform();
    zoomValue.textContent = Math.round(state.zoom * 100) + '%';
  }

  btnZoomIn.addEventListener('click', () => setZoom(state.zoom + ZOOM_STEP));
  btnZoomOut.addEventListener('click', () => setZoom(state.zoom - ZOOM_STEP));
  btnZoomFit.addEventListener('click', fitImageToView);

  // マウスホイールでズーム
  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const centerX = e.clientX - rect.left - rect.width / 2;
    const centerY = e.clientY - rect.top - rect.height / 2;

    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    // ズームが大きい時はステップも大きくする
    const dynamicStep = delta * Math.max(1, state.zoom * 0.5);
    setZoom(state.zoom + dynamicStep, centerX, centerY);
  }, { passive: false });

  // ============================
  // パン（ドラッグ移動）
  // ============================
  canvasArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    state.isDragging = true;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;
    state.panX = state.panStartX + (e.clientX - state.dragStartX);
    state.panY = state.panStartY + (e.clientY - state.dragStartY);
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    state.isDragging = false;
  });

  // ============================
  // 画像変換（反転・回転）
  // ============================
  btnFlipH.addEventListener('click', () => {
    state.flipH = !state.flipH;
    btnFlipH.classList.toggle('active', state.flipH);
    updateTransform();
    showToast(state.flipH ? '⇔ 左右反転' : '⇔ 左右反転 解除');
  });

  btnFlipV.addEventListener('click', () => {
    state.flipV = !state.flipV;
    btnFlipV.classList.toggle('active', state.flipV);
    updateTransform();
    showToast(state.flipV ? '⇕ 上下反転' : '⇕ 上下反転 解除');
  });

  btnRotate.addEventListener('click', () => {
    state.rotation = (state.rotation + 90) % 360;
    updateTransform();
    showToast(`↻ ${state.rotation}° 回転`);
  });

  // ============================
  // フィルター
  // ============================
  btnGrayscale.addEventListener('click', () => {
    state.grayscale = !state.grayscale;
    btnGrayscale.classList.toggle('active', state.grayscale);
    updateFilters();
    showToast(state.grayscale ? '🎨 グレースケール ON' : '🎨 グレースケール OFF');
  });

  btnInvert.addEventListener('click', () => {
    state.invertColors = !state.invertColors;
    btnInvert.classList.toggle('active', state.invertColors);
    updateFilters();
    showToast(state.invertColors ? '🔄 色反転 ON' : '🔄 色反転 OFF');
  });

  function updateFilters() {
    const filters = [];
    if (state.grayscale) filters.push('grayscale(100%)');
    if (state.invertColors) filters.push('invert(100%)');

    refImage.style.filter = filters.length > 0 ? filters.join(' ') : 'none';
  }

  // ============================
  // トランスフォーム更新
  // ============================
  function updateTransform() {
    const transforms = [];
    transforms.push(`translate(${state.panX}px, ${state.panY}px)`);
    transforms.push(`scale(${state.zoom})`);
    if (state.rotation !== 0) transforms.push(`rotate(${state.rotation}deg)`);
    if (state.flipH) transforms.push('scaleX(-1)');
    if (state.flipV) transforms.push('scaleY(-1)');

    imageContainer.style.transform = transforms.join(' ');
  }

  // ============================
  // グリッドオーバーレイと中央線
  // ============================
  btnGrid.addEventListener('click', () => {
    state.gridVisible = !state.gridVisible;
    btnGrid.classList.toggle('active', state.gridVisible);
    
    if (state.gridVisible || state.centerLineVisible) {
      gridOverlay.classList.remove('hidden');
      updateGrid();
    } else {
      gridOverlay.classList.add('hidden');
    }
    showToast(state.gridVisible ? '📐 グリッド ON' : '📐 グリッド OFF');
  });

  gridSizeSelect.addEventListener('change', () => {
    state.gridSize = parseInt(gridSizeSelect.value);
    if (state.gridVisible) updateGrid();
  });

  btnCenterLine.addEventListener('click', () => {
    state.centerLineVisible = !state.centerLineVisible;
    btnCenterLine.classList.toggle('active', state.centerLineVisible);
    
    if (state.gridVisible || state.centerLineVisible) {
      gridOverlay.classList.remove('hidden');
      updateGrid();
    } else {
      gridOverlay.classList.add('hidden');
    }
    showToast(state.centerLineVisible ? '⌖ 中央線強調 ON' : '⌖ 中央線強調 OFF');
  });

  function updateGrid() {
    gridOverlay.innerHTML = '';
    
    if (state.gridVisible) {
      const n = state.gridSize;
      for (let i = 1; i < n; i++) {
        const pct = (i / n) * 100;
        const hLine = document.createElement('div');
        hLine.className = 'grid-line-h';
        hLine.style.top = pct + '%';
        gridOverlay.appendChild(hLine);

        const vLine = document.createElement('div');
        vLine.className = 'grid-line-v';
        vLine.style.left = pct + '%';
        gridOverlay.appendChild(vLine);
      }
    }

    if (state.centerLineVisible) {
      const centerH = document.createElement('div');
      centerH.className = 'grid-line-center h';
      gridOverlay.appendChild(centerH);

      const centerV = document.createElement('div');
      centerV.className = 'grid-line-center v';
      gridOverlay.appendChild(centerV);
    }
  }




  // ============================
  // 画像表示時間タイマー（バックグラウンド）
  // ============================
  function startImageTimer() {
    if (state.imageTimerInterval) {
      clearInterval(state.imageTimerInterval);
    }
    
    updateImageTimerDisplay();

    state.imageTimerInterval = setInterval(() => {
      state.imageTimerSeconds++;
      updateImageTimerDisplay();
    }, 1000);
  }

  function stopImageTimer() {
    if (state.imageTimerInterval) {
      clearInterval(state.imageTimerInterval);
      state.imageTimerInterval = null;
    }
  }

  function updateImageTimerDisplay() {
    if (!imageTimerDisplay) return;
    const formatTime = (seconds) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return h > 0 ? 
        `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}` : 
        `${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    imageTimerDisplay.textContent = formatTime(state.imageTimerSeconds);
  }

  // ============================
  // リセット
  // ============================
  btnReset.addEventListener('click', () => {
    resetAllState();
    fitImageToView();
    showToast('🔄 リセットしました');
  });

  function resetAllState() {
    state.flipH = false;
    state.flipV = false;
    state.rotation = 0;
    state.grayscale = false;
    state.invertColors = false;
    state.brightness = 100;
    state.contrast = 100;
    state.gridVisible = false;
    state.centerLineVisible = false;
    state.panX = 0;
    state.panY = 0;

    // UIの更新
    btnFlipH.classList.remove('active');
    btnFlipV.classList.remove('active');
    btnGrayscale.classList.remove('active');
    btnInvert.classList.remove('active');
    btnGrid.classList.remove('active');
    btnCenterLine.classList.remove('active');
    gridOverlay.classList.add('hidden');

    // 画像表示タイマーも一旦ストップ（画像選択時に再開されるため）
    stopImageTimer();

    updateFilters();
    updateTransform();
    zoomValue.textContent = '100%';
  }

  // ============================
  // フルスクリーン
  // ============================
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  btnToggleThumbnails.addEventListener('click', () => {
    thumbnailSidebar.classList.toggle('collapsed');
  });

  // フルスクリーン時のUI表示制御
  let fullscreenUiTimeout = null;

  document.addEventListener('mousemove', (e) => {
    if (!document.fullscreenElement) return;
    
    document.body.classList.add('show-ui');
    if (fullscreenUiTimeout) clearTimeout(fullscreenUiTimeout);
    
    fullscreenUiTimeout = setTimeout(() => {
      document.body.classList.remove('show-ui');
    }, 2500);
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      document.body.classList.add('is-fullscreen');
      document.body.classList.add('show-ui');
      // フルスクリーン化時に自動でサムネイルを隠す
      thumbnailSidebar.classList.add('collapsed');
      
      if (fullscreenUiTimeout) clearTimeout(fullscreenUiTimeout);
      fullscreenUiTimeout = setTimeout(() => {
        document.body.classList.remove('show-ui');
      }, 2500);
    } else {
      document.body.classList.remove('is-fullscreen');
      document.body.classList.remove('show-ui');
      thumbnailSidebar.classList.remove('collapsed');
    }
  });

  // ============================
  // キーボードショートカット
  // ============================
  document.addEventListener('keydown', (e) => {
    // ビューア画面のみ
    if (viewerScreen.classList.contains('hidden')) return;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        setZoom(state.zoom + ZOOM_STEP);
        break;
      case '-':
        e.preventDefault();
        setZoom(state.zoom - ZOOM_STEP);
        break;
      case '0':
        e.preventDefault();
        fitImageToView();
        break;
      case 'h':
        state.flipH = !state.flipH;
        btnFlipH.classList.toggle('active', state.flipH);
        updateTransform();
        break;
      case 'v':
        state.flipV = !state.flipV;
        btnFlipV.classList.toggle('active', state.flipV);
        updateTransform();
        break;
      case 'r':
        state.rotation = (state.rotation + 90) % 360;
        updateTransform();
        break;
      case 'g':
        state.grayscale = !state.grayscale;
        btnGrayscale.classList.toggle('active', state.grayscale);
        updateFilters();
        break;
      case 'f':
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        break;
      case 'Escape':
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          showLanding();
        }
        break;
    }
  });

  // ============================
  // トースト通知
  // ============================
  let toastTimeout = null;
  function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    // 強制リフロー
    void toast.offsetWidth;
    toast.classList.add('show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
  }

  // ============================
  // 初期化
  // ============================
  // ウィンドウリサイズ時にフィットし直す
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!viewerScreen.classList.contains('hidden')) {
        // リサイズ完了後にフィット（任意）
      }
    }, 200);
  });

  // 右クリックメニューを無効化（画像保護）
  canvasArea.addEventListener('contextmenu', (e) => e.preventDefault());

  async function initApp() {
    try {
      const savedImages = await loadAllImagesFromDB();
      if (savedImages && savedImages.length > 0) {
        savedImages.forEach((data) => {
          const objectUrl = URL.createObjectURL(data.file);
          state.imagesList.push({
            id: data.id,
            name: data.name,
            src: objectUrl,
            file: data.file
          });
        });
        updateThumbnails();
        showToast(`📁 以前の画像（${savedImages.length}枚）を読み込みました`);
      }
    } catch (e) {
      console.warn('DBからの画像読み込みに失敗:', e);
    }

    // スリープ防止をデフォルトONにする（通知なし）
    requestWakeLock(true);

    console.log('🎨 模写スタジオ 初期化完了');
  }

  initApp();
})();
