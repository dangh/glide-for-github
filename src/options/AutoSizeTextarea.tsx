import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Keep wrapped lines visible too, including after a window resize or opening a details panel. */
export function AutoSizeTextarea({ value, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'value'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    resize();
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = field.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return <textarea {...props} ref={ref} rows={4} value={value} />;
}
