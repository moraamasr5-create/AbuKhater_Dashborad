// Developed & Owned by D.AmrMamdouh - 01038035884
// Modernized Thermal Printing Foundation (80mm) for Abu Khater Delivery System
import { safeGetItem, safeSetItem } from '../utils/safeStorage.js';
import { parseItemCommercialDetails } from '../utils/commercialItemParser.js';

const printedCacheKey = 'PRINTED_ORDERS_CACHE';

const getPrintedCache = () => {
  try {
    return JSON.parse(safeGetItem(printedCacheKey)) || {};
  } catch (err) {
    console.warn('Cache read error:', err);
    return {};
  }
};

const setPrintedCache = (cache) => {
  try {
    safeSetItem(printedCacheKey, JSON.stringify(cache));
  } catch (err) {
    console.warn('Cache write error:', err);
  }
};

/**
 * Escapes unsafe characters in user-provided strings to prevent HTML/XSS injection
 */
export const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Sanitizes multi-line notes safely converting newlines to <br/> after escaping HTML
 */
export const sanitizeNotes = (notes) => {
  if (!notes) return '';
  return escapeHtml(notes).replace(/\r?\n/g, '<br/>');
};

/**
 * 📦 Unified Read-Only Print Presentation Model
 * يستخرج وينسق بيانات الطلب من المصدر الموثوق (Supabase / safeOrderParser)
 * دون تعديل المنطق التجاري أو إعادة تفسير الأسعار.
 */
export const normalizePrintOrder = (order, explicitPilotName = null) => {
  if (!order) return null;

  const isPickup = order.type === 'pickup';
  const orderNumber = String(order.originalId || order.id || 'N/A');
  const customerName = (order.customerName || order.customer?.name || (isPickup ? 'عميل استلام بالفرع' : 'عميل')).trim();
  const phone = order.phone || order.customer?.phone || null;
  const phone2 = order.phone2 || null;
  const address = isPickup ? null : (order.area || order.customer?.address || null);
  const pilotName = isPickup ? null : (explicitPilotName || order.pilotName || null);

  const rawItems = Array.isArray(order.items) ? order.items : [];
  const items = rawItems.map(rawItem => {
    const details = parseItemCommercialDetails(rawItem);
    const quantity = Number(rawItem.count || rawItem.quantity || 1) || 1;
    const unitPrice = Number(rawItem.price || rawItem.unit_price || 0) || 0;
    const lineTotal = quantity * unitPrice;

    return {
      productName: details.productName || 'صنف',
      variantName: details.variantName || null,
      optionNames: Array.isArray(details.optionNames) ? details.optionNames : [],
      notes: details.notes || null,
      category: details.category || null,
      quantity,
      unitPrice,
      lineTotal
    };
  });

  const subtotal = Number(order.subtotal) || items.reduce((sum, i) => sum + i.lineTotal, 0);
  const deliveryFee = isPickup ? 0 : Number(order.deliveryFee || order.delivery_fee || 0);
  const serviceFee = Number(order.serviceFee || order.service_fee || 0);
  const total = Number(order.total) || (subtotal + deliveryFee + serviceFee);
  const paidNow = Number(order.paidNow || 0);
  const remainingAmount = Number(order.remainingAmount !== undefined ? order.remainingAmount : (total - paidNow));
  const paymentMethod = order.paymentMethod || 'كاش';
  const timestamp = order.timestamp || order.created_at || new Date().toISOString();

  return {
    orderNumber,
    isPickup,
    orderType: isPickup ? 'pickup' : 'delivery',
    status: order.status || 'pending',
    timestamp,
    customerName,
    phone,
    phone2,
    address,
    pilotName,
    items,
    itemsDescription: order.itemsDescription || null,
    subtotal,
    deliveryFee,
    serviceFee,
    total,
    paidNow,
    remainingAmount,
    paymentMethod,
    source: order.source || 'online'
  };
};

class PrinterService {
  constructor() {
    this.isConnected = false;
    this.printerName = null;
    this.isConnecting = false;
  }

  get qz() {
    return window.qz || null;
  }

  async connectPrinter() {
    const qz = this.qz;
    if (!qz) {
      console.warn('⚠️ QZ Tray library not found on window.');
      return false;
    }

    if (this.isConnected) return true;
    if (this.isConnecting) return false;
    this.isConnecting = true;

    try {
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect({ retries: 2, delay: 1000 });
      }
      this.isConnected = true;

      // Auto-find default or XP thermal printer
      const printers = await qz.printers.find();
      const xpPrinter = printers.find(p => {
        const lower = p.toLowerCase();
        return lower.includes('xp') || lower.includes('pos') || lower.includes('thermal') || lower.includes('80') || lower.includes('receipt');
      });
      this.printerName = xpPrinter || (printers.length > 0 ? printers[0] : null);

      console.log('🖨️ QZ Tray Connected. Printer selected:', this.printerName);
      this.isConnecting = false;
      return true;
    } catch (err) {
      console.warn('⚠️ QZ Tray connection failed, using fallback browser print mode.', err);
      this.isConnected = false;
      this.isConnecting = false;
      return false;
    }
  }

  isOrderAlreadyPrinted(orderId, type = 'cashier') {
    const cache = getPrintedCache();
    const key = `${orderId}_${type}`;
    return !!cache[key];
  }

  markOrderAsPrinted(orderId, type = 'cashier') {
    const cache = getPrintedCache();
    const key = `${orderId}_${type}`;
    cache[key] = new Date().toISOString();
    setPrintedCache(cache);
  }

  generateHtmlWrapper(title, content) {
    const safeTitle = escapeHtml(title);
    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <title>${safeTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&display=swap');
          
          @page {
            size: 80mm auto;
            margin: 0;
          }
          
          @media print {
            html, body {
              width: 80mm !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              color: #000 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body, html, .receipt-container {
              height: auto !important;
              min-height: 0 !important;
              max-height: none !important;
              overflow: visible !important;
            }
            .no-print {
              display: none !important;
            }
            .header, .section, .items-table, .footer, .solid-line, .dashed-line, .double-line, .summary-box, tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
          
          * {
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
            margin: 0 auto;
            padding: 3mm 4mm;
            width: 72mm;
            color: #000;
            background: #fff;
            font-size: 13px;
            line-height: 1.35;
            direction: rtl;
            text-align: right;
            overflow-x: hidden;
          }
          
          .receipt-container {
            width: 100%;
          }
          
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
          .title { font-size: 19px; font-weight: 900; margin: 0; line-height: 1.2; }
          .subtitle { font-size: 12px; font-weight: 800; margin: 2px 0; }
          .section { margin-bottom: 6px; font-size: 12px; }
          .flex { display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; margin-bottom: 2px; }
          .bold { font-weight: 800; }
          .dashed-line { border-top: 1px dashed #000; margin: 5px 0; }
          .solid-line { border-top: 2px solid #000; margin: 5px 0; }
          .double-line { border-top: 3px double #000; margin: 6px 0; }
          
          .items-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
          .items-table th, .items-table td { padding: 3px 0; text-align: right; vertical-align: top; }
          .items-table th { border-bottom: 1px solid #000; font-weight: 900; font-size: 12px; }
          .center { text-align: center; }
          .left { text-align: left; }
          
          .variant-tag { font-size: 11px; font-weight: 800; color: #111; margin-top: 2px; }
          .options-tag { font-size: 10px; font-weight: 700; color: #333; margin-top: 1px; }
          .note-tag { font-size: 10px; font-style: italic; color: #444; margin-top: 1px; }
          
          .badge-box {
            border: 2px solid #000;
            padding: 4px 6px;
            text-align: center;
            font-weight: 900;
            font-size: 13px;
            margin: 4px 0;
          }
          .badge-black {
            background: #000;
            color: #fff;
            padding: 4px 6px;
            text-align: center;
            font-weight: 900;
            font-size: 13px;
            margin: 4px 0;
          }
          
          .footer { text-align: center; font-size: 11px; margin-top: 10px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          ${content}
        </div>
        <div style="text-align: center; font-size: 9px; color: #555; margin-top: 10px; border-top: 1px dotted #000; padding-top: 4px; font-family: sans-serif; direction: ltr; page-break-inside: avoid; break-inside: avoid;">
          Developed & Owned by D.AmrMamdouh - 01038035884
        </div>
      </body>
      </html>
    `;
  }

  async printReceiptHtml(htmlContent, orderId, type, forceReprint = false) {
    if (!forceReprint && this.isOrderAlreadyPrinted(orderId, type)) {
      console.log(`🖨️ Order #${orderId} (${type}) already printed. Skipping duplicate.`);
      return { success: false, reason: 'duplicate' };
    }

    const qz = this.qz;
    if (!this.isConnected || !this.printerName || !qz) {
      const connected = await this.connectPrinter();
      if (!connected || !qz) {
        // Fallback to browser print window
        this.fallbackPrint(htmlContent);
        this.markOrderAsPrinted(orderId, type);
        return { success: true, fallback: true };
      }
    }

    try {
      const config = qz.configs.create(this.printerName, {
        units: 'mm',
        rasterize: true,
        density: 203,
        scaleContent: true
      });

      const data = [{
        type: 'pixel',
        format: 'html',
        flavor: 'plain',
        data: htmlContent
      }];

      await qz.print(config, data);
      this.markOrderAsPrinted(orderId, type);
      console.log(`✅ QZ Print success for #${orderId} (${type})`);
      return { success: true, fallback: false };
    } catch (err) {
      console.error('❌ QZ Tray print error, trying fallback:', err);
      this.fallbackPrint(htmlContent);
      this.markOrderAsPrinted(orderId, type);
      return { success: true, fallback: true };
    }
  }

  fallbackPrint(htmlContent) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    let isPrinted = false;
    const doPrint = () => {
      if (isPrinted) return;
      isPrinted = true;
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.error('Fallback print error:', err);
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 2000);
      }
    };

    iframe.onload = () => {
      setTimeout(doPrint, 300);
    };

    const timeoutId = setTimeout(doPrint, 1500);

    iframe.addEventListener('load', () => {
      clearTimeout(timeoutId);
    });
  }

  // ==========================================
  // 1. KITCHEN RECEIPT (بون المطبخ والتحضير)
  // ==========================================
  async printKitchenReceipt(order, forceReprint = false, pilotName = null) {
    const p = normalizePrintOrder(order, pilotName);
    if (!p) return { success: false, error: 'invalid_order' };

    const safeOrderNum = escapeHtml(p.orderNumber);
    const safeCustomer = escapeHtml(p.customerName);
    const safeArea = escapeHtml(p.address || '');
    const safePilot = escapeHtml(p.pilotName || '');

    const itemsHtml = p.items.map(item => {
      const safeName = escapeHtml(item.productName);
      const safeVariant = item.variantName ? `<div class="variant-tag">🔹 ${escapeHtml(item.variantName)}</div>` : '';
      const safeOptions = item.optionNames.length > 0
        ? `<div class="options-tag">${item.optionNames.map(o => `+ ${escapeHtml(o)}`).join(' &nbsp; ')}</div>`
        : '';
      const safeNotes = item.notes ? `<div class="note-tag">📝 ${sanitizeNotes(item.notes)}</div>` : '';

      return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 4px 0;">
            <div style="font-size: 15px; font-weight: 900;">${safeName}</div>
            ${safeVariant}
            ${safeOptions}
            ${safeNotes}
          </td>
          <td class="center bold" style="font-size: 20px; vertical-align: middle; width: 45px;">
            ${item.quantity}
          </td>
        </tr>
      `;
    }).join('');

    const content = `
      <div class="header">
        <div class="title">بون المطبخ (KITCHEN)</div>
        <div class="bold" style="font-size: 20px; margin-top: 2px;">#${safeOrderNum}</div>
        ${p.isPickup
          ? `<div class="badge-black">🛍️ استلام من الفرع (PICKUP)</div>`
          : `<div class="badge-box">🚚 طلب توصيل (DELIVERY)</div>`
        }
      </div>

      <div class="section">
        <div class="flex">
          <span>الوقت:</span>
          <span class="bold">${new Date(p.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ${safeCustomer ? `<div class="flex"><span>العميل:</span> <span class="bold">${safeCustomer}</span></div>` : ''}
        ${!p.isPickup && safeArea ? `<div class="flex"><span>المنطقة:</span> <span class="bold">${safeArea}</span></div>` : ''}
        ${!p.isPickup && safePilot ? `<div class="flex"><span>الطيار:</span> <span class="bold">${safePilot}</span></div>` : ''}
      </div>

      <div class="solid-line"></div>

      <table class="items-table">
        <thead>
          <tr>
            <th>الصنف والمواصفات</th>
            <th class="center" style="width: 45px;">العدد</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${p.itemsDescription ? `
        <div class="dashed-line"></div>
        <div style="font-size: 11px; font-style: italic; color: #222;">
          <strong>ملاحظات عامة:</strong> ${sanitizeNotes(p.itemsDescription)}
        </div>
      ` : ''}

      <div class="solid-line"></div>
      <div class="footer">مطعم أبو خاطر • نسخة تحضير المطبخ</div>
    `;

    const html = this.generateHtmlWrapper(`Kitchen Ticket #${safeOrderNum}`, content);
    return await this.printReceiptHtml(html, p.orderNumber, 'kitchen', forceReprint);
  }

  // ==========================================
  // 2. CASHIER / CUSTOMER RECEIPT (فاتورة العميل والكاشير)
  // ==========================================
  async printCashierReceipt(order, forceReprint = false, pilotName = null) {
    const p = normalizePrintOrder(order, pilotName);
    if (!p) return { success: false, error: 'invalid_order' };

    const safeOrderNum = escapeHtml(p.orderNumber);
    const safeCustomer = escapeHtml(p.customerName);
    const safePhone = escapeHtml(p.phone || 'غير مسجل');
    const safePhone2 = p.phone2 ? escapeHtml(p.phone2) : null;
    const safeArea = escapeHtml(p.address || '');
    const safePilot = escapeHtml(p.pilotName || '');
    const safePayment = escapeHtml(p.paymentMethod);

    const itemsHtml = p.items.map(item => {
      const safeName = escapeHtml(item.productName);
      const safeVariant = item.variantName ? `<div class="variant-tag">🔹 ${escapeHtml(item.variantName)}</div>` : '';
      const safeOptions = item.optionNames.length > 0
        ? `<div class="options-tag">${item.optionNames.map(o => `+ ${escapeHtml(o)}`).join(', ')}</div>`
        : '';
      const safeNotes = item.notes ? `<div class="note-tag">📝 ${sanitizeNotes(item.notes)}</div>` : '';

      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 3px 0;">
            <div style="font-weight: 800; font-size: 13px;">${safeName}</div>
            ${safeVariant}
            ${safeOptions}
            ${safeNotes}
          </td>
          <td class="center bold" style="font-size: 13px;">${item.quantity}</td>
          <td class="left" style="font-size: 12px;">${item.unitPrice} ج</td>
          <td class="left bold" style="font-size: 13px;">${item.lineTotal} ج</td>
        </tr>
      `;
    }).join('');

    const content = `
      <div class="header">
        <div class="title">مطعم أبو خاطر</div>
        <div class="subtitle">إدارة وتوصيل الطلبات</div>
        <div class="dashed-line"></div>
        <div class="bold" style="font-size: 17px;">فاتورة رقم #${safeOrderNum}</div>
        ${p.isPickup
          ? `<div class="badge-black">🛍️ استلام من الفرع (PICKUP)</div>`
          : `<div class="badge-box">🚚 طلب توصيل (DELIVERY)</div>`
        }
      </div>

      <div class="section">
        <div class="flex">
          <span>التاريخ والوقت:</span>
          <span class="bold">${new Date(p.timestamp).toLocaleString('ar-EG')}</span>
        </div>
        <div class="flex">
          <span>العميل:</span>
          <span class="bold">${safeCustomer}</span>
        </div>
        <div class="flex">
          <span>الهاتف:</span>
          <span class="bold">${safePhone}${safePhone2 ? ` - ${safePhone2}` : ''}</span>
        </div>
        ${!p.isPickup && safeArea ? `<div class="flex"><span>العنوان:</span> <span class="bold">${safeArea}</span></div>` : ''}
        ${!p.isPickup && safePilot ? `<div class="flex"><span>الطيار:</span> <span class="bold">${safePilot}</span></div>` : ''}
        <div class="flex">
          <span>طريقة الدفع:</span>
          <span class="bold">${safePayment}</span>
        </div>
      </div>

      <div class="solid-line"></div>

      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 50%;">الصنف</th>
            <th class="center" style="width: 15%;">العدد</th>
            <th class="left" style="width: 15%;">السعر</th>
            <th class="left" style="width: 20%;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="solid-line"></div>

      <div class="section" style="font-size: 13px;">
        <div class="flex">
          <span>المجموع:</span>
          <span class="bold">${p.subtotal} ج.م</span>
        </div>
        ${!p.isPickup && p.deliveryFee > 0 ? `
          <div class="flex">
            <span>خدمة التوصيل:</span>
            <span class="bold">${p.deliveryFee} ج.م</span>
          </div>
        ` : ''}
        ${p.serviceFee > 0 ? `
          <div class="flex">
            <span>رسوم الخدمة:</span>
            <span class="bold">${p.serviceFee} ج.م</span>
          </div>
        ` : ''}

        <div class="double-line"></div>

        <div class="flex" style="font-size: 17px; font-weight: 900;">
          <span>الإجمالي النهائي:</span>
          <span>${p.total} ج.م</span>
        </div>

        ${p.paidNow > 0 ? `
          <div class="flex" style="color: #000; font-weight: bold; font-size: 13px;">
            <span>المدفوع:</span>
            <span>${p.paidNow} ج.م</span>
          </div>
        ` : ''}

        ${p.remainingAmount > 0 ? `
          <div class="flex" style="font-size: 15px; font-weight: 900; border-top: 1px dashed #000; padding-top: 3px; margin-top: 3px;">
            <span>المتبقي تحصيله:</span>
            <span>${p.remainingAmount} ج.م</span>
          </div>
        ` : ''}
      </div>

      <div class="dashed-line"></div>

      <div class="footer">
        <div>شكراً لتعاملكم مع مطعم أبو خاطر ❤️</div>
        <div>للطلبات والشكاوى: 01038035884</div>
      </div>
    `;

    const html = this.generateHtmlWrapper(`Cashier Receipt #${safeOrderNum}`, content);
    return await this.printReceiptHtml(html, p.orderNumber, 'cashier', forceReprint);
  }

  // ==========================================
  // 3. DELIVERY / PILOT RECEIPT (بون تسليم الطيار)
  // ==========================================
  async printDeliveryReceipt(order, forceReprint = false, pilotName = null) {
    const p = normalizePrintOrder(order, pilotName);
    if (!p) return { success: false, error: 'invalid_order' };

    if (p.isPickup) {
      // طلبات الاستلام تطبع فاتورة الكاشير العادية
      return await this.printCashierReceipt(order, forceReprint, pilotName);
    }

    const safeOrderNum = escapeHtml(p.orderNumber);
    const safeCustomer = escapeHtml(p.customerName);
    const safePhone = escapeHtml(p.phone || 'غير مسجل');
    const safePhone2 = p.phone2 ? escapeHtml(p.phone2) : null;
    const safeArea = escapeHtml(p.address || 'عنوان العميل');
    const safePilot = escapeHtml(p.pilotName || 'طيار الدليفري');
    const safePayment = escapeHtml(p.paymentMethod);

    const itemsHtml = p.items.map(item => {
      const safeName = escapeHtml(item.productName);
      const safeVariant = item.variantName ? `<span class="variant-tag"> (🔹 ${escapeHtml(item.variantName)})</span>` : '';
      return `
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px;">
          <span>• ${safeName}${safeVariant}</span>
          <span class="bold">x${item.quantity}</span>
        </div>
      `;
    }).join('');

    const content = `
      <div class="header">
        <div class="title">بون تسليم الدليفري</div>
        <div class="subtitle">نسخة الطيار والعميل</div>
        <div class="bold" style="font-size: 18px; margin-top: 2px;">أوردر #${safeOrderNum}</div>
      </div>

      <div class="section">
        <div class="badge-box">الطيار: ${safePilot}</div>
        <div class="flex"><span>العميل:</span> <span class="bold">${safeCustomer}</span></div>
        <div class="flex"><span>الهاتف 1:</span> <span class="bold">${safePhone}</span></div>
        ${safePhone2 ? `<div class="flex"><span>الهاتف 2:</span> <span class="bold">${safePhone2}</span></div>` : ''}
        <div style="margin-top: 4px; border: 1px solid #000; padding: 4px; background: #fafafa;">
          <strong>العنوان:</strong> ${safeArea}
        </div>
      </div>

      <div class="solid-line"></div>
      <div style="font-weight: 800; font-size: 12px; margin-bottom: 4px;">الأصناف المطلوبة:</div>
      ${itemsHtml}

      <div class="solid-line"></div>

      <div class="section">
        <div class="flex"><span>إجمالي الأوردر:</span> <span class="bold">${p.total} ج.م</span></div>
        <div class="flex"><span>طريقة الدفع:</span> <span class="bold">${safePayment}</span></div>
        ${p.paidNow > 0 ? `<div class="flex"><span>المدفوع مسبقاً:</span> <span class="bold">${p.paidNow} ج.م</span></div>` : ''}
        <div class="badge-black" style="font-size: 16px; margin-top: 6px;">
          المطلوب تحصيله: ${p.remainingAmount} ج.م
        </div>
      </div>

      <div class="dashed-line"></div>
      <div class="footer">
        <div>توقيع المستلم: ..............................</div>
      </div>
    `;

    const html = this.generateHtmlWrapper(`Delivery Slip #${safeOrderNum}`, content);
    return await this.printReceiptHtml(html, p.orderNumber, 'delivery', forceReprint);
  }

  // ==========================================
  // 4. DAILY REPORT (التقرير اليومي الشامل)
  // ==========================================
  async printDailyReport(reportData) {
    const totalSales = Number(reportData.totalSales || 0);
    const totalOrders = Number(reportData.totalOrders || 0);
    const completedOrders = Number(reportData.completedOrders || 0);
    const cancelledOrders = Number(reportData.cancelledOrders || 0);
    const totalDeliveryFees = Number(reportData.totalDeliveryFees || 0);
    const totalCash = Number(reportData.totalCash || 0);

    const content = `
      <div class="header">
        <div class="title">التقرير اليومي الشامل</div>
        <div class="subtitle">${new Date().toLocaleDateString('ar-EG')} - ${new Date().toLocaleTimeString('ar-EG')}</div>
      </div>
      <div class="section" style="font-size: 14px;">
        <div class="flex"><span>إجمالي المبيعات:</span> <span class="bold">${totalSales} ج.م</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي الطلبات:</span> <span class="bold">${totalOrders}</span></div>
        <div class="flex"><span>الطلبات المكتملة:</span> <span class="bold">${completedOrders}</span></div>
        <div class="flex"><span>الطلبات الملغية:</span> <span class="bold">${cancelledOrders}</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي رسوم التوصيل:</span> <span class="bold">${totalDeliveryFees} ج.م</span></div>
        <div class="solid-line"></div>
        <div class="flex" style="font-size: 17px; font-weight: 900;">
          <span>إجمالي الكاش المحصل:</span>
          <span>${totalCash} ج.م</span>
        </div>
      </div>
      <div class="solid-line"></div>
      <div class="footer">تم إصدار التقرير بواسطة نظام أبو خاطر الآلي</div>
    `;

    const html = this.generateHtmlWrapper(`Daily Report`, content);
    return await this.printReceiptHtml(html, `DAILY_${Date.now()}`, 'report', true);
  }

  // ==========================================
  // 5. DRIVER REPORT (تقرير وردية الطيار)
  // ==========================================
  async printDriverReport(driverReport) {
    const safeDriverName = escapeHtml(driverReport.name || 'طيار');
    const ordersCount = Number(driverReport.ordersCount || 0);
    const deliveredCount = Number(driverReport.deliveredCount || 0);
    const returnedCount = Number(driverReport.returnedCount || 0);
    const totalCollected = Number(driverReport.totalCollected || 0);

    const content = `
      <div class="header">
        <div class="title">تقرير وردية الطيار</div>
        <div class="subtitle">الطيار: ${safeDriverName}</div>
        <div class="subtitle">التاريخ: ${new Date().toLocaleDateString('ar-EG')}</div>
      </div>
      <div class="section" style="font-size: 14px;">
        <div class="flex"><span>إجمالي الطلبات المسندة:</span> <span class="bold">${ordersCount}</span></div>
        <div class="flex"><span>الطلبات المسلمة بنجاح:</span> <span class="bold">${deliveredCount}</span></div>
        <div class="flex"><span>الطلبات المرتجعة / الملغية:</span> <span class="bold">${returnedCount}</span></div>
        <div class="double-line"></div>
        <div class="flex" style="font-size: 17px; font-weight: 900;">
          <span>إجمالي التحصيل:</span>
          <span>${totalCollected} ج.م</span>
        </div>
      </div>
      <div class="dashed-line"></div>
      <div class="footer">توقيع الطيار: ...........................</div>
    `;

    const html = this.generateHtmlWrapper(`Driver Report - ${safeDriverName}`, content);
    return await this.printReceiptHtml(html, `DRIVER_${driverReport.id || 'N'}_${Date.now()}`, 'report', true);
  }
}

export const printerService = new PrinterService();
