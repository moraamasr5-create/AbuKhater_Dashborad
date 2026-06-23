export const isPilotOnDelivery = (state) => state === 'on_delivery' || state === 'out';

export const normalizePilotState = (state) => (state === 'out' ? 'on_delivery' : (state || 'available'));
