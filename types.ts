
export type FileFormat = 'PDF' | 'DOCX' | 'TXT' | 'JPG' | 'PNG' | 'MD';

export interface AppFile {
  id: string;
  name: string;
  size: number;
  type: string;
  blob: File;
  previewUrl?: string;
}

export interface ConversionState {
  status: 'idle' | 'uploading' | 'converting' | 'completed' | 'error';
  progress: number;
  error?: string;
  resultUrl?: string;
  resultName?: string;
}

export interface GeminiInsight {
  summary: string;
  suggestedFormats: FileFormat[];
  fileQuality: string;
}