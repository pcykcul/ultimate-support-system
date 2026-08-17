/**
 * KB health dashboard: what needs verifying, what customers searched for and
 * didn't find (the write-this-article queue), what's rated poorly, what's read most.
 */
import { type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Eye, FilePlus2, SearchX, ThumbsDown } from 'lucide-react';
import { api } from '@/api/client';
import { BackLink, Badge, Button, Card, PageHeader, timeAgo } from '@/lib/ui';
import { useMe } from '@/lib/session';
import { canAct, feedbackPct, type HealthArticle, type KbHealth } from './shared';

export default function KbHealthPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const editable = canAct(me);

  const { data, isLoading } = useQuery({
    queryKey: ['kb', 'health'],
    queryFn: () => api.get<KbHealth>('/api/kb/health'),
  });

  const createDraft = useMutation({
    mutationFn: (title: string) => api.post<{ id: string }>('/api/kb/articles', { title }),
    onSuccess: (article) => navigate(`/kb/${article.id}`),
  });

  const stale = data?.stale ?? [];
  const lowRated = data?.lowRated ?? [];
  const zero = data?.zeroResultQueries ?? [];
  const topViewed = data?.topViewed ?? [];

  return (
    <div>
      <BackLink to="/kb" label="Knowledge base" />
      <div className="mt-2">
        <PageHeader
          title="KB health"
          subtitle="Keep the knowledge base trustworthy: verify what's stale, write what's missing, fix what's not helping."
        />
      </div>

      {isLoading && <div className="py-16 text-center text-gray-400">Checking the knowledge base…</div>}

      {!isLoading && (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <Section
            icon={<AlertTriangle size={15} className="text-red-500" />}
            title="Needs review"
            count={stale.length}
            empty="Nothing is overdue for verification. Well kept."
          >
            {stale.map((a) => (
              <ArticleRow key={a.id} article={a}>
                <span className="text-xs text-red-600 shrink-0">
                  {a.verifiedAt ? `verified ${timeAgo(a.verifiedAt)}` : 'never verified'}
                </span>
              </ArticleRow>
            ))}
          </Section>

          <Section
            icon={<SearchX size={15} className="text-brand" />}
            title="Zero-result searches"
            count={zero.length}
            hint="Customers looked for these and found nothing — the write-this-article queue."
            empty="Every recent search found something."
          >
            {zero.map((z) => (
              <div key={z.query} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">“{z.query}”</p>
                  <p className="text-xs text-gray-400">last searched {timeAgo(z.lastAt)}</p>
                </div>
                <Badge color="gray">{z.count}×</Badge>
                {editable && (
                  <Button
                    variant="secondary"
                    className="!px-2.5"
                    disabled={createDraft.isPending}
                    onClick={() => createDraft.mutate(z.query)}
                  >
                    <FilePlus2 size={14} />
                    Create draft
                  </Button>
                )}
              </div>
            ))}
          </Section>

          <Section
            icon={<ThumbsDown size={15} className="text-yellow-600" />}
            title="Low-rated articles"
            count={lowRated.length}
            hint="Readers said these didn't help. Rewrite or retire them."
            empty="No poorly rated articles."
          >
            {lowRated.map((a) => (
              <ArticleRow key={a.id} article={a}>
                <span className="text-xs text-red-600 shrink-0">
                  {feedbackPct(a.helpfulYes, a.helpfulNo)} helpful
                  <span className="text-gray-400"> ({(a.helpfulYes ?? 0) + (a.helpfulNo ?? 0)} votes)</span>
                </span>
              </ArticleRow>
            ))}
          </Section>

          <Section
            icon={<Eye size={15} className="text-green-600" />}
            title="Top viewed"
            count={topViewed.length}
            hint="Your most-read answers — keep these especially accurate."
            empty="No views recorded yet."
          >
            {topViewed.map((a) => (
              <ArticleRow key={a.id} article={a}>
                <span className="text-xs text-gray-500 shrink-0">{a.viewCount ?? 0} views</span>
              </ArticleRow>
            ))}
          </Section>
        </div>
      )}

      {createDraft.isError && (
        <p className="mt-3 text-sm text-red-600">
          {createDraft.error instanceof Error ? createDraft.error.message : 'Could not create the draft.'}
        </p>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  hint,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  hint?: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs text-gray-400">{count}</span>
        </div>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {count === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="divide-y divide-gray-100">{children}</div>
      )}
    </Card>
  );
}

function ArticleRow({ article, children }: { article: HealthArticle; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Link
        to={`/kb/${article.id}`}
        className="flex-1 min-w-0 text-sm font-medium text-gray-800 hover:text-brand truncate"
      >
        {article.title}
      </Link>
      {children}
    </div>
  );
}
