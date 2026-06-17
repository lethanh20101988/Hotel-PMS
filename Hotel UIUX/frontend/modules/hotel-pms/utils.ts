
export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
};

// Hàm định dạng số khi nhập liệu (chỉ thêm dấu chấm, không thêm đon vị tiền)
export const formatNumber = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return '';
  const numStr = value.toString().replace(/\./g, '');
  if (isNaN(Number(numStr))) return '';
  return Number(numStr).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Hàm parse từ chuỗi có dấu chấm về số
export const parseNumber = (value: string) => {
  return Number(value.replace(/\./g, ''));
};

export const formatDate = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
};

export const calculateRoomCharge = (
  checkIn: string, 
  checkOut: string, 
  type: 'HOURLY' | 'DAILY' | 'OVERNIGHT', 
  prices: { hourly: number, daily: number, overnight: number }
) => {
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  const diffHours = Math.ceil((end - start) / (1000 * 60 * 60));

  if (type === 'HOURLY') {
    // Logic đơn giản: 2 giờ đầu giá cố định (giả lập bằng hourly), các giờ sau cộng thêm
    // Ở đây ta tính phẳng theo giờ cho demo
    return Math.max(1, diffHours) * prices.hourly;
  } else if (type === 'OVERNIGHT') {
    return prices.overnight;
  } else {
    // DAILY
    const days = Math.max(1, Math.ceil(diffHours / 24));
    return days * prices.daily;
  }
};
