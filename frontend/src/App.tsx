// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OperatorPage } from './pages/OperatorPage';
import { DisplayPage } from './pages/DisplayPage';
import { ThemeProvider } from './theme';

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/operator" replace />} />
          <Route path="/operator" element={<OperatorPage />} />
          <Route path="/display" element={<DisplayPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
