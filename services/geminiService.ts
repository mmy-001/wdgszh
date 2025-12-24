
import { GoogleGenAI } from "@google/genai";
import { GeminiInsight } from "../types";

const SUPPORTED_BINARY_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp'
];

export const analyzeDocument = async (fileName: string, fileType: string): Promise<GeminiInsight> => {
  return { 
    summary: "解析引擎已就绪，正在锁定 1:1 内容复刻模式。", 
    suggestedFormats: ['PDF', 'DOCX', 'TXT'], 
    fileQuality: "Lossless" 
  };
};

export const reconstructContentToHtml = async (file: File, targetFormat: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  let contentPart: any;

  try {
    if (SUPPORTED_BINARY_MIMES.includes(file.type)) {
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      contentPart = { inlineData: { data: base64Data, mimeType: file.type } };
    } else {
      let extractedText = "";
      try {
        if (file.name.toLowerCase().endsWith('.docx') && (window as any).mammoth) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await (window as any).mammoth.extractRawText({ arrayBuffer });
          extractedText = result.value;
        } else {
          extractedText = await file.text();
        }
      } catch (e) {
        extractedText = await file.text();
      }
      
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error("文件内容为空或无法识别。");
      }
      contentPart = { text: `[START_ORIGINAL_CONTENT]\n${extractedText}\n[END_ORIGINAL_CONTENT]` };
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        parts: [
          contentPart,
          { text: `你是一个专业的无损文档转换器。你的唯一职责是将提供的原始内容完整复刻为 HTML 格式。
          
          严格准则：
          1. 禁止对内容进行任何解释、分析或总结。
          2. 禁止遗漏任何原始字符（包括标点符号）。
          3. 仅允许使用以下 HTML 标签：<h1>, <h2>, <p>, <br/>, <ul>, <li>, <strong>。
          4. 保持原文的换行逻辑。
          5. 输出必须是纯净的 HTML 代码片段，绝对不能包含 \`\`\`html 这种 Markdown 标记，也不要有任何前置说明。
          6. 如果内容极其复杂，请优先保证文字的完整性而非样式的华丽。` }
        ]
      }],
      config: {
        temperature: 0,
        topP: 0.1,
      }
    });

    let result = response.text || "";
    // 二次清理，防止 AI 吐出 markdown 代码块包裹
    result = result.replace(/^```html\s*/gi, '').replace(/^```\s*/g, '').replace(/\s*```$/g, '').trim();
    
    if (!result) throw new Error("AI 转换失败：响应为空");
    return result;
      
  } catch (error: any) {
    console.error("Gemini Critical Error:", error);
    throw new Error(error.message || "由于服务器繁忙，转换请求被拒绝。请重试。");
  }
};
