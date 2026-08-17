/**
 * Public help-center article: markdown body, breadcrumb, updated date,
 * "was this helpful?" feedback, and the human promise in the footer.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '@/api/client';
import { Button, Card, Textarea, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';
import { applyBrandColors, useBranding } from '@/lib/session';
import { HelpShell } from './shared';

interface HelpArticleData {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  category: { name: string; slug: string } | null;
}

export default function HelpArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { data: branding } = useBranding();

  useEffect(() => {
    if (branding) applyBrandColors(branding.colors);
  }, [branding]);

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['help', 'article', slug],
    queryFn: () => api.get<HelpArticleData>(`/api/help-center/articles/${slug}`),
    enabled: !!slug,
  });

  useEffect(() => {
    if (article) document.title = article.title;
  }, [article]);

  // Feedback flow: yes submits immediately; no asks for an optional comment first.
  const [stage, setStage] = useState<'idle' | 'comment' | 'done'>('idle');
  const [comment, setComment] = useState('');
  const feedback = useMutation({
    mutationFn: (v: { helpful: boolean; comment?: string }) =>
      api.post(`/api/help-center/articles/${article?.id}/feedback`, v),
    onSuccess: () => setStage('done'),
  });

  return (
    <HelpShell branding={branding}>
      {isLoading && <p className="text-center text-gray-400 py-16">Loading article…</p>}

      {!isLoading && (error || !article) && (
        <div className="text-center py-16 text-gray-500">
          <p className="font-medium text-gray-700">Article not found</p>
          <p className="text-sm mt-1">It may have been unpublished or moved.</p>
          <Link to="/help" className="inline-block mt-3 text-sm text-brand underline">
            Back to the help center
          </Link>
        </div>
      )}

      {article && (
        <article>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-gray-500 mb-4 flex-wrap">
            <Link to="/help" className="hover:text-brand">
              Help Center
            </Link>
            {article.category && (
              <>
                <ChevronRight size={14} className="text-gray-300" />
                <Link to={`/help#cat-${article.category.slug}`} className="hover:text-brand">
                  {article.category.name}
                </Link>
              </>
            )}
            <ChevronRight size={14} className="text-gray-300" />
            <span className="text-gray-700 truncate max-w-[16rem]">{article.title}</span>
          </nav>

          <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
          <p className="text-xs text-gray-400 mt-1">Updated {timeAgo(article.updatedAt)}</p>

          <Card className="mt-5 p-6">
            <Markdown className="text-[15px] text-gray-800">{article.body}</Markdown>
          </Card>

          {/* Feedback */}
          <Card className="mt-5 p-5">
            {stage === 'done' ? (
              <p className="text-sm text-gray-600">
                Thanks — your feedback goes straight to a real person on our team.
              </p>
            ) : stage === 'comment' ? (
              <div>
                <p className="text-sm font-medium text-gray-800">Sorry this didn't help.</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  What were you looking for? A human reads every response. (Optional)
                </p>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="mt-2"
                  placeholder="Tell us what was missing…"
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    disabled={feedback.isPending}
                    onClick={() =>
                      feedback.mutate({ helpful: false, comment: comment.trim() || undefined })
                    }
                  >
                    Send feedback
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={feedback.isPending}
                    onClick={() => feedback.mutate({ helpful: false })}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm font-medium text-gray-800">Was this article helpful?</p>
                <Button
                  variant="secondary"
                  disabled={feedback.isPending}
                  onClick={() => feedback.mutate({ helpful: true })}
                >
                  <ThumbsUp size={14} />
                  Yes
                </Button>
                <Button variant="secondary" disabled={feedback.isPending} onClick={() => setStage('comment')}>
                  <ThumbsDown size={14} />
                  No
                </Button>
                {feedback.isError && (
                  <span className="text-xs text-red-600">Couldn't record that — please try again.</span>
                )}
              </div>
            )}
          </Card>
        </article>
      )}
    </HelpShell>
  );
}
