import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'Đã xảy ra lỗi ngoài ý muốn.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CN8-2 Office ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 grid place-content-center bg-[#e8e7de] p-8 text-center text-[#27313e]">
          <div className="max-w-lg border border-[#d5d1ca] bg-[#fffdf8] p-8">
            <p className="text-xs font-medium tracking-wider text-[#737b85]">
              CN8-2 OFFICE
            </p>
            <h1 className="mt-2 text-xl font-semibold">
              Kết nối hoặc quyền truy cập chưa sẵn sàng
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#586474]">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 bg-[#353c45] px-5 py-2.5 text-sm font-medium text-[#f7f1d9] hover:bg-[#27313e]"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
