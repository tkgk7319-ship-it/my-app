// Frontend logic for Smart Receipt application

// State variables
let availableTags = [];
let scannedItems = [];
let currentDashboardMonth = new Date(); // Defaults to today
let mediaStream = null;

// DOM Elements
const views = {
  dashboard: document.getElementById('dashboard-view'),
  scan: document.getElementById('scan-view'),
  history: document.getElementById('history-view'),
  settings: document.getElementById('settings-view')
};

const navButtons = {
  dashboard: document.getElementById('nav-dashboard'),
  scan: document.getElementById('nav-scan'),
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
  // Hide all views, remove active from all nav buttons
  Object.values(views).forEach(view => view.classList.remove('active'));
  Object.values(navButtons).forEach(btn => btn.classList.remove('active'));
  
  // Show target view and set button active
  views[viewName].classList.add('active');
  navButtons[viewName].classList.add('active');
  
  // Terminate camera if switching away from scan view
  if (viewName !== 'scan') {
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
  navButtons[key].addEventListener('click', () => switchView(key));
});

// Setup Scan View Tabs Event Listeners
document.querySelectorAll('.scan-tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // Remove active class from all tab buttons and contents
    document.querySelectorAll('.scan-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.scan-tab-content').forEach(c => c.classList.remove('active'));

    // Add active class to clicked button
    e.currentTarget.classList.add('active');

    // Show target content
    const targetId = e.currentTarget.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');
  });
});

// --- TAGS RETRIEVAL ---
async function fetchTags() {
  try {
    const response = await fetch('/api/tags');
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
    const response = await fetch(`/api/expenses?start_date=${startDate}&end_date=${endDate}`);
    if (!response.ok) throw new Error('Failed to fetch monthly expenses');
    const data = await response.json();

    // 1. Render Total Amount
    const totalDisplay = document.getElementById('dashboard-total-amount');
    const currentVal = parseInt(totalDisplay.textContent.replace(/,/g, ''), 10) || 0;
    animateNumber(totalDisplay, currentVal, data.total_spent);

    // 2. Render SVG Donut Chart and Legend
    renderDonutChart(data.categories, data.total_spent);

    // 3. Render Recent Expenses
    renderRecentExpenses(data.expenses);

  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast('ダッシュボードデータの読み込みに失敗しました。', 'error');
  }
}

function renderDonutChart(categories, totalAmount) {
  const donutSegments = document.getElementById('donut-segments');
  const legendList = document.getElementById('chart-legend-list');
  const totalLabel = document.getElementById('chart-total-label');
  
  donutSegments.innerHTML = '';
  legendList.innerHTML = '';
  totalLabel.textContent = `¥${formatCurrency(totalAmount)}`;

  if (!categories || categories.length === 0 || totalAmount === 0) {
    legendList.innerHTML = '<p class="no-data-msg">データがありません</p>';
    // Draw grey placeholder donut
    donutSegments.innerHTML = `
      <circle cx="100" cy="100" r="80" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="20"/>
    `;
    return;
  }

  const r = 80;
  const circumference = 2 * Math.PI * r; // ~502.65
  let currentOffset = 0;

  categories.forEach(cat => {
    const percentage = cat.amount / totalAmount;
    const strokeLength = percentage * circumference;
    const strokeOffset = circumference - currentOffset;

    // Create SVG path/circle segment
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '100');
    circle.setAttribute('cy', '100');
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'transparent');
    circle.setAttribute('stroke', cat.color);
    circle.setAttribute('stroke-width', '20');
    circle.setAttribute('stroke-dasharray', `${strokeLength} ${circumference}`);
    circle.setAttribute('stroke-dashoffset', String(strokeOffset));
    circle.style.transition = 'stroke-dashoffset 0.8s ease';
    
    donutSegments.appendChild(circle);
    currentOffset += strokeLength;

    // Create Legend Item
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-info">
        <div class="legend-color" style="background-color: ${cat.color}"></div>
        <span>${cat.name}</span>
        <span class="legend-percentage">${Math.round(percentage * 100)}%</span>
      </div>
      <span class="legend-amount">¥${formatCurrency(cat.amount)}</span>
    `;
    legendList.appendChild(legendItem);
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

async function deleteExpense(id) {
  try {
    const response = await fetch(`/api/expenses/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete expense');
    showToast('支出を削除しました。');
    
    // Refresh current view
    if (views.dashboard.classList.contains('active')) {
      loadDashboardData();
    } else if (views.history.classList.contains('active')) {
      loadHistoryData();
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast('支出の削除に失敗しました。', 'error');
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

// Send file to server for OCR
async function uploadAndScanImage(file) {
  const formData = new FormData();
  formData.append('receipt', file);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
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

    // Generate Tag Options
    let tagOptions = '';
    availableTags.forEach(tag => {
      const selectedAttr = item.tag_id === tag.id ? 'selected' : '';
      tagOptions += `<option value="${tag.id}" ${selectedAttr}>${tag.name}</option>`;
    });
    const newSelectedAttr = item.tag_id === 'new' ? 'selected' : '';
    tagOptions += `<option value="new" ${newSelectedAttr}>＋ 新規カテゴリ</option>`;

    tr.innerHTML = `
      <td>
        <div class="custom-checkbox ${item.is_selected ? 'checked' : ''}" data-index="${index}"></div>
      </td>
      <td>
        <input type="text" class="table-input" value="${item.name}" data-field="name" data-index="${index}">
      </td>
      <td>
        <input type="number" class="table-input table-input-amount" value="${item.unit_price}" data-field="unit_price" data-index="${index}">
      </td>
      <td>
        <input type="number" class="table-input" style="text-align: center;" value="${item.quantity}" data-field="quantity" min="1" data-index="${index}">
      </td>
      <td>
        <input type="number" class="table-input table-input-amount" value="${item.amount}" data-field="amount" data-index="${index}" readonly style="opacity: 0.8;">
      </td>
      <td>
        <select class="tag-selector" data-index="${index}">
          ${tagOptions}
        </select>
        <div class="inline-new-tag-form" data-index="${index}" style="display: ${item.tag_id === 'new' ? 'flex' : 'none'}; align-items: center; gap: 4px; margin-top: 4px;">
          <input type="color" class="color-picker-input-sm" value="${item.new_tag_color || '#868e96'}" data-field="new_tag_color" data-index="${index}" style="width: 24px; height: 24px; border: none; padding: 0; cursor: pointer; background: transparent;">
          <input type="text" class="table-input" value="${item.new_tag_name || ''}" placeholder="カテゴリ名" data-field="new_tag_name" data-index="${index}" style="padding: 4px; font-size: 12px;">
        </div>
      </td>
      <td>
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
  const defaultTagId = availableTags.length > 0 ? availableTags.find(t => t.name === 'その他').id : null;
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

// Cancel scanning and restart
document.getElementById('cancel-scan-btn').addEventListener('click', () => {
  scannedItems = [];
  scanResultArea.style.display = 'none';
  uploadZone.style.display = 'block';
});

// Save to DB
document.getElementById('save-expense-btn').addEventListener('click', async () => {
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

  // Prepare payload
  const payload = {
    date: dateStr,
    memo: memoStr,
    items: scannedItems
  };

  try {
    const response = await fetch('/api/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Server failed to save');
    }

    showToast('支出を保存しました！');
    scannedItems = [];
    
    // Switch to Dashboard
    switchView('dashboard');
    scanResultArea.style.display = 'none';
    uploadZone.style.display = 'block';

  } catch (err) {
    console.error('Save failed:', err);
    showToast('保存に失敗しました: ' + err.message, 'error');
  }
});


// --- HISTORY / LIST VIEW CONTROLLERS ---

function setDefaultHistoryDates() {
  const startInput = document.getElementById('filter-start-date');
  const endInput = document.getElementById('filter-end-date');

  // Default to this month
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
    const response = await fetch(`/api/expenses?start_date=${startDate}&end_date=${endDate}`);
    if (!response.ok) throw new Error('Failed to retrieve history');
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


// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  await fetchTags();
  loadDashboardData();
});
