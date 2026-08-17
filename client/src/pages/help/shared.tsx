/**
 * Shared chrome for the public help center. These pages are standalone
 * (no staff Layout, no auth guard) so they carry their own header/footer.
 */
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, LifeBuoy } from 'lucide-react';

export interface HelpBranding {
  name?: string | null;
  logoUrl?: string | null;
  helpCenterTitle?: string | null;
  humanPromise?: string | null;
  colors?: { brand?: string; brandSoft?: string; brandFg?: string } | null;
}

export const DEFAULT_PROMISE =
  'Every question here is answered by a real human — no bots, no AI, ever.';

/** Search snippets may carry FTS highlight markup; show them as plain text. */
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

export function HelpShell({
  branding,
  children,
}: {
  branding: HelpBranding | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/help" className="flex items-center gap-2 font-semibold text-gray-800">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded" />
            ) : (
              <span className="h-7 w-7 rounded bg-brand text-brand-fg flex items-center justify-center">
                <LifeBuoy size={15} />
              </span>
            )}
            <span className="truncate">{branding?.name ?? 'Help Center'}</span>
          </Link>
          <Link to="/portal" className="text-sm text-gray-500 hover:text-gray-800">
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8">{children}</main>

      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-2 text-sm text-gray-500">
          <HeartHandshake size={15} className="text-brand shrink-0" />
          <span>{branding?.humanPromise ?? DEFAULT_PROMISE}</span>
        </div>
      </footer>
    </div>
  );
}
