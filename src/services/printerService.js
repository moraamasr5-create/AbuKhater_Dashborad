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
    return `
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
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
    const itemsHtml = (order.items || []).map(i => `
      <tr>
        <td class="bold" style="font-size:16px;">${i.name} ${i.notes ? `<div style="font-size:12px;color:#666;">${i.notes}</div>` : ''}</td>
        <td class="bold center" style="font-size:18px;">${i.count || i.quantity || 1}</td>
      </tr>
    `).join('');

    const content = `
      <div class="header">
        <div class="title">بون المطبخ (KITCHEN)</div>
        <div class="subtitle">رقم الطلب: #${order.originalId || order.id}</div>
        <div class="subtitle">${order.source === 'online' ? 'توصيل (Delivery)' : 'تيك أواي / صالة'}</div>
      </div>
      <div class="section">
        <div class="flex"><span>الوقت:</span> <span class="bold">${new Date(order.timestamp || Date.now()).toLocaleTimeString('ar-EG')}</span></div>
        ${order.customerName ? `<div class="flex"><span>العميل:</span> <span class="bold">${order.customerName}</span></div>` : ''}
        ${order.area ? `<div class="flex"><span>العنوان:</span> <span class="bold">${order.area}</span></div>` : ''}
        ${(pilotName || order.pilotName) ? `<div style="margin-top:6px; font-weight:bold; border:1px solid #000; padding:6px; text-align:center; font-size:14px;">الطيار: ${pilotName || order.pilotName}</div>` : ''}
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

    const html = this.generateHtmlWrapper(`Kitchen Ticket #${order.originalId || order.id}`, content);
    return await this.printReceiptHtml(html, order.id, 'kitchen', forceReprint);
  }

  // 2. Cashier Receipt (فاتورة العميل / الكاشير)
  async printCashierReceipt(order, forceReprint = false, pilotName = null) {
    const itemsHtml = (order.items || []).map(i => `
      <tr>
        <td>${i.name}</td>
        <td class="center">${i.count || i.quantity || 1}</td>
        <td>${i.price || 0} ج</td>
        <td>${(i.count || i.quantity || 1) * (i.price || 0)} ج</td>
      </tr>
    `).join('');

    const subtotal = order.subtotal || Math.max(0, order.total - (order.deliveryFee || 0));

    const content = `
      <div class="header">
        <div class="title">مطعم أبو خاطر</div>
        <div class="subtitle">إدارة وتوصيل الطلبات</div>
        <div class="dashed-line"></div>
        <div class="bold" style="font-size:18px;">فاتورة رقم #${order.originalId || order.id}</div>
      </div>
      <div class="section">
        <div class="flex"><span>التاريخ والوقت:</span> <span class="bold">${new Date(order.timestamp || Date.now()).toLocaleString('ar-EG')}</span></div>
        <div class="flex"><span>اسم العميل:</span> <span class="bold">${order.customerName || 'عميل'}</span></div>
        <div class="flex"><span>رقم الهاتف:</span> <span class="bold">${order.phone || 'غير مسجل'}</span></div>
        ${order.area ? `<div class="flex"><span>العنوان:</span> <span class="bold">${order.area}</span></div>` : ''}
        <div class="flex"><span>طريقة الدفع:</span> <span class="bold">${order.paymentMethod || 'كاش'}</span></div>
        ${(pilotName || order.pilotName) ? `<div style="margin-top:6px; font-weight:bold; border:1px solid #000; padding:6px; text-align:center; font-size:14px;">الطيار: ${pilotName || order.pilotName}</div>` : ''}
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
        ${order.deliveryFee > 0 ? `<div class="flex"><span>خدمة التوصيل:</span> <span class="bold">${order.deliveryFee} ج.م</span></div>` : ''}
        ${order.serviceFee > 0 ? `<div class="flex"><span>الخدمة:</span> <span class="bold">${order.serviceFee} ج.م</span></div>` : ''}
        <div class="solid-line"></div>
        <div class="flex" style="font-size:18px;font-weight:900;"><span>الإجمالي النهائي:</span> <span class="bold">${order.total} ج.م</span></div>
        ${Number(order.paidNow) > 0 ? `<div class="flex" style="color:#10b981;"><span>المدفوع:</span> <span class="bold">${order.paidNow} ج.م</span></div>` : ''}
        ${Number(order.remainingAmount) > 0 ? `<div class="flex" style="color:#ef4444;font-size:16px;"><span>المتبقي تحصيله:</span> <span class="bold">${order.remainingAmount} ج.م</span></div>` : ''}
      </div>
      <div class="dashed-line"></div>
      <div class="footer">
        <div>شكراً لزيارتكم مطعم أبو خاطر ❤️</div>
        <div>للطلبات والشكاوى: 0100000000</div>
      </div>
    `;

    const html = this.generateHtmlWrapper(`Cashier Receipt #${order.originalId || order.id}`, content);
    return await this.printReceiptHtml(html, order.id, 'cashier', forceReprint);
  }

  // 3. Daily Report (تقرير المبيعات اليومية)
  async printDailyReport(reportData) {
    const content = `
      <div class="header">
        <div class="title">التقرير اليومي الشامل</div>
        <div class="subtitle">${new Date().toLocaleDateString('ar-EG')}</div>
      </div>
      <div class="section" style="font-size:16px;">
        <div class="flex"><span>إجمالي المبيعات:</span> <span class="bold">${reportData.totalSales} ج.م</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي الطلبات:</span> <span class="bold">${reportData.totalOrders}</span></div>
        <div class="flex"><span>الطلبات المكتملة:</span> <span class="bold" style="color:#10b981;">${reportData.completedOrders}</span></div>
        <div class="flex"><span>الطلبات الملغية:</span> <span class="bold" style="color:#ef4444;">${reportData.cancelledOrders}</span></div>
        <div class="dashed-line"></div>
        <div class="flex"><span>إجمالي رسوم التوصيل:</span> <span class="bold">${reportData.totalDeliveryFees} ج.م</span></div>
        <div class="flex"><span>إجمالي الكاش المحصل:</span> <span class="bold">${reportData.totalCash} ج.م</span></div>
      </div>
      <div class="solid-line"></div>
      <div class="footer">تم إصدار التقرير بواسطة النظام الآلي</div>
    `;

    const html = this.generateHtmlWrapper(`Daily Report`, content);
    return await this.printReceiptHtml(html, `DAILY_${Date.now()}`, 'report', true);
  }

  // 4. Driver Report (تقرير الطيار)
  async printDriverReport(driverReport) {
    const content = `
      <div class="header">
        <div class="title">تقرير وردية الطيار</div>
        <div class="subtitle">الطيار: ${driverReport.name}</div>
        <div class="subtitle">التاريخ: ${new Date().toLocaleDateString('ar-EG')}</div>
      </div>
      <div class="section" style="font-size:16px;">
        <div class="flex"><span>إجمالي الطلبات:</span> <span class="bold">${driverReport.ordersCount}</span></div>
        <div class="flex"><span>الطلبات المسلمة:</span> <span class="bold" style="color:#10b981;">${driverReport.deliveredCount}</span></div>
        <div class="flex"><span>الطلبات المرتجعة:</span> <span class="bold" style="color:#ef4444;">${driverReport.returnedCount}</span></div>
        <div class="solid-line"></div>
        <div class="flex" style="font-size:20px;"><span>إجمالي التحصيل:</span> <span class="bold">${driverReport.totalCollected} ج.م</span></div>
      </div>
      <div class="dashed-line"></div>
      <div class="footer">توقيع الطيار: ...........................</div>
    `;

    const html = this.generateHtmlWrapper(`Driver Report - ${driverReport.name}`, content);
    return await this.printReceiptHtml(html, `DRIVER_${driverReport.id}_${Date.now()}`, 'report', true);
  }
}

export const printerService = new PrinterService();
