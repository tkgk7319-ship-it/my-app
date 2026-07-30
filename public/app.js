// Frontend logic for Smart Receipt application

// State variables
let availableTags = [];
let scannedItems = [];
let currentDashboardMonth = new Date(); // Defaults to today
let currentTrendPeriod = 'day'; // 'day', 'week', 'month'
let mediaStream = null;

// DOM Elements
const views = {
  auth: document.getElementById('auth-view'),
  dashboard: document.getElementById('dashboard-view'),
  scan: document.getElementById('scan-view'),
  history: document.getElementById('history-view'),
  settings: document.getElementById('settings-view')
};

// --- Auth Logic ---
let currentToken = localStorage.getItem('auth_token') || null;

function getAuthHeaders(isJson = true) {
  const headers = {};
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  if (isJson) headers['Content-Type'] = 'application/json';
  return headers;
}

// --- Chart Instances ---
let categoryChartInstance = null;
let dailyChartInstance = null;
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";

const navButtons = {
  dashboard: document.getElementById('nav-dashboard'),
  scan: document.getElementById('nav-scan'),
  manual: document.getElementById('nav-manual'),
  history: document.getElementById('nav-history'),
  settings: document.getElementById('nav-settings')
};

// Toast Notification System
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Slide out and remove
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('ja-JP').format(amount);
}

// Smoothly animate number change
function animateNumber(element, start, end, duration = 800) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    // Ease out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.floor(easeProgress * (end - start) + start);
    element.textContent = formatCurrency(currentValue);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      element.textContent = formatCurrency(end);
    }
  };
  window.requestAnimationFrame(step);
}

// View switching logic
function switchView(viewName) {
  if (viewName === 'manual') {
    // Treat 'manual' as a special case of 'scan' view
    switchView('scan');
    
    // Override nav active state
    if (navButtons['scan']) navButtons['scan'].classList.remove('active');
    if (navButtons['manual']) navButtons['manual'].classList.add('active');
    
    // Setup manual input UI
    const uploadZone = document.getElementById('scan-upload-area');
    const scanResultArea = document.getElementById('scan-result-area');
    const scanLoading = document.getElementById('scan-loading');
    
    // Change titles
    const viewTitle = document.getElementById('scan-view-title');
    const viewSubtitle = document.getElementById('scan-view-subtitle');
    const itemsTitle = document.getElementById('scan-items-title');
    if (viewTitle) viewTitle.innerHTML = '<i class="fa-solid fa-keyboard" style="margin-right:10px;"></i>手動入力';
    if (viewSubtitle) viewSubtitle.textContent = '手動で商品名や金額を入力して家計簿に保存します';
    if (itemsTitle) itemsTitle.innerHTML = '<i class="fa-solid fa-list-check"></i>入力する商品一覧';
    
    if (uploadZone) uploadZone.style.display = 'none';
    if (scanLoading) scanLoading.style.display = 'none';
    if (scanResultArea) scanResultArea.style.display = 'block';

    const defaultTag = availableTags.find(t => t.name === 'その他') || availableTags[0];
    const defaultTagId = defaultTag ? defaultTag.id : null;

    scannedItems = [{
      name: '',
      unit_price: 0,
      quantity: 1,
      amount: 0,
      is_selected: 1,
      tag_id: defaultTagId
    }];

    document.getElementById('expense-date').valueAsDate = new Date();
    document.getElementById('expense-memo').value = '';

    renderOcrItems();
    return;
  }

  // Hide all views, remove active from all nav buttons
  Object.values(views).forEach(view => {
    if (view) view.classList.remove('active');
  });
  Object.values(navButtons).forEach(btn => {
    if (btn) btn.classList.remove('active');
  });
  
  // Show target view and set button active
  if (views[viewName]) views[viewName].classList.add('active');
  if (navButtons[viewName]) navButtons[viewName].classList.add('active');
  
  // Reset scan view to upload state if switching to standard scan
  if (viewName === 'scan') {
    const uploadZone = document.getElementById('scan-upload-area');
    const scanResultArea = document.getElementById('scan-result-area');
    const scanLoading = document.getElementById('scan-loading');
    if (uploadZone) uploadZone.style.display = 'block';
    if (scanLoading) scanLoading.style.display = 'none';
    if (scanResultArea) scanResultArea.style.display = 'none';

    // Reset titles
    const viewTitle = document.getElementById('scan-view-title');
    const viewSubtitle = document.getElementById('scan-view-subtitle');
    const itemsTitle = document.getElementById('scan-items-title');
    if (viewTitle) viewTitle.textContent = 'レシート読込';
    if (viewSubtitle) viewSubtitle.textContent = '画像から商品を読み取って保存します';
    if (itemsTitle) itemsTitle.innerHTML = '<i class="fa-solid fa-list-check"></i>読み取った商品一覧';
  }

  // Terminate camera if switching away from scan view
  if (viewName !== 'scan' && viewName !== 'manual') {
    stopCamera();
  }

  // Trigger loading relevant data
  if (viewName === 'dashboard') {
    loadDashboardData();
  } else if (viewName === 'history') {
    setDefaultHistoryDates();
    loadHistoryData();
  } else if (viewName === 'settings') {
    loadSettingsData();
  }
}

// Setup Nav Event Listeners
Object.keys(navButtons).forEach(key => {
  if (navButtons[key]) {
    navButtons[key].addEventListener('click', () => switchView(key));
  }
});

// Logout Listener
const logoutBtn = document.getElementById('nav-logout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('auth_token');
    currentToken = null;
    document.querySelector('.app-header').style.display = 'none';
    switchView('auth');
  });
}

// --- TAGS RETRIEVAL ---
async function fetchTags() {
  try {
    const response = await fetch('/api/tags', { headers: getAuthHeaders() });
    if (!response.ok) throw new Error('Failed to fetch tags');
    availableTags = await response.json();
  } catch (err) {
    console.error('Error loading tags:', err);
    showToast('タグ情報の読み込みに失敗しました。', 'error');
  }
}

// --- DASHBOARD CONTROLLERS ---
async function loadDashboardData() {
  const year = currentDashboardMonth.getFullYear();
  const month = String(currentDashboardMonth.getMonth() + 1).padStart(2, '0');
  
  // Calculate first and last day of the month
  const startDate = `${year}-${month}-01`;
  const lastDay = new Date(year, currentDashboardMonth.getMonth() + 1, 0).getDate();
  const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

  document.getElementById('month-display').textContent = `${year}年${month}月`;
  document.getElementById('dashboard-period-label').textContent = `期間: ${year}/${month}/01 - ${year}/${month}/${lastDay}`;

  try {
    const response = await fetch(`/api/expenses?start_date=${startDate}&end_date=${endDate}`, { headers: getAuthHeaders() });
    if (!response.ok) {
      if (response.status === 401) {
        // Unauthorized, redirect to login
        document.querySelector('.app-header').style.display = 'none';
        switchView('auth');
        return;
      }
      throw new Error('Failed to fetch monthly expenses');
    }
    const data = await response.json();

    // 1. Render Total Amount
    const totalDisplay = document.getElementById('dashboard-total-amount');
    const currentVal = parseInt(totalDisplay.textContent.replace(/,/g, ''), 10) || 0;
    animateNumber(totalDisplay, currentVal, data.total_spent);

    // 2. Render Charts
    renderCategoryChart(data.categories, data.total_spent);
    // Render Trend Chart separately based on selected period
    loadTrendChart(currentTrendPeriod);

    // 3. Render Recent Expenses
    renderRecentExpenses(data.expenses);

  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('ダッシュボードデータの読み込みに失敗しました。', 'error');
  }
}

function renderCategoryChart(categories, totalAmount) {
  const ctx = document.getElementById('category-chart');
  if (!ctx) return;
  
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  if (!categories || categories.length === 0 || totalAmount === 0) {
    categoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['データなし'],
        datasets: [{
          data: [1],
          backgroundColor: ['rgba(255, 255, 255, 0.05)'],
          borderWidth: 0
        }]
      },
      options: {
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
    return;
  }

  const labels = categories.map(cat => cat.name);
  const data = categories.map(cat => cat.amount);
  const bgColors = categories.map(cat => cat.color);

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderColor: '#080b16', // match background
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#ffffff', padding: 20 }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const perc = Math.round((val / totalAmount) * 100);
              return ` ${context.label}: ¥${formatCurrency(val)} (${perc}%)`;
            }
          }
        }
      }
    }
  });
}

// Load and Render Trend Chart
async function loadTrendChart(period) {
  currentTrendPeriod = period;
  
  // Calculate date range based on period
  const today = new Date();
  let startDate = '';
  let endDate = '';
  
  if (period === 'day') {
    // Current viewed month (same as dashboard)
    const year = currentDashboardMonth.getFullYear();
    const month = String(currentDashboardMonth.getMonth() + 1).padStart(2, '0');
    startDate = `${year}-${month}-01`;
    const lastDay = new Date(year, currentDashboardMonth.getMonth() + 1, 0).getDate();
    endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  } else if (period === 'week') {
    // Last 3 months for weekly
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0); // End of this month
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1); // Start of 2 months ago (3 months total)
    startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  } else if (period === 'month') {
    // Last 12 months for monthly
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1);
    startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  }

  try {
    const response = await fetch(`/api/expenses?start_date=${startDate}&end_date=${endDate}`, { headers: getAuthHeaders() });
    if (!response.ok) throw new Error('Failed to fetch trend data');
    const data = await response.json();
    
    // Grouping logic
    let groupedData = {};
    
    // Initialize groupedData with 0 for all intervals in the date range
    const startDt = new Date(startDate);
    const endDt = new Date(endDate);
    let currentDt = new Date(startDt);

    if (period === 'day') {
      while (currentDt <= endDt) {
        const key = `${currentDt.getFullYear()}-${String(currentDt.getMonth() + 1).padStart(2, '0')}-${String(currentDt.getDate()).padStart(2, '0')}`;
        groupedData[key] = 0;
        currentDt.setDate(currentDt.getDate() + 1);
      }
    } else if (period === 'week') {
      // Find the first Monday on or before startDt
      let day = currentDt.getDay();
      let diff = currentDt.getDate() - day + (day === 0 ? -6 : 1);
      currentDt = new Date(currentDt.setDate(diff));
      
      // Adjust endDt to the Monday of its week to ensure we cover it
      let endDay = endDt.getDay();
      let endDiff = endDt.getDate() - endDay + (endDay === 0 ? -6 : 1);
      let adjustedEndDt = new Date(endDt.getTime());
      adjustedEndDt.setDate(endDiff);
      
      while (currentDt <= adjustedEndDt) {
        const key = `${currentDt.getFullYear()}-${String(currentDt.getMonth() + 1).padStart(2, '0')}-${String(currentDt.getDate()).padStart(2, '0')}`;
        groupedData[key] = 0;
        currentDt.setDate(currentDt.getDate() + 7);
      }
    } else if (period === 'month') {
      currentDt.setDate(1);
      const endMonthDt = new Date(endDt.getTime());
      endMonthDt.setDate(1);
      while (currentDt <= endMonthDt) {
        const key = `${currentDt.getFullYear()}-${String(currentDt.getMonth() + 1).padStart(2, '0')}`;
        groupedData[key] = 0;
        currentDt.setMonth(currentDt.getMonth() + 1);
      }
    }
    
    data.expenses.forEach(exp => {
      let key = '';
      if (period === 'day') {
        key = exp.date;
      } else if (period === 'week') {
        // Group by "Week starting Monday"
        const d = new Date(exp.date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      } else if (period === 'month') {
        key = exp.date.substring(0, 7); // YYYY-MM
      }
      
      if (groupedData[key] !== undefined) {
        groupedData[key] += exp.total_amount;
      } else {
        // In case an expense falls slightly outside (e.g., end of month edge cases in weekly)
        groupedData[key] = exp.total_amount;
      }
    });

    const aggregatedArray = Object.keys(groupedData).map(k => ({ date: k, amount: groupedData[k] }));
    renderTrendChart(aggregatedArray, period);
  } catch (err) {
    console.error('Error loading trend chart:', err);
  }
}

function renderTrendChart(trendData, period) {
  const ctx = document.getElementById('daily-chart');
  if (!ctx) return;

  if (dailyChartInstance) {
    dailyChartInstance.destroy();
  }

  if (!trendData || trendData.length === 0) {
    // Empty handled gracefully
  }

  // Sort chronologically
  const sortedData = [...trendData].sort((a, b) => a.date.localeCompare(b.date));
  
  const labels = sortedData.map(d => {
    if (period === 'day') {
      const parts = d.date.split('-');
      return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : d.date;
    } else if (period === 'week') {
      const parts = d.date.split('-');
      return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}週` : d.date;
    } else if (period === 'month') {
      const parts = d.date.split('-');
      return parts.length >= 2 ? `${parseInt(parts[1])}月` : d.date;
    }
    return d.date;
  });
  
  const data = sortedData.map(d => d.amount);

  dailyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '支出推移',
        data: data,
        backgroundColor: '#8b5cf6', // primary color
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ¥${formatCurrency(context.raw)}`;
            }
          }
        }
      }
    }
  });
}

function renderRecentExpenses(expenses) {
  const container = document.getElementById('recent-expenses-list');
  container.innerHTML = '';

  if (!expenses || expenses.length === 0) {
    container.innerHTML = '<p class="no-data-msg">最近の支出データは登録されていません</p>';
    return;
  }

  // Show up to 5 items
  expenses.slice(0, 5).forEach(exp => {
    const item = document.createElement('div');
    item.className = 'expense-row-item';
    item.innerHTML = `
      <div class="item-main-details">
        <span class="item-title-meta">${exp.memo || 'レシート支出'}</span>
        <span class="item-date-meta">${exp.date}</span>
      </div>
      <div class="item-side-details">
        <span class="item-amount-val">¥${formatCurrency(exp.total_amount)}</span>
        <button class="delete-row-btn" data-id="${exp.id}" title="削除">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    // Add delete listener
    item.querySelector('.delete-row-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = e.currentTarget.getAttribute('data-id');
      if (confirm('この支出レコードを削除してもよろしいですか？')) {
        await deleteExpense(id);
      }
    });

    container.appendChild(item);
  });
}

// Delete Expense API Call
async function deleteExpense(id) {
  try {
    const response = await fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete expense');
    showToast('支出データを削除しました。');
    loadHistoryData(); // Reload list
    loadDashboardData(); // Refresh dashboard
  } catch (err) {
    console.error('Delete error:', err);
    showToast('削除に失敗しました。', 'error');
  }
}

// Dashboard month navigation
document.getElementById('prev-month-btn').addEventListener('click', () => {
  currentDashboardMonth.setMonth(currentDashboardMonth.getMonth() - 1);
  loadDashboardData();
});

document.getElementById('next-month-btn').addEventListener('click', () => {
  currentDashboardMonth.setMonth(currentDashboardMonth.getMonth() + 1);
  loadDashboardData();
});

// Dashboard Trend Toggle Listeners
document.querySelectorAll('#trend-period-toggles .toggle-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // UI update
    document.querySelectorAll('#trend-period-toggles .toggle-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    
    // Fetch and render new data
    const period = e.target.getAttribute('data-period');
    loadTrendChart(period);
  });
});

document.getElementById('quick-scan-trigger').addEventListener('click', () => {
  switchView('scan');
});

document.getElementById('view-all-history').addEventListener('click', () => {
  switchView('history');
});


// --- SCANNER / OCR VIEW CONTROLLERS ---

const uploadZone = document.getElementById('scan-upload-area');
const fileInput = document.getElementById('file-input');
const cameraTrigger = document.getElementById('camera-trigger');
const cameraContainer = document.getElementById('camera-container');
const closeCameraBtn = document.getElementById('close-camera-btn');
const captureBtn = document.getElementById('capture-btn');
const videoPreview = document.getElementById('video-preview');
const photoCanvas = document.getElementById('photo-canvas');
const scanLoading = document.getElementById('scan-loading');
const scanResultArea = document.getElementById('scan-result-area');

// Drag and drop event listeners
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.style.borderColor = 'var(--primary)';
  uploadZone.style.background = 'rgba(139, 92, 246, 0.05)';
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.style.borderColor = 'var(--panel-border)';
  uploadZone.style.background = 'rgba(255, 255, 255, 0.01)';
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.style.borderColor = 'var(--panel-border)';
  uploadZone.style.background = 'rgba(255, 255, 255, 0.01)';
  
  if (e.dataTransfer.files.length > 0) {
    handleImageFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleImageFile(e.target.files[0]);
  }
});

// Camera activation
cameraTrigger.addEventListener('click', async () => {
  try {
    uploadZone.style.display = 'none';
    cameraContainer.style.display = 'block';
    
    // Request back camera on mobile if available, fallback to default
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    
    videoPreview.srcObject = mediaStream;
  } catch (err) {
    console.error('Camera access error:', err);
    showToast('カメラの起動に失敗しました。ファイル選択をご利用ください。', 'error');
    stopCamera();
    uploadZone.style.display = 'block';
  }
});

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  cameraContainer.style.display = 'none';
}

closeCameraBtn.addEventListener('click', () => {
  stopCamera();
  uploadZone.style.display = 'block';
});

captureBtn.addEventListener('click', () => {
  if (!mediaStream) return;

  const width = videoPreview.videoWidth;
  const height = videoPreview.videoHeight;
  photoCanvas.width = width;
  photoCanvas.height = height;
  
  const ctx = photoCanvas.getContext('2d');
  ctx.drawImage(videoPreview, 0, 0, width, height);
  
  photoCanvas.toBlob((blob) => {
    const file = new File([blob], 'captured_receipt.jpg', { type: 'image/jpeg' });
    stopCamera();
    handleImageFile(file);
  }, 'image/jpeg', 0.95);
});

// --- CROPPING WORKFLOW ---
let cropperInstance = null;
const cropModal = document.getElementById('crop-modal');
const cropImage = document.getElementById('crop-image');

// Setup image cropping before OCR
function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = function (event) {
    // Hide upload zone
    uploadZone.style.display = 'none';
    
    // Set source image for cropper
    cropImage.src = event.target.result;
    
    // Open modal
    cropModal.style.display = 'flex';
    
    // Initialize Cropper
    if (cropperInstance) {
      cropperInstance.destroy();
    }
    
    setTimeout(() => {
      cropperInstance = new Cropper(cropImage, {
        viewMode: 1,
        autoCropArea: 0.85,
        responsive: true,
        restore: false,
        checkCrossOrigin: false,
        modal: true,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });
    }, 50);
  };
  reader.readAsDataURL(file);
}

// Cancel cropping modal
document.getElementById('crop-cancel-btn').addEventListener('click', () => {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  cropModal.style.display = 'none';
  uploadZone.style.display = 'block';
});

// Confirm crop region and launch OCR upload
document.getElementById('crop-confirm-btn').addEventListener('click', () => {
  if (!cropperInstance) return;
  
  const canvas = cropperInstance.getCroppedCanvas({
    maxWidth: 2048,
    maxHeight: 2048
  });
  
  cropModal.style.display = 'none';
  scanLoading.style.display = 'block';

  canvas.toBlob(async (blob) => {
    if (cropperInstance) {
      cropperInstance.destroy();
      cropperInstance = null;
    }
    
    const croppedFile = new File([blob], 'cropped_receipt.jpg', { type: 'image/jpeg' });
    await uploadAndScanImage(croppedFile);
  }, 'image/jpeg', 0.9);
});

// Removed old manual input workflow from upload area

// Send file to server for OCR
async function uploadAndScanImage(file) {
  const formData = new FormData();
  formData.append('receipt', file);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${currentToken}`
      } // Exclude Content-Type for FormData
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Server error during OCR');
    }

    const result = await response.json();
    scannedItems = result.items;

    // Reset inputs
    document.getElementById('expense-date').valueAsDate = new Date();
    document.getElementById('expense-memo').value = '';

    // Render results
    renderOcrItems();
    
    scanLoading.style.display = 'none';
    scanResultArea.style.display = 'block';
    showToast('レシートの読み取りが完了しました。');

  } catch (err) {
    console.error('Upload/OCR failed:', err);
    showToast('レシート解析に失敗しました: ' + err.message, 'error');
    scanLoading.style.display = 'none';
    uploadZone.style.display = 'block';
  }
}

// Render parsed items in table
function renderOcrItems() {
  const tbody = document.getElementById('ocr-items-body');
  tbody.innerHTML = '';

  if (scannedItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-data-msg">商品が検出されませんでした。行を追加してください。</td></tr>`;
    calculateScanTotal();
    return;
  }

  scannedItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.id = `item-row-${index}`;
    if (!item.is_selected) {
      tr.className = 'unselected';
    }

    // Default price attributes if undefined
    if (item.unit_price === undefined) item.unit_price = item.amount || 0;
    if (item.quantity === undefined) item.quantity = 1;

    // Ensure tag_id is set
    if (item.tag_id === undefined) {
      // Try to match suggested_tag if present, else fallback to 'その他' or first tag
      const matchedTag = availableTags.find(t => t.name === item.suggested_tag);
      const defaultTag = availableTags.find(t => t.name === 'その他') || availableTags[0];
      item.tag_id = matchedTag ? matchedTag.id : (defaultTag ? defaultTag.id : null);
    }

    // Generate Tag Options
    let tagOptions = '';
    availableTags.forEach(tag => {
      const selectedAttr = String(item.tag_id) === String(tag.id) ? 'selected' : '';
      tagOptions += `<option value="${tag.id}" ${selectedAttr}>${tag.name}</option>`;
    });
    const newSelectedAttr = String(item.tag_id) === 'new' ? 'selected' : '';
    tagOptions += `<option value="new" ${newSelectedAttr}>＋ 新規カテゴリ</option>`;

    tr.innerHTML = `
      <td data-label="選択">
        <div class="custom-checkbox ${item.is_selected ? 'checked' : ''}" data-index="${index}"></div>
      </td>
      <td data-label="商品名">
        <input type="text" class="table-input" value="${item.name}" data-field="name" data-index="${index}">
      </td>
      <td data-label="単価">
        <input type="number" class="table-input table-input-amount" value="${item.unit_price}" data-field="unit_price" data-index="${index}">
      </td>
      <td data-label="数量">
        <input type="number" class="table-input" style="text-align: center;" value="${item.quantity}" data-field="quantity" min="1" data-index="${index}">
      </td>
      <td data-label="金額">
        <input type="number" class="table-input table-input-amount" value="${item.amount}" data-field="amount" data-index="${index}" readonly style="opacity: 0.8;">
      </td>
      <td data-label="カテゴリ">
        <select class="tag-selector" data-index="${index}">
          ${tagOptions}
        </select>
        <div class="inline-new-tag-form" data-index="${index}" style="display: ${item.tag_id === 'new' ? 'flex' : 'none'}; align-items: center; gap: 4px; margin-top: 4px;">
          <input type="color" class="color-picker-input-sm" value="${item.new_tag_color || '#868e96'}" data-field="new_tag_color" data-index="${index}" style="width: 24px; height: 24px; border: none; padding: 0; cursor: pointer; background: transparent;">
          <input type="text" class="table-input" value="${item.new_tag_name || ''}" placeholder="カテゴリ名" data-field="new_tag_name" data-index="${index}" style="padding: 4px; font-size: 12px;">
        </div>
      </td>
      <td data-label="削除">
        <button class="delete-row-btn remove-item-btn" data-index="${index}" title="削除">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    `;

    // Toggle row selection listener
    tr.querySelector('.custom-checkbox').addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
      scannedItems[idx].is_selected = scannedItems[idx].is_selected ? 0 : 1;
      
      // Update styling
      if (scannedItems[idx].is_selected) {
        tr.classList.remove('unselected');
        e.currentTarget.classList.add('checked');
      } else {
        tr.classList.add('unselected');
        e.currentTarget.classList.remove('checked');
      }
      
      calculateScanTotal();
    });

    // Inputs change listeners (Name)
    tr.querySelector('input[data-field="name"]').addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      scannedItems[idx].name = e.target.value;
    });

    // Inputs change listeners (UnitPrice)
    tr.querySelector('input[data-field="unit_price"]').addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      const unitPrice = parseInt(e.target.value, 10) || 0;
      scannedItems[idx].unit_price = unitPrice;
      
      // Auto multiply
      scannedItems[idx].amount = unitPrice * (scannedItems[idx].quantity || 1);
      tr.querySelector('input[data-field="amount"]').value = scannedItems[idx].amount;
      
      calculateScanTotal();
    });

    // Inputs change listeners (Quantity)
    tr.querySelector('input[data-field="quantity"]').addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      const quantity = parseInt(e.target.value, 10) || 1;
      scannedItems[idx].quantity = quantity;
      
      // Auto multiply
      scannedItems[idx].amount = (scannedItems[idx].unit_price || 0) * quantity;
      tr.querySelector('input[data-field="amount"]').value = scannedItems[idx].amount;
      
      calculateScanTotal();
    });

    // Select change listener
    tr.querySelector('.tag-selector').addEventListener('change', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      const val = e.target.value;
      const form = tr.querySelector(`.inline-new-tag-form[data-index="${idx}"]`);
      
      if (val === 'new') {
        scannedItems[idx].tag_id = 'new';
        form.style.display = 'flex';
      } else {
        scannedItems[idx].tag_id = parseInt(val, 10);
        form.style.display = 'none';
      }
    });

    // New tag input listeners
    const newNameInput = tr.querySelector('input[data-field="new_tag_name"]');
    if (newNameInput) {
      newNameInput.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        scannedItems[idx].new_tag_name = e.target.value;
      });
    }

    const newColorInput = tr.querySelector('input[data-field="new_tag_color"]');
    if (newColorInput) {
      newColorInput.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        scannedItems[idx].new_tag_color = e.target.value;
      });
    }

    // Delete item listener
    tr.querySelector('.remove-item-btn').addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-index'), 10);
      scannedItems.splice(idx, 1);
      renderOcrItems();
    });

    tbody.appendChild(tr);
  });

  calculateScanTotal();
}

// Dynamically sum active items
function calculateScanTotal() {
  const sum = scannedItems
    .filter(item => item.is_selected === 1)
    .reduce((total, item) => total + parseInt(item.amount || 0, 10), 0);

  const display = document.getElementById('scan-total-display');
  const currentVal = parseInt(display.textContent.replace(/,/g, ''), 10) || 0;
  
  animateNumber(display, currentVal, sum, 400);
}

// Add blank row
document.getElementById('add-item-btn').addEventListener('click', () => {
  const defaultTag = availableTags.find(t => t.name === 'その他') || availableTags[0];
  const defaultTagId = defaultTag ? defaultTag.id : null;
  scannedItems.push({
    name: '新規商品',
    unit_price: 0,
    quantity: 1,
    amount: 0,
    is_selected: 1,
    tag_id: defaultTagId
  });
  renderOcrItems();
});

// Reset Scan UI to default state
function resetScanUI() {
  scannedItems = [];
  scanResultArea.style.display = 'none';
  uploadZone.style.display = 'block';
  document.getElementById('file-input').value = ''; // Reset file input
}

// Cancel scanning and restart
document.getElementById('cancel-scan-btn').addEventListener('click', resetScanUI);

// Save to DB
document.getElementById('save-expense-btn').addEventListener('click', async function() {
  const btn = this;
  const originalHtml = btn.innerHTML;

  const dateStr = document.getElementById('expense-date').value;
  const memoStr = document.getElementById('expense-memo').value;

  if (!dateStr) {
    showToast('日付を選択してください。', 'error');
    return;
  }
  if (scannedItems.length === 0) {
    showToast('商品項目がありません。項目を追加してください。', 'error');
    return;
  }

  // Set loading state
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';

  // Prepare payload
  const payload = {
    date: dateStr,
    memo: memoStr,
    items: scannedItems
  };

  try {
    const response = await fetch('/api/expenses', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Server failed to save');
    }

    showToast('支出を保存しました！');
    
    // Switch to Dashboard and reset scan UI
    switchView('dashboard');
    resetScanUI();

  } catch (err) {
    console.error('Save failed:', err);
    showToast('保存に失敗しました: ' + err.message, 'error');
  } finally {
    // Reset button state
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});


// --- HISTORY / LIST VIEW CONTROLLERS ---

function setDefaultHistoryDates() {
  const startInput = document.getElementById('filter-start-date');
  const endInput = document.getElementById('filter-end-date');
  
  if (!startInput.value || !endInput.value) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    startInput.value = firstDay.toISOString().substring(0, 10);
    endInput.value = lastDay.toISOString().substring(0, 10);
  }
}

async function loadHistoryData() {
  const startDate = document.getElementById('filter-start-date').value;
  const endDate = document.getElementById('filter-end-date').value;

  if (!startDate || !endDate) {
    showToast('開始日と終了日を選択してください。', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/expenses?start_date=${startDate}&end_date=${endDate}`, { headers: getAuthHeaders() });
    if (!response.ok) {
      if (response.status === 401) {
        // Unauthorized, redirect to login
        document.querySelector('.app-header').style.display = 'none';
        switchView('auth');
        return;
      }
      throw new Error('Failed to retrieve history');
    }
    const data = await response.json();

    // Set summary values
    const periodTotal = document.getElementById('history-period-total');
    const curVal = parseInt(periodTotal.textContent.replace(/,/g, ''), 10) || 0;
    animateNumber(periodTotal, curVal, data.total_spent);
    
    document.getElementById('history-count-label').textContent = `件数: ${data.expenses.length}件`;

    // Render list
    renderHistoryList(data.expenses);

  } catch (err) {
    console.error('History fetch error:', err);
    showToast('履歴データの取得に失敗しました。', 'error');
  }
}

function renderHistoryList(expenses) {
  const container = document.getElementById('history-records-container');
  container.innerHTML = '';

  if (!expenses || expenses.length === 0) {
    container.innerHTML = '<p class="no-data-msg">条件に合う支出データが見つかりませんでした</p>';
    return;
  }

  expenses.forEach(exp => {
    const accordion = document.createElement('div');
    accordion.className = 'history-item-accordion';
    
    // Build items rows with Unit Price and Quantity
    let itemsRows = '';
    exp.items.forEach(item => {
      const checkedClass = item.is_selected ? '' : 'style="opacity: 0.5; text-decoration: line-through;"';
      const unitPriceVal = item.unit_price !== undefined ? item.unit_price : item.amount;
      const quantityVal = item.quantity !== undefined ? item.quantity : 1;
      
      itemsRows += `
        <tr ${checkedClass}>
          <td>${item.name}</td>
          <td>¥${formatCurrency(unitPriceVal)}</td>
          <td style="text-align: center;">${quantityVal}</td>
          <td>¥${formatCurrency(item.amount)}</td>
          <td>
            <span class="accordion-tag-pill" style="background-color: ${item.tag_color || '#868e96'}; color: #fff;">
              ${item.tag_name || '未分類'}
            </span>
          </td>
        </tr>
      `;
    });

    accordion.innerHTML = `
      <div class="accordion-header">
        <div class="accordion-left">
          <div class="accordion-meta">
            <span class="accordion-date">${exp.date}</span>
            <span class="accordion-memo">${exp.memo || 'レシート支出'}</span>
          </div>
        </div>
        <div class="accordion-right">
          <span class="accordion-amount">¥${formatCurrency(exp.total_amount)}</span>
          <i class="fa-solid fa-chevron-down accordion-toggle-icon"></i>
        </div>
      </div>
      <div class="accordion-body">
        <div class="accordion-inner">
          <table class="accordion-table">
            <thead>
              <tr>
                <th>商品名</th>
                <th>単価</th>
                <th style="text-align: center; width: 60px;">数量</th>
                <th>小計</th>
                <th>カテゴリ</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
          <div class="accordion-actions">
            <button class="btn btn-sm btn-secondary delete-acc-btn" data-id="${exp.id}">
              <i class="fa-solid fa-trash-can"></i>削除する
            </button>
          </div>
        </div>
      </div>
    `;

    // Accordion click trigger
    accordion.querySelector('.accordion-header').addEventListener('click', () => {
      const isOpen = accordion.classList.contains('open');
      
      // Close all accordions first (optional, but clean)
      document.querySelectorAll('.history-item-accordion').forEach(acc => {
        acc.classList.remove('open');
        acc.querySelector('.accordion-body').style.maxHeight = null;
      });

      if (!isOpen) {
        accordion.classList.add('open');
        const body = accordion.querySelector('.accordion-body');
        body.style.maxHeight = body.scrollHeight + 'px';
      }
    });

    // Delete button click
    accordion.querySelector('.delete-acc-btn').addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      if (confirm('この支出レコードを完全に削除しますか？')) {
        await deleteExpense(id);
      }
    });

    container.appendChild(accordion);
  });
}

// Search and Filter Listeners
document.getElementById('apply-filter-btn').addEventListener('click', loadHistoryData);

document.getElementById('quick-this-month-btn').addEventListener('click', () => {
  const startInput = document.getElementById('filter-start-date');
  const endInput = document.getElementById('filter-end-date');
  
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  startInput.value = firstDay.toISOString().substring(0, 10);
  endInput.value = lastDay.toISOString().substring(0, 10);

  loadHistoryData();
});


// --- SETTINGS CONTROLLERS ---

async function loadSettingsData() {
  await fetchTags();
  renderSettingsTags();
}

function renderSettingsTags() {
  const tbody = document.getElementById('settings-tag-list');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  availableTags.forEach(tag => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="width: 20px; height: 20px; border-radius: 4px; background-color: ${tag.color || '#868e96'};"></div>
      </td>
      <td>${tag.name}</td>
      <td>
        ${tag.name !== 'その他' ? `<button class="btn btn-sm btn-secondary delete-tag-btn" data-id="${tag.id}"><i class="fa-solid fa-trash-can"></i>削除</button>` : '<span style="color:var(--text-muted); font-size: 0.8rem;">必須</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach delete listeners
  tbody.querySelectorAll('.delete-tag-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      if (confirm('このカテゴリを削除しますか？')) {
        try {
          const res = await fetch(`/api/tags/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
          if (!res.ok) throw new Error('Failed to delete tag');
          showToast('カテゴリを削除しました');
          await loadSettingsData(); // Reload
        } catch (err) {
          console.error(err);
          showToast('カテゴリの削除に失敗しました', 'error');
        }
      }
    });
  });
}

const addTagBtn = document.getElementById('add-tag-btn');
if (addTagBtn) {
  addTagBtn.addEventListener('click', async () => {
    const name = prompt('新しいカテゴリ名を入力してください:');
    if (!name) return;
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: name, color: '#3b82f6' }) // Default blue for now
      });
      if (!res.ok) throw new Error('Failed to add tag');
      showToast('カテゴリを追加しました');
      await loadSettingsData();
    } catch (err) {
      console.error(err);
      showToast('カテゴリの追加に失敗しました', 'error');
    }
  });
}


// --- AUTH LOGIC ---
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    const mode = e.target.getAttribute('data-mode');
    const submitBtn = document.getElementById('auth-submit-btn');
    submitBtn.textContent = mode === 'login' ? 'ログイン' : '新規登録';
    submitBtn.setAttribute('data-mode', mode);
  });
});

document.getElementById('auth-submit-btn').addEventListener('click', async (e) => {
  const mode = e.target.getAttribute('data-mode') || 'login';
  const usernameInput = document.getElementById('auth-username').value;
  const passwordInput = document.getElementById('auth-password').value;

  if (!usernameInput || !passwordInput) {
    showToast('IDとパスワードを入力してください。', 'error');
    return;
  }

  const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Authentication failed');
    }

    // Success
    currentToken = data.token;
    localStorage.setItem('auth_token', currentToken);
    showToast('ログインしました！');
    
    // Switch to Dashboard
    document.querySelector('.app-header').style.display = 'flex';
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';
    
    await fetchTags();
    switchView('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

const deleteAccountBtn = document.getElementById('delete-account-btn');
if (deleteAccountBtn) {
  deleteAccountBtn.addEventListener('click', async () => {
    if (!confirm('本当にアカウントを削除しますか？\n\n※この操作は取り消せません。\n※あなたが登録した「すべての支出データ」と「カスタムカテゴリ」が完全に削除されます。')) {
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) throw new Error('アカウントの削除に失敗しました。');

      showToast('アカウントを完全に削除しました。');
      
      // Logout and reset
      localStorage.removeItem('auth_token');
      currentToken = null;
      document.querySelector('.app-header').style.display = 'none';
      switchView('auth');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    }
  });
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  if (currentToken) {
    // Has token, try to load data
    document.querySelector('.app-header').style.display = 'flex';
    switchView('dashboard');
  } else {
    // No token, show auth view
    document.querySelector('.app-header').style.display = 'none';
    switchView('auth');
  }
});
