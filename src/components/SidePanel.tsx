import React from 'react';
import { Plane, Loader2, Share2, Download, FileImage, Moon, Sun, Cloud, LogOut } from 'lucide-react';
import PlanningForm from './PlanningForm';
import type { PlanningInput } from '../types';
import type { User } from '@supabase/supabase-js';

interface SidePanelProps {
  variant: 'desktop' | 'sheet';
  generating: boolean;
  hasItinerary: boolean;
  user: User | null;
  saving: boolean;
  savedSuccess: boolean;
  exporting: boolean;
  sharing: boolean;
  shareUrl: string | null;
  error: string;
  darkMode: boolean;
  onSubmit: (input: PlanningInput) => void;
  onSaveToCloud: () => void;
  onLogout: () => void;
  onToggleDark: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
  onShare: () => void;
}

export default function SidePanel({
  variant,
  generating,
  hasItinerary,
  user,
  saving,
  savedSuccess,
  exporting,
  sharing,
  shareUrl,
  error,
  darkMode,
  onSubmit,
  onSaveToCloud,
  onLogout,
  onToggleDark,
  onExportPng,
  onExportPdf,
  onShare,
}: SidePanelProps) {
  const isDesktop = variant === 'desktop';

  return (
    <div className={isDesktop ? 'p-8 pb-4' : 'p-5'} data-testid={`side-panel-${variant}`}>
      {isDesktop && (
        <>
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-2xl font-display font-medium tracking-wide items-center gap-2 flex">
              <Plane size={24} className="text-accent" />
              WAYFOUND
            </h1>
            <div className="flex gap-2">
              <button
                onClick={onToggleDark}
                className="p-2 rounded-full border border-border text-text-muted hover:text-text-main hover:bg-bg-base transition-colors"
                title="Toggle Theme"
              >
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
          <p className="text-text-muted font-sans text-sm mb-12">Find your way, anywhere.</p>
        </>
      )}

      <PlanningForm loading={generating} onSubmit={onSubmit} />

      {error && <p className="text-delete text-sm text-center mt-4">{error}</p>}

      <div className={isDesktop ? 'mt-auto pt-16 pb-8' : 'mt-8'}>
        <div className="border-t border-border pt-6 flex flex-col gap-3">
          <button
            onClick={onSaveToCloud}
            disabled={saving || !hasItinerary}
            className="flex items-center gap-3 text-sm text-text-muted hover:text-accent transition-colors w-full p-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
            {user ? (savedSuccess ? '已保存！' : '保存到云端') : '登录后保存到云端'}
          </button>
          <button
            onClick={onExportPng}
            disabled={exporting || !hasItinerary}
            data-testid="export-png-btn"
            className="flex items-center gap-3 text-sm text-text-muted hover:text-accent transition-colors w-full p-2 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileImage size={16} />}
            导出长图
          </button>
          <button
            onClick={onExportPdf}
            disabled={exporting || !hasItinerary}
            data-testid="export-pdf-btn"
            className="flex items-center gap-3 text-sm text-text-muted hover:text-accent transition-colors w-full p-2 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            导出 PDF
          </button>
          <button
            onClick={onShare}
            disabled={sharing || !hasItinerary}
            data-testid="share-btn"
            className="flex items-center gap-3 text-sm text-text-muted hover:text-accent transition-colors w-full p-2 disabled:opacity-50"
          >
            {sharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
            {shareUrl ? '已复制分享链接' : '生成分享链接'}
          </button>
          {shareUrl && (
            <p
              className="text-[11px] text-text-muted/80 break-all px-2"
              data-testid="share-url-display"
            >
              {shareUrl}
            </p>
          )}
          {user && (
            <button
              onClick={onLogout}
              className="flex items-center gap-3 text-sm text-text-muted hover:text-delete transition-colors w-full p-2"
            >
              <LogOut size={16} /> 退出 {user.email}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
