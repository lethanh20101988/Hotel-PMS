
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

/** Chỉ giữ chữ số (dùng khi nhập số có dấu phân cách nghìn). */
export const parseDigitsOnly = (s: string) => s.replace(/\D/g, '');

/** Nhóm nghìn kiểu VN (dấu chấm), từ chuỗi chỉ gồm chữ số. */
export const formatThousandsVNFromDigits = (digits: string) => {
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export const normalizeDate = (date: string | Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const diffDays = (date1: string | Date, date2: string | Date) => {
  const d1 = normalizeDate(date1);
  const d2 = normalizeDate(date2);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const calculateRemainingDays = (expiryDate: string) => {
  return diffDays(new Date(), expiryDate);
};

export const numberToVietnameseText = (number: number): string => {
  if (number === 0) return "Không đồng";
  const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

  const readThreeDigits = (n: number, showZero: boolean): string => {
    let res = "";
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0 || showZero) {
      res += digits[h] + " trăm ";
    }

    if (t > 1) {
      res += digits[t] + " mươi ";
      if (u === 1) res += "mốt";
      else if (u === 5) res += "lăm";
      else if (u > 0) res += digits[u];
    } else if (t === 1) {
      res += "mười ";
      if (u === 5) res += "lăm";
      else if (u > 0) res += digits[u];
    } else if (u > 0) {
      if (h > 0 || showZero) res += "lẻ ";
      res += digits[u];
    }
    return res.trim();
  };

  let res = "";
  let unitIdx = 0;
  let tempNum = Math.abs(number);

  while (tempNum > 0) {
    const part = tempNum % 1000;
    if (part > 0) {
      const partStr = readThreeDigits(part, tempNum >= 1000);
      res = partStr + " " + units[unitIdx] + " " + res;
    }
    tempNum = Math.floor(tempNum / 1000);
    unitIdx++;
  }

  res = res.trim();
  return res.charAt(0).toUpperCase() + res.slice(1) + " đồng chẵn.";
};
