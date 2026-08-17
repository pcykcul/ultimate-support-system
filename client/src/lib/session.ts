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
  helpCenterTitle: string | null;
  humanPromise: string | null;
}

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
export function applyBrandColors(colors: Branding['colors']) {
  if (!colors) return;
  const root = document.documentElement;
  if (colors.brand) root.style.setProperty('--brand', colors.brand);
  if (colors.brandSoft) root.style.setProperty('--brand-soft', colors.brandSoft);
  if (colors.brandFg) root.style.setProperty('--brand-fg', colors.brandFg);
}
