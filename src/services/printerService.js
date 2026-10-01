// Developed & Owned by D.AmrMamdouh - 01038035884
// Cache to prevent duplicate printing across app re-renders
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

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
 * @param {any} unsafe - The raw value to escape
 * @returns {string} Sanitized string safe for HTML interpolation
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
 * @param {any} notes - The raw notes string
 * @returns {string} Sanitized HTML string
 */
export const sanitizeNotes = (notes) => {
  if (!notes) return '';
  return escapeHtml(notes).replace(/\r?\n/g, '<br/>');
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
      const xpPrinter = printers.find(p => p.toLowerCase().includes('xp') || p.toLowerCase().includes('pos') || p.toLowerCase().includes('thermal') || p.toLowerCase().includes('80'));
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
      <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>${safeTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;800;900&display=swap');
          
          @page {
            size: 80mm auto;
            margin: 0;
          }
          
          @media print {
            html, body {
              width: 80mm;
              margin: 0;
              padding: 0;
              background: #fff;
              color: #000;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
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
            .header, .section, .items-table, .footer, .solid-line, .dashed-line, tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
          
          * {
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Cairo', sans-serif;
            margin: 0;
            padding: 2mm 4mm;
            width: 72mm;
            color: #000;
            background: #fff;
            font-size: 13px;
            line-height: 1.4;
            overflow-x: hidden;
          }
          
          .receipt-container {
            width: 100%;
          }
          
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .title { font-size: 18px; font-weight: 900; margin: 0; }
          .subtitle { font-size: 12px; font-weight: 800; margin: 2px 0; }
          .section { margin-bottom: 8px; }
          .flex { display: flex; justify-content: space-between; align-items: center; gap: 4px; }
          .bold { font-weight: 800; }
          .dashed-line { border-top: 1px dashed #000; margin: 6px 0; }
          .solid-line { border-top: 2px solid #000; margin: 6px 0; }
          .items-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          .items-table th, .items-table td { padding: 3px 0; text-align: right; vertical-align: top; }
          .items-table th { border-bottom: 1px solid #000; font-weight: 900; font-size: 12px; }
          .center { text-align: center; }
          .footer { text-align: center; font-size: 11px; margin-top: 12px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          ${content}
        </div>
        <div style="text-align: center; font-size: 9px; color: #555; margin-top: 12px; border-top: 1px dotted #000; padding-top: 4px; font-family: sans-serif; direction: ltr; page-break-inside: avoid; break-inside: avoid;">
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

  // 1. Kitchen Receipt (بون المطبخ)
  async printKitchenReceipt(order, forceReprint = false, pilotName = null) {
    const safeOriginalId = escapeHtml(order.originalId || order.id || '');
    const safeCustomerName = escapeHtml(order.customerName || '');
    const safeArea = escapeHtml(order.area || '');
    const safePilotName = escapeHtml(pilotName || order.pilotName || '');

    const itemsHtml = (order.items || []).map(i => {
      const safeItemName = escapeHtml(i.name || 'صنف');
      const safeNotes = i.notes ? sanitizeNotes(i.notes) : '';
      const safeCount = Number(i.count || i.quantity || 1);
      return `
        <tr>
          <td class="bold" style="font-size:16px;">${safeItemName} ${safeNotes ? `<div style="font-size:12px;color:#666;">${safeNotes}</div>` : ''}</td>
          <td class="bold center" style="font-size:18px;">${safeCount}</td>
        </tr>
      `;
    }).join('');

    const content = `
      <div class="header">
        <div class="title">بون المطبخ (KITCHEN)</div>
        <div class="subtitle">رقم الطلب: #${safeOriginalId}</div>
        <div class="subtitle">${order.source === 'online' ? 'توصيل (Delivery)' : 'تيك أواي / صالة'}</div>
      </div>
      <div class="section">
        <div class="flex"><span>الوقت:</span> <span class="bold">${new Date(order.timestamp || Date.now()).toLocaleTimeString('ar-EG')}</span></div>
        ${safeCustomerName ? `<div class="flex"><span>العميل:</span> <span class="bold">${safeCustomerName}</span></div>` : ''}
        ${safeArea ? `<div class="flex"><span>العنوان:</span> <span class="bold">${safeArea}</span></div>` : ''}
        ${safePilotName ? `<div style="margin-top:6px; font-weight:bold; border:1px solid #000; padding:6px; text-align:center; font-size:14px;">الطيار: ${safePilotName}</div>` : ''}
      </div>
      <div class="solid-line"></div>
      <table class="items-table">
        <thead>
          <tr>
            <th>الصنف</th>
            <th class="center" style="width:40px;">الكمية</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      <div class="solid-line"></div>
      <div class="footer">أبو خاطر للتوصيل • نسخة المطبخ</div>
    `;

    const html = this.generateHtmlWrapper(`Kitchen Ticket #${safeOriginalId}`, content);
    return await this.printReceiptHtml(html, order.id, 'kitchen', forceReprint);
  }

  // 2. Cashier Receipt (فاتورة العميل / الكاشير)
  async printCashierReceipt(order, forceReprint = false, pilotName = null) {
    const safeOriginalId = escapeHtml(order.originalId || order.id || '');
    const safeCustomerName = escapeHtml(order.customerName || 'عميل');
    const safePhone = escapeHtml(order.phone || 'غير مسجل');
    const safeArea = escapeHtml(order.area || '');
    const safePaymentMethod = escapeHtml(order.paymentMethod || 'كاش');
    const safePilotName = escapeHtml(pilotName || order.pilotName || '');

    const itemsHtml = (order.items || []).map(i => {
      const safeItemName = escapeHtml(i.name || 'صنف');
      const safeCount = Number(i.count || i.quantity || 1);
      const safePrice = Number(i.price || 0);
      const safeTotal = safeCount * safePrice;
      return `
        <tr>
          <td>${safeItemName}</td>
          <td class="center">${safeCount}</td>
          <td>${safePrice} ج</td>
          <td>${safeTotal} ج</td>
        </tr>
      `;
    }).join('');

    const subtotal = Number(order.subtotal) || Math.max(0, Number(order.total || 0) - Number(order.deliveryFee || 0));
    const deliveryFee = Number(order.deliveryFee || 0);
    const serviceFee = Number(order.serviceFee || 0);
    const total = Number(order.total || 0);
    const paidNow = Number(order.paidNow || 0);
    const remainingAmount = Number(order.remainingAmount || 0);

    const content = `
      <div class="header">
        <div class="title">مطعم أبو خاطر</div>
        <div class="subtitle">إدارة وتوصيل الطلبات</div>
        <div class="dashed-line"></div>
        <div class="bold" style="font-size:18px;">فاتورة رقم #${safeOriginalId}</div>
      </div>
      <div class="section">
        <div class="flex"><span>التاريخ والوقت:</span> <span class="bold">${new Date(order.timestamp || Date.now()).toLocaleString('ar-EG')}</span></div>
        <div class="flex"><span>اسم العميل:</span> <span class="bold">${safeCustomerName}</span></div>
        <div class="flex"><span>رقم الهاتف:</span> <span class="bold">${safePhone}</span></div>
        ${safeArea ? `<div class="flex"><span>العنوان:</span> <span class="bold">${safeArea}</span></div>` : ''}
        <div class="flex"><span>طريقة الدفع:</span> <span class="bold">${safePaymentMethod}</span></div>
        ${safePilotName ? `<div style="margin-top:6px; font-weight:bold; border:1px solid #000; padding:6px; text-align:center; font-size:14px;">الطيار: ${safePilotName}</div>` : ''}
      </div>
      <div class="solid-line"></div>
      <table class="items-table" style="font-size:12px;">
        <thead>
          <tr>
            <th>الصنف</th>
            <th class="center" style="width:25px;">العدد</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      <div class="solid-line"></div>
      <div class="section" style="font-size:15px;">
        <div class="flex"><span>المجموع:</span> <span class="bold">${subtotal} ج.م</span></div>
        ${deliveryFee > 0 ? `<div class="flex"><span>خدمة التوصيل:</span> <span class="bold">${deliveryFee} ج.م</span></div>` : ''}
        ${serviceFee > 0 ? `<div class="flex"><span>الخدمة:</span> <span class="bold">${serviceFee} ج.م</span></div>` : ''}
        <div class="solid-line"></div>
        <div class="flex" style="font-size:18px;font-weight:900;"><span>الإجمالي النهائي:</span> <span class="bold">${total} ج.م</span></div>
        ${paidNow > 0 ? `<div class="flex" style="color:#10b981;"><span>المدفوع:</span> <span class="bold">${paidNow} ج.م</span></div>` : ''}
        ${remainingAmount > 0 ? `<div class="flex" style="color:#ef4444;font-size:16px;"><span>المتبقي تحصيله:</span> <span class="bold">${remainingAmount} ج.م</span></div>` : ''}
      </div>
      <div class="dashed-line"></div>
      <div class="footer">
        <div>شكراً لزيارتكم مطعم أبو خاطر ❤️</div>
        <div>للطلبات والشكاوى: 0100000000</div>
      </div>
    `;

    const html = this.generateHtmlWrapper(`Cashier Receipt #${safeOriginalId}`, content);
    return await this.printReceiptHtml(html, order.id, 'cashier', forceReprint);
  }

  // 3. Daily Report (تقرير المبيعات اليومية)
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
        <div class="subtitle">${new Date().toLocaleDateString('ar-EG')}</div>
      </div>
      <div class="section" style="font-size:16px;">
        <div class="flex"><span>إجمالي المبيعات:</span> <span class="bold">${totalSales} ج.م</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي الطلبات:</span> <span class="bold">${totalOrders}</span></div>
        <div class="flex"><span>الطلبات المكتملة:</span> <span class="bold" style="color:#10b981;">${completedOrders}</span></div>
        <div class="flex"><span>الطلبات الملغية:</span> <span class="bold" style="color:#ef4444;">${cancelledOrders}</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي رسوم التوصيل:</span> <span class="bold">${totalDeliveryFees} ج.م</span></div>
        <div class="flex"><span>إجمالي الكاش المحصل:</span> <span class="bold">${totalCash} ج.م</span></div>
      </div>
      <div class="solid-line"></div>
      <div class="footer">تم إصدار التقرير بواسطة النظام الآلي</div>
    `;

    const html = this.generateHtmlWrapper(`Daily Report`, content);
    return await this.printReceiptHtml(html, `DAILY_${Date.now()}`, 'report', true);
  }

  // 4. Driver Report (تقرير الطيار)
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
      <div class="section" style="font-size:16px;">
        <div class="flex"><span>إجمالي الطلبات:</span> <span class="bold">${ordersCount}</span></div>
        <div class="flex"><span>الطلبات المسلمة:</span> <span class="bold" style="color:#10b981;">${deliveredCount}</span></div>
        <div class="flex"><span>الطلبات المرتجعة:</span> <span class="bold" style="color:#ef4444;">${returnedCount}</span></div>
        <div class="solid-line"></div>
        <div class="flex" style="font-size:20px;"><span>إجمالي التحصيل:</span> <span class="bold">${totalCollected} ج.م</span></div>
      </div>
      <div class="dashed-line"></div>
      <div class="footer">توقيع الطيار: ...........................</div>
    `;

    const html = this.generateHtmlWrapper(`Driver Report - ${safeDriverName}`, content);
    return await this.printReceiptHtml(html, `DRIVER_${driverReport.id}_${Date.now()}`, 'report', true);
  }
}

export const printerService = new PrinterService();
