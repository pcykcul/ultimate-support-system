import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export interface Me {
  id: string;
  kind: 'staff' | 'customer';
  role: 'admin' | 'supervisor' | 'agent' | 'collaborator' | null;
  name: string;
  email: string | null;
  title: string | null;
  avatarUrl: string | null;
  timezone: string;
}

export interface Branding {
  name: string;
  logoUrl: string | null;
  colors: { brand?: string; brandSoft?: string; brandFg?: string } | null;
  /** Key of FONT_STACKS (or a raw CSS font-family string). */
  font: string | null;
  helpCenterTitle: string | null;
  humanPromise: string | null;
}

/** Curated font stacks — no external font requests, so self-hosted stays self-contained. */
export const FONT_STACKS: Record<string, { label: string; css: string }> = {
  system: {
    label: 'System (default)',
    css: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  humanist: {
    label: 'Humanist',
    css: "Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif",
  },
  geometric: {
    label: 'Geometric',
    css: "Avenir, Montserrat, Corbel, 'URW Gothic', source-sans-pro, sans-serif",
  },
  classical: {
    label: 'Classical serif',
    css: "Optima, Candara, 'Noto Sans', source-sans-pro, sans-serif",
  },
  editorial: {
    label: 'Editorial serif',
    css: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif",
  },
  rounded: {
    label: 'Rounded',
    css: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', Calibri, source-sans-pro, sans-serif",
  },
};

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch {
        return null;
      }
    },
  });
}

export function useBranding() {
  return useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get<Branding>('/api/settings/branding/public'),
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/api/auth/logout');
    qc.setQueryData(['me'], null);
    window.location.href = '/login';
  };
}

/** Apply instance branding to the CSS variables (white-label at runtime). */
export function applyBrandColors(colors: Branding['colors'], font?: Branding['font']) {
  const root = document.documentElement;
  if (colors) {
    if (colors.brand) root.style.setProperty('--brand', colors.brand);
    if (colors.brandSoft) root.style.setProperty('--brand-soft', colors.brandSoft);
    if (colors.brandFg) root.style.setProperty('--brand-fg', colors.brandFg);
  }
  if (font) {
    const stack = FONT_STACKS[font]?.css ?? font;
    root.style.setProperty('--font-sans', stack);
  }
}
