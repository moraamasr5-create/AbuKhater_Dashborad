/**
 * Lightweight Sensitive Admin Action Alert Service
 * Developed for AbuKhater_System
 * 
 * Strict Event Classification:
 * - ADMIN_SENSITIVE_ALERT (🔔): Authorized actor + Successful sensitive action.
 * - SECURITY_FAILURE (🚨): Unauthorized / Permission-denied attempt.
 * - NOTIFICATION_SYSTEM_FAILURE (⚙️): Technical failure in Telegram delivery (non-fatal, logged only).
 * - NORMAL_EVENT (ℹ️): Standard operational events (no sensitive alert triggered).
 */

import { supabaseService } from './supabaseService';

// Dynamic credentials cache (loaded from app_config / environment)
let cachedBotToken = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGRAM_BOT_TOKEN) || '';
let cachedChatId = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGRAM_CHAT_ID) || '';
let isCredentialsLoaded = false;

// Deduplication cache: signature -> timestamp (prevents rapid identical duplicate alerts)
const recentAlerts = new Map();
const DEDUPLICATION_WINDOW_MS = 4000;

/**
 * Format current timestamp in Cairo/Egypt timezone (DD/MM/YYYY hh:mm A)
 */
const getFormattedTime = () => {
  try {
    return new Date().toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return new Date().toISOString();
  }
};

/**
 * Helper to format actor identity clearly without fabricating missing fields
 */
const formatActorString = (actor) => {
  if (!actor) return 'مدير النظام (Admin)';
  if (typeof actor === 'string') return actor;

  const name = actor.name || actor.fullName || actor.display_name || actor.email || 'مسؤول';
  const role = actor.role || (actor.userRole ? actor.userRole : '');

  if (role) {
    return `${name} (${role})`;
  }
  return name;
};

/**
 * Load Telegram credentials dynamically from Supabase app_config
 */
const ensureCredentials = async () => {
  if (isCredentialsLoaded && cachedBotToken && cachedChatId) return;

  try {
    const configMap = await supabaseService.fetchAppConfig();
    if (configMap) {
      if (configMap.TELEGRAM_BOT_TOKEN || configMap.telegram_bot_token) {
        cachedBotToken = configMap.TELEGRAM_BOT_TOKEN || configMap.telegram_bot_token;
      }
      if (configMap.TELEGRAM_CHAT_ID || configMap.telegram_chat_id) {
        cachedChatId = configMap.TELEGRAM_CHAT_ID || configMap.telegram_chat_id;
      }
      isCredentialsLoaded = true;
    }
  } catch (err) {
    console.warn('⚙️ [NotificationSystemFailure] Could not fetch Telegram credentials from app_config:', err?.message || err);
  }
};

export const telegramAlertService = {
  /**
   * Update credentials dynamically from settings/runtime
   */
  setCredentials({ botToken, chatId }) {
    if (botToken && typeof botToken === 'string' && botToken.trim()) {
      cachedBotToken = botToken.trim();
    }
    if (chatId && typeof chatId === 'string' && chatId.trim()) {
      cachedChatId = chatId.trim();
    }
    isCredentialsLoaded = true;
  },

  /**
   * Raw sender method - Fire-and-forget, non-blocking, error-safe.
   * Any technical failure is logged as NOTIFICATION_SYSTEM_FAILURE, never a SECURITY_FAILURE.
   */
  async sendMessage(text, alertType = 'info') {
    if (!text || typeof text !== 'string') return;

    // Deduplication check
    const signature = `${alertType}:${text.slice(0, 100)}`;
    const now = Date.now();
    const lastSent = recentAlerts.get(signature);

    if (lastSent && now - lastSent < DEDUPLICATION_WINDOW_MS) {
      console.log('🔇 [TelegramAlert] Suppressed duplicate alert within window');
      return;
    }
    recentAlerts.set(signature, now);

    // Clean up old deduplication cache entries
    if (recentAlerts.size > 100) {
      for (const [k, v] of recentAlerts.entries()) {
        if (now - v > DEDUPLICATION_WINDOW_MS * 2) recentAlerts.delete(k);
      }
    }

    await ensureCredentials();

    const botToken = cachedBotToken;
    const chatId = cachedChatId;

    if (!botToken || !chatId) {
      console.warn('⚙️ [NotificationSystemFailure] Telegram Bot Token or Chat ID not configured. Notification skipped.');
      return;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`⚙️ [NotificationSystemFailure] Telegram API returned HTTP ${response.status}:`, errText);
      }
    } catch (err) {
      // ⚙️ Technical delivery failure must NEVER throw or block the primary business operation
      console.warn('⚙️ [NotificationSystemFailure] Network delivery error (non-fatal):', err?.message || err);
    }
  },

  // ─────────────────────────────────────────────────────────
  // 🔔 A — ADMIN_SENSITIVE_ALERT (Authorized + Succeeded)
  // ─────────────────────────────────────────────────────────

  /**
   * 🔔 Price changed on a menu item
   */
  async notifyPriceChange({ actor, itemName, oldPrice, newPrice, categoryName }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🔔 <b>تنبيه إداري | ADMIN ALERT</b>
⚠️ <b>تعديل سعر صنف تجاري</b>

👤 <b>المنفذ:</b> ${actorStr}
⚙️ <b>العملية:</b> تعديل سعر منتج
🍽️ <b>المنتج:</b> ${itemName} ${categoryName ? `(${categoryName})` : ''}
💰 <b>السعر السابق:</b> ${oldPrice} ج.م
💵 <b>السعر الجديد:</b> ${newPrice} ج.م

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم التنفيذ وتحديث المنيو`;

    await this.sendMessage(text, 'price_change');
  },

  /**
   * 🔔 New product added to the menu
   */
  async notifyProductCreated({ actor, itemName, price, categoryName }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🔔 <b>تنبيه إداري | ADMIN ALERT</b>
✨ <b>إضافة صنف جديد للمنيو</b>

👤 <b>المنفذ:</b> ${actorStr}
🍽️ <b>الصنف:</b> ${itemName}
📂 <b>القسم:</b> ${categoryName || 'غير محدد'}
💰 <b>السعر:</b> ${price} ج.م

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم النشر بنجاح في قاعدة البيانات`;

    await this.sendMessage(text, 'product_created');
  },

  /**
   * 🔴 Critical Alert: Product permanently deleted from menu
   */
  async notifyProductDeleted({ actor, itemName, price, categoryName }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🔴 <b>إجراء إداري حساس | CRITICAL ACTION</b>
🗑️ <b>حذف صنف نهائياً من المنيو</b>

👤 <b>المنفذ:</b> ${actorStr}
🍽️ <b>الصنف المحذوف:</b> ${itemName} ${categoryName ? `(${categoryName})` : ''}
💰 <b>السعر الملغي:</b> ${price || 0} ج.م

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم الحذف النهائي من النظام`;

    await this.sendMessage(text, 'product_deleted');
  },

  /**
   * 🔴 Critical Alert: Category deleted
   */
  async notifyCategoryDeleted({ actor, categoryName }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🔴 <b>إجراء إداري حساس | CRITICAL ACTION</b>
🗑️ <b>حذف قسم كامل من المنيو</b>

👤 <b>المنفذ:</b> ${actorStr}
📂 <b>القسم المحذوف:</b> ${categoryName}

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم الحذف بنجاح`;

    await this.sendMessage(text, 'category_deleted');
  },

  /**
   * 🟠 High Alert: Sensitive System / Payment Settings Changed
   */
  async notifySettingsChanged({ actor, changedItems }) {
    if (!changedItems || !changedItems.length) return;

    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const changesList = changedItems.map(item => `• <b>${item.label}:</b> ${item.oldVal} ➔ <b>${item.newVal}</b>`).join('\n');

    const text = `🟠 <b>تنبيه إداري | SETTINGS CHANGED</b>
⚙️ <b>تعديل إعدادات المطعم وقواعد التسعير</b>

👤 <b>المنفذ:</b> ${actorStr}
📝 <b>التعديلات المطبقة:</b>
${changesList}

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم حفظ وتطبيق الإعدادات`;

    await this.sendMessage(text, 'settings_changed');
  },

  /**
   * 🟠 Operational Alert: Order Cancelled by Cashier/Admin
   */
  async notifyOrderCancelled({ actor, orderNumber, reason, total, customerName }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🟠 <b>تنبيه تشغيلي | ORDER CANCELLED</b>
🚫 <b>إلغاء طلب</b>

👤 <b>المنفذ:</b> ${actorStr}
🧾 <b>رقم الطلب:</b> ${orderNumber}
👤 <b>العميل:</b> ${customerName || 'غير مسجل'}
💰 <b>القيمة:</b> ${total || 0} ج.م
❓ <b>السبب:</b> ${reason || 'لم يُحدد سبب'}

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم الإلغاء`;

    await this.sendMessage(text, 'order_cancelled');
  },

  /**
   * 🟠 Operational Alert: Shift Closed
   */
  async notifyShiftClosed({ actor, totalOrders, totalSales, isAuto = false }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `📊 <b>إغلاق وردية | SHIFT CLOSED</b>
${isAuto ? '⏰ <b>إغلاق تلقائي بحلول وقت نهاية التشغيل</b>' : '👤 <b>إغلاق يدوي من قبل الإدارة</b>'}

👤 <b>المنفذ:</b> ${actorStr}
🧾 <b>إجمالي الطلبات:</b> ${totalOrders || 0} طلب
💰 <b>إجمالي المبيعات:</b> ${totalSales || 0} ج.م

🕒 <b>الوقت:</b> ${timeStr}
✅ <b>الحالة:</b> تم حفظ التقرير وإعادة ضبط الطيارين`;

    await this.sendMessage(text, 'shift_closed');
  },

  // ─────────────────────────────────────────────────────────
  // 🚨 B — SECURITY_FAILURE (Unauthorized / Permission Denied)
  // ─────────────────────────────────────────────────────────

  /**
   * 🚨 Security Failure Alert: Unauthorized attempt / Permission Denied
   */
  async notifySecurityFailure({ actor, action, target, reason }) {
    const actorStr = formatActorString(actor);
    const timeStr = getFormattedTime();

    const text = `🚨 <b>تحذير أمني | SECURITY FAILURE</b>
⛔ <b>محاولة إجراء غير مصرح به!</b>

👤 <b>المستخدم:</b> ${actorStr}
⚙️ <b>العملية المستهدفة:</b> ${action}
🎯 <b>العنصر:</b> ${target || 'غير محدد'}
🛡️ <b>السبب:</b> ${reason || 'المستخدم لا يملك الصلاحية الإدارية المطلوبة'}

🕒 <b>الوقت:</b> ${timeStr}
❌ <b>النتيجة:</b> تم حظر المحاولة وحماية البيانات`;

    await this.sendMessage(text, 'security_failure');
  }
};
