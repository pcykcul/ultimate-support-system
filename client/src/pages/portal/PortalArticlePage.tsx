/**
 * Portal article reader: clean markdown body, breadcrumb back to the KB, and
 * helpful yes/no feedback — via the public help-center endpoint, so it is only
 * offered on public-audience articles. Always ends with a road to a human.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, HeartHandshake, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '@/api/client';
import { Button, Card, Textarea, timeAgo } from '@/lib/ui';
import { Markdown } from '@/lib/markdown';

interface PortalArticleData {
  id: string;
  title: string;
  body: string;
  updatedAt?: string;
  audience?: string;
  category?: { name: string; slug?: string } | null;
}

function FeedbackCard({ articleId }: { articleId: string }) {
  // The public feedback endpoint — used only for public-audience articles.
  const [stage, setStage] = useState<'idle' | 'comment' | 'done'>('idle');
  const [comment, setComment] = useState('');
  const feedback = useMutation({
    mutationFn: (v: { helpful: boolean; comment?: string }) =>
      api.post(`/api/help-center/articles/${articleId}/feedback`, v),
    onSuccess: () => setStage('done'),
  });

  return (
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
          <div className="flex flex-wrap gap-2 mt-2">
            <Button
              disabled={feedback.isPending}
              onClick={() => feedback.mutate({ helpful: false, comment: comment.trim() || undefined })}
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
  );
}

export default function PortalArticlePage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: article, isLoading, error } = useQuery({
    queryKey: ['portal', 'kb-article', slug],
    queryFn: () => api.get<PortalArticleData>(`/api/portal/kb/${slug}`),
    enabled: !!slug,
  });

  useEffect(() => {
    if (article) document.title = article.title;
  }, [article]);

  if (isLoading) return <p className="text-center text-gray-400 py-16">Loading article…</p>;

  if (error || !article) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="font-medium text-gray-700">Article not found</p>
        <p className="text-sm mt-1">It may have been unpublished or moved.</p>
        <Link to="/portal/kb" className="inline-block mt-3 text-sm text-brand underline">
          Back to help articles
        </Link>
      </div>
    );
  }

  return (
    <article className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-gray-500 mb-4 flex-wrap">
        <Link to="/portal/kb" className="hover:text-brand">
          Help articles
        </Link>
        {article.category && (
          <>
            <ChevronRight size={14} className="text-gray-300" />
            <span>{article.category.name}</span>
          </>
        )}
        <ChevronRight size={14} className="text-gray-300" />
        <span className="text-gray-700 truncate max-w-[14rem]">{article.title}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
      {article.updatedAt && (
        <p className="text-xs text-gray-400 mt-1">Updated {timeAgo(article.updatedAt)}</p>
      )}

      <Card className="mt-5 p-5 sm:p-6">
        <Markdown className="text-[15px] text-gray-800">{article.body}</Markdown>
      </Card>

      {/* Feedback via the public endpoint — only when the article itself is public. */}
      {article.audience === 'public' && <FeedbackCard articleId={article.id} />}

      {/* Every dead end leads to a person. */}
      <Card className="mt-5 p-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="flex items-start gap-2 text-sm text-gray-600 flex-1">
          <HeartHandshake size={16} className="shrink-0 text-brand mt-0.5" />
          Still stuck? A real person is happy to help.
        </p>
        <Link to="/portal/new" className="shrink-0">
          <Button variant="secondary" className="w-full sm:w-auto justify-center">
            Ask a human
          </Button>
        </Link>
      </Card>
    </article>
  );
}
