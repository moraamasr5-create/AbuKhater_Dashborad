import React, { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { FileText, Download, Trash2, Calendar, Clock, DollarSign, Bike, TrendingUp, Home, Globe, Printer, UtensilsCrossed } from 'lucide-react';

const displayDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const cleanDate = String(dateStr).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const d = new Date(cleanDate);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ar-EG');
  } catch (e) {
    return dateStr;
  }
};

const ReportsView = () => {
  const { currentShift, dailyReports, activeStats, closeShift, openShift, isShiftOpen, orders, reservations } = useApp();
  const [selectedPilotDetails, setSelectedPilotDetails] = React.useState(null);
  const [showDues, setShowDues] = React.useState(false);
  const [showArchives, setShowArchives] = React.useState(false);

  const handlePrintShiftReport = (report) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
    const formattedDate = displayDate(report.date);

    const pilotSummaryHtml = (report.pilotStats || []).map(p => `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 4px 2px; text-align: right; font-weight: bold;">${p.name}</td>
                <td style="padding: 4px 2px; text-align: center;">${p.restaurantOrdersCount || 0}</td>
                <td style="padding: 4px 2px; text-align: center;">${p.onlineOrdersCount || 0}</td>
                <td style="padding: 4px 2px; text-align: center;">${p.talabatOrdersCount || 0}</td>
                <td style="padding: 4px 2px; text-align: center;">${p.tripsCount || 0}</td>
                <td style="padding: 4px 2px; text-align: left; font-weight: bold;">${Math.floor(p.totalEarnings)}</td>
            </tr>
        `).join('');

    const htmlContent = `
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="utf-8">
                <title>تقرير وردية - ${formattedDate}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;850;900&display=swap');
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
                        }
                        body, html, .receipt-container {
                            height: auto !important;
                            min-height: 0 !important;
                            max-height: none !important;
                            overflow: visible !important;
                        }
                        .header, section, table, .footer {
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
                        font-size: 11px;
                        line-height: 1.3;
                    }
                    .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 6px; margin-bottom: 8px; }
                    .title { font-size: 16px; font-weight: 900; margin: 0; }
                    .subtitle { font-size: 11px; font-weight: 800; margin: 2px 0; }
                    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
                    th { background: #000; color: white; padding: 4px 2px; text-align: right; }
                    td { padding: 4px 2px; border-bottom: 1px solid #eee; }
                    .summary-box { background: #f9f9f9; padding: 6px; border: 1px solid #ccc; margin-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
                    .total-final { background: #000; color: white; padding: 6px; text-align: center; font-size: 13px; font-weight: 900; margin-top: 4px; }
                    .footer { text-align: center; font-size: 9px; color: #555; margin-top: 10px; border-top: 1px dotted #000; padding-top: 4px; }
                    .flex { display: flex; justify-content: space-between; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="title">تقرير ختامي للوردية</div>
                    <div class="subtitle">التاريخ: ${formattedDate}</div>
                    <div class="subtitle">من: ${new Date(report.startTime).toLocaleTimeString('ar-EG')} | إلى: ${new Date(report.endTime).toLocaleTimeString('ar-EG')}</div>
                </div>

                <section>
                    <div style="font-weight: 900; font-size: 12px; margin-bottom: 4px; border-bottom: 1px solid #000; padding-bottom: 2px;">إحصائيات الطيارين</div>
                    <table>
                        <thead>
                            <tr>
                                <th style="padding: 4px 2px; text-align: right;">الطيار</th>
                                <th style="padding: 4px 2px; text-align: center;">مطعم</th>
                                <th style="padding: 4px 2px; text-align: center;">أونلاين</th>
                                <th style="padding: 4px 2px; text-align: center;">طلبات</th>
                                <th style="padding: 4px 2px; text-align: center;">مشاوير</th>
                                <th style="padding: 4px 2px; text-align: left;">المستحق</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pilotSummaryHtml}
                        </tbody>
                    </table>
                </section>

                <section class="summary-box">
                    <div class="flex"><span>إجمالي الطلبات:</span> <strong>${report.ordersCount}</strong></div>
                    <div class="flex"><span>إجمالي بدل الحضور:</span> <strong>${report.totalAttendancePay} ج.م</strong></div>
                    <div class="flex"><span>إجمالي نصيب التوصيل:</span> <strong>${report.totalDeliveryFees} ج.م</strong></div>
                    <div class="total-final">إجمالي مصروف الدليفري: ${report.totalPilotDues} ج.م</div>
                </section>

                <div class="footer">
                    تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')} - نظام إدارة الدليفري
                </div>
                <script>
                    window.addEventListener('DOMContentLoaded', () => {
                        window.addEventListener('load', () => {
                            setTimeout(() => {
                                window.print();
                                setTimeout(() => {
                                    window.close();
                                }, 500);
                            }, 300);
                        });
                    });
                </script>
            </body>
            </html>
        `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setSelectedPilotDetails(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleCloseShift = () => {
    const password = prompt('برجاء إدخال كلمة المرور لإغلاق اليوم:');
    if (password === '8080') {
      closeShift(false);
    } else if (password !== null) {
      alert('كلمة المرور غير صحيحة');
    }
  };

  const handleOpenShift = () => {
    const password = prompt('برجاء إدخال كلمة المرور لفتح وردية جديدة:');
    if (password === '8080') {
      openShift();
    } else {
      alert('كلمة المرور غير صحيحة');
    }
  };

  const getPilotOrders = (pilotId) => {
    // Filter orders for the current shift and specific pilot (Only completed, delivered or failed)
    return orders
      .filter(o => String(o.pilotId) === String(pilotId) && (o.status === 'completed' || o.status === 'delivered' || o.status === 'failed_delivery'))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  };

  const handlePrintPilotReport = (pilot) => {
    const pOrders = getPilotOrders(pilot.id);
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;

    const ordersHtml = pOrders.map(o => {
      const isFailed = o.status === 'failed_delivery';
      const share = isFailed ? 0 : (o.type === 'trip' ? o.deliveryFee : (o.deliveryFee / 2));
      return `
                <tr style="border-bottom: 1px solid #eee; ${isFailed ? 'color: #888; text-decoration: line-through;' : ''}">
                    <td style="padding: 4px 2px; text-align: right;">#${o.originalId || o.id}</td>
                    <td style="padding: 4px 2px; text-align: right;">${new Date(o.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style="padding: 4px 2px; text-align: right;">
                        ${o.source === 'online' ? 'أونلاين' : o.source === 'talabat' ? 'طلبات' : o.source === 'external' ? 'مشوار' : 'مطعم'}
                        ${isFailed ? '<br/><small>(فشل)</small>' : ''}
                    </td>
                    <td style="padding: 4px 2px; text-align: left;">${o.deliveryFee}</td>
                    <td style="padding: 4px 2px; text-align: left; font-weight: bold;">${share}</td>
                </tr>
            `;
    }).join('');

    const htmlContent = `
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="utf-8">
                <title>تقرير طيار - ${pilot.name}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;850;900&display=swap');
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
                        }
                        body, html, .receipt-container {
                            height: auto !important;
                            min-height: 0 !important;
                            max-height: none !important;
                            overflow: visible !important;
                        }
                        .header, .section, table, .footer {
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
                        font-size: 11px;
                        line-height: 1.3;
                    }
                    .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 6px; margin-bottom: 8px; }
                    .title { font-size: 16px; font-weight: 900; margin: 0; }
                    .subtitle { font-size: 11px; font-weight: 800; margin: 2px 0; }
                    .section { margin-bottom: 8px; }
                    .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; margin-top: 6px; }
                    .summary-item { background: #f9f9f9; padding: 4px; border: 1px solid #ccc; text-align: center; font-size: 9px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10px; }
                    th { background: #000; color: white; padding: 4px 2px; text-align: right; }
                    td { padding: 4px 2px; border-bottom: 1px solid #eee; }
                    .total-box { margin-top: 10px; padding: 8px; background: #000; color: white; text-align: center; font-size: 13px; font-weight: 900; }
                    .flex { display: flex; justify-content: space-between; }
                    .footer { text-align: center; font-size: 9px; color: #555; margin-top: 10px; border-top: 1px dotted #000; padding-top: 4px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="title">كشف حساب طيار</div>
                    <div class="subtitle">الطيار: ${pilot.name}</div>
                    <div class="subtitle">التاريخ: ${new Date().toLocaleDateString('ar-EG')} | الوقت: ${new Date().toLocaleTimeString('ar-EG')}</div>
                </div>

                <div class="section">
                    <div style="font-weight: 900; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px;">ملخص الوردية</div>
                    <div class="summary-grid">
                        <div class="summary-item"><div>مطعم</div><strong>${pilot.restaurantOrdersCount || 0}</strong></div>
                        <div class="summary-item"><div>أونلاين</div><strong>${pilot.onlineOrdersCount || 0}</strong></div>
                        <div class="summary-item"><div>طلبات</div><strong>${pilot.talabatOrdersCount || 0}</strong></div>
                        <div class="summary-item"><div>مشاوير</div><strong>${pilot.tripsCount || 0}</strong></div>
                        <div class="summary-item"><div>ساعات</div><strong>${(pilot.totalMinutes / 60).toFixed(1)}</strong></div>
                    </div>
                </div>

                <div class="section">
                    <div style="font-weight: 900; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px;">تفاصيل الرحلات</div>
                    <table>
                        <thead>
                            <tr>
                                <th style="padding: 4px 2px; text-align: right;">البون</th>
                                <th style="padding: 4px 2px; text-align: right;">الوقت</th>
                                <th style="padding: 4px 2px; text-align: right;">النوع</th>
                                <th style="padding: 4px 2px; text-align: left;">القيمة</th>
                                <th style="padding: 4px 2px; text-align: left;">الصافي</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ordersHtml}
                        </tbody>
                    </table>
                </div>

                <div class="section">
                    <div style="font-weight: 900; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px;">الأرباح النهائية</div>
                    <div class="flex" style="font-size: 11px;">
                        <span>إجمالي نصيب التوصيل:</span>
                        <strong>${pilot.feeEarnings} ج.م</strong>
                    </div>
                    <div class="flex" style="font-size: 11px; margin-top: 2px;">
                        <span>حساب ساعات الحضور:</span>
                        <strong>${pilot.attendancePay} ج.م</strong>
                    </div>
                    <div class="total-box">
                        الإجمالي المستحق للطيار: ${Math.floor(pilot.totalEarnings)} ج.م
                    </div>
                </div>

                <div class="footer">
                    نظام إدارة الدليفري - أبو خاطر
                </div>

                <script>
                    window.addEventListener('DOMContentLoaded', () => {
                        window.addEventListener('load', () => {
                            setTimeout(() => {
                                window.print();
                                setTimeout(() => {
                                    window.close();
                                }, 500);
                            }, 300);
                        });
                    });
                </script>
            </body>
            </html>
        `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {selectedPilotDetails && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(5px)' }}>
          <div className="glass-card" style={{ width: '500px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>تفاصيل رحلات: {selectedPilotDetails.name}</h3>
              <button onClick={() => setSelectedPilotDetails(null)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}><span style={{ fontSize: '1.5rem' }}>&times;</span></button>
            </div>
            <div style={{ padding: '20px', overflowY: 'auto' }}>
              {/* Summary Section */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
                {(() => {
                  const pOrders = getPilotOrders(selectedPilotDetails.id);
                  return (
                    <>
                      <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: '#60a5fa', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><Home size={14} /> مطعم</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'white' }}>{pOrders.filter(o => o.source === 'manual').length}</div>
                      </div>
                      <div style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: '#a78bfa', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><Globe size={14} /> أونلاين</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'white' }}>{pOrders.filter(o => o.source === 'online').length}</div>
                      </div>
                      <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.8rem', color: '#fbbf24', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><UtensilsCrossed size={14} /> طلبات</div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.2rem', color: 'white' }}>{pOrders.filter(o => o.source === 'talabat').length}</div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '10px 0', textAlign: 'right' }}>رقم الطلب</th>
                    <th style={{ padding: '10px 0', textAlign: 'right' }}>النوع</th>
                    <th style={{ padding: '10px 0', textAlign: 'right' }}>قيمة التوصيل</th>
                    <th style={{ padding: '10px 0', textAlign: 'right' }}>نصيب الطيار</th>
                  </tr>
                </thead>
                <tbody>
                  {getPilotOrders(selectedPilotDetails.id).length === 0 ? (
                    <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>لا توجد رحلات مسجلة</td></tr>
                  ) : (
                    getPilotOrders(selectedPilotDetails.id).map(order => {
                      const isFailed = order.status === 'failed_delivery';
                      const pilotShare = isFailed ? 0 : (order.type === 'trip' ? order.deliveryFee : (order.deliveryFee / 2));

                      return (
                        <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: isFailed ? 0.6 : 1 }}>
                          <td style={{ padding: '12px 0' }}>#{order.originalId || order.id}</td>
                          <td style={{ padding: '12px 0' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>{order.source === 'online' ? 'أونلاين' : order.source === 'talabat' ? 'طلبات (Talabat)' : order.source === 'external' ? 'مشوار' : 'مطعم'}</span>
                              {isFailed && <span style={{ fontSize: '0.7rem', color: 'var(--danger)' }}>فشل: {order.failureReason}</span>}
                            </div>
                          </td>
                          <td style={{ padding: '12px 0' }}>{order.deliveryFee} ج.م</td>
                          <td style={{ padding: '12px 0', color: isFailed ? 'var(--danger)' : 'var(--accent)', fontWeight: 'bold' }}>
                            {pilotShare} ج.م
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '20px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>إجمالي المستحقات</span>
                  <span style={{ fontSize: '1.6rem', fontWeight: '800', color: 'var(--accent)' }}>{Math.floor(selectedPilotDetails.totalEarnings)} <small style={{ fontSize: '0.9rem' }}>ج.م</small></span>
                </div>
                <div style={{ textAlign: 'left', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '15px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>نصيب التوصيل:</span>
                    <span style={{ fontWeight: '600' }}>{selectedPilotDetails.feeEarnings} ج.م</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '15px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>حساب الساعات:</span>
                    <span style={{ fontWeight: '600' }}>{selectedPilotDetails.attendancePay} ج.م</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="btn-primary"
                  onClick={() => handlePrintPilotReport(selectedPilotDetails)}
                  style={{ flex: 1, height: '45px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Printer size={18} /> طباعة كشف الحساب
                </button>
                <button className="btn-primary" onClick={() => setSelectedPilotDetails(null)} style={{ flex: 1, height: '45px', background: 'rgba(255,255,255,0.1)', color: 'white' }}>إغلاق التفاصيل</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.8rem', fontWeight: '800' }}>تقارير الدليفري</h2>
          <p style={{ color: 'var(--text-muted)' }}>متابعة أداء الطيارين ومستحقاتهم في الوردية</p>
        </div>

      </header>

      {/* Current Active Report */}
      {isShiftOpen ? (
        <div className="glass-card" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(124, 58, 237, 0.1)', color: 'var(--primary)' }}>
              <Clock size={20} />
            </div>
            <h3 style={{ fontSize: '1.2rem' }}>الوردية النشطة</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: 'auto' }}>
              بدأت في: {new Date(currentShift.startTime).toLocaleTimeString('ar-EG')}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>إجمالي الطلبات</p>
              <h4 style={{ fontSize: '1.5rem', fontWeight: '700' }}>
                {activeStats.totalOrders}
                <small style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)', marginRight: '8px' }}>
                  ({activeStats.pilotPerformance.reduce((acc, p) => acc + (p.restaurantOrdersCount || 0), 0)} مطعم | {activeStats.pilotPerformance.reduce((acc, p) => acc + (p.onlineOrdersCount || 0), 0)} أونلاين | {activeStats.pilotPerformance.reduce((acc, p) => acc + (p.talabatOrdersCount || 0), 0)} طلبات || {activeStats.pilotPerformance.reduce((acc, p) => acc + (p.tripsCount || 0), 0)} م )
                </small>
              </h4>
            </div>

            {/* 🟣 New Online Card */}
            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ color: '#a78bfa', fontSize: '0.8rem', marginBottom: '8px' }}>أونلاين (الموقع)</p>
                <Globe size={16} color="#a78bfa" style={{ marginBottom: '8px' }} />
              </div>
              <h4 style={{ fontSize: '1.5rem', fontWeight: '900', color: '#8b5cf6' }}>{activeStats.onlineOrdersCount || 0} طلب</h4>
            </div>
            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>متوسط التأخير</p>
              <h4 style={{ fontSize: '1.5rem', fontWeight: '700', color: activeStats.averageDelay > 40 ? 'var(--danger)' : 'white' }}>{activeStats.averageDelay} دقيقة</h4>
            </div>
            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>إيرادات الحجازات (عربون)</p>
              {showDues ? (
                <h4 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#8b5cf6' }}>
                  {activeStats.reservationStats?.totalDeposits || 0} ج.م
                  <small style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)', marginRight: '8px' }}>
                    ({activeStats.reservationStats?.count || 0} إجمالي الحجوزات)
                  </small>
                </h4>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>🔒 مغلق للمشرف</div>
              )}
            </div>
          </div>

          {/* Owner Financial Summary - EXCLUSIVE */}
          {showDues && (
            <div style={{ background: 'rgba(139, 92, 246, 0.1)', border: '2px solid #8b5cf6', padding: '24px', borderRadius: '20px', marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <TrendingUp color="#8b5cf6" size={28} />
                <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '1.4rem' }}>تقرير صاحب المطعم (صافي الأرباح)</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '24px' }}>
                <div style={{ borderRight: '3px solid rgba(139, 92, 246, 0.3)', paddingRight: '20px' }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '4px' }}>ربح الدليفري الصافي</p>
                  <p style={{ fontSize: '1.6rem', fontWeight: '800' }}>{activeStats.pilotPerformance.reduce((a, b) => a + (b.totalEarnings - b.attendancePay), 0)} ج.م</p>
                </div>
                <div style={{ borderRight: '3px solid rgba(139, 92, 246, 0.3)', paddingRight: '20px' }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '4px' }}>ربح الحجوزات الصافي</p>
                  <p style={{ fontSize: '1.6rem', fontWeight: '800' }}>{activeStats.reservationStats?.totalDeposits || 0} ج.م</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '4px' }}>إجمالي الربح العام للوردية</p>
                  <p style={{ fontSize: '2rem', fontWeight: '900', color: 'var(--accent)' }}>
                    {Math.floor(activeStats.pilotPerformance.reduce((a, b) => a + b.totalEarnings, 0) + (activeStats.reservationStats?.totalDeposits || 0))} ج.م
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reservations Summary Section - Concise & Abbreviated */}
          <section style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <UtensilsCrossed size={20} color="#8b5cf6" />
              <h4 style={{ fontSize: '1.2rem', margin: 0 }}>ملخص حجزات الوردية</h4>
            </div>
            <div className="glass-card" style={{ overflowX: 'auto', background: 'rgba(139, 92, 246, 0.05)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa' }}>
                    <th style={{ padding: '12px', textAlign: 'right' }}>العميل</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>العدد</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>الهاتف</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>العربون</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>صورة التحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>لا توجد حجوزات نشطة</td></tr>
                  ) : (
                    reservations.map(res => (
                      <tr key={res.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontWeight: '600' }}>{res.customerName}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{res.type === 'cafe' ? 'كافيه' : 'مطعم'} | {res.id}</div>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>{res.guests} افراد</td>
                        <td style={{ padding: '12px', fontSize: '0.85rem' }}>{res.phone}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ color: res.status === 'confirmed' ? 'var(--success)' : 'var(--warning)', fontWeight: 'bold' }}>
                            {res.deposit} ج.م
                          </span>
                          {res.status === 'confirmed' && <div style={{ fontSize: '0.65rem' }}>#{res.refNumber}</div>}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {res.paymentProof ? (
                            <div
                              onClick={() => {
                                const w = window.open('about:blank');
                                if (w) w.document.write(`<img src="${res.paymentProof}" style="max-width:100%"/>`);
                              }}
                              style={{ cursor: 'pointer', width: '40px', height: '40px', borderRadius: '4px', overflow: 'hidden', margin: '0 auto', border: '1px solid #8b5cf6' }}
                            >
                              <img src={res.paymentProof} alt="proof" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>لا يوجد</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <h4 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bike size={18} /> تفصيل مستحقات الطيارين
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            {activeStats.pilotPerformance
              .sort((a, b) => {
                // 🟢 1. الترتيب حسب الحالة (مفتوح أولاً)
                if (a.shiftStatus === 'open' && b.shiftStatus === 'closed') return -1;
                if (a.shiftStatus === 'closed' && b.shiftStatus === 'open') return 1;

                // 🏆 2. داخل الأونلاين: الترتيب حسب الأكثر طلباً (مطعم + طلبات + مشاوير)
                if (a.shiftStatus === 'open' && b.shiftStatus === 'open') {
                  const aTotal = (a.restaurantOrdersCount || 0) + (a.talabatOrdersCount || 0) + (a.tripsCount || 0);
                  const bTotal = (b.restaurantOrdersCount || 0) + (b.talabatOrdersCount || 0) + (b.tripsCount || 0);
                  return bTotal - aTotal;
                }
                return 0;
              })
              .map(pilot => (
                <div key={pilot.id} style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', position: 'relative', opacity: pilot.shiftStatus === 'closed' ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', align_items: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: pilot.shiftStatus === 'open' ? '#10b981' : '#ef4444', boxShadow: pilot.shiftStatus === 'open' ? '0 0 10px #10b981' : 'none' }}></div>
                      <span style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--primary)' }}>{pilot.name}</span>
                    </div>
                    {showDues ? (
                      <span style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '1.2rem', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 12px', borderRadius: '8px' }}>
                        {Math.floor(pilot.totalEarnings)} ج.م
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>****</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                    {/* Workload Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <span>🏠 مطعم: <strong>{pilot.restaurantOrdersCount || 0}</strong></span>
                      <span style={{ color: '#a78bfa' }}>🟣 أونلاين: <strong>{pilot.onlineOrdersCount || 0}</strong></span>
                      <span>🌐 طلبات: <strong>{pilot.talabatOrdersCount || 0}</strong></span>
                      <span>🏍️ مشاوير: <strong>{pilot.tripsCount || 0}</strong></span>
                      <span>🕒 عمل: <strong>{(pilot.totalMinutes / 60).toFixed(1)} س</strong></span>
                    </div>

                    {showDues && (
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>تفاصيل الأرباح:</p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: '0.9rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Home size={14} /> مطعم:</span>
                            <span style={{ fontWeight: 'bold' }}>{pilot.restaurantEarnings}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a78bfa' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Globe size={14} /> أونلاين:</span>
                            <span style={{ fontWeight: 'bold' }}>{pilot.onlineEarnings}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><UtensilsCrossed size={14} /> طلبات:</span>
                            <span style={{ fontWeight: 'bold' }}>{pilot.talabatEarnings}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Bike size={14} /> مشاوير:</span>
                            <span style={{ fontWeight: 'bold' }}>{pilot.tripEarnings}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={14} /> حضور:</span>
                            <span style={{ fontWeight: 'bold' }}>{pilot.attendancePay}</span>
                          </div>
                        </div>

                        <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                          <span>إجمالي التوصيل:</span>
                          <strong>{pilot.feeEarnings} ج.م</strong>
                        </div>
                      </div>
                    )}

                    {!showDues && (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', background: 'rgba(0,0,0,0.1)', borderRadius: '8px' }}>
                        تفاصيل المستحقات مخفية 🔒
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button
                      onClick={() => setSelectedPilotDetails(pilot)}
                      style={{ flex: 1, padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'background 0.2s' }}
                    >
                      <FileText size={16} /> كشف تفصيلي
                    </button>
                    {showDues && (
                      <button
                        onClick={() => {
                          const element = document.createElement("a");
                          const file = new Blob([JSON.stringify(pilot, null, 2)], { type: 'application/json' });
                          element.href = URL.createObjectURL(file);
                          element.download = `Pilot_${pilot.name.replace(/\s+/g, '_')}_Report.json`;
                          document.body.appendChild(element);
                          element.click();
                        }}
                        title="حفظ الملف"
                        style={{ padding: '0 16px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid var(--warning)', color: 'var(--warning)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Download size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <Calendar size={48} color="var(--text-muted)" />
          <div>
            <h3 style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>لا توجد وردية مفتوحة حالياً</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>اضغط على الزر أدناه لبدء يوم عمل جديد</p>
          </div>
          <button onClick={handleOpenShift} className="btn-primary" style={{ background: 'var(--accent)', marginTop: '8px' }}>
            <TrendingUp size={18} />
            <span>فتح وردية جديدة</span>
          </button>
        </div>
      )}

      {/* Archived Reports */}
      <section style={{ marginTop: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <FileText size={22} /> سجل الورديات السابقة
          </h3>
          {!showArchives && (
            <button
              onClick={() => {
                const pass = prompt('كلمة المرور للمشرف:');
                if (pass === '8080') setShowArchives(true);
                else alert('خطأ في كلمة المرور');
              }}
              className="btn-primary"
              style={{ background: 'rgba(255,255,255,0.1)', padding: '8px 16px', fontSize: '0.85rem' }}
            >
              🔒 فتح السجل (مشرف)
            </button>
          )}
        </div>

        {showArchives ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {dailyReports.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>لا توجد تقارير مؤرشفة بعد.</p>
            ) : (
              dailyReports.map(report => (
                <div key={report.id} className="glass-card report-card-grid" style={{ padding: '20px', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: '600' }}>تقرير يوم {displayDate(report.date)}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(report.startTime).toLocaleTimeString('ar-EG')} - {new Date(report.endTime).toLocaleTimeString('ar-EG')}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>الطلبات</p>
                    <p style={{ fontWeight: '600' }}>
                      {report.ordersCount}
                      <small style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>
                        ({(report.archivedOrders || []).filter(o => o.source === 'manual').length} مطعم | {(report.archivedOrders || []).filter(o => o.source === 'online').length} أونلاين | {(report.archivedOrders || []).filter(o => o.source === 'talabat').length} طلبات)
                      </small>
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>بدل الحضور</p>
                    <p style={{ fontWeight: '600' }}>{report.totalAttendancePay} ج.م</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>إجمالي المستحقات</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <p style={{ fontWeight: '700', color: 'var(--warning)', fontSize: '1.1rem' }}>{report.totalPilotDues} ج.م</p>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {(() => {
                          const restaurantDues = (report.archivedOrders || []).filter(o => o.type === 'restaurant').reduce((sum, o) => sum + (o.deliveryFee / 2), 0);
                          const talabatDues = (report.archivedOrders || []).filter(o => o.type === 'talabat' || o.type === 'external').reduce((sum, o) => sum + (o.deliveryFee / 2), 0);
                          const tripDues = (report.archivedOrders || []).filter(o => o.type === 'trip').reduce((sum, o) => sum + o.deliveryFee, 0);

                          return (
                            <>
                              <span>🏠 مطعم: {(report.archivedOrders || []).filter(o => o.source === 'manual').reduce((sum, o) => sum + (o.deliveryFee / 2), 0)}</span>
                              <span style={{ color: '#a78bfa' }}>🟣 أونلاين: {(report.archivedOrders || []).filter(o => o.source === 'online').reduce((sum, o) => sum + (o.deliveryFee / 2), 0)}</span>
                              <span>🌐 طلبات: {(report.archivedOrders || []).filter(o => o.source === 'talabat').reduce((sum, o) => sum + (o.deliveryFee / 2), 0)}</span>
                              <span>🏍️ مشاوير: {(report.archivedOrders || []).filter(o => o.source === 'external').reduce((sum, o) => sum + o.deliveryFee, 0)}</span>
                              <span>🕒 حضور: {report.totalAttendancePay}</span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '15px' }}>
                    <button
                      onClick={() => handlePrintShiftReport(report)}
                      title="طباعة التقرير"
                      style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Printer size={18} /> <span style={{ fontSize: '0.8rem' }}>طباعة</span>
                    </button>
                    <button
                      onClick={() => {
                        const element = document.createElement("a");
                        const file = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                        element.href = URL.createObjectURL(file);
                        element.download = `Shift_Report_${report.date}.json`;
                        document.body.appendChild(element);
                        element.click();
                      }}
                      title="تصدير كـ JSON"
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Download size={18} /> <span style={{ fontSize: '0.8rem' }}>JSON</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div style={{ padding: '30px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '12px', background: 'rgba(0,0,0,0.1)' }}>
            <p style={{ color: 'var(--text-muted)' }}>⚠️ سجل الورديات السابقة مخفي لدواعي الأمان. يرجى إدخال كلمة المرور للعرض.</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default ReportsView;
