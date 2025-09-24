import React from 'react';

type State = { hasError: boolean; error?: any; info?: any };

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: any) { this.setState({ info }); }
  render() {
    if (!this.state.hasError) return this.props.children as any;
    const err = String(this.state.error || 'Unknown error');
    const stack = this.state.info?.componentStack || '';
    return (
      <div style={{ padding: 16, color: 'var(--text)', background: 'var(--bg)', height: '100%', boxSizing: 'border-box' }}>
        <div className="pixel-text" style={{ fontSize: 16, color: 'var(--accent)', marginBottom: 8 }}>UI Error</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{err}\n{stack}</pre>
        <button className="tab" onClick={() => location.reload()} style={{ marginTop: 8 }}>Reload</button>
      </div>
    );
  }
}
