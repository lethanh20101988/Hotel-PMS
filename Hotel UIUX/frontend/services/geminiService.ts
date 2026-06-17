
import { GoogleGenAI } from "@google/genai";
import { Device, JournalEntry, Invoice } from '@shared/types';

export const generateFinancialInsight = async (
  devices: Device[],
  entries: JournalEntry[],
  invoices: Invoice[],
  query: string
): Promise<string> => {
  // Initialize AI client using the API key from environment variables as per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Prepare a summarized context to avoid token limits if data is huge
  // For this demo, we assume manageable data size
  const contextData = {
    totalDevices: devices.length,
    activeDevices: devices.filter(d => d.status === 'Hoạt động').length,
    expiredDevices: devices.filter(d => d.status === 'Hết hạn').length,
    recentInvoices: invoices.slice(0, 5),
    recentJournalEntries: entries.slice(0, 5),
    totalRevenue: invoices
      .filter(i => i.type === 'SALES')
      .reduce((sum, i) => sum + i.totalAmount, 0),
  };

  const prompt = `
    Bạn là một trợ lý kế toán trưởng và quản lý thiết bị thông minh cho một công ty tại Việt Nam.
    Công ty tuân thủ chế độ kế toán TT133.
    
    Dữ liệu hiện tại của hệ thống (Tóm tắt JSON):
    ${JSON.stringify(contextData, null, 2)}

    Người dùng đang hỏi: "${query}"

    Hãy trả lời ngắn gọn, chuyên nghiệp, tập trung vào số liệu tài chính và tình trạng thiết bị.
    Nếu câu hỏi liên quan đến hạch toán, hãy gợi ý các tài khoản (Nợ/Có) theo TT133.
    Định dạng tiền tệ là VND.
  `;

  try {
    // Corrected model name to 'gemini-3-flash-preview' as per guidelines for basic text tasks
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    // Guidelines state .text is a property, not a method
    return response.text || "Không thể phân tích dữ liệu lúc này.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Đã xảy ra lỗi khi kết nối với trợ lý ảo.";
  }
};
