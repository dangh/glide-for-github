/**
 * Rendered comment bodies: GitHub's `bodyHTML` / `/preview` output. That HTML is produced and sanitized by GitHub
 * (the same markup github.com shows). Because the viewer page can read the stored token, it is filtered again here
 * (defense in depth, `sanitizeHtml`), and the extension page's CSP (`script-src 'self'`) blocks inline scripts.
 * Links open in a new tab: following them inside the viewer iframe would replace the viewer.
 */
import { memo, useCallback, useMemo } from 'react';

const DROP = 'script,style,iframe,frame,frameset,object,embed,form,button,textarea,select,meta,link,base,noscript,template';
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background']);

/** Removes active content from (already GitHub-sanitized) HTML: script-like elements, event handlers, non-http(s) URLs. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll(DROP).forEach((el) => el.remove());
  // Task list checkboxes stay (read-only); any other input goes.
  tpl.content.querySelectorAll('input').forEach((el) => (el.type === 'checkbox' ? el.setAttribute('disabled', '') : el.remove()));
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (name === 'style' && /expression|url\s*\(/i.test(attr.value))) el.removeAttribute(attr.name);
      else if (URL_ATTRS.has(name) && /^\s*(javascript|vbscript|data):/i.test(attr.value) && !(name === 'src' && /^\s*data:image\//i.test(attr.value)))
        el.removeAttribute(attr.name);
    }
  });
  return tpl.innerHTML;
}

const GITHUB = 'https://github.com';

/** Absolute http(s) URL for a link in GitHub's HTML (relative links are github.com paths), else null. */
export function linkUrl(href: string | null): string | null {
  if (!href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, GITHUB);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export const BodyHtml = memo(function BodyHtml({ html }: { html: string }) {
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.('a');
    if (!a) return;
    e.preventDefault();
    const url = linkUrl(a.getAttribute('href'));
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return <div className="markdown-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
});

/** A comment body: GitHub's HTML when known, else the markdown source as plain text (provisional comments). */
export function CommentBody({ html, text }: { html: string; text: string }) {
  if (html) return <BodyHtml html={html} />;
  return <div className="markdown-body markdown-plain">{text}</div>;
}
