/**
 * 🛡️ Safe Order Parser & Repair Engine
 * هذا المحرك يضمن أن أي بيانات قادمة من n8n يتم تنظيفها وترميمها
 * قبل دخولها إلى الـ State أو عرضها في الداشبورد.
 */

export const repairOrder = (order) => {
    if (!order) return null;

    // 🍔 معالجة الأصناف (Items Healing)
    const items = Array.isArray(order.items) ? order.items : [];
    const safeItems = items.map(item => ({
        name: item.name || "صنف غير معروف",
        count: Number(item.quantity || item.count || item.qty || 1) || 1,
        price: Number(item.price || item.unit_price || 0) || 0,
        menuItemId: item.menuItemId || item.menu_item_id || null
    }));

    // 💰 معالجة الماليات (Financial Healing)
    const itemsTotal = safeItems.reduce((sum, item) => sum + (item.price * item.count), 0);
    const rawDelivery = order.payment?.delivery_fee || order.totals?.delivery_fee || order.deliveryFee || order.delivery_fee || 0;
    const rawService = order.payment?.service_fee || order.totals?.service_fee || order.serviceFee || order.service_fee || 0;

    const safeDelivery = isNaN(Number(rawDelivery)) ? 0 : Number(rawDelivery);
    const safeService = isNaN(Number(rawService)) ? 0 : Number(rawService);
    const computedTotal = itemsTotal + safeDelivery + safeService;

    const paymentMethodStr = order.payment?.method || order.paymentMethod || 'Cash';
    const isCashOnDelivery = (!paymentMethodStr || paymentMethodStr === 'Cash' || String(paymentMethodStr).toLowerCase().includes('cash'));
    const paidNow = isCashOnDelivery ? 0 : Number(order.payment?.paid_now || order.totals?.paid_now || order.paidNow || 0);
    const remainingAmount = isCashOnDelivery ? computedTotal : (computedTotal - paidNow);

    // 👤 معالجة بيانات العميل (Customer Healing)
    const customer = order.customer || {};
    const safeCustomer = {
        name: (customer.name || customer.full_name || "عميل غير معروف").trim(),
        phone: customer.phone_primary || customer.phone || customer.mobile || "غير مسجل",
        address: customer.address || "غير مححدد - استلام فرع"
    };

    // تجميع الوصف النصي للأصناف
    const safeItemsDescription = safeItems.length > 0
        ? safeItems.map(i => `${i.count}x ${i.name}`).join(', ')
        : "طلب خارجي (بدون تفاصيل)";

    return {
        ...order,
        customerName: safeCustomer.name,
        phone: safeCustomer.phone,
        area: safeCustomer.address,
        total: computedTotal,
        deliveryFee: safeDelivery,
        serviceFee: safeService,
        paidNow,
        remainingAmount,
        items: safeItems,
        itemsDescription: safeItemsDescription,
        paymentMethod: paymentMethodStr,
        status: order.status || 'pending',
        timestamp: order.created_at || new Date().toISOString(),
        source: order.source || 'online' // 🌐 تحديد المصدر (أونلاين افتراضياً للطلبات الخارجية)
    };
};

/**
 * 📡 API Contract Layer
 * التحقق من صحة الأوردر وتجهيزه للسيستم
 */
export const safeParseOrder = (rawOrder) => {
    try {
        if (!rawOrder || !rawOrder.order_id) {
            console.warn('⚠️ Missing order_id, skipping record');
            return null;
        }

        // إرسال البيانات لمحرك الإصلاح
        const repaired = repairOrder(rawOrder);

        return {
            id: `EXT-${repaired.order_id}`, // توحيد الـ ID للسيستم
            originalId: String(repaired.order_id),
            type: 'external',
            ...repaired
        };
    } catch (error) {
        console.error('🔥 Critical error while parsing order:', error, rawOrder);
        return null;
    }
};
