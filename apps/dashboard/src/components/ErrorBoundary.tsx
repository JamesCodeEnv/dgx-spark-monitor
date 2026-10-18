import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

/**
 * Without an error boundary a render-time exception unmounts the whole React tree
 * and the user just sees a blank page (hit 2026-10-01 on /#/gpu). Show the error
 * text instead so it can be reported/acted on.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info: info.componentStack ?? '' });
    // Also surface it in the browser console for copy/paste.
    console.error('[dashboard] render error:', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ background: '#2a1418', border: '1px solid #7f2b33', borderRadius: 10, padding: 14, color: '#ffd7db' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>页面渲染出错（已捕获，未白屏）</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{String(error?.stack ?? error?.message ?? error)}</pre>
        {info && (
          <details style={{ marginTop: 8, fontSize: 11, color: '#e0a2a8' }}>
            <summary>组件栈</summary>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{info}</pre>
          </details>
        )}
      </div>
    );
  }
}
