/**
 * إعدادات الروابط والـ API لنظام أبو خاطر
 * مجمع هنا لسهولة التعديل في مكان واحد
 * التواصل يتم مباشرة عبر Supabase
 */

export const API_CONFIG = {
    // 1. روابط التنبيهات الصوتية
    SOUNDS: {
        NEW_ORDER: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
        ALERT: 'https://assets.mixkit.co/active_storage/sfx/2857/2857-preview.mp3'
    },

    // 2. إعدادات النظام (System Config)
    POLLING_INTERVAL: 30000, // فحص احتياطي للطلبات كل 30 ثانية في الخلفية
    AUTO_REFRESH: true       // تفعيل التحديث التلقائي عبر Realtime
};
