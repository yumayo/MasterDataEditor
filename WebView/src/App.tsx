import {useState} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

export function App() {
    const [queryClient] = useState(() => new QueryClient());
    return (
        <QueryClientProvider client={queryClient}>
            {/* Phase 1以降でReactコンポーネントをここに追加していく */}
        </QueryClientProvider>
    );
}
