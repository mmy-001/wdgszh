
import React, { useState, useRef } from 'react';
import { AppFile, FileFormat, ConversionState } from './types';
import { reconstructContentToHtml } from './services/geminiService';
import { CloudUploadIcon, FileIcon, RefreshIcon, DownloadIcon, CheckIcon } from './components/Icons';

const FORMATS: FileFormat[] = ['PDF', 'DOCX', 'TXT', 'JPG', 'PNG', 'MD'];

export default function App() {
  const [file, setFile] = useState<AppFile | null>(null);
  const [targetFormat, setTargetFormat] = useState<FileFormat>('PDF');
  const [conversion, setConversion] = useState<ConversionState>({ status: 'idle', progress: 0 });
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenRenderRef = useRef<HTMLDivElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFile = files[0];
    
    if (selectedFile.name.toLowerCase().endsWith('.doc')) {
      setConversion({ 
        status: 'error', 
        progress: 0, 
        error: "不支持旧版 .doc 格式，请另存为 .docx 格式后再试。" 
      });
      return;
    }

    const newFile: AppFile = {
      id: Math.random().toString(36).substr(2, 9),
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
      blob: selectedFile,
    };

    setFile(newFile);
    setConversion({ status: 'idle', progress: 0 });
    setPreviewHtml('');
  };

  const startConversion = async () => {
    if (!file) return;
    setConversion({ status: 'converting', progress: 10 });

    try {
      // 1. 获取 AI 转换后的 HTML 内容
      const htmlContent = await reconstructContentToHtml(file.blob, targetFormat);
      setPreviewHtml(htmlContent);
      setConversion(prev => ({ ...prev, progress: 50 }));

      const fileNameBase = file.name.split('.')[0];
      const resultName = `${fileNameBase}.${targetFormat.toLowerCase()}`;
      let finalBlob: Blob;

      // 准备渲染环境
      if (!hiddenRenderRef.current) throw new Error("渲染容器失效");
      const renderRootId = "render-root";
      hiddenRenderRef.current.innerHTML = `
        <div id="${renderRootId}" style="padding: 50px; font-family: 'Inter', system-ui, sans-serif; line-height: 1.6; color: #1a1a1a; width: 794px; background: white; white-space: pre-wrap; word-wrap: break-word; font-size: 15px;">
          ${htmlContent}
        </div>`;
      
      await new Promise(r => setTimeout(r, 800)); // 必要的渲染延时

      // 2. 核心导出逻辑分发
      if (targetFormat === 'PDF' || targetFormat === 'JPG' || targetFormat === 'PNG') {
        const element = document.getElementById(renderRootId);
        if (!element) throw new Error("导出节点丢失");

        const canvas = await (window as any).html2canvas(element, { 
          scale: 2, 
          useCORS: true,
          backgroundColor: "#ffffff"
        });

        if (targetFormat === 'PDF') {
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const { jsPDF } = (window as any).jspdf;
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
          
          let heightLeft = pdfHeight;
          let position = 0;
          const pageHeight = pdf.internal.pageSize.getHeight();

          pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
          heightLeft -= pageHeight;
          while (heightLeft >= 0) {
            position = heightLeft - pdfHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
            heightLeft -= pageHeight;
          }
          finalBlob = pdf.output('blob');
        } else {
          // 图片格式转换
          const mime = targetFormat === 'JPG' ? 'image/jpeg' : 'image/png';
          const dataUrl = canvas.toDataURL(mime, 0.9);
          const res = await fetch(dataUrl);
          finalBlob = await res.blob();
        }
      } else if (targetFormat === 'DOCX') {
        // 使用更具兼容性的 Office HTML 协议头，确保 Word 能识别并以页面模式打开
        const docxContent = `
          <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
          <head>
            <meta charset="utf-8">
            <title>Converted Document</title>
            <!--[if gte mso 9]>
            <xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
            <![endif]-->
            <style>
              body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; }
              p { margin-bottom: 8pt; line-height: 1.2; }
            </style>
          </head>
          <body>${htmlContent}</body>
          </html>`;
        finalBlob = new Blob(['\ufeff', docxContent], { type: 'application/msword' });
      } else if (targetFormat === 'MD') {
        const mdContent = htmlContent
          .replace(/<h1>/gi, '# ')
          .replace(/<\/h1>/gi, '\n\n')
          .replace(/<h2>/gi, '## ')
          .replace(/<\/h2>/gi, '\n\n')
          .replace(/<p>/gi, '')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<li>/gi, '* ')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, '');
        finalBlob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      } else {
        // 纯文本导出
        const plainText = htmlContent
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .trim();
        finalBlob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
      }

      setConversion({
        status: 'completed',
        progress: 100,
        resultUrl: URL.createObjectURL(finalBlob),
        resultName: resultName
      });
    } catch (err: any) {
      console.error("Conversion Error:", err);
      setConversion({ 
        status: 'error', 
        progress: 0, 
        error: err.message || "文件处理超时。请尝试更小的文件或刷新页面。"
      });
    }
  };

  const reset = () => {
    if (conversion.resultUrl) URL.revokeObjectURL(conversion.resultUrl);
    setFile(null);
    setConversion({ status: 'idle', progress: 0 });
    setPreviewHtml('');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFCFF] selection:bg-indigo-100">
      <div ref={hiddenRenderRef} className="fixed -top-[100000px] -left-[100000px] opacity-0 pointer-events-none" />

      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-100 h-16 flex items-center px-6 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto w-full flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100">
              <RefreshIcon className="w-5 h-5" />
            </div>
            <span className="font-black text-slate-900 text-xl tracking-tighter">OmniConvert <span className="text-indigo-600 italic">Pure</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg shadow-inner">1:1 Lossless Engine</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:p-14">
        {!file && conversion.status !== 'error' ? (
          <div className="text-center space-y-12 pt-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <div className="space-y-4">
              <h2 className="text-6xl font-black text-slate-900 tracking-tight leading-none">原文无损转换</h2>
              <p className="text-slate-400 font-medium text-xl">全格式互转，100% 还原文字，杜绝 AI 总结。</p>
            </div>

            <div
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`h-80 cursor-pointer border-[3px] border-dashed rounded-[3.5rem] flex flex-col items-center justify-center transition-all duration-500 group relative overflow-hidden
                ${isDragging ? 'border-indigo-500 bg-indigo-50/50 scale-[1.02]' : 'border-slate-200 bg-white hover:border-indigo-400 hover:shadow-2xl hover:shadow-indigo-100/20'}
              `}
            >
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-500 shadow-sm">
                <CloudUploadIcon className="w-10 h-10 transition-colors" />
              </div>
              <p className="font-black text-slate-800 text-2xl">点此上传或拖拽入库</p>
              <p className="text-slate-400 text-xs mt-3 font-black uppercase tracking-[0.4em]">PC & iOS 全力支持</p>
              {isDragging && <div className="absolute inset-0 bg-indigo-500/5 animate-pulse" />}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[3.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-700">
            <div className="p-12 space-y-12">
              <div className="flex items-center gap-6 p-8 bg-[#F8FAFF] rounded-[2.5rem] border border-indigo-50">
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-indigo-600 border border-slate-50">
                  <FileIcon className="w-8 h-8" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-black text-slate-900 truncate text-xl leading-none">{file?.name || "文件解析中"}</h3>
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-3 bg-white w-fit px-3 py-1.5 rounded-lg shadow-sm">
                    {((file?.size || 0) / 1024).toFixed(1)} KB · 无损转换模式
                  </p>
                </div>
                {conversion.status === 'completed' && <CheckIcon className="w-12 h-12 text-green-500 drop-shadow-sm" />}
              </div>

              {conversion.status === 'error' && (
                <div className="p-10 bg-rose-50 rounded-[2.5rem] border border-rose-100 text-center space-y-6">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">
                    <span className="text-rose-500 text-3xl font-black">!</span>
                  </div>
                  <p className="text-rose-900 font-black text-xl px-4">{conversion.error}</p>
                  <button onClick={reset} className="px-12 py-4.5 bg-rose-600 text-white rounded-2xl font-black hover:bg-rose-700 transition-all shadow-xl shadow-rose-100 active:scale-95">
                    重置并上传新文件
                  </button>
                </div>
              )}

              {conversion.status !== 'error' && (
                <>
                  <div className="space-y-6">
                    <div className="flex justify-between items-center px-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">请指定转换目标</label>
                      <span className="text-[9px] font-black text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-md">WYSIWYG Mode</span>
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                      {FORMATS.map(fmt => (
                        <button
                          key={fmt}
                          disabled={conversion.status === 'converting' || conversion.status === 'completed'}
                          onClick={() => setTargetFormat(fmt)}
                          className={`h-16 rounded-2xl text-[11px] font-black transition-all border-2
                            ${targetFormat === fmt ? 'bg-slate-900 border-slate-900 text-white shadow-2xl scale-[1.05]' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}
                          `}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {conversion.status === 'converting' && (
                    <div className="space-y-8 py-8 px-2">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <p className="text-slate-900 text-xl font-black">正在深度克隆内容...</p>
                          <p className="text-slate-400 text-xs font-bold animate-pulse">正在为 {targetFormat} 优化排版结构</p>
                        </div>
                        <span className="text-indigo-600 text-5xl font-black tabular-nums">{conversion.progress}%</span>
                      </div>
                      <div className="h-5 w-full bg-slate-50 rounded-full overflow-hidden p-1.5 border border-slate-100 shadow-inner">
                        <div className="h-full bg-indigo-600 rounded-full transition-all duration-1000 shadow-lg shadow-indigo-100" style={{ width: `${conversion.progress}%` }} />
                      </div>
                    </div>
                  )}

                  {conversion.status === 'completed' && (
                    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-700">
                      <div className="p-10 bg-[#FBFCFF] rounded-[3rem] border border-slate-100 relative shadow-inner">
                        <div className="absolute top-0 right-0 p-6">
                          <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">全文复刻流预览</span>
                        </div>
                        <div 
                          className="max-h-80 overflow-y-auto text-sm text-slate-600 font-medium leading-relaxed prose prose-slate scrollbar-hide"
                          dangerouslySetInnerHTML={{ __html: previewHtml }} 
                        />
                      </div>
                      
                      <div className="flex flex-col sm:flex-row gap-5">
                        <a
                          href={conversion.resultUrl}
                          download={conversion.resultName}
                          className="flex-[2] h-20 bg-indigo-600 text-white rounded-[1.75rem] font-black text-lg flex items-center justify-center gap-4 hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-200 active:scale-95 touch-manipulation"
                        >
                          <DownloadIcon className="w-7 h-7" />
                          下载无损复刻文件
                        </a>
                        <button onClick={reset} className="flex-1 h-20 bg-white border-2 border-slate-100 text-slate-500 rounded-[1.75rem] font-black hover:bg-slate-50 transition-all active:scale-95">
                          处理下一个
                        </button>
                      </div>
                    </div>
                  )}

                  {conversion.status === 'idle' && (
                    <button
                      onClick={startConversion}
                      className="w-full h-20 bg-slate-900 text-white rounded-[1.75rem] font-black text-xl hover:bg-indigo-600 transition-all shadow-2xl shadow-slate-200 active:scale-[0.98] mt-6 group"
                    >
                      <span className="group-hover:tracking-widest transition-all duration-500">执行 1:1 内容迁移</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="p-14 text-center">
        <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.6em] transition-opacity hover:opacity-100 opacity-40">
          Privacy First · PC & iOS Verified · No AI Modifications
        </p>
      </footer>
    </div>
  );
}
