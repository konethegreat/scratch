import React from 'react';
import ErrorCard from './ErrorCard.jsx';
import { recordError } from './errors.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { mapped: null };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    const where = info?.componentStack?.split('\n')[1]?.trim();
    this.setState({ mapped: recordError(error, { where: where ? `render: ${where}` : 'render' }) });
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div style={{ maxWidth: 720, margin: '10vh auto', padding: 24 }}>
        <ErrorCard
          title="The interface hit an unexpected error"
          error={this.state.mapped || {
            code: 'UNKNOWN',
            message: 'The interface hit an unexpected error.',
            hint: 'Reload the page. Your saved jobs and settings are untouched.',
            retryable: true,
            requestId: null
          }}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
}
