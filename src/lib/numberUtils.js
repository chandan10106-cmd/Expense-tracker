export const digitsOnly = (s) => (s || '').toString().replace(/\D/g, '');

export const formatWithCommas = (s) => {
  const n = digitsOnly(s);
  if (!n) return '';
  try {
    return new Intl.NumberFormat('en-IN').format(Number(n));
  } catch {
    return n;
  }
};

export const parseToNumber = (s) => {
  const n = digitsOnly(s);
  return n ? parseInt(n, 10) : 0;
};
