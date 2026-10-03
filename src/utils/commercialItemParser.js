/**
 * 🍔 Commercial Item Parser
 * يقوم بتفكيك بيانات الصنف التجارية (اسم الصنف الأساسي، الـ Variant المختار، الـ Options الإضافية، والملاحظات)
 * لعرضها في شاشات التشغيل والمطبخ والبونات الحرارية بدقة ووضوح ودون الاعتماد على التخمين.
 */

export const parseItemCommercialDetails = (item) => {
  if (!item) {
    return {
      productName: 'صنف غير معروف',
      variantName: null,
      optionNames: [],
      notes: null,
      category: null
    };
  }

  let rawName = String(item.name || item.product_name || item.item_name || '').trim();
  let productName = rawName;
  let variantName = item.selected_variant?.name || item.variant?.name || null;
  
  let optionNames = [];
  if (Array.isArray(item.selected_options) && item.selected_options.length > 0) {
    optionNames = item.selected_options.map(o => typeof o === 'string' ? o : (o.option_name || o.name)).filter(Boolean);
  } else if (Array.isArray(item.options) && item.options.length > 0) {
    optionNames = item.options.map(o => typeof o === 'string' ? o : (o.option_name || o.name)).filter(Boolean);
  }

  // If variant or options are embedded in formatted name: e.g. 'شاورما فراخ (عيش سوري) + [تومية إضافية, مخلل]'
  if (!variantName || optionNames.length === 0) {
    // 1. Extract options from + [...] or + ...
    const optMatch = rawName.match(/\+\s*\[(.*?)\]/) || rawName.match(/\+\s*(.*)$/);
    if (optMatch) {
      if (optionNames.length === 0) {
        optionNames = optMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }
      rawName = rawName.replace(optMatch[0], '').trim();
    }

    // 2. Extract variant from (...)
    const varMatch = rawName.match(/\((.*?)\)/);
    if (varMatch) {
      if (!variantName) {
        variantName = varMatch[1].trim();
      }
      rawName = rawName.replace(varMatch[0], '').trim();
    }

    productName = rawName || item.name || 'صنف';
  }

  return {
    productName,
    variantName,
    optionNames,
    notes: item.notes || null,
    category: (item.category && item.category !== 'عام') ? item.category : null
  };
};
