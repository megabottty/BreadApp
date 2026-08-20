/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US numbers).
 * Returns null if the number can't be normalized.
 */
const normalizePhone = (raw) => {
  if (!raw) return null;
  // Strip everything except digits
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // US: 10 digits → +1XXXXXXXXXX
  if (digits.length === 10) return `+1${digits}`;
  // US with country code: 11 digits starting with 1 → +1XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Already has country code for other countries (12+ digits)
  if (digits.length >= 11) return `+${digits}`;
  return null;
};

module.exports = { normalizePhone };
